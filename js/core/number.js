/**
 * 数字格式化（纯函数，可Node测试）
 */

/**
 * 大数字格式化：1234 -> "1234"，12345 -> "1.23万"，2.3e8 -> "2.30亿"
 */
function formatNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  const neg = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n < 10000) {
    if (n < 100 && !Number.isInteger(n)) return neg + n.toFixed(1);
    return neg + Math.floor(n).toString();
  }
  const units = [
    [1e12, '万亿'],
    [1e8, '亿'],
    [1e4, '万']
  ];
  for (const [v, u] of units) {
    if (n >= v) {
      const x = n / v;
      return neg + (x >= 100 ? Math.floor(x) + u : x.toFixed(2).replace(/\.?0+$/, '') + u);
    }
  }
  return neg + Math.floor(n).toString();
}

/**
 * 秒 -> "1小时23分" / "45秒" / "1天3小时"
 */
function formatDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return h > 0 ? `${d}天${h}小时` : `${d}天`;
  if (h > 0) return m > 0 ? `${h}小时${m}分` : `${h}小时`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

module.exports = { formatNum, formatDuration };
