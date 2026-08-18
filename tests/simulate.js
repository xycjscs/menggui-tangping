/**
 * 猛鬼宿舍·躺平发育 —— 核心逻辑测试 + 数值模拟
 * 运行: node tests/simulate.js
 */
const path = require('path');
const core = require(path.join(__dirname, '..', 'js', 'core', 'gameCore'));
const { formatNum, formatDuration } = require(path.join(__dirname, '..', 'js', 'core', 'number'));

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ FAIL: ' + msg); }
}
function section(name) { console.log('\n=== ' + name + ' ==='); }
// ============ 1. 工具函数 ============
section('数字格式化');
assert(formatNum(0) === '0', '0 -> "0"');
assert(formatNum(1234) === '1234', '1234 -> "1234"');
assert(formatNum(12345) === '1.23万', '12345 -> "1.23万"');
assert(formatNum(230000000) === '2.3亿', '2.3e8 -> "2.3亿"');
assert(formatNum(5.5) === '5.5', '5.5 -> "5.5"');
assert(formatDuration(45) === '45秒', '45秒');
assert(formatDuration(3665) === '1小时1分', '3665秒 -> 1小时1分');
assert(formatDuration(90061) === '1天1小时', '90061秒 -> 1天1小时');

// ============ 2. 新档与产量 ============
section('新档状态');
let s = core.newGame();
assert(s.beds[0].unlocked && s.beds[0].level === 1, '床0 1级已解锁');
assert(s.beds[1].unlocked === false, '床1 未解锁');
assert(s.door.level === 1 && s.door.hp === 180, '大门1级 180血 (100+80)');
assert(core.coinPerSec(s) === 0.5, '初始金币/秒 = 0.5');
assert(core.expPerSec(s) === 0.1, '初始经验/秒 = 0.1');
assert(core.doorMaxHp(s) === 180, '门最大血 180');
assert(core.totalDefendDps(s) === 4, '初始反击 4 dps (门1级*4)');
assert(s.nextWaveAt === core.FIRST_WAVE_AT, '首波在 60s (虚拟时钟)');

// ============ 3. 升级费用 ============
section('费用与升级');
let s2 = core.newGame();
assert(core.bedCost(s2, 0) === 10, '床0 升级费用 = 10');
s2.coin = 100;
let r = core.tryUpgradeBed(s2, 0);
assert(r.ok && r.level === 2 && s2.coin === 90, '床0升到2级 扣10金币');
assert(Math.abs(core.coinPerSec(s2) - 0.775) < 1e-9, '2级床 0.5*1.55=0.775/s');
r = core.tryUnlockBed(s2, 1);
assert(r.ok && s2.beds[1].unlocked && s2.beds[1].level === 1, '解锁床1 (80金币) 成功, 剩' + Math.floor(s2.coin));
assert(Math.abs(core.coinPerSec(s2) - 1.275) < 1e-9, '两床产量叠加 = 1.275');
r = core.tryUnlockBed(s2, 3);
assert(!r.ok, '跳级解锁床3 被拒绝');
s2.coin = 300;  // 补充金币测后续升级
r = core.tryUpgradeDoor(s2);
assert(r.ok && s2.door.level === 2 && s2.door.hp === core.doorMaxHp(s2), '门升级2级并回满');
assert(core.doorMaxHp(s2) === 189, '门2级血量 = 189 (100+80*1.12)');
r = core.tryUpgradeTurret(s2);
assert(r.ok && core.turretDps(s2) === 6, '炮塔1级 6 dps');
// 祭坛
s2.soul = 100;
r = core.tryUpgradeAltar(s2);
assert(r.ok && s2.altar.level === 1, '祭坛升级 (50灵魂)');
assert(Math.abs(core.coinPerSec(s2) - 1.275 * 1.25) < 1e-9, '祭坛1级 全局 x1.25');

// ============ 4. 经验/灵魂/等级 ============
section('经验与等级');
let s3 = core.newGame();
const soulBefore = s3.soul;
core.gainExp(s3, 50);
assert(s3.level === 2, '50经验升到2级');
assert(s3.soul > soulBefore, '灵魂增加');
core.gainExp(s3, 1e9);
assert(s3.level > 10, '巨量经验连跳多级: level=' + s3.level);

