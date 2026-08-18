/**
 * 猛鬼宿舍·躺平发育 —— 核心逻辑（纯JS，无wx依赖，Node可直接测试）
 * v0.2 新增：英雄系统 / Boss 波（每10波）/ 每日任务 / 成就 / 新广告位
 *
 * 玩法（放置版猛鬼宿舍）：
 * - 宿舍 6 张床，每张床是一个"躺平者"，自动生产金币 + 经验
 * - 经验升级获得"灵魂"，灵魂用于：升级灵魂祭坛（全局产量 +25%/级）、招募英雄
 * - 金币升级：床（产量）、大门（血量+反击）、炮塔（自动攻击）、英雄（强化）
 * - 英雄：圣骑士(+DPS) / 暗影猎手(鬼伤害降低) / 战斗法师(+DPS) / 治愈祭司(门回血)
 * - 猛鬼按波次来袭：每波 N 只鬼；每 10 波出现 BOSS（血量x10，伤害x2.5）
 * - 门耐久被打空 => 鬼抓走全部躺平者（失败）：灵魂留30%、床等级减半、门/炮塔重置
 * - 离线收益：最多累积 8 小时，可看广告翻倍
 *
 * 时间设计（重要）：
 * - s.time = 游戏虚拟时钟（秒），随 tick 推进，波次排期全部基于它
 * - 真实墙钟（Date.now）只用于：广告冷却、每日任务日期、存档时间戳
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
const BOSS_EVERY = 10;                   // 每 N 波出现 Boss
const BOSS_HP_MULT = 10;                 // Boss 血量倍率
const BOSS_DMG_MULT = 2.5;               // Boss 伤害倍率
const BOSS_QUIET_RATIO = 0.5;            // Boss 波常规鬼数量比例
const HERO_DEAL_PCT = 0.7;               // 英雄折扣广告：7折

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

// ================= 英雄定义 =================
// type: dps(增加防御DPS) / slow(降低鬼对门的伤害，上限50%) / heal(门额外回血%/s)
const HEROES = [
  {
    id: 'knight', name: '圣骑士', icon: '/images/icons/sword_gold.png',
    type: 'dps', base: 4, growth: 1.25,
    unlockSoul: 150, upBase: 60, upGrowth: 1.4, maxLevel: 100,
    desc: '圣剑普攻，提升防御DPS'
  },
  {
    id: 'archer', name: '暗影猎手', icon: '/images/icons/sword_green.png',
    type: 'slow', base: 0.08, growth: 0.02,
    unlockSoul: 400, upBase: 80, upGrowth: 1.4, maxLevel: 100,
    desc: '诅咒箭矢，降低猛鬼伤害(上限50%)'
  },
  {
    id: 'mage', name: '战斗法师', icon: '/images/icons/sword_purple.png',
    type: 'dps', base: 12, growth: 1.18,
    unlockSoul: 1000, upBase: 150, upGrowth: 1.45, maxLevel: 100,
    desc: '火球齐射，大幅提升防御DPS'
  },
  {
    id: 'priest', name: '治愈祭司', icon: '/images/icons/sword_orange.png',
    type: 'heal', base: 0.005, growth: 1.2,
    unlockSoul: 2500, upBase: 200, upGrowth: 1.5, maxLevel: 100,
    desc: '圣光守护，大门持续回血'
  }
];

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
// v0.2 终局软上限：鬼血量 1~100 波按 1.22^n 增长（前期张力），
//   100 波后放缓到 1.01^n。原因：门反击(1.15^n)在300级封顶后，
//   无上限的 1.22^n 会让 ~240 波起单波耗时 9 小时（实测卡点）。
//   软上限后终局 = 继续堆门/炮塔的长尾，单波数秒~数分钟。
//   长期无限成长留给 v0.3 转生(Prestige)系统。
const GHOST_HP_SOFTCAP_AT = 100;  // 从第 N 波开始软上限
const GHOST_HP_SOFTCAP_BASE = 99; // 软上限基准指数（1.22^99）
const GHOST_HP_SOFTCAP_GROWTH = 1.01; // 软上限后每波增长
const CURVE = {
  waveCount: n => Math.min(3 + n, 30),
  waveGhostHp: n => {
    const k = n - 1;
    if (k <= GHOST_HP_SOFTCAP_BASE) return Math.floor(15 * Math.pow(1.22, k));
    return Math.floor(15 * Math.pow(1.22, GHOST_HP_SOFTCAP_BASE) * Math.pow(GHOST_HP_SOFTCAP_GROWTH, k - GHOST_HP_SOFTCAP_BASE));
  },
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
function isBossWave(n) { return n > 0 && n % BOSS_EVERY === 0; }

// ================= 日期工具 =================
function dateStr(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

// ================= 每日任务 =================
function defaultDaily() {
  return {
    date: '',
    lastBonusDate: '',   // 每日广告福利已领取的日期
    quests: [
      { id: 'kill', name: '击退猛鬼', need: 100, progress: 0, claimed: false, reward: 200 },
      { id: 'upgrade', name: '升级设施', need: 10, progress: 0, claimed: false, reward: 150 },
      { id: 'coin', name: '赚取金币', need: 5000, progress: 0, claimed: false, reward: 300 }
    ]
  };
}

/** 跨天重置（在 tick 和 load 时调用） */
function dailyRollover(s) {
  const today = dateStr(Date.now());
  if (!s.daily || s.daily.date !== today) {
    const nd = defaultDaily();
    nd.date = today;
    s.daily = nd;
  }
}

