// ============================================================
// Authority Navigation - Content Script
// 提取当前页面的丰富元数据，通过消息传递返回给 popup
// ============================================================

(function () {
  // 防止重复注入
  if (window.__AN_CONTENT_LOADED__) return;
  window.__AN_CONTENT_LOADED__ = true;

  /**
   * 提取页面元数据
   * @returns {{
   *   title: string,
   *   url: string,
   *   favicon: string,
   *   description: string,
   *   selectedText: string,
   *   siteName: string
   * }}
   */
  function extractPageMetadata() {
    // 1. 标题 - 优先用 og:title 或 twitter:title
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    const twitterTitle = document.querySelector('meta[name="twitter:title"]')?.content;
    const title = ogTitle || twitterTitle || document.title || '';

    // 2. URL - 使用当前页面的完整 URL（保留所有 query 参数和 hash）
    // 注意：不使用 canonical 链接，因为 canonical 常用于 SEO 规范化，
    // 会去除 token、会话 ID 等动态参数，导致导航链接失效
    const url = location.href;

    // 3. Favicon
    let favicon = '';
    const iconSelectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
      'link[rel="apple-touch-icon-precomposed"]'
    ];
    for (const sel of iconSelectors) {
      const el = document.querySelector(sel);
      if (el && el.href) { favicon = el.href; break; }
    }
    // 如果没找到，使用默认 favicon
    if (!favicon) {
      favicon = new URL('/favicon.ico', location.origin).href;
    }

    // 4. 描述
    const ogDesc = document.querySelector('meta[property="og:description"]')?.content;
    const twitterDesc = document.querySelector('meta[name="twitter:description"]')?.content;
    const metaDesc = document.querySelector('meta[name="description"]')?.content;
    const description = (ogDesc || twitterDesc || metaDesc || '').trim();

    // 5. 选中文本
    const selectedText = (window.getSelection()?.toString() || '').trim();

    // 6. 站点名称
    const siteName = document.querySelector('meta[property="og:site_name"]')?.content || location.hostname;

    return {
      title: title.trim(),
      url,
      favicon,
      description: description.slice(0, 300),
      selectedText: selectedText.slice(0, 500),
      siteName
    };
  }

  // 监听来自 popup 的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.type === 'GET_PAGE_METADATA') {
      try {
        const metadata = extractPageMetadata();
        sendResponse({ success: true, data: metadata });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true; // 保持 sendResponse 异步
    }
    if (request && request.type === 'PING') {
      sendResponse({ pong: true });
      return true;
    }
  });
})();
