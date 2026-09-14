// ============================================================
// 数据导入 / 导出
// ============================================================
// 导入采用「增量合并」语义：以链接为最小粒度逐条并入现有数据，
// 同一分类内按 URL 去重，已存在的分类不重建、已存在的链接不重复添加。
//
// 除完整的导出格式（{ version: 2, custom: {...} }）外，还支持最小粒度格式：
//   "https://example.com"
//   { "name": "清华大学", "url": "https://www.tsinghua.edu.cn", "category": "985高校" }
//   [ { "name": "A", "url": "https://a.com", "category": "资料" }, ... ]
//   [ "https://a.com", "https://b.com" ]
// ============================================================

const MAX_NAME = 100;
const MAX_URL = 2048;

/** 补全协议：未写协议时按 https 处理 */
function withProtocol(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : "https://" + s;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}

function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * URL 归一化键，用于去重比较。
 * 只忽略协议、主机大小写与末尾斜杠；端口、路径、查询、锚点保持原样，
 * 以免把同主机不同端口的服务（如 NAS 上的多个面板）误判为重复。
 */
export function urlKey(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    // 用 host（含端口）而非 hostname，避免忽略端口
    return u.host.toLowerCase() + u.pathname.replace(/\/+$/, "") + u.search + u.hash;
  } catch {
    return s.replace(/\/+$/, "");
  }
}

/** 规范化单条链接；名称缺省时取主机名。网址为空时返回空 url，交由合并阶段记为无效 */
function sanitizeEntry(entry) {
  if (entry === null || entry === undefined) return null;
  const source = typeof entry === "string" ? { url: entry } : entry;
  if (typeof source !== "object" || Array.isArray(source)) return null;

  const url = withProtocol(source.url).slice(0, MAX_URL);
  const rawName = String(source.name || "").trim();
  const name = (rawName || hostnameOf(url) || url).slice(0, MAX_NAME);
  const category = String(source.category || "").trim().slice(0, MAX_NAME);
  return { name, url, category, custom: true };
}

/**
 * 识别最小粒度导入格式。
 * 数组中出现无法识别的元素时跳过该元素，而不是整体判为未知格式，
 * 避免一个坏条目导致整个文件静默导入失败。
 * @returns {Array<{name: string, url: string, category: string}>|null}
 *          无法识别时返回 null，交由完整格式解析处理
 */
function parseSiteEntries(raw) {
  const toEntry = (item) => {
    if (typeof item === "string") return { name: "", url: item.trim(), category: "" };
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    return {
      name: String(item.name || item.title || "").trim(),
      url: String(item.url || item.href || "").trim(),
      category: String(item.category || item.categoryName || "").trim()
    };
  };

  if (typeof raw === "string") {
    const one = toEntry(raw);
    return one ? [one] : null;
  }

  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const out = [];
    for (const item of raw) {
      const one = toEntry(item);
      if (one) out.push(one);
    }
    return out.length > 0 ? out : null;
  }

  if (raw && typeof raw === "object") {
    if (raw.url !== undefined || raw.href !== undefined) {
      const one = toEntry(raw);
      return one ? [one] : null;
    }
    if (Array.isArray(raw.sites)) return parseSiteEntries(raw.sites);
  }

  return null;
}

/** 从完整格式的解析结果中摊平成链接列表，便于统一走合并逻辑 */
function entriesFromPayload(result) {
  const entries = [];
  for (const [category, items] of Object.entries(result.customLinks)) {
    for (const item of items) entries.push({ ...item, category, custom: true });
  }
  for (const cat of result.customCategories) {
    for (const item of cat.links) entries.push({ ...item, category: cat.name, custom: true });
  }
  return entries;
}

export function downloadJson(data, filename = "authority-navigation-data.json") {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("未选择文件"));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        resolve(parsed);
      } catch (err) {
        reject(new Error("文件内容不是有效的 JSON"));
      }
    };
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

/**
 * 校验并规范化导入数据，支持完整导出格式与最小粒度的网站格式。
 * 返回值在原有字段之外附带 entries（扁平链接列表），供增量合并使用。
 */