// ============ 5. 战斗模拟（小规模）============
section('战斗：门扛不住 vs 炮塔够强');
// 5a. 只有1级门(4dps)：4只鬼 总60血 -> 15s击杀，但门180/16dps=11.25s先破
let s4 = core.newGame();
let evts = [];
for (let i = 0; i < 200; i++) {
  if (s4.defeated) break;
  evts = evts.concat(core.tick(s4, 1));
}
const defeat = evts.find(e => e.type === 'defeat');
assert(!!defeat, '弱防御：1级门打不过第1波 -> 进入待处理失败 @time' + Math.floor(s4.time));
assert(s4.defeated === true, 'defeated 标记为 true');
assert(core.tick(s4, 10).length === 0, '失败待处理时 tick 冻结');
// 复活路径
const rv = core.tryRevive(s4);
assert(rv.ok && s4.defeated === false && s4.door.hp === Math.floor(core.doorMaxHp(s4) * 0.5), '看广告复活: 门回50%血');
// 接受失败路径
s4.defeated = true;
core.acceptDefeat(s4);
assert(s4.defeated === false && s4.wave === 0 && s4.defeats === 1, '接受失败: 波次清零 defeats=1');
assert(s4.beds[0].level >= 1, '床等级减半后 >=1');
assert(s4.door.level === 1, '门重置1级');

// 5b. 强化防御：门2级(4.6dps)+炮塔1级(6dps)=10.6dps -> 60/10.6≈5.7s 清波 < 门11.8s存活
let s5 = core.newGame();
s5.coin = 1000;
core.tryUpgradeDoor(s5);
core.tryUpgradeTurret(s5);
assert(Math.abs(core.totalDefendDps(s5) - (4 * 1.15 + 6)) < 1e-6, '防御 = 4*1.15+6 = 10.6 dps');
let evts5 = [];
for (let i = 0; i < 120; i++) evts5 = evts5.concat(core.tick(s5, 1));
const cleared = evts5.find(e => e.type === 'wave_cleared');
assert(!!cleared, '强防御清掉第1波 (bonus=' + (cleared && cleared.bonus) + ')');
assert(s5.ghostsKilled === 4, '击杀4只鬼');
assert(s5.wavesCleared === 1, '清波计数=1');
assert(s5.soul > 0, '灵魂奖励到账');

// 5c. 威胁评估
const s5c = core.newGame();
s5c.coin = 1000;
core.tryUpgradeDoor(s5c);
core.tryUpgradeTurret(s5c);   // 门+炮塔 => 安全
assert(core.nextWaveThreat(s5c).safe === true, '威胁评估：门2级+炮塔 对第1波=安全');
const s5d = core.newGame();
assert(core.nextWaveThreat(s5d).safe === false, '威胁评估：纯1级门 对第1波=危险');

// ============ 6. 完整数值模拟（挂机 3 天）============
section('完整模拟：AI策略挂机 3 天');
/**
 * AI 策略（v0.2）：
 * 1. 门残血 -> 用"修复大门"广告（模拟）
 * 2. 下一波威胁不安全 -> 堆 DPS（炮塔/门/英雄）
 * 3. 灵魂富余 -> 按解锁顺序买英雄 / 升英雄 / 升祭坛
 * 4. 否则解锁下一张床 / 升级最低等级床
 */
