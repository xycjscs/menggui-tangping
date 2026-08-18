/**
 * 猛鬼宿舍·躺平发育 —— 核心逻辑（纯JS，无wx依赖，Node可直接测试）
 *
 * 玩法（放置版猛鬼宿舍）：
 * - 宿舍 6 张床，每张床是一个"躺平者"，自动生产金币 + 经验
 * - 经验升级获得"灵魂"，灵魂用于升级灵魂祭坛（全局产量 +25%/级）
 * - 金币升级：床（产量）、大门（血量+反击）、炮塔（自动攻击）
 * - 猛鬼按波次来袭：每波 N 只鬼，攻击大门；炮塔+门反击自动消灭鬼
 * - 门耐久被打空 => 鬼抓走全部躺平者（失败）：灵魂留30%、床等级减半、门/炮塔重置
 * - 离线收益：最多累积 8 小时，可看广告翻倍
 *
 * 时间设计（重要）：
 * - s.time = 游戏虚拟时钟（秒），随 tick 推进，波次排期全部基于它
 * - 真实墙钟（Date.now）只用于：广告冷却、存档时间戳
 * 这样战斗在任意速度下都是确定且可测试的。
 */

// ================= 常量 =================
const MAX_BEDS = 6;
const OFFLINE_CAP_SEC = 8 * 3600;        // 离线收益上限 8 小时
const WAVE_BASE_GAP = 120;               // 波次间隔（秒，随波次缩短）
const WAVE_MAX_GAP = 60;                 // 间隔下限
const FIRST_WAVE_AT = 60;                // 开局 60 秒新手保护
const DEFENSE_RESPECT_SEC = 45;          // 失败后喘息时间
const DOOR_REGEN_PCT = 0.02;             // 门每秒回血 2% 上限

// 建筑/设施定义
const BUILDINGS = {
  bed: {
    name: '床',
    desc: '躺平者睡在上面自动产出金币和经验',
    coinPerLevel: 0.5,
    coinMult: 1.55,
    expPerLevel: 0.1,
    expMult: 1.55,
    baseCost: 10,
    costGrowth: 1.35,
    maxLevel: 300
  },
  door: {
    name: '大门',
    desc: '抵挡猛鬼攻击，等级越高血量越高、反击越强',
    hpBase: 100,
    hpPerLevel: 80,
    hpGrowth: 1.18,
    counterPerLevel: 4,   // 每秒反击伤害 / 每级
    baseCost: 28,
    costGrowth: 1.4,
    maxLevel: 300
  },
  turret: {
    name: '炮塔',
    desc: '自动攻击来袭的猛鬼',
    dmgPerLevel: 6,
    dmgGrowth: 1.3,
    attackSpeed: 1,        // 每秒攻击次数
    baseCost: 30,
    costGrowth: 1.4,
    maxLevel: 300
  },
  altar: {
    name: '灵魂祭坛',
    desc: '献祭灵魂，全局产量永久 +25%',
    baseCost: 50,          // 灵魂
    costGrowth: 1.6,
    maxLevel: 300,
    bonusPerLevel: 0.25
  }
};

// 解锁床费用：20 * 4^i
function unlockBedCost(s, i) {
  return Math.floor(20 * Math.pow(4, i));
}

// ================= 猛鬼波次（曲线集中在 CURVE，方便调参）=================
// 设计目标：玩家持续投入下，每波 15~90 秒清完；3 天可打到 100+ 波。
// 关键约束（保证后期不卡死）：
//   炮塔 DPS 增长(1.35) > 鬼血量增长(1.22) > 鬼数量(线性) => 清波永远可行
//   门血量增长(1.12) > 鬼伤害增长(1.05) => 门升级领先则永远扛得住
//   床产量(1.55) > 炮塔成本(1.35) => 金币越来越买得起防御
const CURVE = {
  waveCount: n => Math.min(3 + n, 30),
  waveGhostHp: n => Math.floor(15 * Math.pow(1.22, n - 1)),
  waveGhostDmg: n => Math.floor(4 * Math.pow(1.05, n - 1)),
  doorMaxHp: s => Math.floor(100 + 80 * Math.pow(1.12, s.door.level - 1)),
  doorCounterDps: s => 4 * Math.pow(1.15, s.door.level - 1),
  turretDps: s => {
    if (s.turret.level <= 0) return 0;
    const t = BUILDINGS.turret;
    return t.dmgPerLevel * Math.pow(t.dmgGrowth, s.turret.level - 1) * t.attackSpeed;
  }
};
function waveCount(n) { return CURVE.waveCount(n); }
function waveGhostHp(n) { return CURVE.waveGhostHp(n); }
function waveGhostDmg(n) { return CURVE.waveGhostDmg(n); }
function waveGap(n) { return Math.min(240, 60 + 6 * n); }
function waveBonus(n) { return Math.floor(20 * Math.pow(1.5, Math.min(n - 1, 20))) + 10; }

