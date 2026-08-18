/**
 * 猛鬼宿舍·躺平发育 —— Web 试玩版控制器
 * 直接复用小程序核心 js/core/gameCore.js（同一份数值逻辑，零分叉）
 * 广告为 3 秒倒计时模拟（Web 无真实广告位）
 */
(function () {
  'use strict';
  // 惰性绑定核心模块：bootstrap.js 是异步 fetch 加载 gameCore.js 的，
  // 本脚本解析时 window.core 还不存在，必须在 init 前拿到引用
  let core = null;
  let formatNum = null, formatDuration = null;
  function bindModules() {
    core = window.core;
    formatNum = window.num.formatNum;
    formatDuration = window.num.formatDuration;
  }
  const SAVE_KEY = 'menggui_tangping_save_web_v1';

  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  let s = null;
  let pendingOffline = null;
  let toastTimer = null;
  let adTimer = null;
  let loopTimer = null;

  // ============ 存档 ============
  function save() {
    if (!s) return;
    try { localStorage.setItem(SAVE_KEY, core.save(s)); } catch (e) { /* 忽略 */ }
  }
  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? core.load(raw) : null;
    } catch (e) { return null; }
  }

  function init() {
    bindModules();
    s = loadSave();
    if (s) {
      const off = core.computeOffline(s, Date.now() / 1000);
      if (off.seconds >= 30) {
        pendingOffline = off;
        showOffline();
      } else {
        s.lastSave = Date.now();
      }
    } else {
      s = core.newGame();
      save();
      toast('欢迎来到猛鬼宿舍！躺平睡觉赚金币，挡住猛鬼~');
    }
    buildStaticUI();
    loopTimer = setInterval(tickOnce, 1000);
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
    window.addEventListener('beforeunload', save);
    refresh();
  }

  function tickOnce() {
    if (!s) return;
    const events = core.tick(s, 1);
    if (events.length) {
      for (const e of events) onEvent(e);
      if (events.some(e => ['defeat', 'wave_cleared', 'first_kill', 'boss_killed'].includes(e.type))) save();
    }
    refresh();
  }

  function onEvent(e) {
    if (e.type === 'wave_start') {
      toast(e.boss ? '⚠️ 第 ' + e.wave + ' 波 BOSS 来袭！' : '第 ' + e.wave + ' 波猛鬼来袭！(' + e.ghostCount + '只)');
    }
    if (e.type === 'boss_killed') toast('🏆 Boss 被击杀！灵魂大增！');
    if (e.type === 'wave_cleared') toast((e.boss ? 'BOSS 波清除！' : '第 ' + e.wave + ' 波清除！') + ' 灵魂+' + e.bonus);
    if (e.type === 'defeat') {
      $('defeatWaveText').textContent = '第 ' + e.wave + ' 波猛鬼冲进了宿舍…';
      $('defeatModal').style.display = 'flex';
    }
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2200);
  }

  // ============ 广告模拟 ============
  function playAd(key, onDone) {
    const modal = $('adModal');
    modal.style.display = 'flex';
    let n = 3;
    $('adCount').textContent = n;
    if (adTimer) clearInterval(adTimer);
    adTimer = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(adTimer);
        adTimer = null;
        modal.style.display = 'none';
        onDone();
      } else {
        $('adCount').textContent = n;
      }
    }, 1000);
  }

  function adState(key) {
    const c = core.canUseAd(s, key);
    return { ok: c.ok, text: c.ok ? '' : (c.remain ? formatDuration(c.remain) : (c.msg || '')) };
  }

  function doAd(key, apply) {
    playAd(key, () => {
      const r = core.applyAd(s, key, apply);
      if (r.ok) {
        core.markAdUsed(s, key);
        save();
        if (key === 'coin_bonus') toast('金币 +' + formatNum(r.bonus));
        if (key === 'income_boost') toast('双倍收益 1 小时！');
        if (key === 'door_fix') toast('大门已修复');
        if (key === 'revive') toast('复活成功！');
        if (key === 'daily_bonus') toast('每日福利：金币+' + formatNum(r.bonus) + ' 灵魂+100');
        if (key === 'hero_deal') toast('英雄7折券生效！下次购买/升级生效');
      } else {
        toast(r.msg || '广告奖励不可用');
      }
      refresh();
    });
  }

  // ============ 静态 UI 构建 ============
  const bedRefs = [], heroRefs = [], questRefs = [], achRefs = [], adRefs = {};

  function buildStaticUI() {
    // 床
    const bg = $('bedGrid');
    for (let i = 0; i < core.MAX_BEDS; i++) {
      const card = el('div', 'bed-card');
      const img = el('img', 'bed-img'); img.src = '../images/sprites/bed.png';
      const lv = el('div', 'bed-lv');
      const cps = el('div', 'bed-cps');
      const btn = el('button', 'btn-up');
      card.append(img, lv, cps, btn);
      btn.onclick = () => {
        const st = s.beds[i];
        let r;
        if (!st.unlocked) {
          r = core.tryUnlockBed(s, i);
          if (r.ok) toast('床 ' + (i + 1) + ' 解锁！'); else toast(r.msg);
        } else {
          r = core.tryUpgradeBed(s, i);
          if (r.ok) toast('床升到 ' + r.level + ' 级'); else toast(r.msg);
        }
        if (r.ok) { save(); refresh(); }
      };
      bg.appendChild(card);
      bedRefs.push({ card, lv, cps, btn });
    }
    // 英雄
    const hg = $('heroGrid');
    core.HEROES.forEach((h, i) => {
      const card = el('div', 'hero-card');
      card.setAttribute('role', 'button');
      const img = el('img', 'hero-img'); img.src = h.icon.replace('/images/', '../images/');
      const name = el('div', 'hero-name', h.name);
      const type = el('div', 'hero-type');
      const desc = el('div', 'hero-desc', h.desc);
      const btn = el('button', 'hero-btn');
      card.append(img, name, type, desc, btn);
      card.onclick = () => onHeroTap(i);
      hg.appendChild(card);
      heroRefs.push({ card, type, btn });
    });
    // 任务
    const ql = $('questList');
    for (let i = 0; i < 3; i++) {
      const item = el('div', 'quest-item');
      const info = el('div', 'quest-info');
      const nm = el('div', 'quest-name');
      const bar = el('div', 'quest-bar');
      const fill = el('div', 'quest-fill');
      bar.appendChild(fill);
      const prog = el('div', 'quest-progress');
      const btn = el('button', 'btn-quest');
      item.append(info, btn);
      info.append(nm, bar, prog);
      btn.onclick = () => onQuestClaim(i);
      ql.appendChild(item);
      questRefs.push({ item, nm, fill, prog, btn });
    }
    // 成就
    const al = $('achList');
    core.ACHIEVEMENTS.forEach(a => {
      const item = el('div', 'ach-item');
      const info = el('div', 'ach-info');
      const nm = el('div', 'ach-name');
      const desc = el('div', 'ach-desc', a.desc + ' · 奖励 ' + a.reward + ' 灵魂');
      const btn = el('button', 'btn-quest small');
      item.append(info, btn);
      info.append(nm, desc);
      btn.onclick = () => {
        const r = core.claimAchievement(s, a.id);
        if (!r.ok) { toast(r.msg); return; }
        save(); toast('成就达成！灵魂 +' + r.reward); refresh();
      };
      al.appendChild(item);
      achRefs.push({ item, nm, btn, id: a.id });
    });
    // 广告卡
    const ag = $('adGrid');
    const adDefs = [
      { key: 'coin_bonus', ico: 'coin.png', icoDir: 'icons', name: '金币红包', desc: '看广告领金币' },
      { key: 'income_boost', ico: 'ui_fast.png', icoDir: 'icons', name: '双倍收益', desc: '1小时产量x2' },
      { key: 'door_fix', ico: 'door_1.png', icoDir: 'tiles', name: '修复大门', desc: '门残血可用' },
      { key: 'wave_delay', ico: 'ui_ad.png', icoDir: 'icons', name: '延迟猛鬼', desc: '猛鬼迟到10分钟' },
      { key: 'daily_bonus', ico: 'ui_medal1.png', icoDir: 'icons', name: '每日福利', desc: '金币+灵魂 每天1次', cls: 'daily' },
      { key: 'hero_deal', ico: 'sword_gold.png', icoDir: 'icons', name: '英雄7折', desc: '招募/升级7折' }
    ];
    adDefs.forEach(d => {
      const card = el('div', 'ad-card' + (d.cls ? ' ' + d.cls : ''));
      card.setAttribute('role', 'button');
      const img = el('img', 'ad-ico'); img.src = '../images/' + d.icoDir + '/' + d.ico;
      const nm = el('div', 'ad-name', d.name);
      const sub = el('div', 'ad-sub', d.desc);
      card.append(img, nm, sub);
      card.onclick = () => onAdTap(d.key, sub);
      ag.appendChild(card);
      adRefs[d.key] = { card, sub, nm };
    });

    // 防御设施按钮
    $('doorBtn').onclick = () => {
      const r = core.tryUpgradeDoor(s);
      if (!r.ok) toast(r.msg); else { save(); toast('大门升到 ' + r.level + ' 级，已回满血'); refresh(); }
    };
    $('turretBtn').onclick = () => {
      const r = core.tryUpgradeTurret(s);
      if (!r.ok) toast(r.msg); else { save(); toast('炮塔升到 ' + r.level + ' 级'); refresh(); }
    };
    $('altarBtn').onclick = () => {
      const r = core.tryUpgradeAltar(s);
      if (!r.ok) toast(r.msg); else { save(); toast('祭坛升到 ' + r.level + ' 级'); refresh(); }
    };
    // 弹窗
    $('reviveBtn').onclick = () => {
      playAd('revive', () => {
        const r = core.applyAd(s, 'revive');
        if (r.ok) { core.markAdUsed(s, 'revive'); save(); toast('复活成功！'); }
        else toast(r.msg || '复活失败');
        $('defeatModal').style.display = 'none';
        refresh();
      });
    };
    $('acceptBtn').onclick = () => {
      const r = core.acceptDefeat(s);
      if (r.ok) { save(); toast('宿舍被攻陷… 重新开始新一轮'); }
      $('defeatModal').style.display = 'none';
      refresh();
    };
    $('offClaim').onclick = () => settleOffline(false);
    $('offDouble').onclick = () => {
      playAd('offline_double', () => settleOffline(true));
    };
    $('resetBtn').onclick = () => {
      showConfirm('确认重置？', '所有进度将清空，无法恢复！', () => {
        localStorage.removeItem(SAVE_KEY);
        s = core.newGame();
        save();
        toast('已重置，重新开始躺平');
        refresh();
      });
    };
    $('confirmOk').onclick = () => { const cb = $('confirmModal')._cb; $('confirmModal').style.display = 'none'; if (cb) cb(); };
    $('confirmCancel').onclick = () => { $('confirmModal').style.display = 'none'; $('confirmModal')._cb = null; };
  }

  function onHeroTap(i) {
    const h = core.HEROES[i];
    const st = s.heroes[i];
    if (!st.unlocked) {
      const cost = s.heroDeal ? Math.floor(h.unlockSoul * core.HERO_DEAL_PCT) : h.unlockSoul;
      if (s.soul < cost) { toast('灵魂不足 (' + cost + ')'); return; }
      showConfirm('招募 ' + h.name, '花费 ' + cost + ' 灵魂招募' + h.name + '？\n' + h.desc, () => {
        const r = core.tryBuyHero(s, i);
        if (!r.ok) toast(r.msg); else { save(); toast('成功招募 ' + h.name + '！'); refresh(); }
      });
      return;
    }
    if (st.level >= h.maxLevel) { toast('已满级'); return; }
    const r = core.tryUpgradeHero(s, i);
    if (!r.ok) toast(r.msg); else { save(); toast(h.name + ' 升到 ' + r.level + ' 级'); refresh(); }
  }

  function onQuestClaim(i) {
    const q = s.daily.quests[i];
    if (!q || q.claimed) return;
    if (q.progress < q.need) { toast('任务未完成'); return; }
    playAd('task_reward', () => {
      const r = core.claimQuest(s, i);
      if (!r.ok) { toast(r.msg); return; }
      save(); toast('任务完成！灵魂 +' + r.reward); refresh();
    });
  }

  function onAdTap(key, subEl) {
    const st = adState(key);
    if (!st.ok) { toast(st.text || '暂不可用'); return; }
    doAd(key);
  }

  function showConfirm(title, text, cb) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmModal')._cb = cb;
    $('confirmModal').style.display = 'flex';
  }

  function showOffline() {
    const off = pendingOffline;
    if (!off) return;
    $('offSec').textContent = formatDuration(off.seconds);
    $('offCoin').textContent = formatNum(off.coin);
    $('offCap').style.display = off.capped ? 'block' : 'none';
    $('offlineModal').style.display = 'flex';
  }

  function settleOffline(double) {
    if (!pendingOffline) return;
    core.applyOffline(s, Date.now() / 1000, double);
    pendingOffline = null;
    save();
    $('offlineModal').style.display = 'none';
    toast('离线收益已领取' + (double ? '（x2）' : ''));
    refresh();
  }

  // ============ 每秒刷新 ============
  function refresh() {
    if (!s) return;
    $('coinText').textContent = formatNum(s.coin);
    $('cpsText').textContent = '+' + formatNum(core.coinPerSec(s)) + '/s';
    $('soulText').textContent = formatNum(Math.floor(s.soul));
    $('levelText').textContent = 'Lv.' + s.level;
    $('expFill').style.width = Math.min(100, s.totalExp / core.expForLevel(s.level) * 100) + '%';

    // 床
    s.beds.forEach((b, i) => {
      const ref = bedRefs[i];
      const cost = b.unlocked ? core.bedCost(s, i) : core.unlockBedCost(s, i);
      const can = s.coin >= cost;
      ref.card.className = 'bed-card' + (b.unlocked ? '' : ' locked');
      ref.lv.textContent = b.unlocked ? 'Lv.' + b.level : '🔒';
      ref.lv.style.fontSize = b.unlocked ? '' : '30rpx';
      ref.cps.textContent = b.unlocked ? '+' + core.bedCoinPerSec(b).toFixed(1) + '/s' : '';
      ref.btn.textContent = (b.unlocked ? '升级 ' : '解锁 ') + formatNum(cost);
      ref.btn.classList.toggle('disabled', !can);
    });

    // 门/炮塔/祭坛
    const doorMax = core.doorMaxHp(s);
    const doorPct = Math.max(0, s.door.hp / doorMax * 100);
    $('doorImg').src = '../images/tiles/' + (s.door.level >= 20 ? 'door_3' : s.door.level >= 5 ? 'door_2' : 'door_1') + '.png';
    $('doorName').textContent = '大门 Lv.' + s.door.level;
    $('doorHp').textContent = '血 ' + formatNum(Math.floor(s.door.hp)) + '/' + formatNum(doorMax);
    const hpFill = $('doorHpFill');
    hpFill.style.width = doorPct + '%';
    hpFill.classList.toggle('hp-low', doorPct < 35);
    $('doorDps').textContent = '反击 ' + formatNum(core.doorCounterDps(s) + core.heroDpsTotal(s)) + '/s（含英雄）';
    const dCost = core.doorCost(s);
    $('doorBtn').textContent = '升级 ' + formatNum(dCost);
    $('doorBtn').classList.toggle('disabled', s.coin < dCost);
    $('turretName').textContent = '炮塔 Lv.' + s.turret.level;
    $('turretDps').textContent = '伤害 ' + formatNum(core.turretDps(s)) + '/s';
    const tCost = core.turretCost(s);
    $('turretBtn').textContent = '升级 ' + formatNum(tCost);
    $('turretBtn').classList.toggle('disabled', s.coin < tCost);
    $('altarName').textContent = '灵魂祭坛 Lv.' + s.altar.level;
    $('altarBonus').textContent = '全局产量 +' + Math.floor(s.altar.level * core.BUILDINGS.altar.bonusPerLevel * 100) + '%';
    const aCost = core.altarCost(s);
    $('altarBtn').textContent = '献祭 ' + formatNum(aCost);
    $('altarBtn').classList.toggle('disabled', s.soul < aCost);

    // 波次
    const threat = core.nextWaveThreat(s);
    const bossActive = s.ghosts.some(g => g.boss);
    $('waveTitle').textContent = '第 ' + s.wave + ' 波猛鬼';
    $('waveGhost').src = bossActive ? '../images/sprites/ghost_4.png' : '../images/sprites/ghost_1.png';
    $('waveGhost').style.display = s.wave > 0 ? '' : 'none';
    $('nextWaveText').textContent = s.ghosts.length > 0
      ? '战斗中 (剩' + s.ghosts.length + '只' + (bossActive ? '·BOSS' : '') + ')'
      : '下一波 ' + formatDuration(Math.max(0, s.nextWaveAt - s.time)) + (threat.boss ? ' ·BOSS' : '');
    $('waveBanner').classList.toggle('danger', !threat.safe && s.ghosts.length === 0);
    $('waveBanner').classList.toggle('boss', bossActive);
    $('threatTag').style.display = (!threat.safe && s.ghosts.length === 0) ? '' : 'none';
    $('threatTag').textContent = bossActive ? '⚠️ BOSS 战斗中！' : (threat.boss && s.ghosts.length === 0 ? '⚠️ Boss 波将至！' : '危险！建议升级防御');

    // 英雄
    core.HEROES.forEach((h, i) => {
      const st = s.heroes[i];
      const ref = heroRefs[i];
      const upCost = st.unlocked ? core.heroUpgradeCost(s, i) : h.unlockSoul;
      const cost = s.heroDeal ? Math.floor(upCost * core.HERO_DEAL_PCT) : upCost;
      const can = st.unlocked ? s.coin >= cost : s.soul >= cost;
      ref.card.className = 'hero-card' + (st.unlocked ? '' : ' locked');
      ref.type.textContent = (h.type === 'dps' ? '攻击' : h.type === 'slow' ? '减伤' : '治疗') + ' · Lv.' + st.level + '/' + h.maxLevel;
      ref.btn.textContent = (st.unlocked ? '升级 ' : '招募 ') + formatNum(cost) + (st.unlocked ? '' : ' 灵魂');
      ref.btn.classList.toggle('disabled', !can);
    });
    $('dealTag').style.display = s.heroDeal ? '' : 'none';

    // 任务
    s.daily.quests.forEach((q, i) => {
      const ref = questRefs[i];
      ref.nm.textContent = q.name;
      ref.fill.style.width = (q.progress / q.need * 100) + '%';
      ref.prog.textContent = Math.floor(q.progress) + '/' + q.need + ' · 奖励 ' + q.reward + ' 灵魂';
      ref.btn.textContent = q.claimed ? '已领取' : '📺 领取';
      ref.btn.className = 'btn-quest' + (q.claimed ? ' claimed' : (q.progress >= q.need ? '' : ' disabled'));
    });

    // 成就
    const achList = core.listAchievements(s);
    achList.forEach((a, i) => {
      const ref = achRefs[i];
      ref.nm.textContent = (a.unlocked ? '🏅 ' : '🔒 ') + a.name;
      ref.nm.classList.toggle('dim', !a.unlocked);
      ref.item.classList.toggle('claimed', a.claimed);
      ref.btn.textContent = a.claimed ? '已领取' : (a.unlocked ? '领取' : '未达成');
      ref.btn.className = 'btn-quest small' + (a.claimed ? ' claimed' : (a.unlocked ? '' : ' disabled'));
    });

    // 广告卡
    const boostOn = s.time < s.incomeBoostUntil;
    adRefs.coin_bonus.sub.textContent = adState('coin_bonus').ok ? '看广告领金币' : adState('coin_bonus').text;
    adRefs.income_boost.sub.textContent = boostOn ? '剩 ' + formatDuration(s.incomeBoostUntil - s.time) : (adState('income_boost').ok ? '1小时产量x2' : adState('income_boost').text);
    const doorSt = adState('door_fix');
    adRefs.door_fix.sub.textContent = doorSt.ok ? (s.door.hp / doorMax < 0.4 ? '门残血可修复' : '门还健康') : doorSt.text;
    adRefs.wave_delay.sub.textContent = adState('wave_delay').ok ? '猛鬼迟到10分钟' : adState('wave_delay').text;
    adRefs.daily_bonus.sub.textContent = adState('daily_bonus').ok ? '金币+灵魂 每天1次' : adState('daily_bonus').text;
    adRefs.hero_deal.sub.textContent = s.heroDeal ? '折扣生效中' : (adState('hero_deal').ok ? '英雄招募/升级7折' : adState('hero_deal').text);
    adRefs.income_boost.card.classList.toggle('active', boostOn);
  }

  // 等核心模块（bootstrap.js fetch 加载）就绪后再启动
  if (window.core && window.num) {
    init();
  } else {
    document.addEventListener('core-modules-ready', init, { once: true });
  }
})();