function botTick(s, dt = 1) {
  // 门破 => 模拟玩家看广告复活；复活不了（冷却/已复活过）则接受失败
  if (s.defeated) {
    const rv = core.tryRevive(s);
    if (rv.ok) core.markAdUsed(s, 'revive');
    else core.acceptDefeat(s);
    return [];
  }
  if (s.door.hp / core.doorMaxHp(s) < 0.35 && core.canUseAd(s, 'door_fix').ok) {
    core.applyAd(s, 'door_fix');
    core.markAdUsed(s, 'door_fix');
  }
  let acted = null;
  const threat = core.nextWaveThreat(s);
  let nextBed = -1;
  for (let i = 1; i < core.MAX_BEDS; i++) if (!s.beds[i].unlocked) { nextBed = i; break; }
  if (!threat.safe && s.ghosts.length === 0) {
    const tCost = core.turretCost(s);
    const dCost = core.doorCost(s);
    // 升级炮塔带来的 DPS 增量 / 成本
    const tGain = s.turret.level === 0 ? core.CURVE.turretDps({ turret: { level: 1 } }) : core.turretDps({ turret: { level: s.turret.level + 1 } }) - core.turretDps(s);
    const dGain = core.doorCounterDps({ door: { level: s.door.level + 1 } }) - core.doorCounterDps(s);
    const tEff = tGain / tCost, dEff = dGain / dCost;
    if (s.coin >= tCost && tEff >= dEff * 0.5) {
      const rr = core.tryUpgradeTurret(s); if (rr.ok) acted = 'turret';
    } else if (s.coin >= dCost) {
      const rr = core.tryUpgradeDoor(s); if (rr.ok) acted = 'door';
    } else if (s.coin >= tCost) {
      const rr = core.tryUpgradeTurret(s); if (rr.ok) acted = 'turret';
    }
    // 金币不够堆防御时，尝试用金币升 DPS 英雄
    if (!acted) {
      for (let i = 0; i < core.HEROES.length; i++) {
        const h = core.HEROES[i];
        const st = s.heroes[i];
        if (st.unlocked && h.type === 'dps' && st.level < h.maxLevel) {
          const c = core.heroUpgradeCost(s, i);
          if (s.coin >= c) { const rr = core.tryUpgradeHero(s, i); if (rr.ok) { acted = 'hero' + i; break; } }
        }
      }
    }
  } else if (nextBed >= 0 && s.coin >= core.unlockBedCost(s, nextBed)) {
    const rr = core.tryUnlockBed(s, nextBed); if (rr.ok) acted = 'unlock' + nextBed;
  } else {
    // 灵魂富余买英雄（按解锁顺序）；攒灵魂升祭坛；升级产量最低的床（均衡成长）；补门
    if (acted === null) {
      for (let i = 0; i < core.HEROES.length; i++) {
        const h = core.HEROES[i];
        const st = s.heroes[i];
        if (!st.unlocked && s.soul >= h.unlockSoul) {
          const rr = core.tryBuyHero(s, i); if (rr.ok) { acted = 'buyHero' + i; break; }
        }
      }
    }
    if (acted === null && s.soul >= core.altarCost(s) && s.altar.level < 100) {
      const rr = core.tryUpgradeAltar(s); if (rr.ok) acted = 'altar';
    }
    let bi = -1, bl = Infinity;
    for (let i = 0; i < core.MAX_BEDS; i++) {
      const b = s.beds[i];
      if (b.unlocked && b.level < bl) { bl = b.level; bi = i; }
    }
    if (bi >= 0) { const rr = core.tryUpgradeBed(s, bi); if (rr.ok) acted = 'bed' + bi; }
    if (s.coin >= core.doorCost(s)) { const rr = core.tryUpgradeDoor(s); if (rr.ok) acted = 'door'; }
    // 金币富余升级已解锁英雄
    if (acted === null || acted === 'door') {
      for (let i = 0; i < core.HEROES.length; i++) {
        const h = core.HEROES[i];
        const st = s.heroes[i];
        if (st.unlocked && st.level < h.maxLevel) {
          const c = core.heroUpgradeCost(s, i);
          if (s.coin >= c) { const rr = core.tryUpgradeHero(s, i); if (rr.ok) { acted = 'upHero' + i; break; } }
        }
      }
    }
  }
  return core.tick(s, dt);
}