// ================= 状态 =================
function newGame() {
  const s = {
    v: 1,
    created: Date.now(),
    lastSave: Date.now(),
    time: 0,                 // 虚拟时钟（秒）
    // 资源
    coin: 0,
    soul: 0,
    totalCoin: 0,
    totalExp: 0,
    level: 1,
    // 建筑
    beds: Array.from({ length: MAX_BEDS }, () => ({ level: 0, unlocked: false })),
    door: { level: 1, hp: BUILDINGS.door.hpBase + BUILDINGS.door.hpPerLevel },
    turret: { level: 0 },
    altar: { level: 0 },
    // 波次
    wave: 0,
    nextWaveAt: FIRST_WAVE_AT,
    ghosts: [],
    defeated: false,        // 门破待处理（看广告复活 / 接受失败）
    revivedThisDefeat: false, // 本次失败是否已复活（防无限刷广告）
    // 战斗统计
    ghostsKilled: 0,
    wavesCleared: 0,
    defeats: 0,
    // 广告
    adCooldown: {},          // 真实时间戳
    incomeBoostUntil: 0,     // 虚拟时间
    // 成就
    firstKill: false,
    clearedWave10: false
  };
  s.beds[0] = { level: 1, unlocked: true };
  return s;
}

function initNewGame(s) { return s; } // 保留以兼容旧调用

// ================= 等级 =================
function expForLevel(level) {
  return Math.floor(50 * Math.pow(1.6, level - 1));
}

function gainExp(s, amount) {
  if (amount <= 0) return s.soul;
  s.totalExp += amount;
  s.soul += amount * 0.1;
  let need = expForLevel(s.level);
  let guard = 0;
  while (s.totalExp >= need && guard++ < 200) {
    s.totalExp -= need;
    s.level += 1;
    s.soul += 5;
    need = expForLevel(s.level);
  }
  return s.soul;
}

// ================= 产量 =================
function altarMult(s) {
  return 1 + s.altar.level * BUILDINGS.altar.bonusPerLevel;
}
function incomeMult(s) {
  return s.time < (s.incomeBoostUntil || 0) ? 2 : 1;
}
function bedCoinPerSec(bed) {
  if (!bed || !bed.unlocked || bed.level <= 0) return 0;
  const b = BUILDINGS.bed;
  return b.coinPerLevel * Math.pow(b.coinMult, bed.level - 1);
}
function bedExpPerSec(bed) {
  if (!bed || !bed.unlocked || bed.level <= 0) return 0;
  const b = BUILDINGS.bed;
  return b.expPerLevel * Math.pow(b.expMult, bed.level - 1);
}
function coinPerSec(s) {
  return s.beds.reduce((a, b) => a + bedCoinPerSec(b), 0) * altarMult(s) * incomeMult(s);
}
function expPerSec(s) {
  return s.beds.reduce((a, b) => a + bedExpPerSec(b), 0) * altarMult(s) * incomeMult(s);
}

// ================= 费用 =================
function buildingCost(type, level) {
  const b = BUILDINGS[type];
  return Math.floor(b.baseCost * Math.pow(b.costGrowth, Math.max(0, level - 1)));
}
function bedCost(s, i) { return buildingCost('bed', s.beds[i].level); }
function doorCost(s) { return buildingCost('door', s.door.level); }
function turretCost(s) { return buildingCost('turret', s.turret.level); }
function altarCost(s) { return buildingCost('altar', s.altar.level); }

function formatCost(n) {
  return n >= 10000 ? (n / 10000).toFixed(1) + '万' : Math.floor(n).toString();
}

// ================= 防御 =================
function doorMaxHp(s) { return CURVE.doorMaxHp(s); }
function doorCounterDps(s) { return CURVE.doorCounterDps(s); }
function turretDps(s) { return CURVE.turretDps(s); }
function totalDefendDps(s) { return doorCounterDps(s) + turretDps(s); }

