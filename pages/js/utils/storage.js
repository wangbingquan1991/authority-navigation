// 登录口令不再落盘：口令只在登录时提交一次，之后凭服务端会话 Cookie 写入，
// 因此这里不再定义存放口令的 key（历史 key 由 services/adminAuth.js 负责清理）。
export const STORAGE_KEYS = {
  LINKS: "nav_custom_links_v1",
  REMOVED: "nav_removed_defaults",
  REMOVED_COMMON: "nav_removed_common_links_v1",
  CATEGORIES: "nav_custom_categories_v1",
  ORDER: "nav_category_order_v1",
  THEME: "nav-theme"
};

export function getJson(key, defaultValue = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? defaultValue : JSON.parse(raw);
  } catch (e) {
    return defaultValue;
  }
}

export function setJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Ignore quota/security errors.
  }
}

export function removeItem(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    // Ignore.
  }
}
