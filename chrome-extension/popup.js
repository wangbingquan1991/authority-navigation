// ============================================================
// Authority Navigation - Chrome Extension (Popup Script)
// ============================================================

const STORAGE_KEYS = {
  SERVER_URL: 'an_serverUrl',
  ADMIN_TOKEN: 'an_adminToken'
};

const state = {
  settings: { serverUrl: '', adminToken: '' },
  categories: [],       // 合并后的分类列表（default + custom）
  categoriesMap: {},    // 快速查找: { categoryName: { icon, isDefault, links } }
  dataCache: null,      // 从服务器 GET /api/data 得到的完整数据
  defaultConfig: null,  // 从服务器 GET /api/config 得到的默认分类
  currentPageUrl: ''    // 当前标签页地址，用于「恢复」按钮
};

// ------------------------------------------------------------
// Utils
// ------------------------------------------------------------

function $(id) { return document.getElementById(id); }

/**
 * 判断是否为本地/内网地址（这类地址默认使用 http 而非 https）
 */
function isLocalHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '127.0.0.1' || h === '::1' || h === '[::1]') return true;
  // 私有网段
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  // 无点主机名（如 nas、devbox）或 .local 内网域名
  if (!h.includes('.') || h.endsWith('.local')) return true;
  return false;
}

/**
 * 规范化用户输入的网址：
 * - 自动补全协议（本地/内网地址补 http，其余补 https）
 * - 保留 query 参数与 hash
 */
function normalizeUrl(url) {
  url = String(url || '').trim();
  if (!url) return url;

  // 已带协议，直接返回
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;

  // 形如 localhost:3000 / 127.0.0.1:3080/path 的输入
  const hostPart = url.split('/')[0].split('?')[0].split('#')[0];
  const hostname = hostPart.split(':')[0];
  const scheme = isLocalHostname(hostname) ? 'http://' : 'https://';
  return scheme + url;
}

function isValidUrl(str) {
  if (typeof str !== 'string' || str.length === 0 || str.length > 2048) return false;
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function showStatus(type, message) {
  const el = $('status');
  el.className = 'status ' + type;
  el.textContent = message;
  el.classList.remove('hidden');
  if (type !== 'loading') {
    setTimeout(() => {
      el.classList.add('hidden');
    }, 3000);
  }
}

// ------------------------------------------------------------
// Settings Load / Save
// ------------------------------------------------------------

async function loadSettings() {
  const result = await chrome.storage.local.get([STORAGE_KEYS.SERVER_URL, STORAGE_KEYS.ADMIN_TOKEN]);
  state.settings.serverUrl = result[STORAGE_KEYS.SERVER_URL] || '';
  state.settings.adminToken = result[STORAGE_KEYS.ADMIN_TOKEN] || '';
  $('serverUrl').value = state.settings.serverUrl;
  $('adminToken').value = state.settings.adminToken;
}

async function saveSettings() {
  state.settings.serverUrl = $('serverUrl').value.trim().replace(/\/+$/, '');
  state.settings.adminToken = $('adminToken').value;
  await chrome.storage.local.set({
    [STORAGE_KEYS.SERVER_URL]: state.settings.serverUrl,
    [STORAGE_KEYS.ADMIN_TOKEN]: state.settings.adminToken
  });
}

// ------------------------------------------------------------
// API calls
// ------------------------------------------------------------

async function apiGetData() {
  const url = state.settings.serverUrl + '/api/data';
  const res = await fetch(url);
  if (!res.ok) throw new Error('GET /api/data 失败: HTTP ' + res.status);
  return await res.json();
}

async function apiGetConfig() {
  const url = state.settings.serverUrl + '/api/config';
  const res = await fetch(url);
  if (res.ok) return await res.json();
  // 如果没有 /api/config，使用空默认配置
  return { categories: {}, defaultCategoryIcon: 'M12 2v20 M2 12h20' };
}

async function apiPostData(data) {
  const url = state.settings.serverUrl + '/api/data';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': state.settings.adminToken
    },
    body: JSON.stringify(data)
  });

  if (res.status === 401) {
    throw new Error('管理员口令不正确 (401 Unauthorized)');
  }
  if (res.status === 429) {
    throw new Error('请求过于频繁 (429 Too Many Requests)');
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch {}
    throw new Error('保存失败 (HTTP ' + res.status + ')' + (detail ? '：' + detail : ''));
  }
  return await res.json();
}