/**
 * 评估"下一波是否扛得住"：
 * 击杀时间 vs 门存活时间
 */
function nextWaveThreat(s) {
  const n = s.wave + 1;
  const cnt = waveCount(n);
  const hp = waveGhostHp(n);
  const dmg = waveGhostDmg(n);
  const totalHp = cnt * hp;
  const totalDps = cnt * dmg;
  const dps = Math.max(totalDefendDps(s), 0.001);
  const tKill = totalHp / dps;
  const doorHp = Math.max(s.door.hp, 1);
  const tDoor = doorHp / Math.max(totalDps, 0.001);
  return { n, cnt, totalHp, totalDps, tKill, tDoor, safe: tKill < tDoor * 0.8 };
}

// ================= 波次 =================
function spawnWave(s) {
  s.wave += 1;
  const n = waveCount(s.wave);
  const hp = waveGhostHp(s.wave);
  const dmg = waveGhostDmg(s.wave);
  s.ghosts = Array.from({ length: n }, (_, i) => ({ hp, maxHp: hp, dmg, id: i }));
  s.nextWaveAt = s.time + waveGap(s.wave);
}

// ================= 战斗 tick =================
/**
 * 推进游戏 deltaSec 秒（虚拟时间）。返回事件列表 [{type, ...}]
 * 子步长 1 秒，保证确定性。
 */
function tick(s, deltaSec) {
  const events = [];
  let t = 0;
  const dt = 1;
  // 失败待处理时冻结（不生产、不出波），等待玩家选择
  if (s.defeated) return events;
  while (t < deltaSec - 1e-9) {
    const step = Math.min(dt, deltaSec - t);
    t += step;
    s.time += step;

    // 1) 产量
    const c = coinPerSec(s) * step;
    const e = expPerSec(s) * step;
    s.coin += c;
    s.totalCoin += c;
    if (e > 0) gainExp(s, e);

    // 2) 门自然回血
    const maxHp = doorMaxHp(s);
    if (s.door.hp < maxHp) {
      s.door.hp = Math.min(maxHp, s.door.hp + maxHp * DOOR_REGEN_PCT * step);
    }

    // 3) 波次判定
    if (s.time >= s.nextWaveAt && s.ghosts.length === 0) {
      spawnWave(s);
      events.push({ type: 'wave_start', wave: s.wave, ghostCount: s.ghosts.length });
    }

    // 4) 战斗
    if (s.ghosts.length > 0) {
      // 按"实际战斗时长"结算门受击：鬼被打死时即停止攻击
      // killTime = 清光当前鬼所需时间；本秒内鬼死则门只吃等比伤害
      const totalGhostHp = s.ghosts.reduce((a, g) => a + g.hp, 0);
      const dps = totalDefendDps(s);
      const killTime = dps > 0 ? totalGhostHp / dps : Infinity;
      const effTime = Math.min(step, killTime);
      const dmgTaken = s.ghosts.reduce((a, g) => a + g.dmg, 0) * effTime;
      s.door.hp -= dmgTaken;

      let dmgDealt = dps * step;
      for (const g of s.ghosts) {
        if (dmgDealt <= 0) break;
        const deal = Math.min(g.hp, dmgDealt);
        g.hp -= deal;
        dmgDealt -= deal;
        if (g.hp <= 0) {
          const soulR = Math.floor(g.maxHp * 0.3) + 5;
          const coinR = Math.floor(g.maxHp * 0.2) + 3;
          s.soul += soulR;
          s.coin += coinR;
          s.totalCoin += coinR;
          s.ghostsKilled += 1;
          events.push({ type: 'ghost_killed', wave: s.wave });
          if (!s.firstKill) { s.firstKill = true; events.push({ type: 'first_kill' }); }
        }
      }
      s.ghosts = s.ghosts.filter(g => g.hp > 0);

      // 5) 门破 => 进入"待处理失败"状态（UI 弹选择：看广告复活 / 接受失败）
      if (s.door.hp <= 0) {
        s.door.hp = 0;
        s.defeated = true;
        s.revivedThisDefeat = false;
        s.ghosts = [];
        events.push({ type: 'defeat', wave: s.wave });
        break;
      }

      // 6) 清波奖励
      if (s.ghosts.length === 0) {
        s.wavesCleared += 1;
        const bonus = waveBonus(s.wave);
        s.soul += bonus;
        const cBonus = Math.floor(bonus * 1.5);
        s.coin += cBonus;
        s.totalCoin += cBonus;
        events.push({ type: 'wave_cleared', wave: s.wave, bonus });
        if (s.wave === 10 && !s.clearedWave10) {
          s.clearedWave10 = true;
          events.push({ type: 'cleared_10' });
        }
      }
    }
  }
  return events;
}

