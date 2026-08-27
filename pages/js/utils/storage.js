export const STORAGE_KEYS = {
  LINKS: "nav_custom_links_v1",
  REMOVED: "nav_removed_defaults",
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
