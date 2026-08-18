/**
 * 猛鬼宿舍·躺平发育 —— 小程序 2D 战场接入层
 * 复用 js/battle/battleView.js（与 Web 同一份渲染层，零分叉）
 *
 * 用法（页面 onLoad 中）：
 *   const battle = require('../../js/wx/battle');
 *   battle.start(this, Game);   // this = 页面实例
 *   battle.stop();              // 页面 onUnload
 */
const bv = require('../battle/battleView');
const core = require('../core/gameCore');

const IMG_KEYS = [
  ['floor', '/images/tiles/floor_wood.png'],
  ['brick', '/images/tiles/brick.png'],
  ['bed', '/images/sprites/bed.png'],
  ['ghost1', '/images/sprites/ghost_1.png'],
  ['ghost2', '/images/sprites/ghost_2.png'],
  ['ghost3', '/images/sprites/ghost_3.png'],
  ['boss', '/images/sprites/ghost_4.png'],
  ['door1', '/images/tiles/door_1.png'],
  ['door2', '/images/tiles/door_2.png'],
  ['door3', '/images/tiles/door_3.png'],
  ['coin', '/images/icons/coin.png'],
  ['soul', '/images/icons/soul.png'],
  ['knight', '/images/icons/sword_gold.png'],
  ['archer', '/images/icons/sword_green.png'],
  ['mage', '/images/icons/sword_purple.png'],
  ['priest', '/images/icons/sword_orange.png']
];

let view = null;      // BattleView 实例
let canvas = null;
let ctx = null;
let dpr = 1;
let rafId = null;
let timerId = null;
let lastT = 0;
let running = false;
let imgs = {};        // key -> canvas Image

function formatNum(n) {
  n = Math.floor(n);
  return Math.abs(n) >= 10000 ? (n / 10000).toFixed(1) + '万' : '' + n;
}

/** 页面 onLoad 调用 */
function start(page, Game) {
  if (running) return;
  page.createSelectorQuery()
    .select('#battleCanvas')
    .fields({ node: true, size: true })
    .exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        console.warn('[battle] canvas node 未找到，跳过战场渲染');
        return;
      }
      canvas = res[0].node;
      ctx = canvas.getContext('2d');
      try { dpr = wx.getSystemInfoSync().pixelRatio || 1; } catch (e) { dpr = 1; }
      canvas.width = Math.floor(res[0].width * dpr);
      canvas.height = Math.floor(res[0].height * dpr);
      view = new bv.BattleView({ formatNum: formatNum });
      view.resize(res[0].width, res[0].height);
      loadImages(() => {
        running = true;
        lastT = Date.now();
        // canvas 2d 自带 rAF；不支持时降级 30ms 定时器
        if (canvas.requestAnimationFrame) {
          const loop = () => {
            if (!running) return;
            tickOnce(Game);
            rafId = canvas.requestAnimationFrame(loop);
          };
          rafId = canvas.requestAnimationFrame(loop);
        } else {
          timerId = setInterval(tickOnce, 33);
        }
      });
    });
}

function tickOnce(Game) {
  if (!view || !Game.s) return;
  const now = Date.now();
  const dt = Math.min(0.1, Math.max(0.004, (now - lastT) / 1000));
  lastT = now;
  // 页面隐藏时暂停（onHide 会 stop，这里双保险）
  view.frame(bv.makeSnapshot(core, Game.s), dt);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, view.W, view.H);
  view.render(ctx, imgs);
}

function loadImages(cb) {
  let pending = IMG_KEYS.length;
  const done = () => { if (--pending <= 0) cb(); };
  IMG_KEYS.forEach(([key, src]) => {
    const img = canvas.createImage();
    img.onload = () => { imgs[key] = img; done(); };
    img.onerror = done;   // 素材缺失时降级程序化绘制
    img.src = src;
  });
}

/** 页面 onUnload 调用 */
function stop() {
  running = false;
  if (rafId != null && canvas && canvas.cancelAnimationFrame) canvas.cancelAnimationFrame(rafId);
  if (timerId) { clearInterval(timerId); timerId = null; }
  rafId = null;
  view = null;
  ctx = null;
  canvas = null;
  imgs = {};
}

module.exports = { start, stop };
