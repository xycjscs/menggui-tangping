/**
 * 猛鬼宿舍·躺平发育 —— 2D 战场渲染层 v0.3
 *
 * 环境无关：浏览器 canvas 2d / 小程序 canvas type="2d" 通用（只依赖标准 2d API）。
 * 纯展示层：只读 core 状态，绝不修改游戏数值。
 * Web 与小程序共用同一份，零分叉。
 *
 * 布局（俯视战棋风，设计空间 750x430，等比适配任意尺寸）：
 *   左 33%  宿舍：6 张床(2x3) + 灵魂祭坛 + 英雄列（门前防线）
 *   中      砖墙大门 + 炮塔（追踪开火）
 *   右 55%  走廊：猛鬼从右侧阴影入场 → 列阵推进到门前 → 原地突刺攻击
 *
 * 战斗视觉与 core 的对账方式：
 *   - core 每秒 tick 一次，按 id 顺序把 DPS 打到 s.ghosts 并逐只结算死亡
 *   - 本层每帧 frame(snap, dt)：按 key=wave*100+id 对账
 *       新增 id → 生成入场幽灵（右侧屏外，错峰走出）
 *       hp 下降 → 受击闪白 + 伤害飘字
 *       id 消失 → 死亡动画（爆裂粒子 + 灵魂/金币飘出）
 *       门 hp 下降 → 震屏 + 门闪红（幅度与实际掉血成正比）
 *   所以画面"看起来打得热闹"，但胜负/血量/奖励 100% 由 core 决定。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BattleView = factory();
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function fmtNum(n) {
    n = Math.floor(n);
    return Math.abs(n) >= 10000 ? (n / 10000).toFixed(1) + '万' : '' + n;
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.ceil(sec));
    if (sec >= 3600) return Math.floor(sec / 3600) + '小时' + Math.floor(sec % 3600 / 60) + '分';
    if (sec >= 60) return Math.floor(sec / 60) + '分' + String(sec % 60).padStart(2, '0') + '秒';
    return sec + '秒';
  }

  // ============ 视觉常量 ============
  var GHOST_ROWS = 5;             // 走廊阵型行数
  var GHOST_COLS = 6;             // 阵型列数（最多 30 只）
  var ENTER_SPEED = 100;          // 入场速度 px/s（设计空间 750 宽）
  var BOSS_ENTER_SPEED = 62;      // Boss 更慢、更压迫
  var DIE_DUR = 0.45;             // 死亡动画时长
  var LUNGE_DUR = 0.32;           // 突刺攻击时长
  var GHOST_TINTS = ['#cfc6e8', '#bfe3d6', '#e6d9c2'];  // 备用小怪的体色（无素材时）
  var HERO_STYLE = {
    knight: { color: '#ffd75e', char: '骑', interval: 1.2 },
    archer: { color: '#7dff9a', char: '猎', interval: 1.6 },
    mage:   { color: '#ff8a3d', char: '法', interval: 1.9 },
    priest: { color: '#7ce7ff', char: '祭', interval: 2.4 }
  };

  /**
   * 从 core 状态构建渲染快照（页面每帧调用）
   */
  function makeSnapshot(core, s) {
    return {
      wave: s.wave,
      ghosts: (s.ghosts || []).map(function (g) {
        return { id: g.id, boss: !!g.boss, hp: g.hp, maxHp: g.maxHp };
      }),
      doorHp: s.door.hp,
      doorMaxHp: core.doorMaxHp(s),
      doorLevel: s.door.level,
      turretLevel: s.turret.level,
      heroes: s.heroes.map(function (h, i) {
        return { id: core.HEROES[i].id, unlocked: h.unlocked, level: h.level, type: core.HEROES[i].type };
      }),
      beds: s.beds.map(function (b) { return { unlocked: b.unlocked, level: b.level }; }),
      altarLevel: s.altar.level,
      defeated: !!s.defeated,
      nextWaveIn: Math.max(0, s.nextWaveAt - s.time),
      nextIsBoss: core.isBossWave(s.wave + 1),
      threatDanger: !core.nextWaveThreat(s).safe && (s.ghosts || []).length === 0
    };
  }

  // ============ 主类 ============
  function BattleView(opts) {
    opts = opts || {};
    this.formatNum = opts.formatNum || fmtNum;
    this.W = 750; this.H = 430;
    // 纯视觉临时状态（不进存档）
    this.ghosts = new Map();      // key -> sprite
    this.projectiles = [];
    this.particles = [];
    this.floaters = [];
    this.shake = 0;               // 震屏强度
    this.redFlash = 0;            // 全屏红闪（门破/Boss死）
    this.doorFlash = 0;           // 门受击闪白
    this.t = 0;                   // 视觉时钟
    this.doorHpPrev = null;
    this.lastWave = -1;
    this.waveTotal = 0;           // 本波总数（阵型居中用，整波不变）
    this.banner = null;           // {text, sub, t, boss}
    this.turret = { angle: 0, fireT: 0, recoil: 0 };
    this.heroAnim = [];           // 每英雄 {fireT, t}
    this.bedAnim = [];            // 每床 {zzzT, sparkT}
    this.defeatedShown = false;
    this.snap = null;
    this._kills = 0;
    this._layout();
  }

  var P = BattleView.prototype;

  // ---------- 布局 ----------
  P.resize = function (w, h) { this.W = w || 750; this.H = h || 430; this._layout(); };

  P._layout = function () {
    var W = this.W, H = this.H;
    this.dormRight = W * 0.335;
    this.wallX = W * 0.365;
    this.wallW = Math.max(18, W * 0.03);
    this.corridorL = this.wallX + this.wallW / 2 + W * 0.015;
    this.corridorR = W - 8;
    this.hudH = Math.max(46, H * 0.115);
    this.floorTop = this.hudH;
    this.floorBot = H - 6;
    // 床区 2行x3列
    this.bedX0 = W * 0.035;
    this.bedY0 = this.hudH + H * 0.075;
    this.bedCellW = (this.dormRight - this.bedX0 - W * 0.04) / 3;
    this.bedCellH = (H * 0.40) / 2;
    // 英雄列
    this.heroX = W * 0.272;
    this.heroY0 = this.hudH + H * 0.10;
    this.heroGapY = (H - this.hudH - H * 0.16) / 4;
    // 祭坛
    this.altarPos = { x: W * 0.105, y: H * 0.885 };
    // 炮塔（墙内侧中部）
    this.turretPos = { x: this.wallX - this.wallW / 2 - W * 0.03, y: H * 0.52 };
    // 走廊阵型单元
    this.cellW = (this.corridorR - this.corridorL) / GHOST_COLS;
    this.cellH = (this.floorBot - this.floorTop) / GHOST_ROWS;
    this.doorTop = this.hudH + H * 0.045;
    this.doorBot = H - H * 0.045;
  };

  P.bedPos = function (i) {
    var row = i < 3 ? 0 : 1, col = i % 3;
    return { x: this.bedX0 + col * this.bedCellW + this.bedCellW * 0.06, y: this.bedY0 + row * this.bedCellH + this.bedCellH * 0.14 };
  };
  P.heroPos = function (i) {
    return { x: this.heroX, y: this.heroY0 + this.heroGapY * (i + 0.5) };
  };

  /** 阵型槽位：index i（入场顺序），total 本波总数（垂直居中） */
  P.ghostSlot = function (i, total) {
    var col = Math.floor(i / GHOST_ROWS), row = i % GHOST_ROWS;
    var rowsUsed = Math.min(GHOST_ROWS, Math.max(1, total));
    var offY = (GHOST_ROWS - rowsUsed) / 2 * this.cellH + this.cellH * 0.12;
    return {
      x: this.corridorL + this.cellW * (col + 0.42),
      y: this.floorTop + offY + this.cellH * (row + 0.5)
    };
  };

  P.makeSprite = function (g, i, total, key) {
    var slot = this.ghostSlot(i, total);
    var boss = !!g.boss;
    return {
      key: key, id: g.id, boss: boss,
      hp: g.hp, maxHp: g.maxHp,
      x: this.W + 40, y: slot.y + (Math.random() * 12 - 6),
      tx: slot.x, ty: slot.y,
      state: 'enter',
      delay: 0.3 + i * 0.28,
      speed: (boss ? BOSS_ENTER_SPEED : ENTER_SPEED) * (this.W / 750),
      phase: Math.random() * TAU,
      lungeT: 0.6 + Math.random(),
      lungeAnim: 0,
      lungeInterval: 1.9 + Math.random() * 0.9,
      flash: 0, hitCd: 0,
      dieT: 0
    };
  };

  // ---------- 每帧更新 ----------
  P.frame = function (snap, dt) {
    dt = clamp(dt || 0, 0, 0.1);
    if (!snap) return;
    this.t += dt;
    this.snap = snap;
    var self = this;

    var live = {};
    for (var i = 0; i < snap.ghosts.length; i++) {
      live[snap.wave * 100 + snap.ghosts[i].id] = snap.ghosts[i];
    }

    // --- 波次切换 ---
    if (snap.wave !== this.lastWave) {
      if (snap.wave > 0) {
        this.waveTotal = snap.ghosts.length;
        var isBoss = snap.ghosts.some(function (g) { return g.boss; });
        this.banner = { text: '第 ' + snap.wave + ' 波', sub: isBoss ? 'BOSS 来袭！' : snap.ghosts.length + ' 只猛鬼', t: 0, boss: isBoss };
        this.shake = Math.max(this.shake, isBoss ? 7 : 3);
      }
      this.lastWave = snap.wave;
      this.defeatedShown = false;
    }

    // --- 新幽灵入场 ---
    for (var i = 0; i < snap.ghosts.length; i++) {
      var g = snap.ghosts[i];
      var k = snap.wave * 100 + g.id;
      if (!this.ghosts.has(k)) {
        this.ghosts.set(k, this.makeSprite(g, i, Math.max(this.waveTotal, snap.ghosts.length), k));
      }
    }

    // --- hp 同步 / 受击检测 / 死亡触发 ---
    var keys = Array.from(this.ghosts.keys());
    for (var ki = 0; ki < keys.length; ki++) {
      var sp = this.ghosts.get(keys[ki]);
      var lg = live[sp.key];
      if (lg) {
        var prevHp = sp.hp;
        sp.hp = lg.hp; sp.maxHp = lg.maxHp;
        if (lg.hp < prevHp - 0.01) this._onGhostHit(sp, prevHp - lg.hp);
      } else if (sp.state !== 'dying' && sp.state !== 'breach') {
        sp.state = 'dying'; sp.dieT = 0;
        this._onGhostDeath(sp);
      }
    }

    // --- 失败：全员冲过门 ---
    if (snap.defeated && !this.defeatedShown) {
      this.defeatedShown = true;
      this.redFlash = 0.85;
      this.shake = 14;
      this.banner = { text: '大门被撞破！', sub: '宿舍沦陷…', t: 0, boss: true };
      var all = Array.from(this.ghosts.values());
      for (var ai = 0; ai < all.length; ai++) if (all[ai].state !== 'dying') all[ai].state = 'breach';
    }
    if (!snap.defeated) this.defeatedShown = false;

    // --- 门受击（与实际掉血同步）---
    if (this.doorHpPrev === null) this.doorHpPrev = snap.doorHp;
    if (snap.doorHp < this.doorHpPrev - 0.01) {
      var frac = (this.doorHpPrev - snap.doorHp) / Math.max(1, snap.doorMaxHp);
      this.shake = Math.min(11, this.shake + frac * 34 + 0.5);
      this.doorFlash = Math.max(this.doorFlash, 0.28);
    }
    this.doorHpPrev = snap.doorHp;

    // --- 幽灵移动 ---
    var sprites = Array.from(this.ghosts.values());
    var frontline = null;
    for (var gi = 0; gi < sprites.length; gi++) {
      var s = sprites[gi];
      if (s.state === 'enter') {
        if (s.delay > 0) { s.delay -= dt; continue; }
        s.x -= s.speed * dt;
        s.y = s.ty + Math.sin(this.t * 2.6 + s.phase) * 3;
        if (s.x <= s.tx) { s.x = s.tx; s.state = 'fight'; }
      } else if (s.state === 'fight') {
        s.lungeT += dt;
        if (s.lungeT >= s.lungeInterval) {
          s.lungeT = 0; s.lungeAnim = LUNGE_DUR;
          this.doorFlash = Math.max(this.doorFlash, 0.1);
        }
        var lungeOff = 0;
        if (s.lungeAnim > 0) {
          s.lungeAnim = Math.max(0, s.lungeAnim - dt);
          lungeOff = Math.sin((1 - s.lungeAnim / LUNGE_DUR) * Math.PI) * (s.boss ? 30 : 15);
        }
        s.x = s.tx - lungeOff + Math.sin(this.t * 2.1 + s.phase) * 1.6;
        s.y = s.ty + Math.sin(this.t * 2.8 + s.phase) * 2.4;
      } else if (s.state === 'dying') {
        s.dieT += dt;
      } else if (s.state === 'breach') {
        s.x -= s.speed * 3.4 * dt;
        s.y += Math.sin(this.t * 8 + s.phase) * 0.8;
      }
      if (s.hitCd > 0) s.hitCd -= dt;
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt);
      if ((s.state === 'fight' || s.state === 'enter') && s.delay <= 0) {
        if (!frontline || s.x < frontline.x) frontline = s;
      }
    }
    // 清理动画完成
    for (var rki = keys.length - 1; rki >= 0; rki--) {
      var r = this.ghosts.get(keys[rki]);
      if ((r.state === 'dying' && r.dieT >= DIE_DUR) || (r.state === 'breach' && r.x < -60)) {
        this.ghosts.delete(keys[rki]);
      }
    }

    // --- 炮塔 ---
    this.turret.target = frontline;
    if (snap.turretLevel > 0 && frontline) {
      var ta = Math.atan2(frontline.y - this.turretPos.y, frontline.x - this.turretPos.x);
      var dAng = ta - this.turret.angle;
      while (dAng > Math.PI) dAng -= TAU;
      while (dAng < -Math.PI) dAng += TAU;
      this.turret.angle += dAng * Math.min(1, dt * 9);
      this.turret.fireT += dt;
      if (this.turret.fireT >= 0.42) {
        this.turret.fireT = 0;
        this.turret.recoil = 0.18;
        var mx = this.turretPos.x + Math.cos(this.turret.angle) * 20;
        var my = this.turretPos.y + Math.sin(this.turret.angle) * 20;
        this.projectiles.push({
          x: mx, y: my, px: mx, py: my,
          target: frontline,
          speed: 430 * (this.W / 750),
          color: snap.turretLevel >= 20 ? '#ffd75e' : (snap.turretLevel >= 8 ? '#7ce7ff' : '#e8e2ff'),
          r: 3.2
        });
        this.particles.push({ x: mx, y: my, vx: 0, vy: 0, life: 0.09, maxLife: 0.09, size: 9, color: '#fff2c0' });
      }
    }
    if (this.turret.recoil > 0) this.turret.recoil -= dt;

    // --- 英雄（视觉攻击）---
    for (var hi = 0; hi < snap.heroes.length; hi++) {
      var h = snap.heroes[hi];
      var st = HERO_STYLE[h.id];
      if (!st) continue;
      var ha = this.heroAnim[hi] || (this.heroAnim[hi] = { fireT: Math.random(), t: 0 });
      if (h.unlocked && (h.type === 'dps' || h.type === 'slow') && frontline) {
        ha.fireT += dt;
        if (ha.fireT >= st.interval) {
          ha.fireT = 0; ha.t = 0.25;
          var hp2 = this.heroPos(hi);
          var col = h.id === 'knight' ? '#ffd75e' : h.id === 'mage' ? '#ff8a3d' : '#7dff9a';
          this.projectiles.push({
            x: hp2.x + 12, y: hp2.y, target: frontline,
            speed: 500 * (this.W / 750), color: col,
            r: h.id === 'mage' ? 4.5 : 3
          });
        }
      } else if (h.unlocked && h.type === 'heal' && snap.doorHp < snap.doorMaxHp - 1) {
        ha.t += dt;
        if (ha.t >= 2.4) {
          ha.t = 0;
          this.floaters.push({ x: this.wallX, y: this.doorTop + 20, text: '+', color: '#7dff9a', size: 15, life: 0.9, vy: -28, bold: true });
        }
      }
      if (ha.t > 0) ha.t = Math.max(0, ha.t - dt);
    }

    // --- 床（zzz / 金币微粒）---
    for (var bi = 0; bi < snap.beds.length; bi++) {
      var b = snap.beds[bi];
      var ba = this.bedAnim[bi] || (this.bedAnim[bi] = { zzzT: Math.random() * 2, sparkT: Math.random() });
      if (b.unlocked) {
        ba.zzzT += dt;
        if (ba.zzzT >= 2.3) {
          ba.zzzT = 0;
          var bp = this.bedPos(bi);
          this.particles.push({ x: bp.x + 16, y: bp.y - 6, vx: 7, vy: -15, life: 1.5, maxLife: 1.5, size: 11, color: 'rgba(190,180,255,0.75)', text: 'z' });
        }
        ba.sparkT += dt;
        if (ba.sparkT >= 1.5) {
          ba.sparkT = 0;
          var bp2 = this.bedPos(bi);
          this.particles.push({ x: bp2.x + Math.random() * 34, y: bp2.y + 6, vx: 0, vy: -24, life: 0.8, maxLife: 0.8, size: 3, color: '#ffd75e' });
        }
      }
    }

    // --- 弹道 ---
    for (var pi = this.projectiles.length - 1; pi >= 0; pi--) {
      var pr = this.projectiles[pi];
      var tp = pr.target;
      var tx = tp.x, ty = tp.y;
      var dx = tx - pr.x, dy = ty - pr.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var step = pr.speed * dt;
      if (dist <= step + 12) {
        pr.x = tx; pr.y = ty;
        if (this.ghosts.has(tp.key) && tp.state === 'fight') tp.flash = Math.max(tp.flash, 0.1);
        this._burst(tx, ty, 4, pr.color, 70, 2);
        this.projectiles.splice(pi, 1);
      } else {
        pr.px = pr.x; pr.py = pr.y;
        pr.x += dx / dist * step;
        pr.y += dy / dist * step;
      }
    }

    // --- 粒子 ---
    for (var pa = this.particles.length - 1; pa >= 0; pa--) {
      var p = this.particles[pa];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(pa, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.grav) p.vy += p.grav * dt;
    }

    // --- 飘字 ---
    for (var fi = this.floaters.length - 1; fi >= 0; fi--) {
      var f = this.floaters[fi];
      f.life -= dt;
      f.y += f.vy * dt;
      if (f.life <= 0) this.floaters.splice(fi, 1);
    }

    // --- 衰减 ---
    this.shake = Math.max(0, this.shake - dt * 16);
    this.redFlash = Math.max(0, this.redFlash - dt * 1.3);
    this.doorFlash = Math.max(0, this.doorFlash - dt * 2.4);
    if (this.banner) { this.banner.t += dt; if (this.banner.t > 2.8) this.banner = null; }
  };

  // ---------- 事件 ----------
  P._onGhostHit = function (sp, dmg) {
    sp.flash = 0.14;
    if (sp.hitCd <= 0) {
      sp.hitCd = 0.55;
      this.floaters.push({
        x: sp.x + (Math.random() * 16 - 8), y: sp.y,
        text: this.formatNum(dmg), color: '#ffffff',
        size: sp.boss ? 16 : 12, life: 0.8, vy: -46
      });
    }
  };

  P._onGhostDeath = function (sp) {
    this._burst(sp.x, sp.y, sp.boss ? 26 : 12, sp.boss ? '#ff6b8a' : '#b49aff', sp.boss ? 180 : 105, sp.boss ? 5 : 3.5);
    var soulR = Math.floor(sp.maxHp * 0.3) + 5;
    var coinR = Math.floor(sp.maxHp * 0.2) + 3;
    this.floaters.push({ x: sp.x - 10, y: sp.y - 16, text: '+' + this.formatNum(soulR), color: '#c77dff', size: sp.boss ? 17 : 12, life: 1.3, vy: -34, icon: 'soul' });
    this.floaters.push({ x: sp.x + 12, y: sp.y - 2, text: '+' + this.formatNum(coinR), color: '#ffd75e', size: sp.boss ? 16 : 11, life: 1.3, vy: -30, icon: 'coin' });
    if (sp.boss) {
      this.redFlash = Math.max(this.redFlash, 0.4);
      this.shake = Math.max(this.shake, 10);
      this.floaters.push({ x: sp.x, y: sp.y - 46, text: 'BOSS 击杀！', color: '#ff5e7a', size: 21, life: 1.7, vy: -22, bold: true });
    }
    this._kills++;
  };

  P._burst = function (x, y, n, color, speed, size) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU, v = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x: x, y: y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30,
        life: 0.4 + Math.random() * 0.35, maxLife: 0.75,
        size: size * (0.6 + Math.random() * 0.8),
        color: color, grav: 220
      });
    }
  };

  P.reset = function () {
    this.ghosts.clear();
    this.projectiles.length = 0;
    this.particles.length = 0;
    this.floaters.length = 0;
    this.shake = 0; this.redFlash = 0; this.doorFlash = 0;
    this.lastWave = -1; this.waveTotal = 0; this.banner = null;
    this.doorHpPrev = null; this.defeatedShown = false;
    this.heroAnim.length = 0; this.bedAnim.length = 0;
  };

  // ---------- 调试/测试用 ----------
  P.ghostCount = function () { return this.ghosts.size; };
  P.ghostOf = function (key) { return this.ghosts.get(key); };
  P.allFinite = function () {
    var ok = true;
    this.ghosts.forEach(function (sp) { if (!isFinite(sp.x) || !isFinite(sp.y)) ok = false; });
    this.projectiles.forEach(function (p) { if (!isFinite(p.x) || !isFinite(p.y)) ok = false; });
    this.particles.forEach(function (p) { if (!isFinite(p.x) || !isFinite(p.y)) ok = false; });
    return ok;
  };

  // ---------- 渲染 ----------
  P.render = function (ctx, imgs) {
    imgs = imgs || {};
    var W = this.W, H = this.H;
    var self = this;
    ctx.save();
    if (this.shake > 0.1) {
      ctx.translate((Math.random() * 2 - 1) * this.shake, (Math.random() * 2 - 1) * this.shake * 0.7);
    }

    // --- 背景 ---
    ctx.fillStyle = '#241d38';
    ctx.fillRect(-20, -20, this.dormRight + 30, H + 40);
    if (imgs.floor) {
      ctx.globalAlpha = 0.5;
      var ts = 32;
      for (var fy = 0; fy < H + ts; fy += ts) {
        for (var fx = 0; fx < this.dormRight + ts; fx += ts) {
          ctx.drawImage(imgs.floor, fx, fy, ts, ts);
        }
      }
      ctx.globalAlpha = 1;
    }
    // 走廊
    var grd = ctx.createLinearGradient(this.wallX, 0, W, 0);
    grd.addColorStop(0, '#181128');
    grd.addColorStop(1, '#0c0814');
    ctx.fillStyle = grd;
    ctx.fillRect(this.wallX, -20, W - this.wallX + 20, H + 40);
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    for (var lx = this.corridorL; lx < W; lx += 44) {
      ctx.beginPath(); ctx.moveTo(lx, this.floorTop); ctx.lineTo(lx, H); ctx.stroke();
    }
    var dg = ctx.createLinearGradient(W - 100, 0, W, 0);
    dg.addColorStop(0, 'rgba(255,60,90,0)');
    dg.addColorStop(1, 'rgba(255,60,90,0.18)');
    ctx.fillStyle = dg;
    ctx.fillRect(W - 100, -20, 100, H + 40);

    // --- 宿舍实体 ---
    this._drawAltar(ctx, imgs);
    for (var bi = 0; bi < (this.snap ? this.snap.beds.length : 6); bi++) this._drawBed(ctx, imgs, bi);
    for (var hi = 0; hi < 4; hi++) this._drawHero(ctx, imgs, hi);

    // --- 墙 / 门 / 炮塔 ---
    this._drawWall(ctx, imgs);
    this._drawTurret(ctx, imgs);

    // --- 幽灵（按 y 排序，下层的后画）---
    var list = Array.from(this.ghosts.values()).sort(function (a, b) { return a.y - b.y; });
    for (var gi = 0; gi < list.length; gi++) this._drawGhost(ctx, imgs, list[gi]);

    // --- 弹道（曳光尾迹）---
    for (var pi = 0; pi < this.projectiles.length; pi++) {
      var pr = this.projectiles[pi];
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = pr.color;
      ctx.lineWidth = pr.r * 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pr.px || pr.x, pr.py || pr.y);
      ctx.lineTo(pr.x, pr.y);
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = pr.color;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r * 2.2, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // --- 粒子 ---
    for (var pa = 0; pa < this.particles.length; pa++) {
      var p = this.particles[pa];
      var a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      if (p.text) {
        ctx.fillStyle = p.color;
        ctx.font = 'bold ' + p.size + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // --- 飘字 ---
    for (var fi = 0; fi < this.floaters.length; fi++) {
      var f = this.floaters[fi];
      var fa = clamp(f.life / 0.5, 0, 1);
      ctx.globalAlpha = fa;
      ctx.font = (f.bold ? 'bold ' : '') + f.size + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      if (f.icon && imgs[f.icon]) {
        ctx.drawImage(imgs[f.icon], f.x - ctx.measureText(f.text).width / 2 - 13, f.y - 7, 14, 14);
      }
    }
    ctx.globalAlpha = 1;

    // --- HUD / 横幅 ---
    this._drawHud(ctx, imgs);
    if (this.banner) this._drawBanner(ctx);

    // --- 红闪 ---
    if (this.redFlash > 0.01) {
      ctx.fillStyle = 'rgba(255,40,60,' + (this.redFlash * 0.3).toFixed(3) + ')';
      ctx.fillRect(-30, -30, W + 60, H + 60);
    }
    ctx.restore();
  };

  P._drawWall = function (ctx, imgs) {
    var x0 = this.wallX - this.wallW / 2, w = this.wallW;
    var y0 = this.doorTop, y1 = this.doorBot;
    // 砖墙
    if (imgs.brick) {
      var bs = w;
      for (var by = y0; by < y1; by += bs * 0.62) {
        for (var bx = 0; bx < 2; bx++) {
          ctx.drawImage(imgs.brick, x0 + bx * bs / 2, by, bs / 2, bs * 0.62);
        }
      }
    } else {
      ctx.fillStyle = '#3a3352';
      ctx.fillRect(x0, y0, w, y1 - y0);
    }
    // 门（按等级取图，双块叠加成高门）
    var tier = this.snap && this.snap.doorLevel >= 20 ? 3 : (this.snap && this.snap.doorLevel >= 5 ? 2 : 1);
    var dim = Math.min(28, w + 8);
    var doorImg = imgs['door' + tier];
    var dy = this.H * 0.45;
    if (doorImg) {
      ctx.drawImage(doorImg, this.wallX - dim / 2, dy - dim, dim, dim);
      ctx.drawImage(doorImg, this.wallX - dim / 2, dy, dim, dim);
    } else {
      ctx.fillStyle = '#8a6b4a';
      ctx.fillRect(this.wallX - dim / 2, dy - dim, dim, dim * 2);
      ctx.fillStyle = '#6b4f36';
      ctx.fillRect(this.wallX - dim / 2 + 3, dy - dim + 3, dim - 6, dim - 6);
      ctx.fillRect(this.wallX - dim / 2 + 3, dy + 3, dim - 6, dim - 6);
    }
    // 受击闪白
    if (this.doorFlash > 0.01) {
      ctx.fillStyle = 'rgba(255,255,255,' + (this.doorFlash * 0.5).toFixed(3) + ')';
      ctx.fillRect(x0 - 2, y0, w + 4, y1 - y0);
    }
    // 残血红脉
    var snap = this.snap;
    if (snap && snap.doorHp / snap.doorMaxHp < 0.35 && snap.doorHp > 0) {
      ctx.fillStyle = 'rgba(255,60,60,' + (0.12 + 0.1 * Math.sin(this.t * 6)).toFixed(3) + ')';
      ctx.fillRect(x0 - 4, y0, w + 8, y1 - y0);
    }
    // 门血条
    var bw = 62, bx = this.wallX - bw / 2, by = y0 - 14;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, 9);
    var pct = snap ? clamp(snap.doorHp / snap.doorMaxHp, 0, 1) : 1;
    ctx.fillStyle = pct > 0.5 ? '#4caf7d' : pct > 0.25 ? '#e0a53d' : '#e05252';
    ctx.fillRect(bx, by, bw * pct, 7);
  };

  P._drawTurret = function (ctx, imgs) {
    var pos = this.turretPos, lvl = this.snap ? this.snap.turretLevel : 0;
    if (lvl <= 0) {
      // 未建造：虚线底座
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(pos.x, pos.y, 13, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    var tier = lvl >= 20 ? '#ffd75e' : lvl >= 8 ? '#7ce7ff' : '#cfc6e8';
    ctx.save();
    ctx.translate(pos.x, pos.y);
    // 底座
    ctx.fillStyle = '#332c4d';
    ctx.strokeStyle = '#5a5375';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill(); ctx.stroke();
    // 炮管
    ctx.rotate(this.turret.angle);
    var rec = this.turret.recoil > 0 ? -3 : 0;
    ctx.fillStyle = tier;
    ctx.fillRect(rec, -3.5, 20, 7);
    if (this.turret.recoil > 0.06) {
      ctx.fillStyle = 'rgba(255,230,150,0.9)';
      ctx.beginPath(); ctx.arc(21, 0, 5, 0, TAU); ctx.fill();
    }
    ctx.restore();
    // 等级
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(pos.x - 14, pos.y + 15, 28, 13);
    ctx.fillStyle = tier;
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Lv' + lvl, pos.x, pos.y + 21.5);
  };

  P._drawGhost = function (ctx, imgs, sp) {
    var base = Math.min(this.cellW, this.cellH) * 0.82;
    var size = base * (sp.boss ? 1.7 : (0.82 + (sp.id % 3) * 0.09));
    var alpha = 1, sc = 1;
    if (sp.state === 'dying') {
      var k = sp.dieT / DIE_DUR;
      alpha = 1 - k; sc = 1 + k * 0.6;
    }
    ctx.save();
    ctx.translate(sp.x, sp.y + (sp.state === 'dying' ? -sp.dieT * 26 : 0));
    if (sp.state === 'dying') ctx.rotate(sp.dieT * 6);
    ctx.scale(sc, sc);
    ctx.globalAlpha = alpha;
    // Boss 光环
    if (sp.boss) {
      ctx.strokeStyle = 'rgba(255,80,110,' + (0.5 + 0.3 * Math.sin(this.t * 5)).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, size * 0.6, 0, TAU); ctx.stroke();
    }
    var img = sp.boss ? imgs.boss : imgs['ghost' + (sp.id % 3 + 1)];
    if (img) {
      ctx.drawImage(img, -size / 2, -size * 0.56, size, size * 0.86);
    } else {
      this._ghostFallback(ctx, size, sp);
    }
    // 受击闪白
    if (sp.flash > 0) {
      ctx.globalAlpha = alpha * clamp(sp.flash / 0.14, 0, 1) * 0.45;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-size / 2, -size * 0.56, size, size * 0.86);
    }
    ctx.restore();
    // 血条（不随死亡旋转；顶行被 HUD 遮挡时下钳位）
    var barY = sp.y - size * 0.62 - (sp.boss ? 13 : 7);
    var minY = this.hudH + 9;
    if (barY < minY) barY = minY;
    if (sp.state !== 'dying' && sp.hp < sp.maxHp - 0.01) {
      var bw = size * 0.95, bx = sp.x - bw / 2, by = barY;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
      var pct = clamp(sp.hp / sp.maxHp, 0, 1);
      ctx.fillStyle = pct > 0.5 ? '#7dff9a' : pct > 0.25 ? '#ffd75e' : '#ff5e7a';
      ctx.fillRect(bx, by, bw * pct, 4);
    }
    if (sp.boss && sp.state !== 'dying') {
      // 标签在血条上方，黑描边保证可读
      ctx.globalAlpha = 0.98;
      ctx.font = 'bold 14px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText('BOSS', sp.x, Math.max(barY - 16, this.hudH + 5));
      ctx.fillStyle = '#ff7a94';
      ctx.fillText('BOSS', sp.x, Math.max(barY - 16, this.hudH + 5));
      ctx.globalAlpha = 1;
    }
  };

  P._ghostFallback = function (ctx, size, sp) {
    var w = size * 0.86, h = size * 0.86;
    var c = sp.boss ? '#d98ab0' : GHOST_TINTS[sp.id % 3];
    ctx.fillStyle = c;
    this._roundRect(ctx, -w / 2, -h * 0.55, w, h, w * 0.24);
    ctx.fill();
    ctx.fillStyle = 'rgba(30,20,50,0.9)';
    var er = w * 0.13;
    ctx.beginPath(); ctx.arc(-w * 0.2, -h * 0.18, er, 0, TAU); ctx.arc(w * 0.2, -h * 0.18, er, 0, TAU); ctx.fill();
    ctx.beginPath();
    ctx.rect(-w * 0.22, h * 0.12, w * 0.44, h * 0.16);
    ctx.fill();
  };

  P._drawBed = function (ctx, imgs, i) {
    var snap = this.snap;
    var b = snap ? snap.beds[i] : { unlocked: i === 0, level: i === 0 ? 1 : 0 };
    var pos = this.bedPos(i);
    var bw = this.bedCellW * 0.88, bh = bw * 0.6;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    if (imgs.bed) {
      ctx.drawImage(imgs.bed, 0, 0, bw, bh);
    } else {
      ctx.fillStyle = '#d8cbb0';
      this._roundRect(ctx, 0, 0, bw, bh, 6); ctx.fill();
      ctx.fillStyle = '#2fbfae';
      this._roundRect(ctx, 4, 4, bw - 8, bh - 8, 4); ctx.fill();
    }
    if (!b.unlocked) {
      ctx.fillStyle = 'rgba(10,8,18,0.62)';
      this._roundRect(ctx, 0, 0, bw, bh, 6); ctx.fill();
      // 锁
      ctx.strokeStyle = '#9a92b8';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(bw / 2, bh / 2 - 2, 6, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = '#9a92b8';
      ctx.fillRect(bw / 2 - 8, bh / 2 - 2, 16, 12);
    } else {
      // 等级徽章
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bw - 34, bh - 15, 32, 13);
      ctx.fillStyle = '#8fe3a0';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Lv' + b.level, bw - 18, bh - 8.5);
    }
    ctx.restore();
  };

  P._drawHero = function (ctx, imgs, i) {
    var snap = this.snap;
    var h = snap ? snap.heroes[i] : null;
    if (!h) return;
    var pos = this.heroPos(i);
    var st = HERO_STYLE[h.id];
    var ha = this.heroAnim[i];
    var attacking = ha && ha.t > 0;
    var r = 15;
    ctx.save();
    ctx.translate(pos.x + (attacking ? 6 : 0), pos.y);
    if (h.unlocked) {
      // 光环
      ctx.globalAlpha = 0.25 + (attacking ? 0.25 : 0);
      ctx.fillStyle = st.color;
      ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      var img = imgs[h.id];
      if (img) {
        var s = r * 1.9 * (attacking ? 1.12 : 1);
        ctx.drawImage(img, -s / 2, -s / 2, s, s);
      } else {
        ctx.fillStyle = st.color;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#1a1626';
        ctx.font = 'bold 13px "PingFang SC",sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(st.char, 0, 1);
      }
      // 等级
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(-13, r + 4, 26, 12);
      ctx.fillStyle = st.color;
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Lv' + h.level, 0, r + 10);
    } else {
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#6a6288';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#6a6288';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, 1);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  P._drawAltar = function (ctx, imgs) {
    var pos = this.altarPos;
    var lvl = this.snap ? this.snap.altarLevel : 0;
    var r = 20;
    // 光晕
    var glow = ctx.createRadialGradient(pos.x, pos.y, 2, pos.x, pos.y, r * 2.2);
    var ga = lvl > 0 ? 0.35 + 0.12 * Math.sin(this.t * 2) : 0.1;
    glow.addColorStop(0, 'rgba(180,120,255,' + ga.toFixed(3) + ')');
    glow.addColorStop(1, 'rgba(180,120,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(pos.x, pos.y, r * 2.2, 0, TAU); ctx.fill();
    // 主体
    ctx.fillStyle = '#2a2344';
    ctx.strokeStyle = lvl > 0 ? '#a678ff' : '#544c70';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = lvl > 0 ? '#c77dff' : '#544c70';
    ctx.beginPath(); ctx.arc(pos.x, pos.y, r * 0.45, 0, TAU); ctx.fill();
    // 环绕灵魂球
    if (lvl > 0) {
      for (var i = 0; i < 3; i++) {
        var a = this.t * 1.7 + i * TAU / 3;
        ctx.fillStyle = 'rgba(199,125,255,0.9)';
        ctx.beginPath();
        ctx.arc(pos.x + Math.cos(a) * (r + 8), pos.y + Math.sin(a) * (r + 8) * 0.5 - 4, 3.5, 0, TAU);
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(pos.x - 17, pos.y + r + 4, 34, 13);
    ctx.fillStyle = lvl > 0 ? '#c77dff' : '#8a80a8';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('祭坛Lv' + lvl, pos.x, pos.y + r + 10.5);
  };

  P._drawHud = function (ctx, imgs) {
    var W = this.W, snap = this.snap;
    // 顶栏
    ctx.fillStyle = 'rgba(8,6,14,0.78)';
    ctx.fillRect(-20, -20, W + 40, this.hudH + 22);
    ctx.fillStyle = 'rgba(150,120,255,0.25)';
    ctx.fillRect(-20, this.hudH + 2, W + 40, 1.5);

    var fs1 = Math.round(this.hudH * 0.36), fs2 = Math.round(this.hudH * 0.22);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    // 左：波次
    ctx.fillStyle = '#e8e2ff';
    ctx.font = 'bold ' + fs1 + 'px "PingFang SC",sans-serif';
    ctx.fillText('第 ' + (snap ? snap.wave : 0) + ' 波', 12, this.hudH * 0.42);
    // 左下：状态
    var status, color;
    if (!snap) { status = ''; color = '#9a92b8'; }
    else if (snap.defeated) { status = '大门失守！'; color = '#ff5e7a'; }
    else if (snap.ghosts.length > 0) {
      var bossAlive = snap.ghosts.some(function (g) { return g.boss; });
      status = '战斗中 · 剩 ' + snap.ghosts.length + ' 只' + (bossAlive ? ' · BOSS' : '');
      color = bossAlive ? '#ff7a94' : '#ffd75e';
    } else {
      status = '下一波 ' + fmtDur(snap.nextWaveIn) + (snap.nextIsBoss ? ' · BOSS将至' : '') + (snap.threatDanger ? ' · 危险!' : '');
      color = snap.threatDanger || snap.nextIsBoss ? '#ff9a9a' : '#9a92b8';
    }
    ctx.fillStyle = color;
    ctx.font = fs2 + 'px "PingFang SC",sans-serif';
    ctx.fillText(status, 12, this.hudH * 0.78);

    // 右：门耐久条 + 防御等级
    if (snap) {
      var bw = Math.min(150, W * 0.19), bx = W - bw - 12, by = this.hudH * 0.3;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = (fs2 - 2) + 'px "PingFang SC",sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('大门 Lv' + snap.doorLevel, bx + bw, by - 8);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx, by, bw, 8);
      var pct = clamp(snap.doorHp / snap.doorMaxHp, 0, 1);
      ctx.fillStyle = pct > 0.5 ? '#4caf7d' : pct > 0.25 ? '#e0a53d' : '#e05252';
      ctx.fillRect(bx, by, bw * pct, 8);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#9a92b8';
      ctx.font = (fs2 - 3) + 'px "PingFang SC",sans-serif';
      ctx.fillText('炮塔 Lv' + snap.turretLevel, bx + bw, by + 18);
    }
  };

  P._drawBanner = function (ctx) {
    var b = this.banner;
    var aIn = clamp(b.t / 0.25, 0, 1);
    var aOut = clamp((2.8 - b.t) / 0.5, 0, 1);
    var a = Math.min(aIn, aOut);
    var y = this.H * 0.3 + (1 - aIn) * -18;
    var W = this.W;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(8,6,14,0.55)';
    this._roundRect(ctx, W * 0.22, y - 34, W * 0.56, 68, 12);
    ctx.fill();
    var pulse = b.boss ? 1 + 0.04 * Math.sin(b.t * 12) : 1;
    ctx.translate(W / 2, y);
    ctx.scale(pulse, pulse);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 30px "PingFang SC",sans-serif';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(b.text, 0, -10);
    ctx.fillStyle = b.boss ? '#ff5e7a' : '#e8e2ff';
    ctx.fillText(b.text, 0, -10);
    ctx.font = '15px "PingFang SC",sans-serif';
    ctx.fillStyle = b.boss ? '#ffb0c0' : '#b8aee8';
    ctx.fillText(b.sub, 0, 20);
    ctx.restore();
  };

  P._roundRect = function (ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  return { BattleView: BattleView, makeSnapshot: makeSnapshot, fmtDur: fmtDur };
});
