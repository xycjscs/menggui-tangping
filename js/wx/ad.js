/**
 * 广告管理器（wx 层）
 * - AD_DEBUG=true 时模拟广告（开发者工具直接通过）
 * - 上线前：config.js 里 AD_DEBUG=false，填入真实 adUnitId
 * - 所有激励视频广告统一入口：playRewardAd(key, successCb)
 */
const CONFIG = require('../config');

let bannerAd = null;

/**
 * 播放激励视频广告
 * @param {string} key 广告位 key（config.ADS 中的键）
 * @param {Function} successCb 广告完整观看成功回调
 * @param {Function} failCb 失败/跳过回调
 */
function playRewardAd(key, successCb, failCb) {
  const adUnitId = CONFIG.ADS[key];
  if (CONFIG.AD_DEBUG || !adUnitId || adUnitId.indexOf('xxxx') >= 0) {
    // 调试模式：直接模拟成功
    console.log('[AD DEBUG] 模拟播放广告', key);
    setTimeout(() => successCb && successCb(), 600);
    return;
  }
  if (!wx.createRewardedVideoAd) {
    failCb && failCb(new Error('当前基础库不支持激励视频'));
    return;
  }
  if (!playRewardAd._cache) playRewardAd._cache = {};
  if (!playRewardAd._cache[key]) {
    playRewardAd._cache[key] = wx.createRewardedVideoAd({ adUnitId });
  }
  const ad = playRewardAd._cache[key];
  const onClose = () => {
    ad.offClose(onClose);
    // isEnded 为 false 表示中途关闭
    if (ad.isEnded) successCb && successCb();
    else { wx.showToast({ title: '需完整观看广告才能获得奖励', icon: 'none' }); failCb && failCb(new Error('未看完')); }
  };
  const onError = e => {
    ad.offError(onError);
    console.error('[AD] error', key, e);
    wx.showToast({ title: '广告加载失败，请稍后再试', icon: 'none' });
    failCb && failCb(e);
  };
  ad.onClose(onClose);
  ad.onError(onError);
  ad.load().then(() => ad.show()).catch(() => ad.show().catch(onError));
}

/**
 * 初始化 Banner 广告（底部，可选开启）
 */
function initBanner(pageHeight) {
  if (!CONFIG.ENABLE_ADS || CONFIG.AD_DEBUG) return;
  const adUnitId = CONFIG.ADS.banner;
  if (!adUnitId || adUnitId.indexOf('xxxx') >= 0) return;
  const info = wx.getSystemInfoSync();
  bannerAd = wx.createBannerAd({
    adUnitId,
    style: { left: 0, top: pageHeight - 60, width: info.windowWidth }
  });
  bannerAd.onError(e => console.warn('[AD] banner error', e));
  return bannerAd;
}

module.exports = { playRewardAd, initBanner };
