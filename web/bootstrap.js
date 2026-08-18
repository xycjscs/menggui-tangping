/**
 * 模块桥接：把 CommonJS 版的核心逻辑加载进浏览器
 * 复用小程序同一份 js/core/gameCore.js 和 number.js（零分叉）
 */
(async function () {
  'use strict';
  function loadCommonJS(url) {
    return fetch(url, { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error(url + ' -> ' + r.status);
      return r.text();
    }).then(code => {
      const mod = { exports: {} };
      // gameCore.js / number.js 都是纯 CommonJS（module.exports = {...}），
      // 无顶层 this/全局依赖，可安全包一层函数执行
      const fn = new Function('module', 'exports', 'require', code);
      fn(mod, mod.exports, () => { throw new Error('require 不支持（核心应无依赖）'); });
      return mod.exports;
    });
  }
  try {
    const core = await loadCommonJS('../js/core/gameCore.js');
    const num = await loadCommonJS('../js/core/number.js');
    window.core = core;
    window.num = num;
    document.dispatchEvent(new Event('core-modules-ready'));
  } catch (e) {
    console.error('核心模块加载失败', e);
    const p = document.createElement('div');
    p.style.cssText = 'position:fixed;inset:0;background:#1a1626;color:#ff9a9a;display:flex;align-items:center;justify-content:center;font-size:16px;z-index:999';
    p.textContent = '核心模块加载失败：' + e.message + '（请确认 web/ 和 js/ 在同一仓库）';
    document.body.appendChild(p);
  }
})();