function questProgress(s, id, delta) {
  if (!s.daily) return;
  const q = s.daily.quests.find(x => x.id === id);
  if (!q || q.claimed) return;
  q.progress = Math.min(q.need, q.progress + delta);
}

function claimQuest(s, i) {
  const q = s.daily && s.daily.quests[i];
  if (!q) return { ok: false, msg: '无效任务' };
  if (q.claimed) return { ok: false, msg: '已领取' };
  if (q.progress < q.need) return { ok: false, msg: '任务未完成' };
  q.claimed = true;
  s.soul += q.reward;
  return { ok: true, reward: q.reward, id: q.id };
}

// ================= 成就 =================
const ACHIEVEMENTS = [
  { id: 'first_kill', name: '初尝胜利', desc: '首次击杀猛鬼', reward: 50, check: s => s.firstKill },
  { id: 'wave10', name: '小有名气', desc: '累计清除 10 波猛鬼', reward: 100, check: s => s.wavesCleared >= 10 },
  { id: 'wave50', name: '宿舍守护者', desc: '累计清除 50 波猛鬼', reward: 500, check: s => s.wavesCleared >= 50 },
  { id: 'wave100', name: '传说英雄', desc: '累计清除 100 波猛鬼', reward: 2000, check: s => s.wavesCleared >= 100 },
  { id: 'level10', name: '升级达人', desc: '角色达到 10 级', reward: 100, check: s => s.level >= 10 },
  { id: 'level30', name: '躺平大师', desc: '角色达到 30 级', reward: 500, check: s => s.level >= 30 },
  { id: 'coin50k', name: '小金库', desc: '累计赚取 5 万金币', reward: 300, check: s => s.totalCoin >= 50000 },
  { id: 'coin1m', name: '富甲一方', desc: '累计赚取 100 万金币', reward: 2000, check: s => s.totalCoin >= 1000000 },
  { id: 'defeat1', name: '劫后余生', desc: '经历过 1 次宿舍沦陷', reward: 100, check: s => s.defeats >= 1 },
  { id: 'heroes4', name: '英雄满编', desc: '解锁全部 4 位英雄', reward: 1000, check: s => s.heroes && s.heroes.every(h => h.unlocked) }
];

function listAchievements(s) {
  return ACHIEVEMENTS.map(a => ({
    id: a.id, name: a.name, desc: a.desc, reward: a.reward,
    unlocked: a.check(s),
    claimed: !!(s.achievements && s.achievements.claimed[a.id])
  }));
}