async function testConnection() {
  const statusEl = $('connectionStatus');
  try {
    statusEl.className = 'connection-status';
    statusEl.textContent = '测试中...';

    const serverUrl = $('serverUrl').value.trim().replace(/\/+$/, '');
    if (!serverUrl) throw new Error('请先填写导航页面地址');
    if (!isValidUrl(serverUrl)) throw new Error('地址格式不正确');

    // 先测试 health 端点
    const healthRes = await fetch(serverUrl + '/health');
    if (!healthRes.ok) throw new Error('服务器未响应健康检查');

    // 再测试 /api/data 是否可访问
    const dataRes = await fetch(serverUrl + '/api/data');
    if (!dataRes.ok) throw new Error('/api/data 不可访问');

    // 测试 POST（不带 token，应该返回 401，但不是网络错误）
    const testRes = await fetch(serverUrl + '/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': 'wrong-token-for-test' },
      body: JSON.stringify({ customLinks: {}, customCategories: [], removedDefaults: [], categoryOrder: [] })
    });
    if (testRes.status !== 401) throw new Error('写端点行为异常');

    statusEl.className = 'connection-status success';
    statusEl.textContent = '✓ 连接成功';
  } catch (err) {
    statusEl.className = 'connection-status error';
    statusEl.textContent = '✗ ' + err.message;
  }
}

// ------------------------------------------------------------
// Category loading / merging
// ------------------------------------------------------------

async function loadCategories() {
  try {
    state.defaultConfig = await apiGetConfig();
    state.dataCache = await apiGetData();
    mergeCategories();
    populateCategorySelect();
  } catch (err) {
    console.error('加载分类失败:', err);
    showStatus('error', '加载分类失败: ' + err.message + '。请检查设置。');
  }
}

function mergeCategories() {
  const merged = {};
  const defaults = state.defaultConfig.categories || {};
  const data = state.dataCache || {};
  const customLinks = data.customLinks || {};
  const customCategories = data.customCategories || [];
  const categoryOrder = data.categoryOrder || [];
  const removedDefaults = data.removedDefaults || [];

  // 默认分类 + 附加自定义链接
  for (const [cat, meta] of Object.entries(defaults)) {
    merged[cat] = {
      name: cat,
      icon: meta.icon,
      links: meta.links ? meta.links.map(l => ({ ...l })) : [],
      isDefault: true,
      isCustomCategory: false
    };
    const extras = customLinks[cat] || [];
    for (const item of extras) {
      if (!merged[cat].links.some(l => l.url === item.url)) {
        merged[cat].links.push({ ...item, custom: true });
      }
    }
    // 移除被标记删除的默认链接
    merged[cat].links = merged[cat].links.filter(l => !removedDefaults.includes(l.url));
  }

  // 自定义分类
  for (const cat of customCategories) {
    merged[cat.name] = {
      name: cat.name,
      icon: cat.icon || state.defaultConfig.defaultCategoryIcon || '',
      links: cat.links ? cat.links.map(l => ({ ...l })) : [],
      isDefault: false,
      isCustomCategory: true
    };
  }

  // 排序
  const known = new Set(Object.keys(merged));
  const ordered = [];
  for (const cat of categoryOrder) {
    if (known.has(cat)) ordered.push(cat);
  }
  for (const cat of Object.keys(merged)) {
    if (!ordered.includes(cat)) ordered.push(cat);
  }

  state.categories = ordered;
  state.categoriesMap = merged;
}

function populateCategorySelect() {
  const select = $('categorySelect');
  select.innerHTML = '';

  if (state.categories.length === 0) {
    select.innerHTML = '<option value="">（暂无分类，点击 + 新建）</option>';
    return;
  }

  for (const cat of state.categories) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  }
}

// ------------------------------------------------------------
// Add link to navigation
// ------------------------------------------------------------

