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
