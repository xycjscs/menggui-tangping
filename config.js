/**
 * 全局配置
 * 广告位 ID 在微信开发者工具「流量主」开通后替换 AD_DEBUG=false 并填入真实 adUnitId
 */
module.exports = {
  VERSION: '0.6.1',
  SAVE_KEY: 'menggui_tangping_save_v1',

  // 广告开关：AD_DEBUG=true 时模拟广告（开发/内测用），上线前改为 false
  ENABLE_ADS: true,
  AD_DEBUG: true,
  ADS: {
    coin_bonus: 'adunit-xxxxxxxxxxxxxxxx',   // 金币红包
    income_boost: 'adunit-xxxxxxxxxxxxxxxx', // 双倍收益 1 小时
    wave_delay: 'adunit-xxxxxxxxxxxxxxxx',   // 猛鬼延后 10 分钟
    door_fix: 'adunit-xxxxxxxxxxxxxxxx',     // 修复大门
    offline_double: 'adunit-xxxxxxxxxxxxxxxx',// 离线收益翻倍
    revive: 'adunit-xxxxxxxxxxxxxxxx',       // 门破看广告复活
    banner: 'adunit-xxxxxxxxxxxxxxxx',       // 底部 banner
    // v0.2 新增
    daily_bonus: 'adunit-xxxxxxxxxxxxxxxx',  // 每日广告福利（每天1次：金币+灵魂）
    hero_deal: 'adunit-xxxxxxxxxxxxxxxx',    // 英雄7折券（10分钟冷却）
    task_reward: 'adunit-xxxxxxxxxxxxxxxx',  // 每日任务领奖（每次完成领取看广告）
    // v0.6 手机端：游戏内快捷奖励（战场底部状态坞）
    game_bonus: 'adunit-xxxxxxxxxxxxxxxx'    // 看广告：本局金币 +50%（每局 1 次）
  },

  // 广告冷却（毫秒）—— 与 core 中 AD_COOLDOWN 保持一致
  AD_COOLDOWN: {
    coin_bonus: 30 * 60 * 1000,
    income_boost: 2 * 60 * 60 * 1000,
    wave_delay: 10 * 60 * 1000,
    door_fix: 0,             // 按条件可用（门耐久 < 40%）
    revive: 60 * 1000,
    daily_bonus: 0,          // 按天限制
    hero_deal: 10 * 60 * 1000,
    task_reward: 0,          // 按任务限制
    game_bonus: 0            // 按局限制（每局 1 次，controller 侧控制）
  }
};