let sim = core.newGame();
const TOTAL_SEC = 3 * 86400;
let maxWave = 0, lastCleared = 0, cpsNow = 0, soulNow = 0;
let defeatLog = [];
let clearDurs = [], wStart = 0, revives = 0, bossWaves = 0;
let t = 0;
while (t < TOTAL_SEC) {
  const events = botTick(sim, 1);
  for (const e of events) {
    if (e.type === 'defeat') { defeatLog.push({ at: t, wave: e.wave }); revives++; }
    if (e.type === 'wave_start') { maxWave = Math.max(maxWave, e.wave); wStart = t; if (e.boss) bossWaves++; }
    if (e.type === 'wave_cleared') { lastCleared = e.wave; clearDurs.push(t - wStart); }
  }
  t += 1;
  if (t % 600 === 0) { cpsNow = core.coinPerSec(sim); soulNow = Math.floor(sim.soul); }
}
const q = clearDurs.slice().sort((a, b) => a - b);
const medDur = q.length ? q[Math.floor(q.length / 2)] : 0;
const p90Dur = q.length ? q[Math.floor(q.length * 0.9)] : 0;
console.log('  --- 3天模拟结果 ---');
console.log('  门破次数(均复活): ' + revives + '  ' + defeatLog.slice(0, 8).map(d => 'wave' + d.wave + '@' + (d.at / 3600).toFixed(1) + 'h').join(', '));
console.log('  最高波次:        ' + maxWave + '  (已清 ' + lastCleared + ')  Boss波出现: ' + bossWaves);
console.log('  清波耗时:        中位 ' + medDur + 's / P90 ' + p90Dur + 's / 最长 ' + (q.length ? q[q.length - 1] : 0) + 's');
console.log('  累计击杀:        ' + sim.ghostsKilled + ' (Boss ' + sim.bossesKilled + ')');
console.log('  床等级:          ' + sim.beds.map(b => b.unlocked ? b.level : '-').join(' '));
console.log('  门等级:          ' + sim.door.level + ' (血 ' + Math.floor(sim.door.hp) + '/' + core.doorMaxHp(sim) + ')');
console.log('  炮塔等级:        ' + sim.turret.level + ' (dps ' + core.turretDps(sim).toFixed(1) + ')');
console.log('  英雄:            ' + core.HEROES.map((h, i) => h.name + 'Lv' + sim.heroes[i].level + (sim.heroes[i].unlocked ? '' : '(未解锁)')).join(' '));
console.log('  祭坛等级:        ' + sim.altar.level);
console.log('  金币/秒:         ' + formatNum(cpsNow));
console.log('  累计金币:        ' + formatNum(sim.totalCoin));
console.log('  灵魂:            ' + formatNum(soulNow));
console.log('  玩家等级:        ' + sim.level);

assert(maxWave >= 50, '3天至少打到第50波 (实际 ' + maxWave + ')');
assert(revives <= 20, '门破次数(看广告复活机会) <= 20 (实际 ' + revives + ')');
assert(medDur <= 120, '清波耗时中位 <= 120s (实际 ' + medDur + 's)');
assert(p90Dur <= 900, '清波耗时 P90 <= 15min (实际 ' + p90Dur + 's)');
assert(sim.beds.every(b => b.unlocked), '3天内6张床全解锁');
assert(sim.totalCoin > 1e6, '累计金币 > 100万 (实际 ' + formatNum(sim.totalCoin) + ')');
assert(sim.level >= 5, '玩家等级 >= 5 (实际 ' + sim.level + ')');
assert(sim.wavesCleared >= 30, '至少清掉30波 (实际 ' + sim.wavesCleared + ')');
assert(bossWaves >= 2, '3天出现至少2个Boss波 (实际 ' + bossWaves + ')');
assert(sim.heroes[0].unlocked, '3天内招募第一位英雄(圣骑士)');

// ============ 7. 离线收益 ============
section('离线收益');
let s6 = core.newGame();
s6.beds[0].level = 10;
for (let i = 1; i < 4; i++) { s6.beds[i] = { level: 10, unlocked: true }; }
const cps = core.coinPerSec(s6);
s6.lastSave = Date.now() - 2 * 3600 * 1000;
const off = core.computeOffline(s6, Date.now() / 1000);
assert(Math.abs(off.coin - cps * 7200 * 0.5) < 1, '离线2h收益 = cps*7200*50% (实际 ' + off.coin.toFixed(0) + ')');
assert(off.capped === false, '2h 未超上限');
s6.lastSave = Date.now() - 12 * 3600 * 1000;
const off2 = core.computeOffline(s6, Date.now() / 1000);
assert(off2.capped === true && Math.abs(off2.seconds - 8 * 3600) < 1, '12h离线截断到8h');
const coinBefore = s6.coin;
const res = core.applyOffline(s6, Date.now() / 1000, true);
assert(Math.abs((s6.coin - coinBefore) - cps * 8 * 3600 * 0.5 * 2) < 2, '离线结算翻倍正确');
assert(res.mult === 2, '翻倍标记正确');

