# 猛鬼宿舍·躺平发育

> 微信小程序放置游戏。参考《猛鬼宿舍》玩法的放置化改编：
> 躺平睡觉赚金币，升级床位、大门、炮塔和灵魂祭坛，自动抵御一波又一波的猛鬼。
> 离线也有收益，关键资源看广告获取。

![主界面](images/ui/title.png)

## 玩法

- **6 张床位**：每张床是一个躺平者，自动产金币+经验。按顺序解锁，各自升级。
- **大门**：抵挡猛鬼攻击，等级越高血越厚、反击越强（3 种门外观随等级变化）。
- **炮塔**：自动攻击来袭猛鬼，主要输出。
- **灵魂祭坛**：献祭灵魂，全局产量 +25%/级。
- **猛鬼波次**：每波鬼更多更硬，门被打空会弹出「看广告复活 / 接受失败」抉择。
- **离线收益**：最多累积 8 小时（50% 效率），看广告可翻倍。

## 广告变现点

| 广告位 | 奖励 | 冷却 |
|---|---|---|
| coin_bonus | 金币红包（cps×5分钟） | 30 分钟 |
| income_boost | 全局产量 ×2 | 2 小时 |
| wave_delay | 猛鬼延后 10 分钟 | 10 分钟 |
| door_fix | 大门回满血 | 残血<40%可用 |
| offline_double | 离线收益 ×2 | 每次离线 |
| revive | 门破复活（回50%血） | 每局1次+60s |
| banner | 底部 banner | 常驻 |

开发阶段 `config.js` 的 `AD_DEBUG: true` 会模拟广告直接通过，方便开发者工具调试。
上线前改为 `false` 并填入真实 `adUnitId`。

## 目录结构

```
pages/        小程序页面（index 主游戏 + settings 设置）
js/core/      纯 JS 核心逻辑（Node 可测，不依赖 wx）
js/wx/        wx 封装层（存档、1s tick 循环、广告）
images/       CC0 游戏素材
tests/        核心逻辑测试 + 3 天数值模拟 + 调参器
docs/         开发日志 + AI 断点交接文档
config.js     广告位配置（★ 上线前修改）
```

## 本地测试

```bash
node tests/simulate.js   # 70 断言 + 3 天 AI 挂机模拟
node tests/tune.js       # 数值曲线调参对比
```

在 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) 中导入本目录即可预览（需替换 `project.config.json` 的 appid）。

## 素材授权

全部素材来自 [Kenney](https://kenney.nl)，**CC0 公共领域**，可商用无需署名（已尽量署名）：
- [Roguelike RPG Pack](https://kenney.nl/assets/roguelike-rpg-pack)（tile/门/床/图标）
- [Game Icons](https://kenney.nl/assets/game-icons)（UI 图标）
- [Monster Builder Pack](https://kenney.nl/assets/monster-builder-pack)（幽灵怪物部件）

## 开发文档

- [docs/DEV_LOG.md](docs/DEV_LOG.md) — 开发日志（人类向）
- [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) — AI 断点交接文档（架构决策/踩坑/待办）