function claimAchievement(s, id) {
  const a = ACHIEVEMENTS.find(x => x.id === id);
  if (!a) return { ok: false, msg: '无效成就' };
  if (s.achievements.claimed[id]) return { ok: false, msg: '已领取' };
  if (!a.check(s)) return { ok: false, msg: '尚未达成' };
  s.achievements.claimed[id] = true;
  s.soul += a.reward;
  return { ok: true, reward: a.reward };
}

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
    // v0.2 英雄
    heroes: HEROES.map(() => ({ unlocked: false, level: 0 })),
    heroDeal: false,         // 英雄折扣广告标记（下次招募/升级 7 折）
    // v0.2 任务/成就
    daily: defaultDaily(),
    achievements: { claimed: {} },
    // 波次
    wave: 0,
    nextWaveAt: FIRST_WAVE_AT,
    ghosts: [],
    defeated: false,        // 门破待处理（看广告复活 / 接受失败）
    revivedThisDefeat: false, // 本次失败是否已复活（防无限刷广告）
    // 战斗统计
    ghostsKilled: 0,
    bossesKilled: 0,
    wavesCleared: 0,
    defeats: 0,
    // 广告
    adCooldown: {},          // 真实时间戳
    incomeBoostUntil: 0,     // 虚拟时间
    // 成就标记
    firstKill: false,
    clearedWave10: false
  };
  s.beds[0] = { level: 1, unlocked: true };
  s.daily = defaultDaily();
  s.daily.date = dateStr(Date.now());
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

// ================= 英雄 =================
function heroState(s, i) { return s.heroes[i]; }
function heroDpsOf(s, i) {
  const h = HEROES[i]; const st = s.heroes[i];
  if (!h || !st || !st.unlocked || h.type !== 'dps') return 0;
  return h.base * Math.pow(h.growth, st.level - 1);
}
function heroSlowOf(s, i) {
  const h = HEROES[i]; const st = s.heroes[i];
  if (!h || !st || !st.unlocked || h.type !== 'slow') return 0;
  return Math.min(0.5, h.base + h.growth * (st.level - 1));
}
function heroHealOf(s, i) {
  const h = HEROES[i]; const st = s.heroes[i];
  if (!h || !st || !st.unlocked || h.type !== 'heal') return 0;
  return h.base * Math.pow(h.growth, st.level - 1);
}
function heroDpsTotal(s) {
  return HEROES.reduce((a, h, i) => a + heroDpsOf(s, i), 0);
}
function heroSlowTotal(s) {
  return Math.min(0.5, HEROES.reduce((a, h, i) => a + heroSlowOf(s, i), 0));
}
function heroHealTotal(s) {
  return HEROES.reduce((a, h, i) => a + heroHealOf(s, i), 0);
}
function heroUpgradeCost(s, i) {
  const h = HEROES[i];
  const lv = s.heroes[i].level; // lv=1 时返回升到 2 级的费用
  return Math.floor(h.upBase * Math.pow(h.upGrowth, lv));
}
function tryBuyHero(s, i) {
  const h = HEROES[i];
  const st = s.heroes[i];
  if (!h || !st) return { ok: false, msg: '无效英雄' };
  if (st.unlocked) return { ok: false, msg: '已拥有' };
  let cost = h.unlockSoul;
  if (s.heroDeal) cost = Math.floor(cost * HERO_DEAL_PCT);
  if (s.soul < cost) return { ok: false, msg: '灵魂不足 (' + cost + ')' };
  s.soul -= cost;
  st.unlocked = true;
  st.level = 1;
  if (s.heroDeal) s.heroDeal = false;
  questProgress(s, 'upgrade', 1);
  return { ok: true, cost };
}
function tryUpgradeHero(s, i) {
  const h = HEROES[i];
  const st = s.heroes[i];
  if (!h || !st) return { ok: false, msg: '无效英雄' };
  if (!st.unlocked) return { ok: false, msg: '未招募' };
  if (st.level >= h.maxLevel) return { ok: false, msg: '已满级' };
  let cost = heroUpgradeCost(s, i);
  if (s.heroDeal) cost = Math.floor(cost * HERO_DEAL_PCT);
  if (s.coin < cost) return { ok: false, msg: '金币不足 (' + formatCost(cost) + ')' };
  s.coin -= cost;
  st.level += 1;
  if (s.heroDeal) s.heroDeal = false;
  questProgress(s, 'upgrade', 1);
  return { ok: true, cost, level: st.level };
}

// ================= 防御 =================
function doorMaxHp(s) { return CURVE.doorMaxHp(s); }
function doorCounterDps(s) { return CURVE.doorCounterDps(s); }
function turretDps(s) { return CURVE.turretDps(s); }
function totalDefendDps(s) { return doorCounterDps(s) + turretDps(s) + heroDpsTotal(s); }

/**
 * 评估"下一波是否扛得住"：
 * 击杀时间 vs 门存活时间（含 Boss 波）
 */