export function validateImportData(data) {
  // 最小粒度格式优先：单条网址 / 单个网站 / 网站数组
  const minimal = parseSiteEntries(data);
  if (minimal) {
    return {
      customLinks: {},
      customCategories: [],
      removedDefaults: [],
      removedCommonLinks: [],
      categoryOrder: [],
      entries: minimal.map(sanitizeEntry).filter(Boolean)
    };
  }

  if (!data || typeof data !== "object") {
    throw new Error("数据格式错误：必须为 JSON 对象");
  }

  // Support v2 export format: { version: 2, custom, merged, config }
  const source = data.version === 2 && data.custom ? data.custom : data;

  const result = {
    customLinks: {},
    customCategories: [],
    removedDefaults: [],
    removedCommonLinks: [],
    categoryOrder: []
  };

  if (source.customLinks !== undefined) {
    if (typeof source.customLinks !== "object" || Array.isArray(source.customLinks)) {
      throw new Error("customLinks 必须是对象");
    }
    for (const [category, items] of Object.entries(source.customLinks)) {
      if (!Array.isArray(items)) continue;
      result.customLinks[category] = items
        .filter(item => item && typeof item === "object")
        .map(item => ({
          name: String(item.name || "").slice(0, MAX_NAME),
          url: String(item.url || "").slice(0, MAX_URL),
          custom: item.custom === true
        }))
        .filter(item => item.name && item.url);
    }
  }

  if (source.customCategories !== undefined) {
    if (!Array.isArray(source.customCategories)) {
      throw new Error("customCategories 必须是数组");
    }
    result.customCategories = source.customCategories
      .filter(cat => cat && typeof cat === "object" && cat.name)
      .map(cat => ({
        name: String(cat.name).slice(0, MAX_NAME),
        icon: String(cat.icon || "").slice(0, 500),
        links: (cat.links || [])
          .filter(item => item && typeof item === "object")
          .map(item => ({
            name: String(item.name || "").slice(0, MAX_NAME),
            url: String(item.url || "").slice(0, MAX_URL),
            custom: item.custom === true
          }))
          .filter(item => item.name && item.url)
      }));
  }

  if (source.removedDefaults !== undefined) {
    if (!Array.isArray(source.removedDefaults)) {
      throw new Error("removedDefaults 必须是数组");
    }
    result.removedDefaults = source.removedDefaults
      .map(url => String(url || "").slice(0, MAX_URL))
      .filter(url => url);
  }

  if (source.removedCommonLinks !== undefined) {
    if (!Array.isArray(source.removedCommonLinks)) {
      throw new Error("removedCommonLinks 必须是数组");
    }
    result.removedCommonLinks = source.removedCommonLinks
      .map(url => String(url || "").slice(0, MAX_URL))
      .filter(url => url);
  }

  if (source.categoryOrder !== undefined) {
    if (!Array.isArray(source.categoryOrder)) {
      throw new Error("categoryOrder 必须是数组");
    }
    result.categoryOrder = source.categoryOrder
      .map(name => String(name || "").slice(0, MAX_NAME))
      .filter(name => name);
  }

  result.entries = entriesFromPayload(result);
  return result;
}

/**
 * 增量合并：把 incoming 逐条并入 existing，链接级别去重。
 *
 * @param {object} existing  现有数据 { customLinks, customCategories, removedDefaults, removedCommonLinks, categoryOrder }
 * @param {object} incoming  validateImportData 的结果
 * @param {object} options
 *   - defaultCategoryNames: Set<string> 默认分类名，命中时链接写入 customLinks
 *   - fallbackCategory:     未指定分类时的归属分类名
 *   - defaultIcon:          新建分类时使用的图标
 * @returns {{customLinks, customCategories, removedDefaults, removedCommonLinks, categoryOrder, stats}}
 */
