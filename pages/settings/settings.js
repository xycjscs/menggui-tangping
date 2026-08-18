/**
 * 设置页
 */
const Game = require('../../js/wx/game');

Page({
  data: {
    stats: {},
    showResetConfirm: false
  },
  onLoad() { this.refresh(); },
  refresh() {
    const s = Game.s;
    if (!s) return;
    this.setData({
      stats: {
        wave: s.wave,
        kills: s.ghostsKilled,
        totalCoin: require('../../js/core/number').formatNum(s.totalCoin),
        defeats: s.defeats,
        level: s.level
      }
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
