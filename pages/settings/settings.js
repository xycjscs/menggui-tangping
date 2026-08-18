/**
 * 设置页
 */
const Game = require('../../js/wx/game');
const core = require('../../js/core/gameCore');
const { formatNum } = require('../../js/core/number');

Page({
  data: {
    stats: {},
    heroes: [],
    showResetConfirm: false
  },
  onLoad() { this.refresh(); },
  onShow() { this.refresh(); },
  refresh() {
    const s = Game.s;
    if (!s) return;
    this.setData({
      stats: {
        wave: s.wave,
        kills: s.ghostsKilled,
        bosses: s.bossesKilled || 0,
        wavesCleared: s.wavesCleared,
        totalCoin: formatNum(s.totalCoin),
        defeats: s.defeats,
        level: s.level,
        souls: formatNum(Math.floor(s.soul))
      },
      heroes: core.HEROES.map((h, i) => ({
        id: h.id,
        name: h.name,
        icon: h.icon,
        unlocked: s.heroes[i].unlocked,
        level: s.heroes[i].level,
        maxLevel: h.maxLevel
      }))
    });
  },
  onResetTap() { this.setData({ showResetConfirm: true }); },
  onResetCancel() { this.setData({ showResetConfirm: false }); },
  onResetConfirm() {
    Game.reset();
    this.setData({ showResetConfirm: false });
    this.refresh();
    wx.navigateBack();
  }
});
