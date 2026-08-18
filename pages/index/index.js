/**
 * 猛鬼宿舍·躺平发育 v0.4 —— 小程序主控制器（三屏流程）
 *  首页(关卡/奖励/设置) → 进入页(关卡+支援) → 游戏(战场为主,点哪里弹哪里)
 * 复用 js/core/gameCore.js + js/levels.js + js/battle/battleView.js（与 Web 零分叉）
 */
const core = require('../../js/core/gameCore');
const LVL = require('../../js/levels.js');
const { formatNum, formatDuration } = require('../../js/core/number');
const ad = require('../../js/wx/ad');
const battle = require('../../js/wx/battle');

const META_KEY = 'menggui_tangping_meta_v1';

function loadMeta() {
  let m = { coin: 0, soul: 0, progress: { unlocked: 1, stars: {} }, settings: {}, dailyBonusDate: '' };
  try {
    const raw = wx.getStorageSync(META_KEY);
    if (raw) m = Object.assign(m, JSON.parse(raw));
  } catch (e) {}
  return m;
}
function saveMeta(m) { try { wx.setStorageSync(META_KEY, JSON.stringify(m)); } catch (e) {} }

Page({
  data: {
    screen: 'home',
    // 首页
    walletCoin: '0', walletSoul: '0',
    levels: [],
    // 进入页
    currentLevel: null,
    supportPick: 'coin',
    supportDefs: LVL.SUPPORT_DEFS,
    eliteUsed: false,
    eliteCost: '0', eliteGainCoin: '0', eliteGainSoul: '0',
    // 游戏
    coinText: '0', soulText: '0',
    wavesCleared: 0,
    hintHide: false,
    tapMenu: { show: false, x: 0, y: 0, title: '', desc: '', stats: [], action: '', disabled: false },
    // 弹窗
    winModal: { show: false, stars: 0, line: '', coin: 0, soul: 0, hasNext: false },
    defeatModal: { show: false, text: '' },
    toastText: ''
  },

  onLoad() {
    this.meta = loadMeta();
    this.supportPick = 'coin';
    this.eliteUsed = false;
    this.revivesUsed = 0;
    this.won = false;
    this.tapTarget = null;
    this._toastTimer = null;
    this.refreshHome();
  },

  onReady() {
    // 进入游戏屏时才启动战场 canvas 渲染
  },
  onUnload() { battle.stop(); },
  onHide() { this.stopGameLoop(); },

  // ============ 屏幕路由 ============
  goHome() {
    this.stopGameLoop();
    battle.stop();   // 离开游戏屏：canvas 被 wx:if 销毁，停渲染循环
    this.setData({ screen: 'home', tapMenu: { ...this.data.tapMenu, show: false } });
    this.refreshHome();
  },
  goEntry() { this.setData({ screen: 'entry' }); },

  // ============ 首页 ============
  refreshHome() {
    const lv = LVL.LEVELS.map(l => ({
      id: l.id, name: l.name, sub: l.sub,
      locked: !LVL.isUnlocked(this.meta.progress, l.id),
      stars: LVL.bestStars(this.meta.progress, l.id)
    }));
    this.setData({
      walletCoin: formatNum(Math.floor(this.meta.coin)),
      walletSoul: formatNum(Math.floor(this.meta.soul)),
      levels: lv
    });
  },
  onLevelTap(e) {
    const id = e.currentTarget.dataset.id;
    const lv = LVL.getLevel(id);
    if (!lv) return;
    if (!LVL.isUnlocked(this.meta.progress, lv.id)) { this.toast('先通关上一关'); return; }
    this.currentLevel = lv;
    this.supportPick = 'coin';
    this.eliteUsed = false;
    this.buildEntry();
    this.setData({ screen: 'entry' });
  },
  buildEntry() {
    const lv = this.currentLevel;
    const ef = LVL.eliteSupport(lv);
    const heroNames = lv.init.heroes.map(i => core.HEROES[i].name).join('、');
    this.setData({
      'currentLevel.id': lv.id, 'currentLevel.name': lv.name, 'currentLevel.sub': lv.sub,
      'currentLevel.wave': lv.wave, 'currentLevel.initCoin': formatNum(lv.init.coin),
      'currentLevel.door': lv.init.door, 'currentLevel.turret': lv.init.turret,
      'currentLevel.beds': lv.init.beds, 'currentLevel.soul': lv.init.soul,
      'currentLevel.heroes': heroNames, 'currentLevel.bestStars': LVL.bestStars(this.meta.progress, lv.id),
      supportPick: this.supportPick,
      eliteUsed: this.eliteUsed,
      eliteCost: formatNum(ef.cost.coin),
      eliteGainCoin: formatNum(ef.gain.coin), eliteGainSoul: formatNum(ef.gain.soul)
    });
  },
  onEntryBack() { this.setData({ screen: 'home' }); this.refreshHome(); },
  onSupportPick(e) { this.supportPick = e.currentTarget.dataset.kind; this.buildEntry(); },
  onEliteTap() {
    const ef = LVL.eliteSupport(this.currentLevel);
    if (this.eliteUsed) { this.toast('已使用精锐支援'); return; }
    if (this.meta.coin < ef.cost.coin) { this.toast('钱包金币不足'); return; }
    this.eliteUsed = true; this.buildEntry(); this.toast('已启用精锐支援');
  },
  onEntryGo() { this.startLevel(this.currentLevel.id); },

  // ============ 开始一局 ============
  startLevel(id) {
    const lv = LVL.getLevel(id);
    if (!lv || !LVL.isUnlocked(this.meta.progress, lv.id)) { this.toast('先通关上一关'); return; }
    const wantElite = this.eliteUsed;
    this.currentLevel = lv; this.revivesUsed = 0; this.won = false;
    const s = core.newGame();
    s.coin = lv.init.coin; s.soul = lv.init.soul;
    s.door = { level: lv.init.door, hp: core.doorMaxHp(s) };
    s.turret = { level: lv.init.turret };
    s.altar = { level: lv.init.altar };
    for (let i = 0; i < core.MAX_BEDS; i++) {
      s.beds[i] = (i < lv.init.beds) ? { level: 1, unlocked: true } : { level: 0, unlocked: false };
    }
    s.heroes = core.HEROES.map(() => ({ unlocked: false, level: 0 }));
    lv.init.heroes.forEach(i => { s.heroes[i] = { unlocked: true, level: 1 }; });
    const sup = LVL.supportEffect(lv, this.supportPick);
    s.coin += sup.coin || 0; s.soul += sup.soul || 0;
    if (sup.door) { s.door.level += sup.door; s.door.hp = core.doorMaxHp(s); }
    if (wantElite) {
      const ef = LVL.eliteSupport(lv);
      s.coin += ef.gain.coin; s.soul += ef.gain.soul;
      this.meta.coin -= ef.cost.coin;
    }
    s.time = 0; s.nextWaveAt = 30; s.ghosts = [];
    this.s = s;
    saveMeta(this.meta);
    this.startGameLoop();
    this.setData({ screen: 'game', hintHide: false });
    battle.start(this, () => s, () => this.s);
    this.refreshGameTop();
    this.toast('第 ' + lv.id + ' 关 · 清除 ' + lv.wave + ' 波通关');
    const h = setTimeout(() => this.setData({ hintHide: true }), 5000);
    this._hintTimer = h;
  },

  // ============ 游戏循环 ============
  startGameLoop() {
    if (this._loop) return;
    this._loop = setInterval(() => {
      const s = this.s;
      if (!s || this.won) return;
      const events = core.tick(s, 1);
      for (const e of events) this.onEvent(e);
      this.refreshGameTop();
      if (this.tapTarget) this.updateTapStats();
      if (!this.won && this.currentLevel && s.wavesCleared >= this.currentLevel.wave) {
        this.won = true; this.onWin();
      }
    }, 1000);
  },
  stopGameLoop() { if (this._loop) { clearInterval(this._loop); this._loop = null; } },

  onEvent(e) {
    if (e.type === 'wave_start') this.toast(e.boss ? '⚠️ 第 ' + e.wave + ' 波 BOSS 来袭！' : '第 ' + e.wave + ' 波猛鬼来袭');
    if (e.type === 'boss_killed') this.toast('🏆 Boss 被击杀！');
    if (e.type === 'defeat') this.setData({ defeatModal: { show: true, text: '第 ' + e.wave + ' 波猛鬼冲进了宿舍…' } });
  },

  refreshGameTop() {
    const s = this.s;
    if (!s || !this.currentLevel) return;
    this.setData({
      coinText: formatNum(Math.floor(s.coin)),
      soulText: formatNum(Math.floor(s.soul)),
      wavesCleared: Math.min(s.wavesCleared, this.currentLevel.wave)
    });
  },

  // ============ 胜利 ============
  onWin() {
    const lv = this.currentLevel;
    const stars = LVL.starsForRevives(this.revivesUsed);
    if (!this.meta.progress.stars[lv.id] || stars > this.meta.progress.stars[lv.id]) this.meta.progress.stars[lv.id] = stars;
    this.meta.progress.unlocked = Math.max(this.meta.progress.unlocked, lv.id);
    const first = !this.meta._won || !(this.meta._won[lv.id]);
    const rw = first ? lv.reward : { coin: Math.floor(lv.reward.coin * 0.3), soul: Math.floor(lv.reward.soul * 0.3) };
    this.meta.coin += rw.coin; this.meta.soul += rw.soul;
    this.meta._won = this.meta._won || {}; this.meta._won[lv.id] = true;
    saveMeta(this.meta);
    this.stopGameLoop();
    this.setData({
      winModal: {
        show: true, stars, line: '复活 ' + this.revivesUsed + ' 次 · ' + (first ? '首次通关' : '再次挑战'),
        coin: formatNum(rw.coin), soul: formatNum(rw.soul),
        hasNext: lv.id < LVL.LEVELS.length
      }
    });
  },
  onWinNext() {
    this.setData({ winModal: { ...this.data.winModal, show: false } });
    battle.stop();
    const next = LVL.getLevel(this.currentLevel.id + 1);
    if (next) { this.currentLevel = next; this.supportPick = 'coin'; this.eliteUsed = false; this.buildEntry(); this.setData({ screen: 'entry' }); }
    else this.goHome();
  },
  onWinHome() { this.setData({ winModal: { ...this.data.winModal, show: false } }); this.goHome(); },

  // ============ 门破 ============
  onRevive() {
    ad.playRewardAd('revive', () => {
      const r = core.tryRevive(this.s);
      if (!r.ok) { this.toast(r.msg || '复活失败'); this.setData({ defeatModal: { show: false } }); this.goHome(); return; }
      core.markAdUsed(this.s, 'revive');
      this.revivesUsed += 1;
      this.setData({ defeatModal: { show: false } });
      this.toast('复活成功！大门回 50% 血');
      this.refreshGameTop();
    });
  },
  onAcceptDefeat() { this.setData({ defeatModal: { show: false } }); this.toast('本局结束 · 返回调整支援再战'); this.goHome(); },

  // ============ 点触菜单 ============
  onBattleTap(e) {
    const s = this.s;
    if (!s || !battle.view) return;
    const p = battle.tapPoint(e);
    const hit = battle.view.hitTest(p.x, p.y);
    if (!hit) { this.closeTapMenu(); return; }
    this.tapTarget = hit;
    this.showTapMenu(hit);
  },
  showTapMenu(hit) {
    const s = this.s;
    const stats = [];
    let title = '', desc = '', action = '', disabled = false, fn = null;

    if (hit.type === 'bed') {
      const b = s.beds[hit.index];
      const cost = b.unlocked ? core.bedCost(s, hit.index) : core.unlockBedCost(s, hit.index);
      title = '床 ' + (hit.index + 1) + (b.unlocked ? ' · Lv.' + b.level : '（未解锁）');
      desc = b.unlocked ? '躺平者自动产金币/经验' : '解锁后开始产金币';
      stats.push({ k: '产量', v: b.unlocked ? '+' + core.bedCoinPerSec(b).toFixed(1) + '/s' : '—' });
      if (b.unlocked && b.level >= core.BUILDINGS.bed.maxLevel) { title += ' · 已满级'; disabled = true; }
      action = (b.unlocked ? '升级 ' : '解锁 ') + formatNum(cost) + ' 💰';
      fn = () => {
        const r = b.unlocked ? core.tryUpgradeBed(s, hit.index) : core.tryUnlockBed(s, hit.index);
        if (!r.ok) return this.toast(r.msg);
        this.toast(b.unlocked ? '床升到 ' + r.level + ' 级' : '床 ' + (hit.index + 1) + ' 解锁！');
        this.showTapMenu(hit); this.refreshGameTop();
      };
      if (s.coin < cost) disabled = true;
    } else if (hit.type === 'door') {
      const max = core.doorMaxHp(s), cost = core.doorCost(s);
      title = '大门 Lv.' + s.door.level;
      desc = '抵挡猛鬼攻击 · 升级回满血';
      stats.push({ k: '耐久', v: formatNum(Math.floor(s.door.hp)) + '/' + formatNum(max) });
      stats.push({ k: '反击', v: formatNum(core.doorCounterDps(s)) + '/s' });
      if (s.door.level >= core.BUILDINGS.door.maxLevel) { title += ' · 满级'; disabled = true; }
      action = '升级 ' + formatNum(cost) + ' 💰';
      fn = () => { const r = core.tryUpgradeDoor(s); if (!r.ok) return this.toast(r.msg); this.toast('大门升到 ' + r.level + ' 级'); this.showTapMenu(hit); this.refreshGameTop(); };
      if (s.coin < cost) disabled = true;
    } else if (hit.type === 'turret') {
      const cost = core.turretCost(s);
      title = '炮塔' + (s.turret.level > 0 ? ' Lv.' + s.turret.level : '（未建造）');
      desc = '自动索敌，主要输出';
      stats.push({ k: '伤害', v: formatNum(core.turretDps(s)) + '/s' });
      if (s.turret.level >= core.BUILDINGS.turret.maxLevel) { title += ' · 满级'; disabled = true; }
      action = (s.turret.level > 0 ? '升级 ' : '建造 ') + formatNum(cost) + ' 💰';
      fn = () => { const r = core.tryUpgradeTurret(s); if (!r.ok) return this.toast(r.msg); this.toast('炮塔升到 ' + r.level + ' 级'); this.showTapMenu(hit); this.refreshGameTop(); };
      if (s.coin < cost) disabled = true;
    } else if (hit.type === 'altar') {
      const cost = core.altarCost(s);
      title = '灵魂祭坛' + (s.altar.level > 0 ? ' Lv.' + s.altar.level : '（未启用）');
      desc = '献祭灵魂，全局产量永久 +25%/级';
      stats.push({ k: '加成', v: '+' + Math.floor(s.altar.level * core.BUILDINGS.altar.bonusPerLevel * 100) + '%' });
      if (s.altar.level >= core.BUILDINGS.altar.maxLevel) { title += ' · 满级'; disabled = true; }
      action = '献祭 ' + formatNum(cost) + ' 👻';
      fn = () => { const r = core.tryUpgradeAltar(s); if (!r.ok) return this.toast(r.msg); this.toast('祭坛升到 ' + r.level + ' 级'); this.showTapMenu(hit); this.refreshGameTop(); };
      if (s.soul < cost) disabled = true;
    } else if (hit.type === 'hero') {
      const h = core.HEROES[hit.index], st = s.heroes[hit.index];
      const upCost = st.unlocked ? core.heroUpgradeCost(s, hit.index) : h.unlockSoul;
      const cost = s.heroDeal ? Math.floor(upCost * core.HERO_DEAL_PCT) : upCost;
      title = h.name + (st.unlocked ? ' Lv.' + st.level : '（未招募）');
      desc = h.desc;
      stats.push({ k: '类型', v: h.type === 'dps' ? '攻击' : h.type === 'slow' ? '减伤' : '治疗' });
      if (!st.unlocked) {
        action = '招募 ' + formatNum(cost) + ' 👻';
        fn = () => { if (s.soul < cost) return this.toast('灵魂不足'); const r = core.tryBuyHero(s, hit.index); if (!r.ok) return this.toast(r.msg); this.toast('成功招募 ' + h.name + '！'); this.showTapMenu(hit); this.refreshGameTop(); };
        if (s.soul < cost) disabled = true;
      } else {
        if (st.level >= h.maxLevel) { title += ' · 满级'; disabled = true; }
        action = '升级 ' + formatNum(cost) + ' 💰';
        fn = () => { const r = core.tryUpgradeHero(s, hit.index); if (!r.ok) return this.toast(r.msg); this.toast(h.name + ' 升到 ' + r.level + ' 级'); this.showTapMenu(hit); this.refreshGameTop(); };
        if (s.coin < cost) disabled = true;
      }
    }

    // 定位（设计坐标 → 屏幕 px，基于 canvas 实际尺寸）
    const pos = battle.menuPos(hit);
    this.setData({
      tapMenu: {
        show: true, x: pos.x, y: pos.y, title, desc, stats,
        action: disabled ? '资源不足' : action, disabled
      },
      '_tapFn': fn
    });
    this._tapFn = fn;
  },
  updateTapStats() { if (this.tapTarget) this.showTapMenu(this.tapTarget); },
  onTapAction() { if (this._tapFn && !this.data.tapMenu.disabled) this._tapFn(); },
  onTapClose() { this.closeTapMenu(); },
  closeTapMenu() { this.tapTarget = null; this.setData({ 'tapMenu.show': false }); },

  // ============ 退出 / 设置 / 奖励 ============
  onGameExit() {
    wx.showModal({
      title: '退出本局？', content: '当前局进度将作废（钱包与关卡进度保留）',
      success: r => { if (r.confirm) this.goHome(); }
    });
  },
  onGoSettings() { wx.navigateTo({ url: '/pages/settings/settings' }); },
  onDailyBonus() {
    const today = core.dateStr(Date.now());
    if (this.meta.dailyBonusDate === today) { this.toast('今日已领取'); return; }
    ad.playRewardAd('daily_bonus', () => {
      this.meta.dailyBonusDate = today;
      this.meta.coin += 800; this.meta.soul += 200;
      saveMeta(this.meta);
      this.toast('每日福利：金币+800 灵魂+200');
      this.refreshHome();
    });
  },
  onWalletCoin() {
    ad.playRewardAd('wallet_coin', () => {
      const bonus = Math.max(300, Math.floor(this.meta.coin * 0.5 + 500));
      this.meta.coin += bonus; saveMeta(this.meta);
      this.toast('钱包金币 +' + formatNum(bonus)); this.refreshHome();
    });
  },
  onWalletSoul() {
    ad.playRewardAd('wallet_soul', () => {
      const bonus = Math.max(80, Math.floor(this.meta.soul * 0.5 + 100));
      this.meta.soul += bonus; saveMeta(this.meta);
      this.toast('钱包灵魂 +' + formatNum(bonus)); this.refreshHome();
    });
  },

  toast(msg) {
    this.setData({ toastText: msg });
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.setData({ toastText: '' }), 2400);
  }
});
