/**
 * 数值调参：对比不同难度/成长曲线下的 3 天模拟节奏
 * 运行: node tests/tune.js
 */
const path = require('path');
const core = require(path.join(__dirname, '..', 'js', 'core', 'gameCore'));
const { formatNum } = require(path.join(__dirname, '..', 'js', 'core', 'number'));

function botTick(s, dt = 1) {
  // 修复大门（模拟广告）
  if (s.door.hp / core.doorMaxHp(s) < 0.35 && core.canUseAd(s, 'door_fix').ok) {
    core.applyAd(s, 'door_fix');
    core.markAdUsed(s, 'door_fix');
  }
  const threat = core.nextWaveThreat(s);
  let nextBed = -1;
  for (let i = 1; i < core.MAX_BEDS; i++) if (!s.beds[i].unlocked) { nextBed = i; break; }

  if (!threat.safe && s.ghosts.length === 0) {
    // 堆 DPS
    const tCost = core.turretCost(s);
    const dCost = core.doorCost(s);
    const tGain = core.turretDps(s) + (s.turret.level === 0 ? core.BUILDINGS.turret.dmgPerLevel : core.turretDps(s) * 0.3);
    const dGain = core.doorCounterDps(s) + core.BUILDINGS.door.counterPerLevel;
    const tEff = tGain / tCost, dEff = dGain / dCost;
    if (s.coin >= tCost && tEff >= dEff * 0.6) core.tryUpgradeTurret(s);
    else if (s.coin >= dCost) core.tryUpgradeDoor(s);
    else if (s.coin >= tCost) core.tryUpgradeTurret(s);
  } else if (nextBed >= 0 && s.coin >= core.unlockBedCost(s, nextBed)) {
    core.tryUnlockBed(s, nextBed);
  } else {
    // 祭坛 + 升床
    if (s.soul >= core.altarCost(s) && s.altar.level < 100) core.tryUpgradeAltar(s);
    let bi = -1, bl = -1;
    for (let i = 0; i < core.MAX_BEDS; i++) {
      const b = s.beds[i];
      if (b.unlocked && b.level > bl) { bl = b.level; bi = i; }
    }
    if (bi >= 0) core.tryUpgradeBed(s, bi);
    if (s.coin >= core.doorCost(s)) core.tryUpgradeDoor(s);
  }
  return core.tick(s, dt);
}

function runSim(name, curve) {
  const C = core.CURVE;
  const orig = { ...C };
  Object.assign(C, curve);
  try {
    const sim = core.newGame();
    const TOTAL = 3 * 86400;
    let maxWave = 0, clearDurations = [], waveStart = 0;
    const defeatLog = [];
    for (let t = 0; t < TOTAL; t++) {
      const ev = botTick(sim, 1);
      for (const e of ev) {
        if (e.type === 'wave_start') { maxWave = Math.max(maxWave, e.wave); waveStart = t; }
        if (e.type === 'wave_cleared') clearDurations.push(t - waveStart);
        if (e.type === 'defeat') defeatLog.push('w' + e.wave + '@' + (t / 3600).toFixed(1) + 'h');
      }
    }
    const q = clearDurations.slice().sort((a, b) => a - b);
    const med = q.length ? q[Math.floor(q.length / 2)] : 0;
    const p90 = q.length ? q[Math.floor(q.length * 0.9)] : 0;
    const max = q.length ? q[q.length - 1] : 0;
    console.log(`\n[${name}]`);
    console.log(`  最高波次 ${maxWave} (已清 ${sim.wavesCleared}) | 失败 ${sim.defeats} ${defeatLog.slice(0, 5).join(',')}`);
    console.log(`  清波耗时 中位${med}s / P90 ${p90}s / 最长 ${max}s`);
    console.log(`  床[${sim.beds.map(b => b.unlocked ? b.level : '-').join(' ')}] 门${sim.door.level} 炮${sim.turret.level} 坛${sim.altar.level} lv${sim.level}`);
    console.log(`  cps=${formatNum(core.coinPerSec(sim))} total=${formatNum(sim.totalCoin)} soul=${formatNum(Math.floor(sim.soul))}`);
  } finally {
    Object.assign(C, orig);
  }
}

runSim('A baseline(默认: 鬼hp1.4^n, dmg1.22^n, 门反击线性4/级)', {});
runSim('B gentle(鬼hp1.32^n, dmg1.18^n, 门反击/血量 1.12^n)', {
  waveGhostHp: n => Math.floor(15 * Math.pow(1.32, n - 1)),
  waveGhostDmg: n => Math.floor(4 * Math.pow(1.18, n - 1)),
  doorMaxHp: s => Math.floor(100 + 80 * Math.pow(1.12, s.door.level - 1)),
  doorCounterDps: s => Math.floor(4 * Math.pow(1.12, s.door.level - 1))
});
runSim('C relaxed(鬼数少, hp1.28^n, dmg1.15^n, 门1.1^n)', {
  waveCount: n => Math.min(3 + Math.floor(n * 0.8), 25),
  waveGhostHp: n => Math.floor(12 * Math.pow(1.28, n - 1)),
  waveGhostDmg: n => Math.floor(4 * Math.pow(1.15, n - 1)),
  doorMaxHp: s => Math.floor(100 + 80 * Math.pow(1.1, s.door.level - 1)),
  doorCounterDps: s => Math.floor(4 * Math.pow(1.1, s.door.level - 1))
});