function nextWaveThreat(s) {
  const n = s.wave + 1;
  const cnt = waveCount(n);
  const hp = waveGhostHp(n);
  const dmg = waveGhostDmg(n);
  let totalHp = cnt * hp;
  let totalDps = cnt * dmg;
  if (isBossWave(n)) {
    totalHp += hp * BOSS_HP_MULT;
    totalDps += dmg * BOSS_DMG_MULT;
  }
  const dps = Math.max(totalDefendDps(s), 0.001);
  const tKill = totalHp / dps;
  const doorHp = Math.max(s.door.hp, 1);
  const tDoor = doorHp / Math.max(totalDps, 0.001);
  return { n, cnt, totalHp, totalDps, tKill, tDoor, safe: tKill < tDoor * 0.8, boss: isBossWave(n) };
}

// ================= 波次 =================
function spawnWave(s) {
  s.wave += 1;
  const n = waveCount(s.wave);
  const hp = waveGhostHp(s.wave);
  const dmg = waveGhostDmg(s.wave);
  if (isBossWave(s.wave)) {
    // Boss 波：1 只 Boss + 减半的常规鬼
    const bossHp = Math.floor(hp * BOSS_HP_MULT);
    const bossDmg = Math.floor(dmg * BOSS_DMG_MULT);
    s.ghosts = [{ hp: bossHp, maxHp: bossHp, dmg: bossDmg, id: 0, boss: true }];
    const regular = Math.max(4, Math.floor(n * BOSS_QUIET_RATIO));
    for (let i = 0; i < regular; i++) {
      s.ghosts.push({ hp, maxHp: hp, dmg, id: i + 1 });
    }
  } else {
    s.ghosts = Array.from({ length: n }, (_, i) => ({ hp, maxHp: hp, dmg, id: i }));
  }
  s.nextWaveAt = s.time + waveGap(s.wave);
}

// ================= 战斗 tick =================
/**
 * 推进游戏 deltaSec 秒（虚拟时间）。返回事件列表 [{type, ...}]
 * 子步长 1 秒，保证确定性。
 */
