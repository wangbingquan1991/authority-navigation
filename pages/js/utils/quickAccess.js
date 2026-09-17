// ============================================================
// 快捷入口：候选池构建与使用频率排序
// ============================================================
// 快捷入口是一个「派生视图」，不是一个分类：
// 候选来自全站所有可见链接（各分类 + 自建分类 + 用户显式加入的），
// 排序完全由点击行为驱动，因此任何网址——包括自定义添加的、以及
// 自建分类里的——只要用得多就会自动浮上来。
//
// 这里刻意保持纯函数、零依赖：便于单测，也不与 DOM / 存储耦合。
// ============================================================

/** 快捷入口最多展示多少条 */
export const QUICK_ACCESS_LIMIT = 25;

// 冷启动（尚无任何点击记录）时的展示优先级分段。
// 用户显式加入的排最前，其次是默认精选，最后是其余链接。
const SEED_OFFSET = 1e6;
const CATEGORY_OFFSET = 2e6;

/**
 * 构建快捷入口的候选池。
 *
 * @param {object} input
 * @param {Array<{name: string, links: Array}>} input.categories 已合并、已过滤的可见分类
 * @param {Array<{name: string, url: string}>} input.customQuickLinks 用户显式加入快捷入口的链接
 * @param {string[]} input.removedCommonLinks 用户已移出快捷入口的 URL
 * @param {Array<{name: string, url: string}>} input.seedLinks 默认精选（config.commonLinks）
 * @returns {Array<{name, url, custom, sourceCategory, order}>}
 */
export function buildQuickAccessPool({
  categories = [],
  customQuickLinks = [],
  removedCommonLinks = [],
  seedLinks = []
} = {}) {
  const removed = new Set(Array.isArray(removedCommonLinks) ? removedCommonLinks : []);

  const explicitIndex = new Map();
  for (const [i, link] of customQuickLinks.entries()) {
    if (link && link.url && !explicitIndex.has(link.url)) explicitIndex.set(link.url, i);
  }

  const seedIndex = new Map();
  for (const [i, link] of seedLinks.entries()) {
    if (link && link.url && !seedIndex.has(link.url)) seedIndex.set(link.url, i);
  }

  // 展示优先级：显式加入 > 默认精选 > 其余（各自保持原始顺序）
  const orderOf = (url, fallbackIndex) => {
    if (explicitIndex.has(url)) return explicitIndex.get(url);
    if (seedIndex.has(url)) return SEED_OFFSET + seedIndex.get(url);
    return CATEGORY_OFFSET + fallbackIndex;
  };

  const pool = [];
  const seen = new Set();

  // sourceCategory 记录链接真正的归属分类，供「拖拽改分类」使用；
  // 为 null 表示它只存在于快捷入口（用户直接加进来的）。
  // sourceIsStock 表示它是「默认分类里的原有条目」——决定把它移出该分类时
  // 是否需要记入已删除列表，与「是否被固定到快捷入口」是两回事，不能混用。
  const add = (link, sourceCategory, sourceIsStock, fallbackIndex, userCreated = false) => {
    if (!link || typeof link.url !== "string" || link.url === "") return;
    if (seen.has(link.url)) return;
    // 显式加入快捷入口的链接优先于「移出」记录，与分类里自建链接不受
    // removedDefaults 影响的做法一致；否则用户重新加入也不会生效。
    const explicit = explicitIndex.has(link.url);
    if (!explicit && removed.has(link.url)) return;
    seen.add(link.url);
    pool.push({
      name: link.name,
      url: link.url,
      // custom 只表示「用户自建」。它来自链接自己的标记，或「用户亲手加入
      // 快捷入口」这一事实——固定一条原有条目不会让它变成自建链接。
      custom: userCreated || link.custom === true,
      sourceCategory,
      sourceIsStock,
      order: orderOf(link.url, fallbackIndex)
    });
  };

  // 先放分类链接，保证去重后保留的是「有归属分类」的那条记录
  let index = 0;
  for (const category of categories) {
    const stockLinks = category.isDefault === true;
    for (const link of category.links || []) {
      add(link, category.name, stockLinks && link.custom !== true, index++);
    }
  }

  // 用户显式加入的（通常也会出现在某个分类里，被上面的去重吸收）
  for (const link of customQuickLinks) add(link, null, false, index++, true);

  // 默认精选里不在任何分类中的兜底项
  for (const link of seedLinks) add(link, null, false, index++);

  return pool;
}

/**
 * 按使用频率排序并截断，返回可直接渲染的链接数组。
 *
 * @param {Array} pool buildQuickAccessPool 的结果
 * @param {object} stats url -> { hourlyFreq, lastClick }（来自 getAllClickStats）
 * @param {number} limit 最多返回条数
 */
export function rankQuickAccess(pool = [], stats = {}, limit = QUICK_ACCESS_LIMIT) {
  const freqOf = (url) => (stats?.[url]?.hourlyFreq || 0);
  const lastOf = (url) => (stats?.[url]?.lastClick || 0);

  return [...pool]
    .sort((a, b) => {
      // 频率高的优先
      const fa = freqOf(a.url);
      const fb = freqOf(b.url);
      if (fa !== fb) return fb - fa;
      // 频率相同则最近点击的优先
      const la = lastOf(a.url);
      const lb = lastOf(b.url);
      if (la !== lb) return lb - la;
      // 都没有使用记录时回落到冷启动顺序
      return a.order - b.order;
    })
    .slice(0, limit)
    .map(({ name, url, custom, sourceCategory, sourceIsStock }) => ({
      name,
      url,
      custom,
      sourceCategory,
      sourceIsStock
    }));
}