async function addToNavigation() {
  const name = $('pageTitle').value.trim();
  const url = normalizeUrl($('pageUrl').value.trim());
  let categoryName = $('categorySelect').value;
  const newCategoryName = $('newCategoryName').value.trim();
  const creatingNew = !categoryName && newCategoryName;

  // 验证
  if (!name) { showStatus('error', '请填写页面名称'); return; }
  if (!isValidUrl(url)) { showStatus('error', '网址格式不正确'); return; }
  if (!creatingNew && !categoryName) {
    showStatus('error', '请选择目标分类，或点击 + 新建分类');
    return;
  }
  if (!state.settings.serverUrl) {
    showStatus('error', '请先在设置中配置导航页面地址');
    return;
  }
  if (!state.settings.adminToken) {
    showStatus('error', '请先在设置中配置管理员口令');
    return;
  }

  showStatus('loading', '正在添加到 "' + categoryName + '" ...');

  try {
    // 1. 获取最新数据（用于去重检查）
    const currentData = await apiGetData();

    // 2. 前置校验（基于最新数据）
    if (creatingNew) {
      categoryName = newCategoryName;
      // 检查分类名称冲突（从 currentData 检查）
      const customCatNames = (currentData.customCategories || []).map(c => c.name);
      const defaultCatNames = Object.keys(state.defaultConfig.categories || {});
      if (customCatNames.includes(categoryName) || defaultCatNames.includes(categoryName)) {
        showStatus('error', '分类 "' + categoryName + '" 已存在');
        return;
      }
    } else {
      // 检查 URL 是否已存在于目标分类（从 currentData 检查，包括 customLinks 和 customCategories）
      const catInfo = state.categoriesMap[categoryName];
      const linksFromData = catInfo.isCustomCategory
        ? ((currentData.customCategories || []).find(c => c.name === categoryName)?.links || [])
        : (currentData.customLinks?.[categoryName] || []);
      const allUrls = [...linksFromData.map(l => l.url)];
      // 默认分类的链接也包含在 catInfo 中（但默认链接不应通过 URL 去重拦截）
      if (allUrls.includes(url)) {
        showStatus('error', '该网址已存在于 "' + categoryName + '"');
        return;
      }
    }

    // 3. 添加新链接
    const item = { name, url, custom: true };
    let added = false;

    if (creatingNew) {
      // 新建自定义分类
      const customCategories = currentData.customCategories || [];
      customCategories.push({
        name: categoryName,
        icon: 'M12 2v20 M2 12h20',
        links: [item]
      });
      currentData.customCategories = customCategories;
      added = true;
    } else {
      const catInfo = state.categoriesMap[categoryName];

      if (catInfo.isCustomCategory) {
        // 自定义分类
        const customCategories = currentData.customCategories || [];
        const cat = customCategories.find(c => c.name === categoryName);
        if (cat) {
          cat.links = cat.links || [];
          cat.links.push(item);
          currentData.customCategories = customCategories;
          added = true;
        }
      } else {
        // 默认分类，放入 customLinks
        currentData.customLinks = currentData.customLinks || {};
        currentData.customLinks[categoryName] = currentData.customLinks[categoryName] || [];
        currentData.customLinks[categoryName].push(item);
        added = true;
      }
    }

    if (!added) {
      throw new Error('未能定位到目标分类');
    }

    // 3. 写回服务器
    await apiPostData(currentData);

    showStatus('success', '✓ 已添加到 "' + categoryName + '"');

    // 重置表单
    $('newCategoryName').value = '';
    $('newCategoryPanel').classList.add('hidden');
    $('pageTitle').value = '';
    $('pageUrl').value = state.currentPageUrl;
    updateResetUrlState();

    // 重新加载分类
    await loadCategories();

  } catch (err) {
    console.error('添加失败:', err);
    showStatus('error', '添加失败: ' + err.message);
  }
}

// ------------------------------------------------------------
// Content Script Communication
// ------------------------------------------------------------

/**
 * 通过 content script 获取丰富的页面元数据
 * 优先使用消息传递，如果失败则降级为 chrome.tabs.query
 */