function tick(s, deltaSec) {
  const events = [];
  dailyRollover(s);
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
    questProgress(s, 'coin', c);
    if (e > 0) gainExp(s, e);

    // 2) 门回血（自然 + 祭司）
    const maxHp = doorMaxHp(s);
    if (s.door.hp < maxHp) {
      const regenPct = DOOR_REGEN_PCT + heroHealTotal(s);
      s.door.hp = Math.min(maxHp, s.door.hp + maxHp * regenPct * step);
    }

    // 3) 波次判定
    if (s.time >= s.nextWaveAt && s.ghosts.length === 0) {
      spawnWave(s);
      events.push({
        type: 'wave_start', wave: s.wave,
        ghostCount: s.ghosts.length,
        boss: s.ghosts.some(g => g.boss)
      });
    }

    // 4) 战斗
    if (s.ghosts.length > 0) {
      // 按"实际战斗时长"结算门受击：鬼被打死时即停止攻击
      // killTime = 清光当前鬼所需时间；本秒内鬼死则门只吃等比伤害
      // 暗影猎手：鬼伤害降低
      const slow = heroSlowTotal(s);
      const totalGhostHp = s.ghosts.reduce((a, g) => a + g.hp, 0);
      const dps = totalDefendDps(s);
      const killTime = dps > 0 ? totalGhostHp / dps : Infinity;
      const effTime = Math.min(step, killTime);
      const dmgTaken = s.ghosts.reduce((a, g) => a + g.dmg, 0) * (1 - slow) * effTime;
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
          questProgress(s, 'kill', 1);
          events.push({ type: 'ghost_killed', wave: s.wave, boss: !!g.boss });
          if (!s.firstKill) { s.firstKill = true; events.push({ type: 'first_kill' }); }
          if (g.boss) {
            s.bossesKilled += 1;
            events.push({ type: 'boss_killed', wave: s.wave });
          }
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
        const isBoss = isBossWave(s.wave);
        const soulBonus = isBoss ? Math.floor(bonus * 5) : bonus;
        s.soul += soulBonus;
        const cBonus = Math.floor(soulBonus * 1.5);
        s.coin += cBonus;
        s.totalCoin += cBonus;
        events.push({ type: 'wave_cleared', wave: s.wave, bonus: soulBonus, boss: isBoss });
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
  questProgress(s, 'upgrade', 1);
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
  questProgress(s, 'upgrade', 1);
  return { ok: true, cost, level: s.door.level };
}

function tryUpgradeTurret(s) {
  if (s.turret.level >= BUILDINGS.turret.maxLevel) return { ok: false, msg: '已满级' };
  const cost = turretCost(s);
  if (s.coin < cost) return { ok: false, msg: `金币不足 (${formatCost(cost)})` };
  s.coin -= cost;
  s.turret.level += 1;
  questProgress(s, 'upgrade', 1);
  return { ok: true, cost, level: s.turret.level };
}

function tryUpgradeAltar(s) {
  if (s.altar.level >= BUILDINGS.altar.maxLevel) return { ok: false, msg: '已满级' };
  const cost = altarCost(s);
  if (s.soul < cost) return { ok: false, msg: `灵魂不足 (${cost})` };
  s.soul -= cost;
  s.altar.level += 1;
  questProgress(s, 'upgrade', 1);
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
  revive: 60 * 1000,
  // v0.2 新增
  daily_bonus: 0,        // 按天限制（canUseAd 中判断）
  hero_deal: 10 * 60 * 1000,
  task_reward: 0         // 按任务领取限制（claimQuest 中判断）
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
    // v0.2 新增
    case 'daily_bonus': {
      const today = dateStr(Date.now());
      if (s.daily.lastBonusDate === today) return { ok: false, msg: '今日已领取' };
      s.daily.lastBonusDate = today;
      const bonus = Math.max(500, Math.floor(coinPerSec(s) * 600));
      s.coin += bonus;
      s.totalCoin += bonus;
      s.soul += 100;
      return { ok: true, bonus, soul: 100 };
    }
    case 'hero_deal': {
      s.heroDeal = true;
      return { ok: true };
    }
    case 'task_reward': {
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
  if (adKey === 'daily_bonus' && s.daily.lastBonusDate === dateStr(now)) return { ok: false, msg: '今日已领' };
  if (adKey === 'hero_deal' && s.heroDeal) return { ok: false, msg: '折扣已持有' };
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
    // v0.2 存档迁移（v0.1 存档兼容）
    if (!s.heroes || s.heroes.length !== HEROES.length) {
      s.heroes = HEROES.map(() => ({ unlocked: false, level: 0 }));
    }
    if (typeof s.heroDeal !== 'boolean') s.heroDeal = false;
    if (!s.daily || !s.daily.quests) s.daily = defaultDaily();
    if (!s.achievements) s.achievements = { claimed: {} };
    if (typeof s.bossesKilled !== 'number') s.bossesKilled = 0;
    dailyRollover(s);
    return s;
  } catch (e) {
    return null;
  }
}

// ================= 导出 =================
module.exports = {
  MAX_BEDS, OFFLINE_CAP_SEC, BUILDINGS, FIRST_WAVE_AT, CURVE,
  HEROES, ACHIEVEMENTS, BOSS_EVERY, BOSS_HP_MULT, BOSS_DMG_MULT, HERO_DEAL_PCT,
  waveCount, waveGhostHp, waveGhostDmg, waveGap, waveBonus, isBossWave,
  newGame, initNewGame,
  expForLevel, gainExp,
  altarMult, incomeMult, bedCoinPerSec, bedExpPerSec, coinPerSec, expPerSec,
  buildingCost, bedCost, doorCost, turretCost, altarCost, unlockBedCost, formatCost,
  // 英雄
  heroState, heroDpsOf, heroSlowOf, heroHealOf,
  heroDpsTotal, heroSlowTotal, heroHealTotal,
  heroUpgradeCost, tryBuyHero, tryUpgradeHero,
  doorMaxHp, doorCounterDps, turretDps, totalDefendDps, nextWaveThreat,
  // 任务/成就
  dateStr, defaultDaily, dailyRollover, questProgress, claimQuest,
  listAchievements, claimAchievement,
  spawnWave, tick, doDefeat, tryRevive, acceptDefeat,
  tryUpgradeBed, tryUnlockBed, tryUpgradeDoor, tryUpgradeTurret, tryUpgradeAltar,
  computeOffline, applyOffline,
  applyAd, canUseAd, markAdUsed, AD_COOLDOWN,
  save, load
};