export function mergeImportData(existing, incoming, options = {}) {
  const defaultNames = options.defaultCategoryNames instanceof Set
    ? options.defaultCategoryNames
    : new Set(options.defaultCategoryNames || []);
  const fallbackCategory = String(options.fallbackCategory || "").trim();
  const defaultIcon = String(options.defaultIcon || "");

  const src = incoming || {};
  const base = existing || {};

  // 现有数据拷贝一份，避免直接改动调用方持有的对象
  const customLinks = {};
  for (const [cat, list] of Object.entries(base.customLinks || {})) {
    customLinks[cat] = Array.isArray(list) ? list.map(item => ({ ...item })) : [];
  }
  const customCategories = (base.customCategories || []).map(cat => ({
    name: String(cat.name),
    icon: String(cat.icon || ""),
    links: (cat.links || []).map(item => ({ ...item }))
  }));

  const categoryByName = new Map(customCategories.map(cat => [cat.name, cat]));
  const incomingIcons = new Map(
    (src.customCategories || []).map(cat => [String(cat.name), String(cat.icon || "")])
  );

  // 各分类已收录的 URL 键，用于去重
  const keySets = new Map();
  const keySetFor = (categoryName) => {
    if (!keySets.has(categoryName)) {
      const set = new Set();
      if (defaultNames.has(categoryName)) {
        for (const item of customLinks[categoryName] || []) set.add(urlKey(item.url));
      } else {
        const cat = categoryByName.get(categoryName);
        for (const item of (cat && cat.links) || []) set.add(urlKey(item.url));
      }
      keySets.set(categoryName, set);
    }
    return keySets.get(categoryName);
  };

  const ensureCategory = (name) => {
    if (categoryByName.has(name)) return categoryByName.get(name);
    const cat = { name, icon: incomingIcons.get(name) || defaultIcon, links: [] };
    customCategories.push(cat);
    categoryByName.set(name, cat);
    return cat;
  };

  const stats = { addedLinks: 0, addedCategories: 0, skippedLinks: 0, invalidLinks: 0, byCategory: {} };
  const categoryCountBefore = customCategories.length;

  const resolveTarget = (rawCategory) => {
    const name = String(rawCategory || "").trim() || fallbackCategory;
    if (!name) return null;
    if (defaultNames.has(name)) {
      if (!customLinks[name]) customLinks[name] = [];
      return { key: name, bucket: customLinks[name] };
    }
    const cat = ensureCategory(name);
    return { key: name, bucket: cat.links };
  };

  const entries = Array.isArray(src.entries) ? src.entries : [];
  for (const entry of entries) {
    const normalized = sanitizeEntry(entry);
    if (!normalized || !isHttpUrl(normalized.url)) {
      stats.invalidLinks++;
      continue;
    }

    const target = resolveTarget(normalized.category);
    if (!target) {
      stats.invalidLinks++;
      continue;
    }

    const keys = keySetFor(target.key);
    const key = urlKey(normalized.url);
    if (keys.has(key)) {
      stats.skippedLinks++;
      continue;
    }

    target.bucket.push({ name: normalized.name, url: normalized.url, custom: true });
    keys.add(key);
    stats.addedLinks++;
    stats.byCategory[target.key] = (stats.byCategory[target.key] || 0) + 1;
  }

  stats.addedCategories = customCategories.length - categoryCountBefore;

  // 删除记录取并集：导入文件里标记的删除同样生效，且不影响现有记录
  const union = (a, b) => {
    const out = [];
    const seen = new Set();
    for (const value of [...(a || []), ...(b || [])]) {
      const s = String(value || "");
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  };

  // 分类顺序：保留现有顺序，再补入新出现的分类
  const categoryOrder = [];
  const ordered = new Set();
  const allNames = [...Object.keys(customLinks), ...customCategories.map(cat => cat.name)];
  for (const name of [...(base.categoryOrder || []), ...(src.categoryOrder || [])]) {
    const s = String(name || "");
    if (!s || ordered.has(s)) continue;
    ordered.add(s);
    categoryOrder.push(s);
  }
  for (const name of allNames) {
    if (ordered.has(name)) continue;
    ordered.add(name);
    categoryOrder.push(name);
  }

  return {
    customLinks,
    customCategories,
    removedDefaults: union(base.removedDefaults, src.removedDefaults),
    removedCommonLinks: union(base.removedCommonLinks, src.removedCommonLinks),
    categoryOrder,
    stats
  };
}
