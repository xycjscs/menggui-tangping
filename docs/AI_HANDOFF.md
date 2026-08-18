# AI 断点交接文档（AI HANDOFF）

> 本文档写给"接手继续开发的本 AI 或下一个 AI"。读完即可从断点继续，无需人工解释背景。
> 人类开发者请看 `docs/DEV_LOG.md`（叙事版）和 `README.md`。

## 1. 一句话项目状态

猛鬼宿舍·躺平发育 v0.1.0 已完成并推送 GitHub（xycjscs/menggui-tangping）。
**核心逻辑 70/70 测试通过、3 天数值模拟达标、小程序 UI 完成、广告 6 点位接入（调试模式）。**
下一步是：填真实广告位 ID → 开发者工具调 UI → 提审上线。详见 §6 待办清单。

## 2. 快速上手（断点恢复 SOP）

```bash
# 1. 拉代码
git clone https://github.com/xycjscs/menggui-tangping.git
cd menggui-tangping

# 2. 跑核心测试（必须全绿才能动核心逻辑）
node tests/simulate.js        # 70 断言 + 3天模拟
node tests/tune.js            # 调参对比（改曲线前先跑基线）

# 3. 改数值后验证节奏
#    目标：3天模拟 波次>50、门破<20、清波中位<120s、P90<900s

# 4. 改 UI 后在微信开发者工具导入项目根目录
#    project.config.json 的 appid 是 touristappid（游客），需替换为自己的
```

**铁律：先跑 `node tests/simulate.js`，红了就不要提交。**

## 3. 代码结构

```
menggui-tangping/
├── app.js / app.json / app.wxss    # 小程序入口
├── config.js                        # ★ 广告位 ID + 开关（上线前改这里）
├── project.config.json              # 微信开发者工具配置（appid 待换）
├── pages/
│   ├── index/                       # 主游戏页（全部玩法 UI）
│   └── settings/                    # 统计 + 重置存档
├── js/
│   ├── core/
│   │   ├── gameCore.js              # ★★ 核心逻辑（纯JS无wx，Node可跑）
│   │   └── number.js                # 数字格式化
│   └── wx/
│       ├── game.js                  # Game 单例：封装 core + 存档 + 1s tick 循环
│       └── ad.js                    # 广告统一入口 playRewardAd(key, ok, fail)
├── images/                          # CC0 素材（Kenney）
│   ├── tiles/    # 门x3/地板/砖/草/树
│   ├── icons/    # 金币/灵魂/炮塔/剑/UI图标
│   ├── sprites/  # 床/幽灵x4
│   └── ui/       # title.png
├── tests/
│   ├── simulate.js                  # ★ 70 断言 + 3天 AI bot 模拟
│   └── tune.js                      # 曲线调参对比器（patch CURVE 跑多组）
├── scripts/build_assets.py          # 素材处理（源包在 assets-raw，未入库）
└── docs/
    ├── DEV_LOG.md                   # 人类向开发日志
    └── AI_HANDOFF.md                # ← 本文件
```

**依赖关系**：`pages/*` → `js/wx/game.js` + `js/wx/ad.js` → `js/core/gameCore.js`（纯函数式状态机）。
核心不碰 wx，所以所有数值/战斗/广告逻辑都能在 Node 里测。

## 4. 架构关键决策（为什么这么设计）

1. **虚拟时钟 `s.time`**（秒）：波次排期、双倍收益截止、门回血全部基于它。
   真实墙钟 `Date.now()` 只用于：广告冷却、`lastSave` 存档时间。
   → 战斗确定性 + 可测试。不要把这个设计改回去（第一版就栽在这，见 §5.1）。
2. **`CURVE` 对象集中所有成长曲线**（gameCore.js 顶部）：波次鬼数/血量/伤害、门血量/反击、炮塔 DPS。
   调数值只改这一处；`tests/tune.js` 通过 `Object.assign(core.CURVE, {...})` 试不同曲线。
3. **门破不直接失败**：进入 `s.defeated=true` 冻结态 → UI 弹选择（看广告复活 / 接受失败）。
   复活有双保险：每局限 1 次（`revivedThisDefeat`）+ 60s 真实冷却（防刷广告）。
4. **战斗按击杀时间结算受击**：`effTime = min(1s, 总鬼血/dps)`，鬼死即停。
   不做这个，高波次会出现"鬼还没死门先被满额伤害秒杀"的假象（§5.3）。
5. **广告是纯函数**：`core.applyAd(s, key)` 只改状态，`js/wx/ad.js` 负责真正播广告，
   成功后调 `Game.applyAd(key)`。`AD_DEBUG=true` 时 600ms 模拟成功。
   → 上线只需改 config.js：`AD_DEBUG:false` + 填 7 个 adUnitId。
6. **存档**：`wx.setStorageSync('menggui_tangping_save_v1', JSON)`。
   `core.load()` 做版本/结构校验，坏档返回 null 自动开新局。
   战斗中间态（ghosts）不入库，读档后从下一波开始。

## 5. 已踩的坑（血泪教训，别重蹈）

