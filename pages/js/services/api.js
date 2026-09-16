import { STORAGE_KEYS, getJson, setJson } from "../utils/storage.js";

const API_PROBE_TIMEOUT_MS = 800;

// apiMode 只在「确认服务端存在」时缓存为 true。
// 之前把探测失败也缓存成 false 会导致永久降级到 localStorage 模式：
// 一次网络抖动、或未登录时的非 200 响应，都会让前端此后一直读不到、
// 也写不进服务端数据，是「数据看起来凭空消失」的成因之一。现在临时故障不缓存结论。
let apiMode = null;
let apiModeProbe = null;

// 是否成功从服务端读到过数据。未读到即代表内存状态不可信，
// 此时绝不允许整库覆盖写（会把服务端未知的既有数据一起冲掉）。
let remoteDataLoaded = false;

let remoteDataCache = null;
let defaultConfigCache = null;

const EMPTY_DATA = () => ({
  customLinks: {},
  customCategories: [],
  removedDefaults: [],
  removedCommonLinks: [],
  categoryOrder: []
});

async function fetchWithTimeout(url, ms, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, credentials: "same-origin", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function detectApiMode() {
  // true：已确认有后端；false：已确认无后端（纯静态部署）。
  // 两者都是确定结论，直接短路；只有「临时故障」才不缓存、留待下次重试。
  if (apiMode !== null) return apiMode;
  if (apiModeProbe) return apiModeProbe;

  apiModeProbe = (async () => {
    try {
      const res = await fetchWithTimeout("/api/data", API_PROBE_TIMEOUT_MS);
      if (res.ok) {
        remoteDataCache = await res.json();
        remoteDataLoaded = true;
        apiMode = true;
        return true;
      }
      // 服务端确实在（因未登录 / 限流而拒绝本次读取）——仍属 API 模式。
      // 若这里判定为 false，登录后前端会一直停留在空的本地模式。
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        apiMode = true;
        return true;
      }
      // 5xx 多为服务启动中或网关抖动，属临时故障：不缓存结论，下次重试
      if (res.status >= 500) return false;
      // 其余（如纯静态部署下的 404）判定为无后端，走 localStorage 模式
      apiMode = false;
      return false;
    } catch (e) {
      // 网络异常 / 超时同样不缓存，避免一次抖动把前端永久降级为空本地模式
      return false;
    } finally {
      apiModeProbe = null;
    }
  })();

  return apiModeProbe;
}

/**
 * 主动重新拉取服务端数据并刷新缓存。
 * @returns {Promise<boolean>} 是否读取成功
 */