// ============ 8. 广告系统 ============
section('广告系统');
let s7 = core.newGame();
s7.coin = 100;
assert(core.canUseAd(s7, 'coin_bonus').ok === true, '金币红包初始可用');
const rAd = core.applyAd(s7, 'coin_bonus');
assert(rAd.ok && s7.coin >= 200, '红包到账 (实际 +' + rAd.bonus.toFixed(0) + ')');
core.markAdUsed(s7, 'coin_bonus');
const can2 = core.canUseAd(s7, 'coin_bonus');
assert(can2.ok === false, '红包冷却中 (剩 ' + can2.remain + 's)');
const s7b = core.newGame();
const cpsBefore = core.coinPerSec(s7b);
core.applyAd(s7b, 'income_boost');
assert(core.coinPerSec(s7b) === cpsBefore * 2, '双倍收益生效 x2 (虚拟时间)');
const s7c = core.newGame();
s7c.door.hp = 10;
assert(core.canUseAd(s7c, 'door_fix').ok === true, '门残血时修复广告可用');
assert(core.canUseAd(core.newGame(), 'door_fix').ok === false, '门健康时修复广告不可用');
const s7e = core.newGame();
const nw = s7e.nextWaveAt;
core.applyAd(s7e, 'wave_delay');
assert(s7e.nextWaveAt === s7e.time + 600, '延后猛鬼 +600s 虚拟时间');

// ============ 9. 存档序列化 ============
section('存档序列化');
let s8 = core.newGame();
s8.coin = 12345.678;
s8.beds[2] = { level: 7, unlocked: true };
s8.soul = 999;
s8.time = 12345;
const json = core.save(s8);
const s9 = core.load(json);
assert(s9 !== null, 'load 成功');
assert(s9.coin === 12345.678 && s9.beds[2].level === 7 && s9.soul === 999 && s9.time === 12345, '字段完整还原');
assert(core.load('garbage{{{') === null, '坏存档返回 null');
assert(core.load('{"v":99}') === null, '版本不符返回 null');
assert(core.load('{"v":1,"beds":[],"door":null,"turret":null}') === null, '结构缺失返回 null');

// ============ 10. 波次难度曲线 ============
section('波次难度曲线');
console.log('  波次 | 鬼数 | 鬼血量 | 单只伤害 | 门总压力 | 建议我方dps(10s清波)');
for (const n of [1, 5, 10, 20, 30]) {
  const cnt = core.waveCount(n);
  const hp = core.waveGhostHp(n);
  const dmg = core.waveGhostDmg(n);
  console.log(`  ${String(n).padStart(4)} | ${String(cnt).padStart(4)} | ${String(hp).padStart(7)} | ${String(dmg).padStart(8)} | ${(cnt * dmg).toString().padStart(6)} | ${(cnt * hp / 10).toFixed(1)}`);
}
assert(core.waveGhostHp(10) > core.waveGhostHp(1) * 5, '10波鬼血量 > 1波5倍 (实际 x' + (core.waveGhostHp(10) / core.waveGhostHp(1)).toFixed(1) + ')');