1. **墙钟 tick**：初版 `tick()` 内用 `Date.now()/1000` 判断波次触发，
   测试里连续 tick(1s) 但真实时间只过了 0.01s → 波次永远不触发。
   解法：虚拟时钟 `s.time += step`。**任何"时间相关"逻辑都用 s.time。**
2. **鬼伤害增长(1.15^n) > 门血量增长(1.12^n)**：数学上保证玩家必无限死循环，
   模拟出现 7817 次门破。解法：鬼伤害 1.05^n < 门 1.12^n。
   **规则：任何"敌人成长率"必须 < 对应"防御成长率"，且等级要能追波次（上限 300）。**
3. **同帧伤害模型**：高波次 30 只鬼总攻速 300万/s，门 600万血，
   若"先扣满 1s 伤害再判鬼死"，门永远先破。解法：§4.4 的 effTime。
4. **复活广告无冷却**：bot 每秒复活一次，刷了 7817 次广告。
   解法：revivedThisDefeat + 60s 冷却 + 测试 bot 里 `markAdUsed`。
   **规则：所有广告奖励必须有次数或冷却约束。**
5. **升级费用用 `costGrowth^level` 还是 `^(level-1)`**：buildingCost 用 `^(level-1)`
   （1 级升 2 级 = baseCost）。改费用公式时注意别多乘一级。
6. **测试里 tryUpgrade 会静默失败**（金币不足返回 {ok:false}），
   断言失败时先检查测试状态有没有补够金币（s.coin = 1000 这种）。
7. **Kenney tile 网格是 17px 间距**（16px tile + 1px margin），裁剪坐标 `c*17`。
   素材源包不入库（体积大），重建用 `scripts/build_assets.py` + assets-raw（本地保留）。

## 6. 待办清单（按优先级）

### P0 上线前必须
- [ ] `config.js`：`AD_DEBUG: false` + 填 7 个真实 adUnitId（流量主开通后）
- [ ] `project.config.json`：appid 换成自己的小程序 appid
- [ ] 微信开发者工具导入，人工过一遍：
      开局引导 → 升床/门/炮塔 → 第1波战斗 → 门破弹窗（复活+失败两条路）
      → 离线结算弹窗 → 设置页重置
- [ ] 真机预览（开发者工具模拟器和真机广告行为有差异）
- [ ] 隐私协议（涉及用户数据？当前只有本地存档，提审时勾选"不涉及"）

### P1 玩法迭代
- [ ] 第 10 波/50 波/100 波里程碑奖励（clearedWave10 钩子已埋）
- [ ] 成就系统（firstKill 等标记已埋，缺 UI）
- [ ] 门破时"危险预警"提前 30s 提示（threatDanger 已算出，UI 只显示红条）
- [ ] 波次间歇期加"准备倒计时"视觉（数字倒数）
- [ ] 音效（激励视频前后、击杀、门破）
- [ ] 每日签到/每日广告次数上限（留存）

### P2 数值长线
- [ ] 第 2 周内容：新怪物种类（ghost_2/3/4 素材已备好，缺 spawn 逻辑）
- [ ] 第 3 周内容：宿舍 2.0（更多床位/新建筑位）
- [ ] 鬼血量 1.22^n 若 2 周后玩家普遍卡在 50 波，降 1.20 或加"波次跳过"广告

## 7. 数值红线（改曲线前必读）

模拟（3 天 AI bot）必须满足：
- 最高波次 ≥ 50（当前 241）
- 门破次数 ≤ 20（当前 9，理想 0~10 = 有张力但不挫败）
- 清波耗时中位 ≤ 120s，P90 ≤ 900s（当前 6s / 359s）
- 6 床位 3 天内全解锁
- 失败/复活循环不能出现在 3 天模拟里（出现 = 曲线必死，回炉）

**改曲线的标准流程**：
1. `node tests/tune.js` 跑基线
2. 改 `js/core/gameCore.js` 的 CURVE（或加新曲线组到 tune.js 对比）
3. `node tests/simulate.js` 全绿 + 红线达标
4. 更新 `docs/DEV_LOG.md` 的数值速查表
5. commit message 写明：改了哪条曲线 + 前后模拟对比数字

## 8. 常用调试片段

```js
// Node REPL 快速看某波数值
const c = require('./js/core/gameCore');
for (const n of [1,5,10,50]) {
  console.log(n, c.waveCount(n), c.waveGhostHp(n), c.waveGhostDmg(n));
}

// 手动构造高波场景压测门
let s = c.newGame();
s.door = {level:300, hp: c.doorMaxHp(s)};
s.turret = {level:300}; s.wave = 200; s.time = 0; s.nextWaveAt = 1;
for (let i=0;i<600;i++){ c.tick(s,1); if(s.defeated) break; }

// 看当前存档
// 开发者工具 Console: wx.getStorageSync('menggui_tangping_save_v1')
```

## 9. 断点位置（2026-08-18 下班时）

- 已完成：全部 P0 中"代码侧"工作（广告是占位符状态）
- 卡点：**等用户提供真实小程序 appid + 流量主广告位 ID**（需用户注册微信开发者账号操作，AI 无法代劳）
- 下一个 AI 接手第一步：问用户要 appid 和 adUnitId → 填 config.js → 开发者工具验证 → 提审
