import {
  loadAllData,
  loadCustomCategories,
  loadRemovedDefaults,
  loadRemovedCommonLinks,
  loadCategoryOrder,
  addCustomLink,
  removeCustomLink,
  addDefaultRemoved,
  addRemovedCommonLink,
  addCategory,
  deleteCategory,
  saveCategoryOrder,
  saveCustomCategories,
  saveAllData,
  loadDefaultConfig,
  UNAUTHORIZED_EVENT
} from "./services/api.js";
import { checkSession, login, logout } from "./services/adminAuth.js";
import { normalizeUrl, normalize, isValidUrl, isValidName } from "./utils/validators.js";
import { sortLinksByFrequency } from "./utils/clickTracker.js";
import { mergeImportData } from "./utils/exportImport.js?v=2";
import { NavHeader } from "./components/NavHeader.js?v=2";
import { ThemeSwitcher } from "./components/ThemeSwitcher.js?v=3";
import { AuthControl } from "./components/AuthControl.js?v=1";
import { SearchBar } from "./components/SearchBar.js?v=2";
import { CategoryGrid } from "./components/CategoryGrid.js?v=4";
import { Modal } from "./components/Modal.js?v=2";
import { ImportExport } from "./components/ImportExport.js?v=4";

// “常用链接”卡片在数据层复用一个保留类别名，用于保存用户自建/删除的常用链接
const QUICK_LINKS_CATEGORY = "常用链接";

// 导入时未指定分类的网站，归入这个分类
const UNCATEGORIZED_CATEGORY = "未分类";

let defaultConfig = { categories: {}, defaultCategoryIcon: "M12 2v20 M2 12h20" };

function getDefaultCategories() {
  return defaultConfig.categories || {};
}

function getDefaultCategoryIcon() {
  return defaultConfig.defaultCategoryIcon || "M12 2v20 M2 12h20";
}

function isDefaultCategory(name) {
  return Object.prototype.hasOwnProperty.call(getDefaultCategories(), name);
}

async function isCustomCategory(name) {
  return (await loadCustomCategories()).some(c => c.name === name);
}

async function mergeCategories() {
  const data = await loadAllData();
  const customLinks = data.customLinks || {};
  const customCategories = data.customCategories || [];
  const categoryOrder = data.categoryOrder || [];
  const merged = {};
  const defaultCategories = getDefaultCategories();

  for (const [cat, meta] of Object.entries(defaultCategories)) {
    merged[cat] = {
      name: cat,
      icon: meta.icon,
      links: meta.links.map(l => ({ ...l })),
      isDefault: true
    };
    const extras = customLinks[cat] || [];
    for (const item of extras) {
      if (!merged[cat].links.some(l => l.url === item.url)) {
        merged[cat].links.push({ ...item, custom: true });
      }
    }
  }

  for (const cat of customCategories) {
    merged[cat.name] = {
      name: cat.name,
      icon: cat.icon || getDefaultCategoryIcon(),
      links: (cat.links || []).map(l => ({ ...l })),
      isDefault: false
    };
  }

  const known = new Set(Object.keys(merged));
  const ordered = [];
  for (const cat of categoryOrder) {
    if (known.has(cat)) ordered.push(cat);
  }
  for (const cat of Object.keys(merged)) {
    if (!ordered.includes(cat)) ordered.push(cat);
  }

  const removed = await loadRemovedDefaults();
  return ordered.map(cat => {
    const item = merged[cat];
    if (item.isDefault) {
      // 用户自建链接（custom: true）不受 removedDefaults 影响，避免被其他分类的删除记录误删
      item.links = item.links.filter(l => l.custom === true || !removed.includes(l.url));
    }
    return item;
  });
}

/**
 * 常用链接 = 默认配置(config.commonLinks) 去掉用户已删除的 + 用户自建的。
 * 删除记录单独存放在 removedCommonLinks，避免误删同名分类中的链接。
 */
async function getQuickLinks() {
  const data = await loadAllData();
  const configLinks = defaultConfig.commonLinks || [];
  const removed = await loadRemovedCommonLinks();
  const custom = data.customLinks?.[QUICK_LINKS_CATEGORY] || [];

  const result = configLinks
    .filter(link => !removed.includes(link.url))
    .map(link => ({ ...link }));

  for (const item of custom) {
    if (!result.some(link => link.url === item.url)) {
      result.push({ ...item, custom: true });
    }
  }
  return result;
}