// ============ 11. v0.2 英雄系统 ============
section('v0.2 英雄系统');
let sh = core.newGame();
assert(sh.heroes.length === 4, '4位英雄状态初始化');
assert(core.heroDpsTotal(sh) === 0, '初始英雄DPS=0');
assert(core.heroSlowTotal(sh) === 0, '初始减伤=0');
assert(core.heroHealTotal(sh) === 0, '初始治疗=0');
// 招募圣骑士（150灵魂）
sh.soul = 150;
let hr = core.tryBuyHero(sh, 0);
assert(hr.ok && sh.heroes[0].unlocked && sh.heroes[0].level === 1, '招募圣骑士 (150灵魂)');
assert(sh.soul === 0, '灵魂扣完');
assert(Math.abs(core.heroDpsTotal(sh) - 4) < 1e-9, '圣骑士1级 +4 dps');
assert(Math.abs(core.totalDefendDps(sh) - (4 + 4)) < 1e-9, '总防御DPS = 门4 + 骑士4 = 8');
// 升级圣骑士
sh.coin = 1000;
const hUpCost = core.heroUpgradeCost(sh, 0);
hr = core.tryUpgradeHero(sh, 0);
assert(hr.ok && sh.heroes[0].level === 2 && sh.coin === 1000 - hUpCost, '圣骑士升2级 费用' + hUpCost);
assert(Math.abs(core.heroDpsOf(sh, 0) - 4 * 1.25) < 1e-9, '圣骑士2级 dps=5');
// 未招募升级被拒
hr = core.tryUpgradeHero(sh, 1);
assert(!hr.ok, '未招募的猎手不能升级');
// 灵魂不足招募被拒
const sh2 = core.newGame();
sh2.soul = 10;
assert(!core.tryBuyHero(sh2, 0).ok, '灵魂不足招募被拒');
// 暗影猎手减伤
const sh3 = core.newGame();
sh3.soul = 1000;
core.tryBuyHero(sh3, 1);
assert(Math.abs(core.heroSlowTotal(sh3) - 0.08) < 1e-9, '猎手1级 减伤8%');
// 减伤上限50%
const sh4 = core.newGame();
sh4.heroes[1] = { unlocked: true, level: 24 };
assert(core.heroSlowTotal(sh4) === 0.5, '猎手24级 减伤触顶50%');
// 战斗法师 DPS
const sh5 = core.newGame();
sh5.soul = 2000;
core.tryBuyHero(sh5, 2);
assert(Math.abs(core.heroDpsOf(sh5, 2) - 12) < 1e-9, '法师1级 +12 dps');
// 治愈祭司回血
const sh6 = core.newGame();
sh6.soul = 3000;
core.tryBuyHero(sh6, 3);
const maxHp6 = core.doorMaxHp(sh6);
sh6.door.hp = maxHp6 * 0.5;
core.tick(sh6, 1);
const expectRegen = maxHp6 * 0.02 + maxHp6 * 0.005;
assert(Math.abs((maxHp6 * 0.5 + expectRegen) - sh6.door.hp) < 1, '祭司1级 门每秒额外回0.5%上限 (实际回' + (sh6.door.hp - maxHp6 * 0.5).toFixed(2) + '/' + expectRegen.toFixed(2) + ')');
// 7折券
const sh7 = core.newGame();
core.applyAd(sh7, 'hero_deal');
assert(sh7.heroDeal === true, '英雄7折券生效');
sh7.soul = 200;
const hr7 = core.tryBuyHero(sh7, 0);
assert(hr7.ok && hr7.cost === Math.floor(150 * 0.7) && sh7.heroDeal === false, '7折招募: 150->105灵魂, 券一次性消耗');
assert(core.canUseAd(sh7, 'hero_deal').ok === true, '券消耗后可再观看(未记冷却)');
core.markAdUsed(sh7, 'hero_deal');
assert(core.canUseAd(sh7, 'hero_deal').ok === false, '记冷却后10分钟内不可用');