async function refreshRemoteData() {
  try {
    const res = await fetchWithTimeout("/api/data", API_PROBE_TIMEOUT_MS * 3);
    if (!res.ok) return false;
    remoteDataCache = await res.json();
    remoteDataLoaded = true;
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 判断一份数据是否「完全为空」。
 * 在整库替换语义下，空数据等价于清空全库，是空写保护的判据。
 * @param {object} data
 * @returns {boolean}
 */
export function isEmptyDataState(data) {
  if (!data || typeof data !== "object") return true;
  const linkGroups = data.customLinks && typeof data.customLinks === "object"
    ? Object.keys(data.customLinks).length
    : 0;
  const count = (value) => (Array.isArray(value) ? value.length : 0);
  return (
    linkGroups +
    count(data.customCategories) +
    count(data.removedDefaults) +
    count(data.removedCommonLinks) +
    count(data.categoryOrder) === 0
  );
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

/**
 * 深拷贝一份数据，避免调用方直接改写缓存。
 * 各 save* 封装是「读-改-写」模式：若把缓存对象本身交出去，
 * 写入失败时缓存已被改脏，后续展示与保存都会基于错误状态。
 * @param {object} data
 * @returns {object}
 */
function cloneData(data) {
  return {
    customLinks: JSON.parse(JSON.stringify(data.customLinks || {})),
    customCategories: JSON.parse(JSON.stringify(data.customCategories || [])),
    removedDefaults: [...(data.removedDefaults || [])],
    removedCommonLinks: [...(data.removedCommonLinks || [])],
    categoryOrder: [...(data.categoryOrder || [])]
  };
}

export async function loadAllData() {
  if (await detectApiMode()) {
    // 服务端存在但尚未成功读到数据时补一次读取，
    // 否则会把「没读到」当成「没有数据」，进而渲染空页面并可能回写空状态。
    if (!remoteDataCache) {
      await refreshRemoteData();
    }
    return remoteDataCache ? cloneData(remoteDataCache) : EMPTY_DATA();
  }
  return {
    customLinks: getJson(STORAGE_KEYS.LINKS, {}),
    customCategories: getJson(STORAGE_KEYS.CATEGORIES, []),
    removedDefaults: getJson(STORAGE_KEYS.REMOVED, []),
    removedCommonLinks: getJson(STORAGE_KEYS.REMOVED_COMMON, []),
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

// 未登录（或会话过期）时广播，由 app.js 统一弹出登录入口
export const UNAUTHORIZED_EVENT = "nav:unauthorized";

// 服务端数据未读到时的统一拒绝提示
const UNVERIFIED_WRITE_MESSAGE =
  "尚未成功读取服务器数据，为避免覆盖已保存内容，本次修改未保存。请刷新页面后重试。";

function refuseUnverifiedWrite() {
  if (typeof window !== "undefined" && typeof window.alert === "function") {
    window.alert(UNVERIFIED_WRITE_MESSAGE);
  }
}

/**
 * POST /api/data，凭登录会话写入（会话 Cookie 由浏览器自动携带，不再传口令）。
 * 抛出 Error 表示保存未成功，由调用方提示用户。
 * @param {object} data
 * @param {{ allowEmpty?: boolean }} [options] allowEmpty=true 表示本次确有清空意图
 * @returns {Promise<void>}
 */
async function postData(data, options = {}) {
  const payload = options.allowEmpty === true ? { ...data, allowEmpty: true } : data;

  let res;
  try {
    res = await fetch("/api/data", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    throw new Error("无法连接服务器，本次保存未成功，请稍后重试。");
  }

  if (res.status === 401) {
    // 会话缺失或已过期：提示重新登录，而不是再次索要口令
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    const err = new Error("登录状态已失效，请重新登录后重试。");
    err.unauthorized = true;
    throw err;
  }
  if (res.status === 409) {
    // 服务端拒绝了会清空既有数据的写入
    const err = new Error("本次保存会清空服务器上已有的数据，已被拒绝。");
    err.emptyOverwrite = true;
    throw err;
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

export async function saveAllData(data, options = {}) {
  if (await detectApiMode()) {
    // 空写保护：整库替换语义下，提交空数据就等于清空全库。
    // 前端在「内存状态为空」时会自然地发出这种请求，必须在源头拦掉。
    if (isEmptyDataState(data) && options.allowEmpty !== true) {
      // 服务端数据尚未读到：内存状态不可信，直接拒绝而不向用户确认
      if (!remoteDataLoaded) {
        refuseUnverifiedWrite();
        return;
      }
      // 数据可信时，空状态也可能是用户确实删空了，交由用户确认
      const ok = typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm("本次保存会清空全部自定义分类与链接，确定继续吗？")
        : false;
      if (!ok) return;
      options = { ...options, allowEmpty: true };
    }

    // 数据非空但从未成功读到服务端状态时同样拒绝覆盖：
    // 此时内存状态可能只是「基于空壳」的残缺快照，覆盖会把既有数据冲掉。
    if (!remoteDataLoaded && options.allowEmpty !== true) {
      refuseUnverifiedWrite();
      return;
    }

    try {
      await postData(data, options);
      remoteDataCache = cloneData(data);
      remoteDataLoaded = true;
    } catch (e) {
      console.error("Failed to save data to API", e);
      // 登录失效与空写拦截已各自给出提示，这里不再重复弹窗
      if (!e.unauthorized && !e.emptyOverwrite) alert(e.message);
    }
    return;
  }
  setJson(STORAGE_KEYS.LINKS, data.customLinks);
  setJson(STORAGE_KEYS.CATEGORIES, data.customCategories);
  setJson(STORAGE_KEYS.REMOVED, data.removedDefaults);
  setJson(STORAGE_KEYS.REMOVED_COMMON, data.removedCommonLinks || []);
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

export async function loadRemovedCommonLinks() {
  const data = await loadAllData();
  return data.removedCommonLinks || [];
}

export async function saveRemovedCommonLinks(arr) {
  const data = await loadAllData();
  data.removedCommonLinks = arr;
  await saveAllData(data);
}

export async function addRemovedCommonLink(url) {
  const removed = await loadRemovedCommonLinks();
  if (!removed.includes(url)) {
    removed.push(url);
    await saveRemovedCommonLinks(removed);
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
