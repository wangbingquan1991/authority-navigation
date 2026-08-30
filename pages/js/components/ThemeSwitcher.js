const THEMES = [
  { id: "tiktok-dark", label: "抖音暗色", icon: "flame" },
  { id: "claude-light", label: "Claude 浅色", icon: "sun" },
  { id: "claude-dark", label: "Claude 深色", icon: "moon" },
  { id: "apple-light", label: "Apple 浅色", icon: "sun-dim" },
  { id: "apple-dark", label: "Apple 深色", icon: "moon-star" },
];

export class ThemeSwitcher {
  constructor(container, options = {}) {
    this.container = container;
    this.currentTheme = options.currentTheme || "tiktok-dark";
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
            title="${t.label}"
          >
            <i data-lucide="${t.icon}" width="18" height="18"></i>
          </button>
        `
        ).join("")}
      </div>
    `;

    this.container.querySelectorAll("[data-theme]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const theme = btn.dataset.theme;
        this.setTheme(theme);
        this.onChange(theme);
      });
    });
  }

  setTheme(theme) {
    this.currentTheme = theme;
    this.container.querySelectorAll("[data-theme]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.theme === theme);
    });
  }
}
