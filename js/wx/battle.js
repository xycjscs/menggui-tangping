/**
 * 猛鬼宿舍·躺平发育 —— 小程序 2D 战场接入层 v0.4
 * 复用 js/battle/battleView.js（与 Web 同一份渲染层，零分叉）
 * 提供：start/stop（渲染循环）、tapPoint（点击→设计坐标）、menuPos（元素→屏幕坐标）
 */
const bv = require('../battle/battleView');
const core = require('../core/gameCore');

const IMG_KEYS = [
  ['floor', '/images/tiles/floor_wood.png'], ['brick', '/images/tiles/brick.png'],
  ['bed', '/images/sprites/bed.png'], ['ghost1', '/images/sprites/ghost_1.png'],
  ['ghost2', '/images/sprites/ghost_2.png'], ['ghost3', '/images/sprites/ghost_3.png'],
  ['boss', '/images/sprites/ghost_4.png'], ['door1', '/images/tiles/door_1.png'],
  ['door2', '/images/tiles/door_2.png'], ['door3', '/images/tiles/door_3.png'],
  ['coin', '/images/icons/coin.png'], ['soul', '/images/icons/soul.png'],
  ['knight', '/images/icons/sword_gold.png'], ['archer', '/images/icons/sword_green.png'],
  ['mage', '/images/icons/sword_purple.png'], ['priest', '/images/icons/sword_orange.png']
];

const W = 750, H = 430;
let view = null, canvas = null, ctx = null, dpr = 1;
let rafId = null, running = false, imgs = {};
let canvasRect = null;      // 画布页面坐标 {left, top, width, height}（px）
let getState = null;        // () => 当前 core 状态

function formatNum(n) {
  n = Math.floor(n);
  return Math.abs(n) >= 10000 ? (n / 10000).toFixed(1) + '万' : '' + n;
}

/** 页面进入游戏屏时调用。page=页面实例，getState=() => core 状态 */
function start(page, _stateFn, getStateFn) {
  getState = getStateFn || _stateFn || (() => null);
  if (running && view && canvas) return;   // 同一存活画布已渲染，仅更新 getState
  // 否则（首次 / stop 过 / 画布被 wx:if 重建）重新初始化
  running = false; view = null; canvas = null; ctx = null;
  const init = (attempt) => {
    page.createSelectorQuery()
      .select('#battleCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          if (attempt < 8) setTimeout(() => init(attempt + 1), 120);   // 等 canvas 渲染
          else console.warn('[battle] canvas 未找到');
          return;
        }
        canvas = res[0].node;
        ctx = canvas.getContext('2d');
        try { dpr = wx.getSystemInfoSync().pixelRatio || 1; } catch (e) { dpr = 1; }
        canvas.width = Math.floor(res[0].width * dpr);
        canvas.height = Math.floor(res[0].height * dpr);
        // 画布页面坐标（点触菜单定位用）
        page.createSelectorQuery().select('#battleCanvas').boundingClientRect(rect => {
          canvasRect = rect;
        }).exec();
        if (!view) view = new bv.BattleView({ formatNum: formatNum });
        view.resize(W, H);
        view.reset();
        loadImages(() => {
          running = true;
          lastT = Date.now();
          if (canvas.requestAnimationFrame) {
            const loop = () => {
              if (!running) return;
              tickOnce();
              rafId = canvas.requestAnimationFrame(loop);
            };
            rafId = canvas.requestAnimationFrame(loop);
          } else {
            setInterval(() => { if (running) tickOnce(); }, 33);
          }
        });
      });
  };
  init(0);
}

let lastT = 0;
function tickOnce() {
  if (!view) return;
  const s = getState && getState();
  if (!s) return;
  const now = Date.now();
  const dt = Math.min(0.1, Math.max(0.004, (now - lastT) / 1000));
  lastT = now;
  view.frame(bv.makeSnapshot(core, s), dt);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  view.render(ctx, imgs);
}

function loadImages(cb) {
  let pending = IMG_KEYS.length;
  const done = () => { if (--pending <= 0) cb(); };
  IMG_KEYS.forEach(([key, src]) => {
    const img = canvas.createImage();
    img.onload = () => { imgs[key] = img; done(); };
    img.onerror = done;
    img.src = src;
  });
}

function stop() {
  running = false;
  if (rafId != null && canvas && canvas.cancelAnimationFrame) canvas.cancelAnimationFrame(rafId);
  rafId = null; view = null; ctx = null; canvas = null; imgs = {}; canvasRect = null;
}

/** 点击事件 → 设计空间坐标 (0..750, 0..430)。WeChat canvas bindtap 的 e.detail 是画布相对坐标 */
function tapPoint(e) {
  const d = (e && e.detail) || {};
  const cw = (canvasRect && canvasRect.width) || 375;
  const ch = (canvasRect && canvasRect.height) || 214;
  let x = (typeof d.x === 'number' ? d.x : (e.clientX || 0) - (canvasRect ? canvasRect.left : 0));
  let y = (typeof d.y === 'number' ? d.y : (e.clientY || 0) - (canvasRect ? canvasRect.top : 0));
  return { x: x / cw * W, y: y / ch * H };
}

/** 战场元素 → 屏幕绝对坐标（点触菜单定位，含边界钳位） */
function menuPos(hit) {
  const view2 = view;
  if (!view2 || !canvasRect) return { x: 16, y: 120 };
  const sx = canvasRect.width / W, sy = canvasRect.height / H;
  let dx = 0, dy = 0;
  if (hit.type === 'bed') { const p = view2.bedPos(hit.index); dx = p.x + view2.bedCellW * 0.44; dy = p.y + view2.bedCellW * 0.26; }
  else if (hit.type === 'door') { dx = view2.wallX; dy = H * 0.5; }
  else if (hit.type === 'turret') { dx = view2.turretPos.x; dy = view2.turretPos.y; }
  else if (hit.type === 'altar') { dx = view2.altarPos.x; dy = view2.altarPos.y; }
  else if (hit.type === 'hero') { const p = view2.heroPos(hit.index); dx = p.x; dy = p.y; }
  else if (hit.type === 'slot') { const p = view2.slotPos(hit.index); dx = p.x; dy = p.y; }
  const mw = 200, mh = 170;
  let left = canvasRect.left + dx * sx + 16;
  if (left + mw > canvasRect.left + canvasRect.width - 8) left = canvasRect.left + dx * sx - mw - 16;
  left = Math.max(8, Math.min(left, canvasRect.left + canvasRect.width - mw - 8));
  let top = canvasRect.top + dy * sy - mh / 2;
  top = Math.max(8, Math.min(top, canvasRect.top + canvasRect.height - mh - 8));
  return { x: Math.round(left), y: Math.round(top) };
}

module.exports = { start, stop, get view() { return view; }, tapPoint, menuPos };
