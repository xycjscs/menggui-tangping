/**
 * 猛鬼宿舍·躺平发育 —— 关卡数据模块（v0.4）
 * 纯数据 + 纯函数，无 wx/canvas 依赖，UMD 导出（Node 可测 / 浏览器全局 MGLLevels / 小程序 require）
 *
 * 关卡 = 一局自包含的波次挑战：
 *   - 每关有初始资源（床/门/炮塔/祭坛/英雄）与"清除 N 波"胜利目标
 *   - 胜利 → 结算奖励进首页钱包 + 星级评价（未复活3星 / 1次复活2星 / 多次1星）
 *   - 门破 → 看广告复活（每次失败1次）或 认输（本局作废，回首页）
 *   - 过关解锁下一关；每关可重复挑战刷更高星级
 *
 * 关卡进度/钱包/设置都是"长效"数据，与单局存档分离（controller 负责持久化）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MGLLevels = factory();
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // 每关 3 个"入场支援"（进入页交互，三选一，免费，每局限用所选）
  // kind: coin(开局金币) / soul(开局灵魂) / door(大门+2级)
  var SUPPORT_DEFS = [
    { kind: 'coin', icon: 'coin.png', icoDir: 'icons', name: '金币储备', desc: '开局额外金币' },
    { kind: 'soul', icon: 'soul.png', icoDir: 'icons', name: '灵魂庇佑', desc: '开局额外灵魂' },
    { kind: 'door', icon: 'door_2.png', icoDir: 'tiles', name: '加固大门', desc: '开局大门 +2 级' }
  ];

  var LEVELS = [
    {
      id: 1, name: '守夜 · 宿舍一楼', sub: '5 波 · 新手',
      wave: 5,
      init: { coin: 60, soul: 0, door: 1, turret: 0, altar: 0, beds: 1, heroes: [] },
      reward: { coin: 300, soul: 80 }
    },
    {
      id: 2, name: '深夜 · 第一只 BOSS', sub: '10 波 · 首杀 BOSS',
      wave: 10,
      init: { coin: 150, soul: 0, door: 1, turret: 1, altar: 0, beds: 2, heroes: [] },
      reward: { coin: 800, soul: 200 }
    },
    {
      id: 3, name: '子夜 · 走廊回声', sub: '15 波 · 压力上升',
      wave: 15,
      init: { coin: 420, soul: 30, door: 2, turret: 1, altar: 1, beds: 2, heroes: [] },
      reward: { coin: 1800, soul: 400 }
    },
    {
      id: 4, name: '凌晨 · 双 BOSS 夜', sub: '20 波 · 双 BOSS',
      wave: 20,
      init: { coin: 1000, soul: 60, door: 3, turret: 2, altar: 1, beds: 3, heroes: [] },
      reward: { coin: 4000, soul: 900 }
    },
    {
      id: 5, name: '破晓前 · 圣骑士参战', sub: '30 波 · 英雄首秀',
      wave: 30,
      init: { coin: 2600, soul: 120, door: 4, turret: 3, altar: 2, beds: 3, heroes: [0] },
      reward: { coin: 9000, soul: 1800 }
    },
    {
      id: 6, name: '月蚀 · 猎手之影', sub: '50 波 · 双英雄',
      wave: 50,
      init: { coin: 6500, soul: 250, door: 6, turret: 4, altar: 3, beds: 4, heroes: [0, 1] },
      reward: { coin: 20000, soul: 4000 }
    },
    {
      id: 7, name: '血月 · 法师齐射', sub: '75 波 · 三英雄',
      wave: 75,
      init: { coin: 16000, soul: 500, door: 8, turret: 6, altar: 4, beds: 5, heroes: [0, 1, 2] },
      reward: { coin: 45000, soul: 9000 }
    },
    {
      id: 8, name: '终局 · 百波传奇', sub: '100 波 · 十连 BOSS',
      wave: 100,
      init: { coin: 40000, soul: 1000, door: 10, turret: 8, altar: 5, beds: 6, heroes: [0, 1, 2, 3] },
      reward: { coin: 100000, soul: 20000 }
    }
  ];

  /** 取关卡定义（id 无效返回 null） */
  function getLevel(id) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return LEVELS[i];
    return null;
  }

  /** 关卡是否已解锁（progress = {unlocked: 数字, stars: {id: 星数}}） */
  function isUnlocked(progress, id) {
    if (!id) return true;
    var lv = getLevel(id);
    if (!lv) return false;
    if (lv.id === 1) return true;
    var prev = getLevel(lv.id - 1);
    return !!(progress && (progress.unlocked >= id || (prev && progress.stars && progress.stars[prev.id] > 0)));
  }

  /** 星级：整局复活 0 次=3星，1 次=2星，>=2 次=1星 */
  function starsForRevives(revives) {
    if (revives <= 0) return 3;
    if (revives === 1) return 2;
    return 1;
  }

  /** 支援效果（按关卡缩放） */
  function supportEffect(level, kind) {
    var L = level.id;
    if (kind === 'coin') return { coin: Math.floor(level.init.coin * 10 + 500 * L) };
    if (kind === 'soul') return { soul: Math.floor(level.init.soul * 5 + 100 * L) };
    if (kind === 'door') return { door: 2 };
    return {};
  }

  /** 钱包"精锐支援"（进入页付费项）：费用与效果 */
  function eliteSupport(level) {
    var L = level.id;
    return {
      cost: { coin: Math.floor(level.reward.coin * 2) },
      gain: { coin: Math.floor(level.reward.coin * 8), soul: Math.floor(level.reward.soul * 4) }
    };
  }

  /** 通关统计（用于进入页展示） */
  function bestStars(progress, id) {
    return (progress && progress.stars && progress.stars[id]) || 0;
  }

  return { LEVELS: LEVELS, SUPPORT_DEFS: SUPPORT_DEFS, getLevel: getLevel,
           isUnlocked: isUnlocked, starsForRevives: starsForRevives,
           supportEffect: supportEffect, eliteSupport: eliteSupport, bestStars: bestStars };
});
