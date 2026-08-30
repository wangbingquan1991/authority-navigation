import { STORAGE_KEYS, getJson, setJson } from "../utils/storage.js";
import {
  getCachedAdminToken,
  clearAdminToken,
  promptForAdminToken
} from "./adminAuth.js";

let apiMode = null;
let remoteDataCache = null;
let defaultConfigCache = null;

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

export async function loadDefaultConfig() {
  if (defaultConfigCache) return defaultConfigCache;
  if (await detectApiMode()) {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        defaultConfigCache = await res.json();
        return defaultConfigCache;
      }
    } catch (e) {
      console.error("Failed to load default config from API", e);
    }
  }
  // Fallback for static file mode
  try {
    const res = await fetch("/config/default-sites.json");
    if (res.ok) {
      defaultConfigCache = await res.json();
      return defaultConfigCache;
    }
  } catch (e) {
    console.error("Failed to load default config from static file", e);
  }
  return { categories: {}, defaultCategoryIcon: "M12 2v20 M2 12h20" };
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

async function readErrorDetail(res) {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch (e) {
    // 非 JSON 响应体，忽略。
  }
  return "";
}

/**
 * POST /api/data，附带 x-admin-token 请求头。
 * 401：清除缓存 token，重新 prompt，重试一次（有且仅有一次，避免循环弹窗）。
 * 抛出 Error 表示保存未成功，由调用方提示用户。
 * @param {object} data
 * @returns {Promise<void>}
 */
async function postWithAdminToken(data) {
  let token = getCachedAdminToken();
  if (!token) {
    token = promptForAdminToken();
    if (!token) {
      throw new Error("未输入管理员口令，本次保存已取消。");
    }
  }

  const doPost = () => fetch("/api/data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": token
    },
    body: JSON.stringify(data)
  });

  let res = await doPost();
  if (res.status === 401) {
    clearAdminToken();
    token = promptForAdminToken({ rejected: true });
    if (!token) {
      throw new Error("未输入管理员口令，本次保存已取消。");
    }
    res = await doPost();
    if (res.status === 401) {
      clearAdminToken();
      throw new Error("管理员口令不正确，数据未保存。");
    }
  }
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After"), 10);
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? `请 ${retryAfter} 秒后重试。`
      : "请稍后重试。";
    throw new Error(`保存过于频繁，已触发速率限制，${wait}`);
  }
  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw new Error(`保存失败（HTTP ${res.status}）${detail ? "：" + detail : ""}`);
  }
}

export async function saveAllData(data) {
  if (await detectApiMode()) {
    try {
      await postWithAdminToken(data);
      remoteDataCache = data;
    } catch (e) {
      console.error("Failed to save data to API", e);
      alert(e.message);
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

export async function addCategory(name, firstLink, defaultIcon) {
  const cats = await loadCustomCategories();
  cats.push({
    name,
    icon: defaultIcon || "M12 2v20 M2 12h20",
    links: [firstLink]
  });
  await saveCustomCategories(cats);
}

export async function deleteCategory(name) {
  const cats = (await loadCustomCategories()).filter(c => c.name !== name);
  await saveCustomCategories(cats);
}
