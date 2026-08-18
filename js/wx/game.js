/**
 * 游戏状态管理（wx 层）
 * 封装 core 逻辑 + wx 本地存储 + 定时器
 * 页面通过 Game 单例访问
 */
const core = require('../core/gameCore');
const CONFIG = require('../../config');

class GameImpl {
  constructor() {
    this.s = null;
    this.listeners = [];
    this._timer = null;
  }

  /** 初始化：读存档或开新局 */
  init() {
    const raw = wx.getStorageSync(CONFIG.SAVE_KEY);
    if (raw) {
      const s = core.load(raw);
      if (s) {
        this.s = s;
        // 结算离线收益
        const off = core.computeOffline(s, Date.now() / 1000);
        if (off.seconds >= 30) {
          this.pendingOffline = off; // UI 弹出离线结算弹窗
        } else {
          s.lastSave = Date.now();
        }
        return { fresh: false, offline: this.pendingOffline || null };
      }
    }
    this.s = core.initNewGame(core.newGame());
    this.save();
    return { fresh: true, offline: null };
  }

  /** 每帧/每秒推进 */
  tick(deltaSec) {
    if (!this.s) return [];
    const events = core.tick(this.s, deltaSec);
    if (events.length) {
      this.emit('events', events);
      // 关键事件自动存档
      if (events.some(e => ['defeat', 'wave_cleared', 'first_kill', 'boss_killed'].includes(e.type))) {
        this.save();
      }
    }
    return events;
  }

  /** 启动 1 秒定时 tick */
  startLoop() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      const t0 = Date.now();
      this.tick(1);
      this.emit('tick', { cps: core.coinPerSec(this.s), elapsed: Date.now() - t0 });
    }, 1000);
  }
  stopLoop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  save() {
    if (!this.s) return;
    try {
      wx.setStorageSync(CONFIG.SAVE_KEY, core.save(this.s));
    } catch (e) {
      console.error('save fail', e);
    }
  }

  // ---- 操作代理 ----
  upgradeBed(i) { const r = core.tryUpgradeBed(this.s, i); if (r.ok) { this.save(); this.emit('change'); } return r; }
  unlockBed(i) { const r = core.tryUnlockBed(this.s, i); if (r.ok) { this.save(); this.emit('change'); } return r; }
  upgradeDoor() { const r = core.tryUpgradeDoor(this.s); if (r.ok) { this.save(); this.emit('change'); } return r; }
  upgradeTurret() { const r = core.tryUpgradeTurret(this.s); if (r.ok) { this.save(); this.emit('change'); } return r; }
  // v0.2 英雄
  buyHero(i) { const r = core.tryBuyHero(this.s, i); if (r.ok) { this.save(); this.emit('change'); } return r; }
  upgradeHero(i) { const r = core.tryUpgradeHero(this.s, i); if (r.ok) { this.save(); this.emit('change'); } return r; }
  // v0.2 任务/成就
  claimQuest(i) { const r = core.claimQuest(this.s, i); if (r.ok) { this.save(); this.emit('change'); } return r; }
  claimAchievement(id) { const r = core.claimAchievement(this.s, id); if (r.ok) { this.save(); this.emit('change'); } return r; }

  /** 看广告并结算（UI 层播广告成功后调用） */
  applyAd(adKey, extra) {
    const r = core.applyAd(this.s, adKey, extra);
    if (r.ok) {
      core.markAdUsed(this.s, adKey);
      this.save();
      this.emit('ad_done', { adKey, ...r });
    }
    return r;
  }

  /** 门破后：接受失败 */
  acceptDefeat() {
    const r = core.acceptDefeat(this.s);
    if (r.ok) { this.save(); this.emit('defeat_accepted'); }
    return r;
  }

  /** 结算离线收益 */
  settleOffline(double) {
    if (!this.pendingOffline) return null;
    const r = core.applyOffline(this.s, Date.now() / 1000, double);
    this.pendingOffline = null;
    this.save();
    this.emit('offline_settled', r);
    return r;
  }

  /** 重置（危险操作，UI 需二次确认） */
  reset() {
    this.stopLoop();
    wx.removeStorageSync(CONFIG.SAVE_KEY);
    this.s = core.initNewGame(core.newGame());
    this.save();
    this.emit('reset');
  }

  on(evt, fn) { this.listeners.push({ evt, fn }); }
  emit(evt, data) {
    for (const l of this.listeners) if (l.evt === evt) l.fn(data);
  }
}

const Game = new Game();
module.exports = Game;
