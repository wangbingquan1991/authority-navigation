import { STORAGE_KEYS, getJson, setJson } from "../utils/storage.js";
import { DEFAULT_CATEGORY_ICON } from "../data/defaultCategories.js";

let apiMode = null;
let remoteDataCache = null;

export async function detectApiMode() {
  if (apiMode !== null) return apiMode;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    const res = await fetch("/api/data", { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      remoteDataCache = await res.json();
      apiMode = true;
    } else {
      apiMode = false;
    }
  } catch (e) {
    apiMode = false;
  }
  return apiMode;
}

export async function loadAllData() {
  if (await detectApiMode()) {
    return remoteDataCache || { customLinks: {}, customCategories: [], removedDefaults: [], categoryOrder: [] };
  }
  return {
    customLinks: getJson(STORAGE_KEYS.LINKS, {}),
    customCategories: getJson(STORAGE_KEYS.CATEGORIES, []),
    removedDefaults: getJson(STORAGE_KEYS.REMOVED, []),
    categoryOrder: getJson(STORAGE_KEYS.ORDER, [])
  };
}

export async function saveAllData(data) {
  if (await detectApiMode()) {
    remoteDataCache = data;
    try {
      await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
    } catch (e) {
      console.error("Failed to save data to API", e);
    }
    return;
  }
  setJson(STORAGE_KEYS.LINKS, data.customLinks);
  setJson(STORAGE_KEYS.CATEGORIES, data.customCategories);
  setJson(STORAGE_KEYS.REMOVED, data.removedDefaults);
  setJson(STORAGE_KEYS.ORDER, data.categoryOrder || []);
}

export async function loadCustomLinks() {
  const data = await loadAllData();
  return data.customLinks || {};
}

export async function saveCustomLinks(obj) {
  const data = await loadAllData();
  data.customLinks = obj;
  await saveAllData(data);
}

export async function loadCustomCategories() {
  const data = await loadAllData();
  return data.customCategories || [];
}

export async function saveCustomCategories(arr) {
  const data = await loadAllData();
  data.customCategories = arr;
  await saveAllData(data);
}

export async function loadRemovedDefaults() {
  const data = await loadAllData();
  return data.removedDefaults || [];
}

export async function saveRemovedDefaults(arr) {
  const data = await loadAllData();
  data.removedDefaults = arr;
  await saveAllData(data);
}

export async function loadCategoryOrder() {
  const data = await loadAllData();
  return data.categoryOrder || [];
}

export async function saveCategoryOrder(arr) {
  const data = await loadAllData();
  data.categoryOrder = arr;
  await saveAllData(data);
}

export async function addCustomLink(category, item) {
  const customLinks = await loadCustomLinks();
  if (!customLinks[category]) customLinks[category] = [];
  if (!customLinks[category].some(existing => existing.url === item.url)) {
    customLinks[category].push(item);
    await saveCustomLinks(customLinks);
  }
}

export async function removeCustomLink(category, url) {
  const customLinks = await loadCustomLinks();
  if (customLinks[category]) {
    customLinks[category] = customLinks[category].filter(item => item.url !== url);
    if (customLinks[category].length === 0) delete customLinks[category];
    await saveCustomLinks(customLinks);
  }
}

export async function addDefaultRemoved(url) {
  const removed = await loadRemovedDefaults();
  if (!removed.includes(url)) {
    removed.push(url);
    await saveRemovedDefaults(removed);
  }
}

export async function addCategory(name, firstLink) {
  const cats = await loadCustomCategories();
  cats.push({
    name,
    icon: DEFAULT_CATEGORY_ICON,
    links: [firstLink]
  });
  await saveCustomCategories(cats);
}

export async function deleteCategory(name) {
  const cats = (await loadCustomCategories()).filter(c => c.name !== name);
  await saveCustomCategories(cats);
}
