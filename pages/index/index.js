/**
 * 主游戏页面
 */
const Game = require('../../js/wx/game');
const core = require('../../js/core/gameCore');
const ad = require('../../js/wx/ad');
const battle = require('../../js/wx/battle');
const { formatNum, formatDuration } = require('../../js/core/number');

Page({
  data: {
    // 资源
    coinText: '0', cpsText: '0', soulText: '0',
    level: 1, expPct: 0,
    // 床
    beds: [],
    // 门/炮塔/祭坛
    door: {}, turret: {}, altar: {},
    // 波次
    wave: 0, nextWaveText: '准备中', ghostInfo: '',
    threatDanger: false, bossActive: false,
    // 双倍收益
    boostActive: false, boostText: '',
    // v0.2 英雄
    heroes: [],
    heroDealOn: false,
    // v0.2 任务/成就
    quests: [],
    achievements: [],
    // 弹窗
    showOffline: false,
    offline: null,
    showDefeat: false, defeatWave: 0,
    // 广告按钮状态
    adCoins: { ok: true, text: '' },
    adBoost: { ok: true, text: '' },
    adDoor: { ok: false, text: '' },
    adWave: { ok: true, text: '' },
    adDaily: { ok: true, text: '' },
    adHeroDeal: { ok: true, text: '' }
  },

  onLoad() {
    const r = Game.init();
    if (r.fresh) {
      wx.showModal({
        title: '欢迎来到猛鬼宿舍',
        content: '躺平睡觉赚金币，升级床、大门和炮塔，招募英雄，挡住一波又一波的猛鬼！每10波有Boss出没，睡觉也能变强~',
        showCancel: false,
        confirmText: '开始躺平'
      });
    }
    if (r.offline && r.offline.seconds >= 30) {
      const off = r.offline;
      this.setData({
        showOffline: true,
        offline: {
          secText: formatDuration(off.seconds),
          coinText: formatNum(off.coin),
          capped: off.capped
        }
      });
    }
    Game.on('tick', () => this.refresh());
    Game.on('events', evts => this.onEvents(evts));
    Game.on('change', () => this.refresh());
    Game.on('ad_done', d => {
      if (d.adKey === 'income_boost') wx.showToast({ title: '双倍收益 1 小时！', icon: 'none' });
      if (d.adKey === 'coin_bonus') wx.showToast({ title: '金币 +' + formatNum(d.bonus), icon: 'none' });
      if (d.adKey === 'door_fix') wx.showToast({ title: '大门已修复', icon: 'none' });
      if (d.adKey === 'revive') wx.showToast({ title: '复活成功！', icon: 'none' });
      if (d.adKey === 'daily_bonus') wx.showToast({ title: '每日福利：金币+' + formatNum(d.bonus) + ' 灵魂+100', icon: 'none' });
      if (d.adKey === 'hero_deal') wx.showToast({ title: '英雄7折券生效！下次购买/升级生效', icon: 'none' });
      this.refresh();
    });
    this.refresh();
    Game.startLoop();
    // v0.3 2D 战场（canvas 2d，复用 web 同一份 battleView）
    battle.start(this, Game);
    // 底部 banner 广告（AD_DEBUG 时跳过）
    this._banner = ad.initBanner(wx.getSystemInfoSync().windowHeight);
  },

  onUnload() { Game.stopLoop(); Game.save(); battle.stop(); },
  onHide() { Game.save(); },

  onGoSettings() { wx.navigateTo({ url: '/pages/settings/settings' }); },

  onEvents(evts) {
    for (const e of evts) {
      if (e.type === 'wave_start') {
        wx.vibrateShort && wx.vibrateShort({ type: 'medium' });
        if (e.boss) this.toast('⚠️ 第 ' + e.wave + ' 波 BOSS 来袭！');
        else this.toast('第 ' + e.wave + ' 波猛鬼来袭！(' + e.ghostCount + '只)');
      }
      if (e.type === 'boss_killed') {
        this.toast('🏆 Boss 被击杀！灵魂大增！');
      }
      if (e.type === 'wave_cleared') {
        this.toast((e.boss ? 'BOSS 波清除！' : '第 ' + e.wave + ' 波清除！') + ' 灵魂+' + e.bonus);
      }
      if (e.type === 'defeat') {
        this.setData({ showDefeat: true, defeatWave: e.wave });
      }
    }
  },

  toast(msg) {
    if (this._toastTimer) return;
    wx.showToast({ title: msg, icon: 'none', duration: 1800 });
    this._toastTimer = setTimeout(() => { this._toastTimer = null; }, 2000);
  },

  /** 每秒刷新 UI 数据 */
  refresh() {
    const s = Game.s;
    if (!s) return;
    const beds = s.beds.map((b, i) => {
      const cost = b.unlocked ? core.bedCost(s, i) : core.unlockBedCost(s, i);
      return {
        idx: i,
        level: b.level,
        unlocked: b.unlocked,
        cps: b.unlocked ? core.bedCoinPerSec(b).toFixed(1) : '0',
        costText: formatNum(cost),
        canAfford: s.coin >= cost
      };
    });
    const doorMax = core.doorMaxHp(s);
    const threat = core.nextWaveThreat(s);
    const boostOn = s.time < s.incomeBoostUntil;

    // v0.2 英雄
    const heroes = core.HEROES.map((h, i) => {
      const st = s.heroes[i];
      const upCost = st.unlocked ? core.heroUpgradeCost(s, i) : h.unlockSoul;
      const shownCost = s.heroDeal ? Math.floor(upCost * core.HERO_DEAL_PCT) : upCost;
      return {
        idx: i,
        id: h.id,
        name: h.name,
        icon: h.icon,
        desc: h.desc,
        typeText: h.type === 'dps' ? '攻击' : h.type === 'slow' ? '减伤' : '治疗',
        unlocked: st.unlocked,
        level: st.level,
        maxLevel: h.maxLevel,
        costText: formatNum(shownCost),
        costIsSoul: !st.unlocked,
        canAfford: st.unlocked ? s.coin >= shownCost : s.soul >= shownCost
      };
    });

    // v0.2 任务
    const quests = s.daily.quests.map((q, i) => ({
      idx: i,
      name: q.name,
      need: q.need,
      progress: Math.floor(q.progress),
      done: q.progress >= q.need,
      claimed: q.claimed,
      reward: q.reward
    }));

    // v0.2 成就
    const achievements = core.listAchievements(s).map(a => ({
      id: a.id, name: a.name, desc: a.desc, reward: a.reward,
      unlocked: a.unlocked, claimed: a.claimed,
      claimable: a.unlocked && !a.claimed
    }));

    this.setData({
      coinText: formatNum(s.coin),
      cpsText: formatNum(core.coinPerSec(s)),
      soulText: formatNum(Math.floor(s.soul)),
      level: s.level,
      expPct: Math.min(100, Math.floor(s.totalExp / core.expForLevel(s.level) * 100)),
      beds,
      door: {
        level: s.door.level,
        hpPct: Math.max(0, Math.floor(s.door.hp / doorMax * 100)),
        hpText: formatNum(Math.floor(s.door.hp)) + '/' + formatNum(doorMax),
        dps: formatNum(core.doorCounterDps(s) + core.heroDpsTotal(s)),
        costText: formatNum(core.doorCost(s)),
        canAfford: s.coin >= core.doorCost(s)
      },
      turret: {
        level: s.turret.level,
        dps: formatNum(core.turretDps(s)),
        costText: formatNum(core.turretCost(s)),
        canAfford: s.coin >= core.turretCost(s)
      },
      altar: {
        level: s.altar.level,
        bonus: Math.floor(s.altar.level * core.BUILDINGS.altar.bonusPerLevel * 100),
        costText: formatNum(core.altarCost(s)),
        canAfford: s.soul >= core.altarCost(s)
      },
      wave: s.wave,
      nextWaveText: s.ghosts.length > 0
        ? '战斗中 (剩' + s.ghosts.length + '只' + (s.ghosts.some(g => g.boss) ? '·含BOSS' : '') + ')'
        : '下一波 ' + formatDuration(Math.max(0, s.nextWaveAt - s.time)) + (threat.boss ? ' ·BOSS' : ''),
      ghostInfo: s.ghosts.length > 0 ? '存活 ' + s.ghosts.length + ' / 本波 ' + s.ghosts.length : '',
      threatDanger: !threat.safe && s.ghosts.length === 0,
      bossActive: s.ghosts.some(g => g.boss),
      boostActive: boostOn,
      boostText: boostOn ? '剩 ' + formatDuration(s.incomeBoostUntil - s.time) : '',
      heroes,
      heroDealOn: s.heroDeal,
      quests,
      achievements,
      adCoins: this.adState('coin_bonus'),
      adBoost: this.adState('income_boost'),
      adDoor: this.adState('door_fix'),
      adWave: this.adState('wave_delay'),
      adDaily: this.adState('daily_bonus'),
      adHeroDeal: this.adState('hero_deal')
    });
  },

  adState(key) {
    const c = core.canUseAd(Game.s, key);
    return { ok: c.ok, text: c.ok ? '' : (c.remain ? formatDuration(c.remain) : (c.msg || '')) };
  },

  // ============ 升级操作 ============
  onUpgradeBed(e) {
    const i = e.currentTarget.dataset.idx;
    const s = Game.s;
    if (!s.beds[i].unlocked) {
      const r = Game.unlockBed(i);
      if (!r.ok) this.toast(r.msg);
      return;
    }
    const r = Game.upgradeBed(i);
    if (!r.ok) this.toast(r.msg);
    else this.toast('床升到 ' + r.level + ' 级');
  },
  onUpgradeDoor() {
    const r = Game.upgradeDoor();
    if (!r.ok) this.toast(r.msg);
    else this.toast('大门升到 ' + r.level + ' 级，已回满血');
  },
  onUpgradeTurret() {
    const r = Game.upgradeTurret();
    if (!r.ok) this.toast(r.msg);
    else this.toast('炮塔升到 ' + r.level + ' 级');
  },
  onUpgradeAltar() {
    const r = core.tryUpgradeAltar(Game.s);
    if (r.ok) { Game.save(); this.refresh(); this.toast('祭坛升到 ' + r.level + ' 级'); }
    else this.toast(r.msg);
  },

  // ============ v0.2 英雄操作 ============
  onHeroTap(e) {
    const i = e.currentTarget.dataset.idx;
    const s = Game.s;
    const h = core.HEROES[i];
    const st = s.heroes[i];
    if (!st.unlocked) {
      const cost = s.heroDeal ? Math.floor(h.unlockSoul * core.HERO_DEAL_PCT) : h.unlockSoul;
      if (s.soul < cost) { this.toast('灵魂不足 (' + cost + ')'); return; }
      if (wx.showModal) wx.showModal({
        title: '招募 ' + h.name,
        content: '花费 ' + cost + ' 灵魂招募' + h.name + '？\n' + h.desc,
        success: res => {
          if (!res.confirm) return;
          const r = Game.buyHero(i);
          if (!r.ok) this.toast(r.msg);
          else { this.toast('成功招募 ' + h.name + '！'); this.refresh(); }
        }
      });
      return;
    }
    if (st.level >= h.maxLevel) { this.toast('已满级'); return; }
    const r = Game.upgradeHero(i);
    if (!r.ok) this.toast(r.msg);
    else this.toast(h.name + ' 升到 ' + r.level + ' 级');
  },

  // ============ v0.2 任务/成就 ============
  onQuestClaim(e) {
    const i = e.currentTarget.dataset.idx;
    const q = Game.s.daily.quests[i];
    if (!q || q.claimed) return;
    if (q.progress < q.need) { this.toast('任务未完成'); return; }
    // 看广告领奖
    ad.playRewardAd('task_reward', () => {
      const r = Game.claimQuest(i);
      if (!r.ok) { this.toast(r.msg); return; }
      this.toast('任务完成！灵魂 +' + r.reward);
      this.refresh();
    }, () => this.toast('需完整观看广告才能领奖'));
  },

  onAchClaim(e) {
    const id = e.currentTarget.dataset.id;
    const r = Game.claimAchievement(id);
    if (!r.ok) { this.toast(r.msg); return; }
    this.toast('成就达成！灵魂 +' + r.reward);
    this.refresh();
  },

  // ============ 广告操作 ============
  onAdCoin() {
    if (!this.data.adCoins.ok) return this.toast('冷却中: ' + this.data.adCoins.text);
    ad.playRewardAd('coin_bonus', () => Game.applyAd('coin_bonus'));
  },
  onAdBoost() {
    if (!this.data.adBoost.ok) return this.toast('冷却中: ' + this.data.adBoost.text);
    ad.playRewardAd('income_boost', () => Game.applyAd('income_boost'));
  },
  onAdDoor() {
    if (!this.data.adDoor.ok) return this.toast(this.data.adDoor.text || '门还健康');
    ad.playRewardAd('door_fix', () => Game.applyAd('door_fix'));
  },
  onAdWave() {
    if (!this.data.adWave.ok) return this.toast('冷却中: ' + this.data.adWave.text);
    ad.playRewardAd('wave_delay', () => Game.applyAd('wave_delay'));
  },
  onAdDaily() {
    if (!this.data.adDaily.ok) return this.toast(this.data.adDaily.text || '今日已领');
    ad.playRewardAd('daily_bonus', () => Game.applyAd('daily_bonus'));
  },
  onAdHeroDeal() {
    if (!this.data.adHeroDeal.ok) return this.toast(this.data.adHeroDeal.text || '折扣已持有');
    ad.playRewardAd('hero_deal', () => Game.applyAd('hero_deal'));
  },

  // ============ 离线结算 ============
  onOfflineClaim() {
    Game.settleOffline(false);
    this.setData({ showOffline: false, offline: null });
    this.refresh();
  },
  onOfflineDouble() {
    ad.playRewardAd('offline_double', () => {
      Game.settleOffline(true);
      this.setData({ showOffline: false, offline: null });
      this.refresh();
    }, () => this.onOfflineClaim());
  },
  onOfflineClose() { this.onOfflineClaim(); },

  // ============ 失败处理 ============
  onRevive() {
    ad.playRewardAd('revive', () => {
      Game.applyAd('revive');
      this.setData({ showDefeat: false });
      this.refresh();
    }, () => {
      // 广告失败也能复活一次（保底，防体验过差）
      const r = Game.applyAd('revive');
      if (!r.ok) this.toast(r.msg || '复活失败');
      this.setData({ showDefeat: false });
      this.refresh();
    });
  },
  onAcceptDefeat() {
    Game.acceptDefeat();
    this.setData({ showDefeat: false });
    this.toast('宿舍被攻陷… 重新开始第 ' + (Game.s.wave + 1) + ' 轮');
    this.refresh();
  }
});
