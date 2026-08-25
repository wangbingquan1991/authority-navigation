import { STORAGE_KEYS, getJson, setJson } from "../utils/storage.js";

/**
 * 每个主题映射到 <html data-theme="..."> 的取值：
 * - 抖音暗色是基础配色，色值直接定义在 :root 里，所以取 "tiktok"（与 HTML 初始值一致），
 *   不命中任何覆盖块时自动回落到 :root 的默认色值；
 * - 其余主题各自在 index.html 中有 [data-theme="..."] 覆盖块。
 */
const THEMES = [
  { id: "tiktok-dark", label: "抖音暗色", icon: "flame", attr: "tiktok", dark: true },
  { id: "claude-light", label: "Claude 浅色", icon: "sun", attr: "claude-light", dark: false },
  { id: "claude-dark", label: "Claude 深色", icon: "moon", attr: "claude-dark", dark: true },
  { id: "apple-light", label: "Apple 浅色", icon: "sun-dim", attr: "apple-light", dark: false },
  { id: "apple-dark", label: "Apple 深色", icon: "moon-star", attr: "apple-dark", dark: true }
];

export const DEFAULT_THEME = "tiktok-dark";

const THEME_MAP = new Map(THEMES.map((t) => [t.id, t]));

export function getStoredTheme() {
  const stored = getJson(STORAGE_KEYS.THEME, null);
  return THEME_MAP.has(stored) ? stored : DEFAULT_THEME;
}

/**
 * 把主题真正写到 <html> 上：色值由 data-theme 对应的 CSS 变量驱动，
 * 同时同步 dark 类与 color-scheme（影响滚动条、表单控件等浏览器原生外观）。
 * @param {string} themeId
 * @returns {string} 实际生效的主题 id
 */
export function applyTheme(themeId) {
  const theme = THEME_MAP.get(themeId) || THEME_MAP.get(DEFAULT_THEME);
  const root = document.documentElement;
  root.setAttribute("data-theme", theme.attr);
  root.classList.toggle("dark", theme.dark);
  root.style.colorScheme = theme.dark ? "dark" : "light";
  return theme.id;
}

export class ThemeSwitcher {
  constructor(container, options = {}) {
    this.container = container;
    this.currentTheme = THEME_MAP.has(options.currentTheme)
      ? options.currentTheme
      : getStoredTheme();
    this.onChange = options.onChange || (() => {});
  }

  render() {
    this.container.innerHTML = `
      <div class="icon-btn-group theme-switcher-group" role="group" aria-label="主题切换">
        ${THEMES.map(
          (t) => `
          <button
            type="button"
            class="icon-btn ${t.id === this.currentTheme ? "is-active" : ""}"
            data-theme="${t.id}"
            aria-label="${t.label}"
            aria-pressed="${t.id === this.currentTheme}"
            title="${t.label}"
          >
            <i data-lucide="${t.icon}" width="18" height="18"></i>
          </button>
        `
        ).join("")}
      </div>
    `;

    this.container.querySelectorAll("button[data-theme]").forEach((btn) => {
      btn.addEventListener("click", () => this.setTheme(btn.dataset.theme));
    });

    // 首屏同步一次：让高亮状态与 <html data-theme> 保持一致（不重复写存储）
    this.setTheme(this.currentTheme, { persist: false });
  }

  /**
   * @param {string} theme
   * @param {{persist?: boolean}} [options] persist=false 用于首屏初始化
   */
  setTheme(theme, { persist = true } = {}) {
    const applied = applyTheme(theme);
    this.currentTheme = applied;

    this.container.querySelectorAll("button[data-theme]").forEach((btn) => {
      const active = btn.dataset.theme === applied;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });

    if (persist) {
      setJson(STORAGE_KEYS.THEME, applied);
      this.onChange(applied);
    }
  }
}
