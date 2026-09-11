import { getJson, setJson } from "./storage.js";

const STORAGE_KEY = "nav_click_stats_v1";
const MAX_HISTORY_PER_URL = 200;

let cache = null;

function loadStats() {
  if (cache !== null) return cache;
  cache = getJson(STORAGE_KEY, {});
  return cache;
}

function saveStats() {
  setJson(STORAGE_KEY, cache || {});
}

/**
 * 记录一次链接点击
 * @param {string} url - 链接 URL
 */
export function recordClick(url) {
  if (!url) return;
  const stats = loadStats();
  const now = Date.now();

  if (!stats[url]) {
    stats[url] = {
      count: 0,
      firstClick: now,
      lastClick: now,
      timestamps: []
    };
  }

  const entry = stats[url];
  entry.count += 1;
  entry.lastClick = now;
  entry.timestamps.push(now);

  // 限制历史记录数量，避免 localStorage 膨胀
  if (entry.timestamps.length > MAX_HISTORY_PER_URL) {
    entry.timestamps = entry.timestamps.slice(-MAX_HISTORY_PER_URL);
    entry.firstClick = entry.timestamps[0];
  }

  saveStats();
}

/**
 * 计算小时频率（总点击数 / 距离首次点击的小时数）
 * 对新链接使用平滑处理，避免少量点击产生极高频率
 * @param {object} entry - 统计条目
 * @returns {number} 每小时点击频率
 */
function getHourlyFrequency(entry) {
  if (!entry || entry.count === 0) return 0;
  const now = Date.now();
  const hours = Math.max((now - entry.firstClick) / (1000 * 60 * 60), 0.1); // 最少 0.1 小时兜底
  const baseFreq = entry.count / hours;

  // 近期加权：最近 24 小时内的点击额外加权
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const recentClicks = entry.timestamps.filter(t => t > oneDayAgo).length;
  const recentBoost = recentClicks / Math.max(hours, 1) * 0.3;

  return baseFreq + recentBoost;
}

/**
 * 获取链接的点击频率分数
 * @param {string} url
 * @returns {number} 频率分数，越高表示越常使用
 */
export function getClickFrequency(url) {
  const stats = loadStats();
  const entry = stats[url];
  if (!entry) return 0;
  return getHourlyFrequency(entry);
}

/**
 * 获取所有链接的点击统计
 * @returns {object} url -> { count, firstClick, lastClick, hourlyFreq }
 */
export function getAllClickStats() {
  const stats = loadStats();
  const result = {};
  for (const [url, entry] of Object.entries(stats)) {
    result[url] = {
      count: entry.count,
      firstClick: entry.firstClick,
      lastClick: entry.lastClick,
      hourlyFreq: getHourlyFrequency(entry)
    };
  }
  return result;
}

/**
 * 按点击频率排序链接数组
 * @param {Array} links - 链接数组，每项需包含 url 字段
 * @param {number} limit - 最多返回数量
 * @returns {Array} 排序后的链接数组
 */
export function sortLinksByFrequency(links, limit = 125) {
  const stats = loadStats();
  const scored = links.map(link => ({
    ...link,
    _freq: stats[link.url] ? getHourlyFrequency(stats[link.url]) : 0
  }));

  scored.sort((a, b) => {
    // 先按频率降序
    if (b._freq !== a._freq) return b._freq - a._freq;
    // 频率相同则按最后点击时间降序（最近点击的排前面）
    const aLast = stats[a.url]?.lastClick || 0;
    const bLast = stats[b.url]?.lastClick || 0;
    return bLast - aLast;
  });

  return scored.slice(0, limit);
}

/**
 * 清除指定 URL 的点击统计
 * @param {string} url
 */
export function clearClickStats(url) {
  const stats = loadStats();
  if (stats[url]) {
    delete stats[url];
    saveStats();
  }
}
