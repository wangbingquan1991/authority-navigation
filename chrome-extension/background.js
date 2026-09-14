// ============================================================
// Authority Navigation - Chrome Extension (Service Worker)
// ============================================================
// 主要负责处理来自 popup 的消息（如果后续需要），
// 以及在浏览器工具栏图标上显示角标提示。

// 安装时初始化默认设置
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // 首次安装，设置默认存储
    await chrome.storage.local.set({
      an_serverUrl: '',
      an_adminToken: ''
    });
  }
});

// 监听标签页更新，为匹配的页面更新图标/角标（可扩展）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 可以在这里根据页面特征决定是否显示特殊图标
  // 例如：如果当前页面已经在导航中，显示不同图标
});

// 图标点击事件（如果不设置 default_popup，则走这里）
// 但我们设置了 default_popup，所以这个不会触发
chrome.action.onClicked.addListener(async (tab) => {
  // 留作将来扩展
});

// ============================================================
// 记录跳转前的完整地址
// ============================================================
// 部分站点（例如 dsh web）会把 ?token=xxx 当作一次性凭证：
// 服务端收到后立刻 302 跳到不带参数的地址，凭证随之从地址栏消失。
// 等用户点开插件时，location.href 里已经没有 token 了，插件无从获取。
// 因此在请求发出阶段就把本次导航的起始地址记下来，供 popup 取用。

const NAV_START_PREFIX = 'an_nav_start_';
const MAIN_FRAME_FILTER = { urls: ['<all_urls>'], types: ['main_frame'] };

// tabId -> 本次导航链的第一个地址（内存缓存，减少 storage 读写）
const navChainStart = new Map();

function storageKey(tabId) {
  return NAV_START_PREFIX + tabId;
}

function sameOriginAndPath(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch (err) {
    return false;
  }
}

async function persistNavStart(tabId, url) {
  if (tabId < 0 || !url) return;
  try {
    await chrome.storage.session.set({ [storageKey(tabId)]: url });
  } catch (err) {
    // storage.session 在极旧版本不可用，失败不影响主流程
    console.warn('[AN] persist nav start failed:', err.message);
  }
}

async function clearNavStart(tabId) {
  try {
    await chrome.storage.session.remove(storageKey(tabId));
  } catch (err) {
    // 忽略
  }
}

// 请求发出时记录链首地址（只记第一个，后续跳转目标不覆盖）
chrome.webRequest.onBeforeRequest.addListener((details) => {
  if (details.tabId < 0) return;
  if (!navChainStart.has(details.tabId)) {
    navChainStart.set(details.tabId, details.url);
  }
}, MAIN_FRAME_FILTER);

// 导航结束：若最终地址与链首不同，说明中途发生过跳转（参数可能被丢弃），
// 此时保留链首地址。若没有跳转，则仅在已记录地址与当前页面不同源或不同路径时
// 才清理 —— 这样用户刷新页面不会把刚记下的 token 地址弄丢。
chrome.webRequest.onCompleted.addListener(async (details) => {
  if (details.tabId < 0) return;
  const start = navChainStart.get(details.tabId);
  navChainStart.delete(details.tabId);

  if (start && start !== details.url) {
    await persistNavStart(details.tabId, start);
    return;
  }

  try {
    const key = storageKey(details.tabId);
    const res = await chrome.storage.session.get(key);
    const saved = res[key];
    if (saved && !sameOriginAndPath(saved, details.url)) {
      await clearNavStart(details.tabId);
    }
  } catch (err) {
    // 忽略：读不到就保持现状
  }
}, MAIN_FRAME_FILTER);

// 导航失败时同样清理，避免把上一次的结果误用到新页面
chrome.webRequest.onErrorOccurred.addListener((details) => {
  if (details.tabId < 0) return;
  navChainStart.delete(details.tabId);
  clearNavStart(details.tabId);
}, MAIN_FRAME_FILTER);

chrome.tabs.onRemoved.addListener((tabId) => {
  navChainStart.delete(tabId);
  clearNavStart(tabId);
});
