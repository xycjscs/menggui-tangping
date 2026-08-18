/**
 * 猛鬼宿舍·躺平发育 —— Web 试玩版控制器 v0.4（三屏流程）
 *  首页（关卡选择/奖励/长效设置）→ 进入页（关卡详情+支援）→ 游戏（战场为主，点哪里弹哪里）
 * 复用 js/core/gameCore.js（数值零分叉）+ js/battle/battleView.js（战场）+ js/levels.js（关卡）
 * 广告为 3 秒倒计时模拟（Web 无真实广告位）
 */
(function () {
  'use strict';
  let core = null, LVL = null;
  let formatNum = null, formatDuration = null;
  function bindModules() {
    core = window.core;
    LVL = window.MGLLevels;
    formatNum = window.num.formatNum;
    formatDuration = window.num.formatDuration;
  }

  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // ============ 持久化（长效数据：钱包 / 关卡进度 / 设置）============
  const META_KEY = 'menggui_tangping_meta_v1';
  let meta = {
    coin: 0, soul: 0,                 // 钱包（跨关卡累计）
    progress: { unlocked: 1, stars: {} },  // 关卡进度
    settings: { resetAt: 0 },
    dailyBonusDate: ''
  };
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {} }
  function loadMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (raw) meta = Object.assign(meta, JSON.parse(raw));
    } catch (e) { /* 坏档用默认 */ }
  }

  // ============ 运行时 ============
  let s = null;            // 当前局 core 状态
  let currentLevel = null; // 当前关卡定义
  let supportPick = 'coin';// 入场支援
  let eliteUsed = false;   // 本局是否买精锐支援
  let revivesUsed = 0;     // 本局复活次数（定星级）
  let won = false;
  let battle = null, battleImgs = {};
  let loopTimer = null;
  let toastTimer = null, adTimer = null;
  let tapTarget = null;    // 当前打开的点触菜单目标 {type,index}

  const BATTLE_IMGS = [
    ['floor', '../images/tiles/floor_wood.png'], ['brick', '../images/tiles/brick.png'],
    ['bed', '../images/sprites/bed.png'], ['ghost1', '../images/sprites/ghost_1.png'],
    ['ghost2', '../images/sprites/ghost_2.png'], ['ghost3', '../images/sprites/ghost_3.png'],
    ['boss', '../images/sprites/ghost_4.png'], ['door1', '../images/tiles/door_1.png'],
    ['door2', '../images/tiles/door_2.png'], ['door3', '../images/tiles/door_3.png'],
    ['coin', '../images/icons/coin.png'], ['soul', '../images/icons/soul.png'],
    ['knight', '../images/icons/sword_gold.png'], ['archer', '../images/icons/sword_green.png'],
    ['mage', '../images/icons/sword_purple.png'], ['priest', '../images/icons/sword_orange.png']
  ];
  function preloadBattleImages() {
    return Promise.all(BATTLE_IMGS.map(p => new Promise(res => {
      const img = new Image();
      img.onload = () => { battleImgs[p[0]] = img; res(); };
      img.onerror = () => res();
      img.src = p[1];
    })));
  }

  // ============ 调试钩子 ============
  window.__game = {
    get state() { return s; }, get core() { return core; },
    get battle() { return battle; }, get meta() { return meta; },
    forceWin() { if (s && currentLevel) s.wave = currentLevel.wave; },
    startLevel(id) { startLevel(id); }
  };

  // ============ 屏幕路由 ============
  function showScreen(name) {
    ['Home', 'Entry', 'Game'].forEach(n => {
      $('screen' + n).style.display = (n.toLowerCase() === name) ? '' : 'none';
    });
  }
  function goHome() { closeTapMenu(); stopBattleLoop(); showScreen('home'); refreshHome(); }
  function goEntry() { refreshEntry(); showScreen('entry'); }

  // ============ 首页 ============
  function refreshHome() {
    $('wCoin').textContent = formatNum(Math.floor(meta.coin));
    $('wSoul').textContent = formatNum(Math.floor(meta.soul));
    // 关卡网格
    const grid = $('levelGrid'); grid.innerHTML = '';
    LVL.LEVELS.forEach(lv => {
      const unlocked = LVL.isUnlocked(meta.progress, lv.id);
      const stars = LVL.bestStars(meta.progress, lv.id);
      const card = el('div', 'level-card' + (unlocked ? '' : ' locked') + (stars ? ' done' : ''));
      // 紧凑 3 行：关号+星级同行 / 名称 / 副标题（矮屏不裁切）
      const top = el('div', 'level-top');
      top.appendChild(el('span', 'level-id', '第 ' + lv.id + ' 关'));
      const st = el('span', 'level-stars');
      for (let i = 0; i < 3; i++) st.appendChild(el('i', 'star' + (i < stars ? ' on' : ''), i < stars ? '★' : '☆'));
      top.appendChild(st);
      const nm = el('div', 'level-name', lv.name);
      const sub = el('div', 'level-sub', unlocked ? lv.sub : '🔒 通关上一关解锁');
      card.append(top, nm, sub);
      if (unlocked) card.onclick = () => openEntry(lv);
      grid.appendChild(card);
    });
  }
  function openEntry(lv) {
    currentLevel = lv; supportPick = 'coin'; eliteUsed = false;
    buildEntry(); showScreen('entry');
  }
  function buildEntry() {
    const lv = currentLevel;
    $('entryId').textContent = '关卡 ' + lv.id;
    $('entryName').textContent = lv.name;
    $('entrySub').textContent = lv.sub;
    $('entryGoal').textContent = lv.wave;
    const stars = LVL.bestStars(meta.progress, lv.id);
    const se = $('entryStars'); se.innerHTML = '';
    for (let i = 0; i < 3; i++) se.appendChild(el('span', 'star big' + (i < stars ? ' on' : ''), i < stars ? '★' : '☆'));
    // 初始配置
    const init = $('entryInit'); init.innerHTML = '';
    const heroNames = lv.init.heroes.map(i => core.HEROES[i].name).join('、');
    init.append(
      el('span', 'init-chip', '💰 ' + formatNum(lv.init.coin)),
      el('span', 'init-chip', '🏚 大门 Lv.' + lv.init.door),
      el('span', 'init-chip', '🗼 炮塔 Lv.' + lv.init.turret),
      el('span', 'init-chip', '🛏 ×' + lv.init.beds),
      lv.init.soul > 0 ? el('span', 'init-chip', '👻 ' + formatNum(lv.init.soul)) : document.createDocumentFragment(),
      heroNames ? el('span', 'init-chip', '⚔ ' + heroNames) : document.createDocumentFragment()
    );
    // 支援
    const row = $('supportRow'); row.innerHTML = '';
    LVL.SUPPORT_DEFS.forEach(sf => {
      const c = el('div', 'support-card' + (sf.kind === supportPick ? ' picked' : ''));
      c.append(
        el('img', 'support-ico', ''),
        el('div', 'support-name', sf.name),
        el('div', 'support-desc', sf.desc)
      );
      c.querySelector('img').src = '../images/' + sf.icoDir + '/' + sf.icon;
      c.onclick = () => { supportPick = sf.kind; buildEntry(); };
      row.appendChild(c);
    });
    // 精锐支援
    const ef = LVL.eliteSupport(lv);
    $('eliteInfo').innerHTML = '';
    $('eliteInfo').append(
      el('span', 'elite-cost', '💰 ' + formatNum(ef.cost.coin)),
      el('span', 'elite-gain', '开局 +' + formatNum(ef.gain.coin) + ' 金币 / +' + formatNum(ef.gain.soul) + ' 灵魂')
    );
  }

  // ============ 开始一局 ============
  function startLevel(id) {
    const lv = LVL.getLevel(id);
    if (!lv) return;
    if (!LVL.isUnlocked(meta.progress, lv.id)) { toast('先通关上一关'); return; }
    const wantElite = eliteUsed;      // 先读，再重置
    currentLevel = lv; supportPick = 'coin'; eliteUsed = false; revivesUsed = 0; won = false;
    // 构建 core 状态（从 newGame 再按关卡配置覆盖）
    s = core.newGame();
    s.coin = lv.init.coin;
    s.soul = lv.init.soul;
    s.door = { level: lv.init.door, hp: core.doorMaxHp(s) };
    s.turret = { level: lv.init.turret };
    s.altar = { level: lv.init.altar };
    for (let i = 0; i < core.MAX_BEDS; i++) {
      s.beds[i] = (i < lv.init.beds) ? { level: 1, unlocked: true } : { level: 0, unlocked: false };
    }
    s.heroes = core.HEROES.map(() => ({ unlocked: false, level: 0 }));
    lv.init.heroes.forEach(i => { s.heroes[i] = { unlocked: true, level: 1 }; });
    // 入场支援
    const sup = LVL.supportEffect(lv, supportPick);
    s.coin += sup.coin || 0; s.soul += sup.soul || 0;
    if (sup.door) { s.door.level += sup.door; s.door.hp = core.doorMaxHp(s); }
    // 精锐支援（进入页勾选过则生效，钱包扣费）
    if (wantElite) {
      const ef = LVL.eliteSupport(lv);
      s.coin += ef.gain.coin; s.soul += ef.gain.soul;
      meta.coin -= ef.cost.coin;
    }
    s.time = 0; s.nextWaveAt = 30; s.ghosts = [];
    saveMeta();
    setupBattle();
    showScreen('game');
    if (!loopTimer) loopTimer = setInterval(tickOnce, 1000);
    refreshGameTop();
    toast('第 ' + lv.id + ' 关 · ' + lv.name + '：清除 ' + lv.wave + ' 波即可通关');
  }

  // ============ 战场 ============
  let battleLoopStarted = false;   // rAF 循环只启动一次（进多关不重复）
  function setupBattle() {
    if (battle) { battle.reset(); }
    if (!battle) {
      const cv = $('battleCanvas');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = 750 * dpr; cv.height = 430 * dpr;
      cv._dpr = dpr; cv._ctx = cv.getContext('2d');
      battle = new window.BattleView.BattleView({ formatNum: n => formatNum(n) });
      battle.resize(750, 430);
    }
    battle.reset();
    if (battleLoopStarted) return;
    battleLoopStarted = true;
    const cv = $('battleCanvas');
    let last = performance.now();
    (function loop(now) {
      const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      last = now;
      if (s && !document.hidden && $('screenGame').style.display !== 'none') {
        battle.frame(window.BattleView.makeSnapshot(core, s), dt);
        const ctx = cv._ctx;
        ctx.setTransform(cv._dpr, 0, 0, cv._dpr, 0, 0);
        ctx.clearRect(0, 0, 750, 430);
        battle.render(ctx, battleImgs);
      }
      requestAnimationFrame(loop);
    })(last);
  }
  function stopBattleLoop() { if (loopTimer) { clearInterval(loopTimer); loopTimer = null; } }

  // ============ tick ============
  function tickOnce() {
    if (!s || won) return;
    const events = core.tick(s, 1);
    for (const e of events) onEvent(e);
    refreshGameTop();
    if (tapTarget) updateTapStats(); // 菜单开着就同步数字
    // 胜利判定：清完目标波
    if (!won && currentLevel && s.wavesCleared >= currentLevel.wave) {
      won = true; onWin();
    }
  }
  function onEvent(e) {
    if (e.type === 'wave_start') {
      toast(e.boss ? '⚠️ 第 ' + e.wave + ' 波 BOSS 来袭！' : '第 ' + e.wave + ' 波猛鬼来袭（剩 ' + (currentLevel.wave - e.wave + 1) + ' 波）');
    }
    if (e.type === 'boss_killed') toast('🏆 Boss 被击杀！');
    if (e.type === 'defeat') {
      $('defeatWaveText').textContent = '第 ' + e.wave + ' 波猛鬼冲进了宿舍…';
      $('defeatModal').style.display = 'flex';
    }
  }

  // ============ 胜利 / 失败 ============
  function onWin() {
    const lv = currentLevel;
    const stars = LVL.starsForRevives(revivesUsed);
    // 进度
    if (!meta.progress.stars[lv.id] || stars > meta.progress.stars[lv.id]) meta.progress.stars[lv.id] = stars;
    meta.progress.unlocked = Math.max(meta.progress.unlocked, lv.id);
    if (lv.id === 8) meta.progress.unlocked = 8;
    // 奖励进钱包（首次通关才给全额，重复挑战给 30%）
    const first = !meta._won || !(meta._won[lv.id]);
    const rw = first ? lv.reward : { coin: Math.floor(lv.reward.coin * 0.3), soul: Math.floor(lv.reward.soul * 0.3) };
    meta.coin += rw.coin; meta.soul += rw.soul;
    meta._won = meta._won || {}; meta._won[lv.id] = true;
    saveMeta();
    // UI
    const ws = $('winStars'); ws.innerHTML = '';
    for (let i = 0; i < 3; i++) ws.appendChild(el('span', 'win-star' + (i < stars ? ' on' : ''), i < stars ? '★' : '☆'));
    $('winLine').textContent = '复活 ' + revivesUsed + ' 次 · ' + (first ? '首次通关' : '再次挑战');
    $('winReward').innerHTML = '';
    $('winReward').append(
      el('span', 'rw-chip', '💰 +' + formatNum(rw.coin)),
      el('span', 'rw-chip', '👻 +' + formatNum(rw.soul))
    );
    $('winNext').style.display = lv.id < LVL.LEVELS.length ? '' : 'none';
    $('winModal').style.display = 'flex';
  }
  function onDefeatChoice() {
    // 认输
    $('defeatModal').style.display = 'none';
    toast('本局结束 · 返回调整支援再战');
    goHome();
  }

  // ============ 点触菜单 ============
  function canvasPoint(evt) {
    const cv = $('battleCanvas');
    const r = cv.getBoundingClientRect();
    return { x: (evt.clientX - r.left) / r.width * 750, y: (evt.clientY - r.top) / r.height * 430 };
  }
  function onCanvasTap(evt) {
    if (!battle || !s) return;
    const p = canvasPoint(evt);
    const hit = battle.hitTest(p.x, p.y);
    if (!hit) { closeTapMenu(); return; }
    tapTarget = hit;
    showTapMenu(hit);
  }
  function showTapMenu(hit) {
    const m = $('tapMenu');
    $('tapTitle').textContent = '';
    $('tapDesc').textContent = '';
    $('tapStats').innerHTML = '';
    const so = $('tapSlotOptions');
    so.innerHTML = ''; so.style.display = 'none';
    $('tapAction').style.display = '';
    let actionText = '', actionFn = null, disabled = false;

    if (hit.type === 'bed') {
      const b = s.beds[hit.index];
      const cost = b.unlocked ? core.bedCost(s, hit.index) : core.unlockBedCost(s, hit.index);
      const can = s.coin >= cost;
      $('tapTitle').textContent = '床 ' + (hit.index + 1) + (b.unlocked ? ' · Lv.' + b.level : '（未解锁）');
      $('tapDesc').textContent = b.unlocked ? '躺平者自动产金币/经验' : '解锁后开始产金币';
      addStat('产量', b.unlocked ? '+' + core.bedCoinPerSec(b).toFixed(1) + '/s' : '—');
      if (b.unlocked && b.level >= core.BUILDINGS.bed.maxLevel) { $('tapTitle').textContent += ' · 已满级'; disabled = true; }
      actionText = (b.unlocked ? '升级 ' : '解锁 ') + formatNum(cost) + ' 💰';
      actionFn = () => {
        const r = b.unlocked ? core.tryUpgradeBed(s, hit.index) : core.tryUnlockBed(s, hit.index);
        if (!r.ok) return toast(r.msg);
        toast(b.unlocked ? '床升到 ' + r.level + ' 级' : '床 ' + (hit.index + 1) + ' 解锁！');
        showTapMenu(hit);
      };
      disabled = disabled || !can;
    } else if (hit.type === 'door') {
      const max = core.doorMaxHp(s);
      const cost = core.doorCost(s);
      $('tapTitle').textContent = '大门 Lv.' + s.door.level;
      $('tapDesc').textContent = '抵挡猛鬼攻击 · 升级回满血';
      addStat('耐久', formatNum(Math.floor(s.door.hp)) + '/' + formatNum(max));
      addStat('反击', formatNum(core.doorCounterDps(s)) + '/s');
      if (s.door.level >= core.BUILDINGS.door.maxLevel) { disabled = true; $('tapTitle').textContent += ' · 满级'; }
      actionText = '升级 ' + formatNum(cost) + ' 💰';
      actionFn = () => {
        const r = core.tryUpgradeDoor(s);
        if (!r.ok) return toast(r.msg);
        toast('大门升到 ' + r.level + ' 级，已回满血');
        showTapMenu(hit);
      };
      disabled = disabled || s.coin < cost;
    } else if (hit.type === 'turret') {
      const cost = core.turretCost(s);
      $('tapTitle').textContent = '炮塔' + (s.turret.level > 0 ? ' Lv.' + s.turret.level : '（未建造）');
      $('tapDesc').textContent = '自动索敌，主要输出';
      addStat('伤害', formatNum(core.turretDps(s)) + '/s');
      if (s.turret.level >= core.BUILDINGS.turret.maxLevel) { disabled = true; $('tapTitle').textContent += ' · 满级'; }
      actionText = (s.turret.level > 0 ? '升级 ' : '建造 ') + formatNum(cost) + ' 💰';
      actionFn = () => {
        const r = core.tryUpgradeTurret(s);
        if (!r.ok) return toast(r.msg);
        toast('炮塔升到 ' + r.level + ' 级');
        showTapMenu(hit);
      };
      disabled = disabled || s.coin < cost;
    } else if (hit.type === 'altar') {
      const cost = core.altarCost(s);
      $('tapTitle').textContent = '灵魂祭坛' + (s.altar.level > 0 ? ' Lv.' + s.altar.level : '（未启用）');
      $('tapDesc').textContent = '献祭灵魂，全局产量永久 +25%/级';
      addStat('加成', '+' + Math.floor(s.altar.level * core.BUILDINGS.altar.bonusPerLevel * 100) + '%');
      if (s.altar.level >= core.BUILDINGS.altar.maxLevel) { disabled = true; $('tapTitle').textContent += ' · 满级'; }
      actionText = '献祭 ' + formatNum(cost) + ' 👻';
      actionFn = () => {
        const r = core.tryUpgradeAltar(s);
        if (!r.ok) return toast(r.msg);
        toast('祭坛升到 ' + r.level + ' 级');
        showTapMenu(hit);
      };
      disabled = disabled || s.soul < cost;
    } else if (hit.type === 'hero') {
      const h = core.HEROES[hit.index], st = s.heroes[hit.index];
      const upCost = st.unlocked ? core.heroUpgradeCost(s, hit.index) : h.unlockSoul;
      const cost = s.heroDeal ? Math.floor(upCost * core.HERO_DEAL_PCT) : upCost;
      $('tapTitle').textContent = h.name + (st.unlocked ? ' Lv.' + st.level : '（未招募）');
      $('tapDesc').textContent = h.desc;
      addStat('类型', h.type === 'dps' ? '攻击' : h.type === 'slow' ? '减伤' : '治疗');
      if (!st.unlocked) {
        actionText = '招募 ' + formatNum(cost) + ' 👻';
        actionFn = () => {
          if (s.soul < cost) return toast('灵魂不足 (' + cost + ')');
          const r = core.tryBuyHero(s, hit.index);
          if (!r.ok) return toast(r.msg);
          toast('成功招募 ' + h.name + '！');
          showTapMenu(hit);
        };
        disabled = s.soul < cost;
      } else {
        if (st.level >= h.maxLevel) { disabled = true; $('tapTitle').textContent += ' · 满级'; }
        actionText = '升级 ' + formatNum(cost) + ' 💰';
        actionFn = () => {
          const r = core.tryUpgradeHero(s, hit.index);
          if (!r.ok) return toast(r.msg);
          toast(h.name + ' 升到 ' + r.level + ' 级');
          showTapMenu(hit);
        };
        disabled = disabled || s.coin < cost;
      }
    } else if (hit.type === 'slot') {
      // v0.5 道具插槽：空槽=选道具放置，已占=拆除
      const slotIdx = hit.index;
      const placedId = s.itemSlots ? s.itemSlots[slotIdx] : null;
      $('tapSlotOptions').innerHTML = '';
      if (!placedId) {
        // 空槽：4 种道具选项（图标+名称+价格），点击即放置
        const box = $('tapSlotOptions');
        box.style.display = 'grid';
        core.ITEM_IDS.forEach(id => {
          const it = core.ITEMS[id];
          const cost = core.itemPlaceCost(s, id);
          const can = it.res === 'coin' ? s.coin >= cost : s.soul >= cost;
          const chip = el('div', 'slot-opt' + (can ? '' : ' slot-opt-poor'));
          chip.innerHTML = '<span class="slot-opt-ico">' + it.icon + '</span><span class="slot-opt-name">' + it.name + '</span><span class="slot-opt-cost">' + formatNum(cost) + (it.res === 'coin' ? ' 💰' : ' 👻') + '</span>';
          chip.onclick = () => {
            const r = core.placeItem(s, slotIdx, id);
            if (!r.ok) return toast(r.msg);
            toast(it.icon + ' ' + it.name + ' 已放置');
            showTapMenu(hit);   // 刷新（现在应显示"拆除"）
          };
          box.appendChild(chip);
        });
        $('tapTitle').textContent = '放置道具';
        $('tapDesc').textContent = '选一个放入该位置';
        $('tapAction').style.display = 'none';
      } else {
        // 已占：显示当前道具 + 拆除
        const it = core.ITEMS[placedId];
        const info = core.itemSlotInfo(s, slotIdx);
        $('tapTitle').textContent = it.icon + ' ' + it.name;
        $('tapDesc').textContent = it.desc;
        if (placedId === 'barrier') addStat('屏障', formatNum(Math.floor(info.barrierHp || 0)) + '/' + formatNum(info.barrierMax));
        $('tapAction').style.display = '';
        actionText = '拆除（不返还）';
        actionFn = () => {
          const r = core.removeItem(s, slotIdx);
          if (!r.ok) return toast(r.msg);
          toast(it.name + ' 已拆除');
          showTapMenu(hit);
        };
        disabled = false;
      }
    }

    const btn = $('tapAction');
    btn.textContent = disabled ? (hit.type === 'bed' && s.beds[hit.index] && !s.beds[hit.index].unlocked ? '需金币' : '资源不足') : actionText;
    btn.classList.toggle('disabled', disabled);
    btn.onclick = disabled ? () => toast('资源不足') : actionFn;

    $('tapMenuMask').style.display = 'block';
    positionTapMenu(hit);
  }
  function addStat(k, v) {
    const d = el('div', 'tap-stat');
    d.append(el('span', 'tap-stat-k', k), el('span', 'tap-stat-v', v));
    $('tapStats').appendChild(d);
  }
  function positionTapMenu(hit) {
    // 元素设计坐标 → CSS 坐标（贴 stage）
    const cv = $('battleCanvas');
    const r = cv.getBoundingClientRect();
    const sx = r.width / 750, sy = r.height / 430;
    let cx = 0, cy = 0;
    if (hit.type === 'bed') { const p = battle.bedPos(hit.index); cx = (p.x + battle.bedCellW * 0.44) * sx; cy = (p.y + battle.bedCellW * 0.26) * sy; }
    else if (hit.type === 'door') { cx = battle.wallX * sx; cy = 215 * sy; }
    else if (hit.type === 'turret') { cx = battle.turretPos.x * sx; cy = battle.turretPos.y * sy; }
    else if (hit.type === 'altar') { cx = battle.altarPos.x * sx; cy = battle.altarPos.y * sy; }
    else if (hit.type === 'hero') { const p = battle.heroPos(hit.index); cx = p.x * sx; cy = p.y * sy; }
    else if (hit.type === 'slot') { const p = battle.slotPos(hit.index); cx = p.x * sx; cy = p.y * sy; }
    const mask = $('tapMenuMask'), m = $('tapMenu');
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let left = cx + 16; if (left + mw > r.width - 8) left = cx - mw - 16;
    left = Math.max(8, Math.min(left, r.width - mw - 8));
    let top = cy - mh / 2;
    top = Math.max(8, Math.min(top, r.height - mh - 8));
    m.style.left = left + 'px'; m.style.top = top + 'px';
    mask.style.left = r.left + 'px'; mask.style.top = r.top + 'px';
    mask.style.width = r.width + 'px'; mask.style.height = r.height + 'px';
  }
  function updateTapStats() { if (tapTarget && $('tapMenuMask').style.display !== 'none') showTapMenu(tapTarget); }
  function closeTapMenu() { tapTarget = null; $('tapMenuMask').style.display = 'none'; }

  // ============ 顶部 HUD ============
  function refreshGameTop() {
    if (!s || !currentLevel) return;
    $('gtName').textContent = '关卡 ' + currentLevel.id;
    $('gtProgress').textContent = Math.min(s.wavesCleared, currentLevel.wave) + '/' + currentLevel.wave + ' 波';
    $('gtCoin').textContent = formatNum(Math.floor(s.coin));
    $('gtSoul').textContent = formatNum(Math.floor(s.soul));
  }

  // ============ 广告模拟 ============
  function playAd(key, onDone) {
    const modal = $('adModal'); modal.style.display = 'flex';
    let n = 3; $('adCount').textContent = n;
    if (adTimer) clearInterval(adTimer);
    adTimer = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(adTimer); adTimer = null; modal.style.display = 'none'; onDone(); }
      else $('adCount').textContent = n;
    }, 1000);
  }
  function walletCoinAd() {
    playAd('wallet_coin', () => {
      const bonus = Math.max(300, Math.floor(meta.coin * 0.5 + 500));
      meta.coin += bonus; saveMeta();
      toast('钱包金币 +' + formatNum(bonus)); refreshHome();
    });
  }
  function walletSoulAd() {
    playAd('wallet_soul', () => {
      const bonus = Math.max(80, Math.floor(meta.soul * 0.5 + 100));
      meta.soul += bonus; saveMeta();
      toast('钱包灵魂 +' + formatNum(bonus)); refreshHome();
    });
  }
  function dailyBonus() {
    const today = core.dateStr(Date.now());
    if (meta.dailyBonusDate === today) return toast('今日已领取');
    playAd('daily_bonus', () => {
      meta.dailyBonusDate = today;
      meta.coin += 800; meta.soul += 200; saveMeta();
      toast('每日福利：金币+800 灵魂+200'); refreshHome();
    });
  }

  // ============ toast / confirm ============
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2400);
  }
  function showConfirm(title, text, cb) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmModal')._cb = cb;
    $('confirmModal').style.display = 'flex';
  }

  // ============ 绑定 ============
  function bindUI() {
    // 首页
    $('homeSettings').onclick = () => showConfirm('重置全部进度？', '钱包、关卡进度、星级将全部清空，无法恢复！', () => {
      localStorage.removeItem(META_KEY);
      meta = { coin: 0, soul: 0, progress: { unlocked: 1, stars: {} }, settings: {}, dailyBonusDate: '' };
      saveMeta(); toast('已重置'); refreshHome();
    });
    $('dailyBonusBtn').onclick = dailyBonus;
    $('adCoin').onclick = walletCoinAd;
    $('adSoul').onclick = walletSoulAd;
    // 进入页
    $('entryBack').onclick = goHome;
    $('entryGo').onclick = () => startLevel(currentLevel.id);
    $('eliteRow').onclick = () => {
      const ef = LVL.eliteSupport(currentLevel);
      if (eliteUsed) return toast('已使用精锐支援');
      if (meta.coin < ef.cost.coin) return toast('钱包金币不足 (' + formatNum(ef.cost.coin) + ')');
      eliteUsed = true;
      toast('已启用精锐支援');
      buildEntry();
    };
    // 游戏
    $('gameExit').onclick = () => showConfirm('退出本局？', '当前局进度将作废（钱包与关卡进度保留）。', () => { goHome(); });
    $('battleStage').addEventListener('click', onCanvasTap);
    // 点触菜单
    $('tapClose').onclick = closeTapMenu;
    $('tapMenuMask').addEventListener('click', e => { if (e.target === $('tapMenuMask')) closeTapMenu(); });
    // 门破
    $('reviveBtn').onclick = () => {
      playAd('revive', () => {
        const r = core.tryRevive(s);
        if (!r.ok) { toast(r.msg || '复活失败'); $('defeatModal').style.display = 'none'; onDefeatChoice(); return; }
        core.markAdUsed(s, 'revive');
        revivesUsed += 1;
        $('defeatModal').style.display = 'none';
        toast('复活成功！大门回 50% 血');
        refreshGameTop();
      });
    };
    $('acceptBtn').onclick = onDefeatChoice;
    // 胜利
    $('winNext').onclick = () => {
      $('winModal').style.display = 'none';
      const next = currentLevel.id + 1;
      if (LVL.getLevel(next)) openEntry(LVL.getLevel(next)); else goHome();
    };
    $('winHome').onclick = () => { $('winModal').style.display = 'none'; goHome(); };
    // 确认弹窗
    $('confirmOk').onclick = () => { const cb = $('confirmModal')._cb; $('confirmModal').style.display = 'none'; if (cb) cb(); };
    $('confirmCancel').onclick = () => { $('confirmModal').style.display = 'none'; $('confirmModal')._cb = null; };
  }

  function init() {
    try {
      bindModules();
      loadMeta();
      bindUI();
      preloadBattleImages();
      showScreen('home');
      refreshHome();
      // 调试：?level=N 直接进某关
      const q = new URLSearchParams(location.search);
      if (q.get('level')) startLevel(parseInt(q.get('level'), 10));
    } catch (e) {
      window.__initErr = (e && (e.message || e)) + '\n' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : '');
      console.error('INIT FAIL', e);
    }
  }
  // bootstrap.js 异步 fetch 核心模块，完成后派发 core-modules-ready
  // 必须等它，否则 window.core / window.num 还没挂上
  function boot() {
    if (window.core && window.num) { init(); return; }
    document.addEventListener('core-modules-ready', init, { once: true });
    // 兜底：8s 还没就绪则报错
    setTimeout(() => { if (!window.core) window.__initErr = 'core modules not loaded in 8s'; }, 8000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
