import { STORAGE_KEYS, getJson, setJson } from "../utils/storage.js";

export class ThemeSwitcher {
  constructor(container) {
    this.container = container;
    this.themes = [
      { key: "tiktok", label: "抖音暗色" },
      { key: "claude-light", label: "Claude 浅色" },
      { key: "claude-dark", label: "Claude 深色" },
      { key: "apple-light", label: "Apple 浅色" },
      { key: "apple-dark", label: "Apple 深色" }
    ];
  }

  render() {
    this.container.setAttribute("role", "group");
    this.container.setAttribute("aria-label", "主题切换");
    this.container.innerHTML = this.themes.map(t => `
      <button type="button" data-theme="${t.key}" aria-pressed="false">${t.label}</button>
    `).join("");

    this.container.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      this.applyTheme(btn.dataset.theme);
    });

    const saved = getJson(STORAGE_KEYS.THEME, "tiktok");
    this.applyTheme(saved);
  }

  applyTheme(theme) {
    const validThemes = this.themes.map(t => t.key);
    if (!validThemes.includes(theme)) theme = "tiktok";
    document.documentElement.setAttribute("data-theme", theme);
    setJson(STORAGE_KEYS.THEME, theme);

    this.container.querySelectorAll("button").forEach(btn => {
      const active = btn.dataset.theme === theme;
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.classList.toggle("active", active);
    });
  }
}