// ============ 12. v0.2 Boss 波 ============
section('v0.2 Boss 波 (每10波)');
assert(core.isBossWave(10) && core.isBossWave(20) && !core.isBossWave(9) && !core.isBossWave(0), 'isBossWave: 10/20是, 9/0不是');
const sb = core.newGame();
sb.wave = 9;
sb.time = sb.nextWaveAt; // 立即出波
sb.coin = 5000;
// 给足防御，确保能击杀
core.tryUpgradeDoor(sb);
core.tryUpgradeTurret(sb);
for (let i = 0; i < 4; i++) core.tryUpgradeTurret(sb);
sb.door.hp = core.doorMaxHp(sb);
let bEvts = [];
for (let i = 0; i < 400 && sb.wave === 9; i++) bEvts = bEvts.concat(core.tick(sb, 1));
assert(sb.wave === 10, '第10波生成');
const bStart = bEvts.find(e => e.type === 'wave_start' && e.wave === 10);
assert(bStart && bStart.boss === true, '第10波 wave_start 事件带 boss 标记');
assert(sb.ghosts.some(g => g.boss), 'Boss 实体存在');
const boss10 = sb.ghosts.find(g => g.boss);
assert(boss10 && Math.abs(boss10.maxHp - core.waveGhostHp(10) * core.BOSS_HP_MULT) < 1, 'Boss血量 = 普通鬼x10');
assert(boss10 && Math.abs(boss10.dmg - core.waveGhostDmg(10) * core.BOSS_DMG_MULT) < 1, 'Boss伤害 = 普通鬼x2.5');
// 威胁评估 Boss 波
const sb2 = core.newGame();
sb2.wave = 9;
const th2 = core.nextWaveThreat(sb2);
assert(th2.boss === true && th2.totalHp > 10 * core.waveGhostHp(10), '威胁评估识别Boss波且总血量>普通10倍');
// Boss 击杀奖励
const sb3 = core.newGame();
sb3.wave = 9;
sb3.time = sb3.nextWaveAt;
sb3.coin = 999999;
for (let i = 0; i < 30; i++) { core.tryUpgradeTurret(sb3); core.tryUpgradeDoor(sb3); }
sb3.door.hp = core.doorMaxHp(sb3);
const soulB3 = sb3.soul;
let b3ev = [];
for (let i = 0; i < 400 && !sb3.ghosts.length && i < 200; i++) b3ev = b3ev.concat(core.tick(sb3, 1));
for (let i = 200; i < 400; i++) b3ev = b3ev.concat(core.tick(sb3, 1));
const bossKilled = b3ev.find(e => e.type === 'boss_killed');
assert(!!bossKilled, 'Boss 被击杀事件');
assert(sb3.bossesKilled >= 1, 'bossesKilled 计数+1');
const cleared10 = b3ev.find(e => e.type === 'wave_cleared' && e.wave === 10);
assert(cleared10 && cleared10.boss === true && cleared10.bonus === Math.floor((Math.floor(20 * Math.pow(1.5, 9)) + 10) * 5), 'Boss波奖励 = 普通x5');

// ============ 13. v0.2 每日任务 ============
section('v0.2 每日任务');
let sq = core.newGame();
sq.daily = core.defaultDaily();
sq.daily.date = core.dateStr(Date.now());
// 击杀进度
core.questProgress(sq, 'kill', 50);
assert(sq.daily.quests[0].progress === 50, '击杀任务进度+50');
// 未完成不能领取
let cq = core.claimQuest(sq, 0);
assert(!cq.ok, '未完成(50/100)不能领取');
core.questProgress(sq, 'kill', 9999);
assert(sq.daily.quests[0].progress === 100, '击杀任务进度封顶100');
// 完成领取
cq = core.claimQuest(sq, 0);
assert(cq.ok && sq.soul >= 200, '完成领取: +200灵魂');
cq = core.claimQuest(sq, 0);
assert(!cq.ok, '不能重复领取');
// 金币任务进度
const sq2 = core.newGame();
sq2.daily = core.defaultDaily();
sq2.daily.date = core.dateStr(Date.now());
const coinQBefore = sq2.daily.quests[2].progress;
core.questProgress(sq2, 'coin', 1234.5);
assert(sq2.daily.quests[2].progress === coinQBefore + 1234.5, '金币任务进度累加');
// 跨天重置
const sq3 = core.newGame();
sq3.daily = core.defaultDaily();
sq3.daily.date = '1999-1-1';
sq3.daily.quests[0].progress = 55;
core.dailyRollover(sq3);
assert(sq3.daily.date === core.dateStr(Date.now()) && sq3.daily.quests[0].progress === 0, '跨天任务重置');
// 任务与升级联动
const sq4 = core.newGame();
sq4.daily = core.defaultDaily();
sq4.daily.date = core.dateStr(Date.now());
sq4.coin = 1000;
core.tryUpgradeBed(sq4, 0);
core.tryUpgradeDoor(sq4);
assert(sq4.daily.quests[1].progress === 2, '升级设施任务进度=2 (床+门)');

