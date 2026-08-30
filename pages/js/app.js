import {
  loadAllData,
  loadCustomCategories,
  loadRemovedDefaults,
  loadCategoryOrder,
  addCustomLink,
  removeCustomLink,
  addDefaultRemoved,
  addCategory,
  deleteCategory,
  saveCategoryOrder,
  saveCustomCategories,
  saveAllData,
  loadDefaultConfig
} from "./services/api.js";
import { normalizeUrl, normalize, isValidUrl, isValidName } from "./utils/validators.js";
import { NavHeader } from "./components/NavHeader.js?v=2";
import { ThemeSwitcher } from "./components/ThemeSwitcher.js?v=2";
import { SearchBar } from "./components/SearchBar.js?v=2";
import { CategoryGrid } from "./components/CategoryGrid.js?v=2";
import { Modal } from "./components/Modal.js?v=2";
import { ImportExport } from "./components/ImportExport.js?v=3";

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
      item.links = item.links.filter(l => !removed.includes(l.url));
    }
    return item;
  });
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

  const searchBar = new SearchBar(document.querySelector(".search-wrap"));
  const emptyState = document.getElementById("emptyState");
  const emptyQuery = document.getElementById("emptyQuery");

  const gridContainer = document.querySelector("main#grid");
  const grid = new CategoryGrid(gridContainer, {
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
      if (isDefault) {
        await removeCustomLink(category, url);
        await addDefaultRemoved(url);
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
        if (isDefaultCategory(cat) || (await isCustomCategory(cat))) {
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
      return await loadAllData();
    },
    onImport: async (data) => {
      await saveAllData(data);
      await refresh();
    },
    onReset: async () => {
      await saveAllData({
        customLinks: {},
        customCategories: [],
        removedDefaults: [],
        categoryOrder: []
      });
      await refresh();
    }
  });
  importExport.render();

  async function refresh() {
    const categories = await mergeCategories();
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