async function getPageMetadata() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { title: '', url: '', favicon: '', description: '', selectedText: '', siteName: '' };
  }

  // 不支持的 URL 协议（chrome://, chrome-extension://, about:, file: 等）
  const unsupportedProtocols = ['chrome://', 'chrome-extension://', 'about:', 'file://', 'edge://', 'brave://', 'devtools://'];
  const isUnsupported = unsupportedProtocols.some(p => (tab.url || '').startsWith(p));

  // 尝试通过 content script 获取元数据
  if (!isUnsupported) {
    try {
      const metadata = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_METADATA' });
      if (metadata && metadata.success && metadata.data) {
        return metadata.data;
      }
    } catch (err) {
      // content script 可能还没注入完成，降级处理
      console.warn('Content script message failed, using fallback:', err.message);
    }
  }

  // 降级: 使用 tabs API
  return {
    title: tab.title || '',
    url: tab.url || '',
    favicon: '',
    description: '',
    selectedText: '',
    siteName: ''
  };
}

// ------------------------------------------------------------
// Init
// ------------------------------------------------------------

/**
 * 网址栏被手动修改后，恢复按钮高亮；与当前页面地址一致时置灰
 */
function updateResetUrlState() {
  const btn = $('resetUrlBtn');
  if (!btn) return;
  const dirty = $('pageUrl').value.trim() !== state.currentPageUrl;
  btn.classList.toggle('is-active', dirty);
  btn.title = dirty ? '恢复为当前页面地址' : '当前页面地址';
}

async function init() {
  await loadSettings();
  bindEvents();

  // 如果已有设置，自动加载分类
  if (state.settings.serverUrl && isValidUrl(state.settings.serverUrl)) {
    await loadCategories();
  }

  // 获取当前页面元数据（通过 content script 消息传递）
  const metadata = await getPageMetadata();
  state.currentPageUrl = metadata.url || '';
  $('pageTitle').value = metadata.title || '';
  $('pageUrl').value = state.currentPageUrl;

  // 如果地址栏被手动修改过，恢复按钮进入可用态
  updateResetUrlState();

  // 如果有描述信息，可以在控制台显示（预留扩展点）
  if (metadata.description) {
    console.log('[AN] Page description:', metadata.description.slice(0, 100) + '...');
  }
}

function bindEvents() {
  // 设置按钮
  $('settingsBtn').addEventListener('click', () => {
    const panel = $('settingsPanel');
    panel.classList.toggle('hidden');
  });

  // 保存设置
  $('saveSettingsBtn').addEventListener('click', async () => {
    await saveSettings();
    const statusEl = $('connectionStatus');
    statusEl.className = 'connection-status success';
    statusEl.textContent = '✓ 设置已保存';
    // 关闭设置面板并重新加载分类
    setTimeout(() => {
      $('settingsPanel').classList.add('hidden');
      statusEl.textContent = '';
    }, 800);
    await loadCategories();
  });

  // 测试连接
  $('testConnectionBtn').addEventListener('click', testConnection);

  // 新建分类按钮
  $('newCategoryBtn').addEventListener('click', () => {
    const panel = $('newCategoryPanel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      $('categorySelect').value = '';
      $('newCategoryName').focus();
    }
  });

  // 分类选择变化
  $('categorySelect').addEventListener('change', (e) => {
    if (e.target.value) {
      $('newCategoryPanel').classList.add('hidden');
    }
  });

  // 网址栏：可手动编辑，输入时同步「恢复」按钮状态
  $('pageUrl').addEventListener('input', updateResetUrlState);

  // 恢复为当前页面地址
  $('resetUrlBtn').addEventListener('click', () => {
    $('pageUrl').value = state.currentPageUrl;
    updateResetUrlState();
    $('pageUrl').focus();
  });

  // 提交
  $('addBtn').addEventListener('click', addToNavigation);

  // 快捷键: Enter 在 title 输入框触发提交
  $('pageTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addToNavigation();
  });
  // 网址栏内按 Enter 也触发提交（避免与手动编辑冲突）
  $('pageUrl').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addToNavigation();
  });
  $('newCategoryName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addToNavigation();
  });
}

document.addEventListener('DOMContentLoaded', init);
