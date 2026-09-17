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
 *
 * 分母取「距首次点击的小时数」，下限 0.1 小时（约 6 分钟）。因此刚建立
 * 记录的链接会被短期放大：最初几分钟内频率约为 点击数 × 10，之后随观察
 * 窗口增长而衰减。也就是说这是一个偏「近期使用」的加权频率，而不是长期
 * 平均频率——新近用过的链接会更快浮到快捷入口前部。
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