/**
 * 看广告复活：门回 50% 血，当波鬼被击退，保留波次进度
 * 每次失败只能复活 1 次（防无限刷广告），且需过复活冷却
 * UI 播完广告后调用
 */
function tryRevive(s) {
  if (!s.defeated) return { ok: false, msg: '未失败' };
  if (s.revivedThisDefeat) return { ok: false, msg: '本次已复活过，只能接受失败' };
  const now = Date.now();
  const cd = (s.adCooldown && s.adCooldown.revive) || 0;
  if (now < cd + AD_COOLDOWN.revive) return { ok: false, msg: '复活冷却中' };
  s.revivedThisDefeat = true;
  s.defeated = false;
  s.door.hp = Math.floor(doorMaxHp(s) * 0.5);
  s.ghosts = [];
  s.nextWaveAt = s.time + 30;
  return { ok: true };
}

/**
 * 接受失败：鬼抓走躺平者。保留灵魂30%、床等级减半；门/炮塔重置。
 */
function acceptDefeat(s) {
  if (!s.defeated) return { ok: false, msg: '未失败' };
  doDefeat(s);
  return { ok: true };
}

function doDefeat(s) {
  s.defeated = false;
  s.defeats += 1;
  s.soul = Math.floor(s.soul * 0.3);
  for (const b of s.beds) {
    if (b.unlocked) b.level = Math.max(1, Math.floor(b.level / 2));
  }
  s.door = { level: 1, hp: BUILDINGS.door.hpBase + BUILDINGS.door.hpPerLevel };
  s.turret = { level: 0 };
  s.ghosts = [];
  s.wave = 0;
  s.nextWaveAt = s.time + DEFENSE_RESPECT_SEC;
}

// ================= 操作 =================
function tryUpgradeBed(s, i) {
  const bed = s.beds[i];
  if (!bed || !bed.unlocked) return { ok: false, msg: '未解锁' };
  if (bed.level >= BUILDINGS.bed.maxLevel) return { ok: false, msg: '已满级' };
  const cost = bedCost(s, i);
  if (s.coin < cost) return { ok: false, msg: `金币不足 (${formatCost(cost)})` };
  s.coin -= cost;
  bed.level += 1;
  return { ok: true, cost, level: bed.level };
}

function tryUnlockBed(s, i) {
  const bed = s.beds[i];
  if (!bed || bed.unlocked) return { ok: false, msg: '已解锁/无效' };
  if (i > 0 && !s.beds[i - 1].unlocked) return { ok: false, msg: '请先解锁上一张床' };
  const cost = unlockBedCost(s, i);
  if (s.coin < cost) return { ok: false, msg: `金币不足 (${formatCost(cost)})` };
  s.coin -= cost;
  bed.unlocked = true;
  bed.level = 1;
  return { ok: true, cost, level: 1 };
}

function tryUpgradeDoor(s) {
  if (s.door.level >= BUILDINGS.door.maxLevel) return { ok: false, msg: '已满级' };
  const cost = doorCost(s);
  if (s.coin < cost) return { ok: false, msg: `金币不足 (${formatCost(cost)})` };
  s.coin -= cost;
  s.door.level += 1;
  s.door.hp = doorMaxHp(s);   // 升级回满
  return { ok: true, cost, level: s.door.level };
}

function tryUpgradeTurret(s) {
  if (s.turret.level >= BUILDINGS.turret.maxLevel) return { ok: false, msg: '已满级' };
  const cost = turretCost(s);
  if (s.coin < cost) return { ok: false, msg: `金币不足 (${formatCost(cost)})` };
  s.coin -= cost;
  s.turret.level += 1;
  return { ok: true, cost, level: s.turret.level };
}

function tryUpgradeAltar(s) {
  if (s.altar.level >= BUILDINGS.altar.maxLevel) return { ok: false, msg: '已满级' };
  const cost = altarCost(s);
  if (s.soul < cost) return { ok: false, msg: `灵魂不足 (${cost})` };
  s.soul -= cost;
  s.altar.level += 1;
  return { ok: true, cost, level: s.altar.level };
}