async function init() {
  defaultConfig = await loadDefaultConfig();

  // 等待 CDN 脚本（Tailwind / Lucide，地址来自 config/cdn.json）注入完成，
  // 自带 4s 超时兜底，CDN 故障不会导致页面空白
  if (window.__cdnReady) {
    try {
      await window.__cdnReady;
    } catch (e) {
      console.error("CDN scripts unavailable:", e);
    }
  }

  const modal = new Modal(document.body);
  const navHeader = new NavHeader(document.querySelector(".nav-header-content"));
  navHeader.render();

  const themeSwitcher = new ThemeSwitcher(document.querySelector(".theme-switcher"));
  themeSwitcher.render();

  // 口令只在登录时校验一次；登录后的修改（拖拽改分类、增删链接、排序、导入）
  // 都凭服务端会话 Cookie 直接保存，不再重复索要口令。
  const authControl = new AuthControl(document.querySelector(".auth-control"), {
    onLogin: () => openLoginModal(),
    onLogout: async () => {
      await logout();
      authControl.setAuthenticated(false);
    }
  });
  authControl.render();
  authControl.setAuthenticated(await checkSession());

  function openLoginModal() {
    if (!modal.element.hidden) return;
    modal.open("管理员登录", [
      { name: "token", label: "管理员口令", placeholder: "请输入管理员口令", type: "password", required: true }
    ], async (vals) => {
      let authenticated = false;
      try {
        authenticated = await login(vals.token);
      } catch (err) {
        alert(err.message);
        return false;
      }
      if (!authenticated) {
        alert("口令不正确，请重新输入。");
        return false;
      }
      authControl.setAuthenticated(true);
      await refresh();
      return true;
    });
  }

  // 会话缺失或过期时写接口返回 401，这里统一引导重新登录
  window.addEventListener(UNAUTHORIZED_EVENT, () => {
    authControl.setAuthenticated(false);
    openLoginModal();
  });

  const searchBar = new SearchBar(document.querySelector(".search-wrap"));
  const emptyState = document.getElementById("emptyState");
  const emptyQuery = document.getElementById("emptyQuery");

  const gridContainer = document.querySelector("main#grid");
  const grid = new CategoryGrid(gridContainer, {
    quickLinks: [],
    onAddLink: (category) => {
      modal.open(`添加链接到“${category}”`, [
        { name: "name", label: "名称", placeholder: "名称", required: true },
        { name: "url", label: "网址", placeholder: "https://", required: true }
      ], async (vals) => {
        const url = normalizeUrl(vals.url);
        if (!isValidUrl(url)) return false;
        await addCustomLink(category, { name: vals.name, url });
        await refresh();
        return true;
      });
    },
    onDeleteLink: async (category, url, isDefault) => {
      // 用户自建的链接一律先移除；默认链接另记入「已删除」列表
      await removeCustomLink(category, url);
      if (isDefault) {
        if (category === QUICK_LINKS_CATEGORY) {
          await addRemovedCommonLink(url);
        } else {
          await addDefaultRemoved(url);
        }
      } else {
        const cats = await loadCustomCategories();
        const cat = cats.find(c => c.name === category);
        if (cat) {
          cat.links = cat.links.filter(l => l.url !== url);
          await saveCustomCategories(cats);
        }
      }
      await refresh();
    },
    onMoveLink: async (sourceCategory, targetCategory, link) => {
      if (sourceCategory === targetCategory) return;

      // 1. 添加到目标分类
      if (targetCategory === QUICK_LINKS_CATEGORY || isDefaultCategory(targetCategory)) {
        await addCustomLink(targetCategory, { name: link.name, url: link.url });
      } else {
        const cats = await loadCustomCategories();
        const cat = cats.find(c => c.name === targetCategory);
        if (cat && !cat.links.some(l => l.url === link.url)) {
          cat.links.push({ name: link.name, url: link.url });
          await saveCustomCategories(cats);
        }
      }

      // 2. 从源分类移除
      if (sourceCategory === QUICK_LINKS_CATEGORY) {
        if (link.isCustom) {
          await removeCustomLink(QUICK_LINKS_CATEGORY, link.url);
        } else {
          await addRemovedCommonLink(link.url);
        }
      } else if (isDefaultCategory(sourceCategory)) {
        if (link.isCustom) {
          await removeCustomLink(sourceCategory, link.url);
        } else {
          await addDefaultRemoved(link.url);
        }
      } else {
        const cats = await loadCustomCategories();
        const cat = cats.find(c => c.name === sourceCategory);
        if (cat) {
          cat.links = cat.links.filter(l => l.url !== link.url);
          await saveCustomCategories(cats);
        }
      }

      await refresh();
    },
    onDeleteCategory: async (name) => {
      if (confirm(`确定删除自定义类别“${name}”及其所有链接吗？`)) {
        await deleteCategory(name);
        await refresh();
      }
    },
    onReorder: async (order) => {
      await saveCategoryOrder(order);
      await refresh();
    },
    onAddCategory: () => {
      modal.open("添加新类别", [
        { name: "categoryName", label: "类别名称", placeholder: "例如：设计资源", required: true },
        { name: "linkName", label: "首个链接名称", placeholder: "名称", required: true },
        { name: "url", label: "首个链接网址", placeholder: "https://", required: true }
      ], async (vals) => {
        const cat = vals.categoryName.trim();
        if (!isValidName(cat)) return false;
        if (cat === QUICK_LINKS_CATEGORY || isDefaultCategory(cat) || (await isCustomCategory(cat))) {
          alert("该类别名称已存在，请使用其他名称。");
          return false;
        }
        const url = normalizeUrl(vals.url);
        if (!isValidUrl(url)) return false;
        await addCategory(cat, { name: vals.linkName, url }, getDefaultCategoryIcon());
        await refresh();
        return true;
      });
    },
    onFilterChange: ({ raw, normalized, visibleCards, visibleLinks }) => {
      if (normalized.length === 0) {
        searchBar.setResultCount("");
        emptyState.classList.remove("visible");
      } else {
        searchBar.setResultCount(`找到 ${visibleCards} 个分类、${visibleLinks} 个链接`);
        if (visibleCards === 0) {
          emptyQuery.textContent = raw;
          emptyState.classList.add("visible");
        } else {
          emptyState.classList.remove("visible");
        }
      }
    }
  });

  searchBar.onInput = (value) => grid.filter(value);
  searchBar.render();

  const importExport = new ImportExport(document.querySelector(".import-export-wrap"), {
    onExport: async () => {
      const custom = await loadAllData();
      const merged = await mergeCategories();
      const quickLinks = await getQuickLinks();
      return {
        version: 2,
        exportedAt: new Date().toISOString(),
        config: defaultConfig,
        custom,
        merged,
        quickLinks
      };
    },
    // 增量导入：以链接为最小粒度并入现有数据，同分类内按 URL 去重；
    // 传入 replace=true 时退化为全量替换（用于还原备份）
    onImport: async (data, opts = {}) => {
      const replace = opts.replace === true;
      const entries = Array.isArray(data.entries) ? data.entries : [];

      if (replace) {
        const categories = data.customCategories || [];
        if (categories.length === 0 && entries.length === 0) {
          return { empty: true, replace: true };
        }
        await saveAllData({
          customLinks: data.customLinks || {},
          customCategories: categories,
          removedDefaults: data.removedDefaults || [],
          removedCommonLinks: data.removedCommonLinks || [],
          categoryOrder: data.categoryOrder || []
        });
        await refresh();
        return { replace: true, categories: categories.length, links: entries.length };
      }

      // 没有可导入的链接时不写库，避免无意义变更
      if (entries.length === 0) return { empty: true };

      const existing = await loadAllData();
      const merged = mergeImportData(existing, data, {
        defaultCategoryNames: new Set(Object.keys(getDefaultCategories())),
        fallbackCategory: UNCATEGORIZED_CATEGORY,
        defaultIcon: getDefaultCategoryIcon()
      });

      await saveAllData({
        customLinks: merged.customLinks,
        customCategories: merged.customCategories,
        removedDefaults: merged.removedDefaults,
        removedCommonLinks: merged.removedCommonLinks,
        categoryOrder: merged.categoryOrder
      });
      await refresh();
      return merged.stats;
    },
    onReset: async () => {
      await saveAllData({
        customLinks: {},
        customCategories: [],
        removedDefaults: [],
        removedCommonLinks: [],
        categoryOrder: []
      });
      await refresh();
    }
  });
  importExport.render();

  async function refresh() {
    const categories = await mergeCategories();
    const rawQuickLinks = await getQuickLinks();
    grid.quickLinks = sortLinksByFrequency(rawQuickLinks, 125);
    grid.render(categories);
    grid.filter(searchBar.value);
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  await refresh();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