// ============ 14. v0.2 成就 ============
section('v0.2 成就');
let sa = core.newGame();
sa.firstKill = true;
sa.wavesCleared = 10;
sa.totalCoin = 60000;
sa.level = 12;
const list = core.listAchievements(sa);
const a1 = list.find(a => a.id === 'first_kill');
const a2 = list.find(a => a.id === 'wave10');
const a3 = list.find(a => a.id === 'coin50k');
const a4 = list.find(a => a.id === 'level10');
const a5 = list.find(a => a.id === 'wave50');
assert(a1.unlocked && a2.unlocked && a3.unlocked && a4.unlocked, '已达成的成就 unlocked=true');
assert(!a5.unlocked, '未达成成就 unlocked=false');
let ca = core.claimAchievement(sa, 'first_kill');
assert(ca.ok && sa.soul >= 50, '领取成就奖励 +50灵魂');
ca = core.claimAchievement(sa, 'first_kill');
assert(!ca.ok, '成就不能重复领取');
ca = core.claimAchievement(sa, 'wave50');
assert(!ca.ok, '未达成不能领取');
// 全英雄成就
const sa2 = core.newGame();
sa2.soul = 100000;
for (let i = 0; i < 4; i++) core.tryBuyHero(sa2, i);
const heroes4 = core.listAchievements(sa2).find(a => a.id === 'heroes4');
assert(heroes4.unlocked, '英雄满编成就解锁');

// ============ 15. v0.2 新广告位 ============
section('v0.2 新广告位');
// 每日福利
let sd = core.newGame();
sd.coin = 100;
sd.beds[0].level = 5;
assert(core.canUseAd(sd, 'daily_bonus').ok === true, '每日福利初始可用');
const coinD = sd.coin, soulD = sd.soul;
const da = core.applyAd(sd, 'daily_bonus');
assert(da.ok && sd.coin > coinD && sd.soul === soulD + 100, '每日福利: 金币+灵魂100');
assert(core.canUseAd(sd, 'daily_bonus').ok === false, '今日已领不可用');
// 英雄7折广告
const sd2 = core.newGame();
assert(core.canUseAd(sd2, 'hero_deal').ok === true, '英雄7折券初始可用');
core.applyAd(sd2, 'hero_deal');
core.markAdUsed(sd2, 'hero_deal');
assert(core.canUseAd(sd2, 'hero_deal').ok === false, '7折券10分钟冷却');
// 任务奖励广告（无状态，按任务领取限制）
const sd3 = core.newGame();
assert(core.canUseAd(sd3, 'task_reward').ok === true, '任务奖励广告位可用');

// ============ 16. v0.1 -> v0.2 存档迁移 ============
section('v0.1 -> v0.2 存档迁移');
// 模拟一个没有 v0.2 字段的旧存档
const oldSave = {
  v: 1, created: Date.now(), lastSave: Date.now(), time: 5000,
  coin: 500, soul: 300, totalCoin: 5000, totalExp: 200, level: 5,
  beds: [
    { level: 10, unlocked: true }, { level: 5, unlocked: true },
    { level: 0, unlocked: false }, { level: 0, unlocked: false },
    { level: 0, unlocked: false }, { level: 0, unlocked: false }
  ],
  door: { level: 3, hp: 200 }, turret: { level: 2 }, altar: { level: 1 },
  wave: 12, nextWaveAt: 6000, ghosts: [], defeated: false, revivedThisDefeat: false,
  ghostsKilled: 50, wavesCleared: 11, defeats: 1,
  adCooldown: {}, incomeBoostUntil: 0, firstKill: true, clearedWave10: true
};
const migrated = core.load(JSON.stringify(oldSave));
assert(migrated !== null, '旧存档可加载');
assert(migrated.heroes && migrated.heroes.length === 4, '迁移: heroes 数组补齐');
assert(migrated.daily && migrated.daily.quests.length === 3, '迁移: daily 补齐');
assert(migrated.achievements && typeof migrated.achievements.claimed === 'object', '迁移: achievements 补齐');
assert(typeof migrated.bossesKilled === 'number' && migrated.bossesKilled === 0, '迁移: bossesKilled=0');
assert(migrated.coin === 500 && migrated.beds[0].level === 10 && migrated.wave === 12, '迁移: 原数据完整保留');
assert(migrated.daily.date === core.dateStr(Date.now()), '迁移: daily 日期为今天');
// 迁移后 tick 正常
const evMig = core.tick(migrated, 10);
assert(typeof evMig.length === 'number', '迁移后 tick 正常运行');

// ============ 汇总 ============
section('测试汇总');
console.log(`通过 ${pass} / ${pass + fail}  ${fail === 0 ? '✅ 全部通过' : '❌ 有 ' + fail + ' 个失败'}`);
process.exit(fail === 0 ? 0 : 1);