// ================= 离线收益 =================
function computeOffline(s, nowSec) {
  const last = s.lastSave / 1000;
  let sec = nowSec - last;
  const capped = sec > OFFLINE_CAP_SEC;
  sec = Math.min(sec, OFFLINE_CAP_SEC);
  if (sec < 30) return { coin: 0, exp: 0, seconds: sec, capped };
  const eff = 0.5;
  const coin = coinPerSec(s) * sec * eff;
  const exp = expPerSec(s) * sec * eff;
  return { coin, exp, seconds: sec, capped };
}

function applyOffline(s, nowSec, double) {
  const off = computeOffline(s, nowSec);
  const mult = double ? 2 : 1;
  s.coin += off.coin * mult;
  s.totalCoin += off.coin * mult;
  if (off.exp > 0) gainExp(s, off.exp * mult);
  s.lastSave = nowSec * 1000;
  s.nextWaveAt = s.time + 30;   // 回来后 30 秒才有鬼
  return { ...off, mult };
}

// ================= 广告 =================
const AD_COOLDOWN = {
  coin_bonus: 30 * 60 * 1000,
  income_boost: 2 * 3600 * 1000,
  wave_delay: 10 * 60 * 1000,
  door_fix: 0,
  offline_double: 0,
  revive: 60 * 1000
};

function applyAd(s, adKey) {
  switch (adKey) {
    case 'coin_bonus': {
      const bonus = Math.max(100, coinPerSec(s) * 300);
      s.coin += bonus;
      s.totalCoin += bonus;
      return { ok: true, bonus };
    }
    case 'income_boost': {
      s.incomeBoostUntil = s.time + 3600;
      return { ok: true, seconds: 3600 };
    }
    case 'wave_delay': {
      s.nextWaveAt = Math.max(s.nextWaveAt, s.time + 600);
      return { ok: true, seconds: 600 };
    }
    case 'door_fix': {
      s.door.hp = doorMaxHp(s);
      return { ok: true };
    }
    case 'revive': {
      return tryRevive(s);
    }
    case 'offline_double': {
      return { ok: true };
    }
  }
  return { ok: false };
}

function canUseAd(s, adKey) {
  const now = Date.now();
  const cd = (s.adCooldown && s.adCooldown[adKey]) || 0;
  if (now < cd + (AD_COOLDOWN[adKey] || 0)) {
    return { ok: false, remain: Math.ceil((cd + (AD_COOLDOWN[adKey] || 0) - now) / 1000) };
  }
  if (adKey === 'door_fix' && s.door.hp / doorMaxHp(s) >= 0.4) return { ok: false, msg: '大门健康' };
  if (adKey === 'revive' && !s.defeated) return { ok: false, msg: '未失败' };
  return { ok: true };
}

function markAdUsed(s, adKey) {
  if (!s.adCooldown) s.adCooldown = {};
  s.adCooldown[adKey] = Date.now();
}

// ================= 序列化 =================
function save(s) {
  s.lastSave = Date.now();
  return JSON.stringify(s);
}

function load(json) {
  try {
    const s = JSON.parse(json);
    if (!s || s.v !== 1) return null;
    if (!Array.isArray(s.beds) || s.beds.length !== MAX_BEDS) return null;
    if (!s.door || !s.turret) return null;
    s.time = s.time || 0;
    s.ghosts = [];               // 不在存档中保存战斗中间态
    s.adCooldown = s.adCooldown || {};
    if (!s.altar) s.altar = { level: 0 };
    return s;
  } catch (e) {
    return null;
  }
}

// ================= 导出 =================
module.exports = {
  MAX_BEDS, OFFLINE_CAP_SEC, BUILDINGS, FIRST_WAVE_AT, CURVE,
  waveCount, waveGhostHp, waveGhostDmg, waveGap, waveBonus,
  newGame, initNewGame,
  expForLevel, gainExp,
  altarMult, incomeMult, bedCoinPerSec, bedExpPerSec, coinPerSec, expPerSec,
  buildingCost, bedCost, doorCost, turretCost, altarCost, unlockBedCost, formatCost,
  doorMaxHp, doorCounterDps, turretDps, totalDefendDps, nextWaveThreat,
  spawnWave, tick, doDefeat, tryRevive, acceptDefeat,
  tryUpgradeBed, tryUnlockBed, tryUpgradeDoor, tryUpgradeTurret, tryUpgradeAltar,
  computeOffline, applyOffline,
  applyAd, canUseAd, markAdUsed, AD_COOLDOWN,
  save, load
};
