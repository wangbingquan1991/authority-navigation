// ============================================================
// 登录 / 退出入口
// ============================================================
// 口令只在登录时输入一次，登录态由服务端会话 Cookie 维持，
// 因此这里的按钮是「登录」与「已登录（点击退出）」二态切换。
// ============================================================

const LOCK_ICON = `
  <path d="M7 11V8a5 5 0 0 1 10 0v3"/>
  <rect x="4" y="11" width="16" height="10" rx="2"/>
`;

const UNLOCK_ICON = `
  <path d="M7 11V8a5 5 0 0 1 9.6-1.9"/>
  <rect x="4" y="11" width="16" height="10" rx="2"/>
`;

export class AuthControl {
  constructor(container, options = {}) {
    this.container = container;
    this.authenticated = options.authenticated === true;
    this.onLogin = options.onLogin || (() => {});
    this.onLogout = options.onLogout || (() => {});
    this.element = null;
    this.button = null;
  }

  render() {
    this.element = document.createElement("div");
    this.element.className = "icon-btn-group auth-group";
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", "登录状态");
    this.element.innerHTML = `
      <button type="button" class="icon-btn auth-btn">
        <svg class="auth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></svg>
        <span class="auth-label"></span>
      </button>
    `;

    this.button = this.element.querySelector(".auth-btn");
    this.iconEl = this.element.querySelector(".auth-icon");
    this.labelEl = this.element.querySelector(".auth-label");

    this.button.addEventListener("click", () => {
      if (this.authenticated) {
        this.onLogout();
      } else {
        this.onLogin();
      }
    });

    this.sync();
    this.container.appendChild(this.element);
    return this.element;
  }

  /** 按当前登录态刷新图标、文案与无障碍提示 */
  sync() {
    if (!this.element) return;
    this.iconEl.innerHTML = this.authenticated ? UNLOCK_ICON : LOCK_ICON;
    this.labelEl.textContent = this.authenticated ? "已登录" : "登录";
    this.button.classList.toggle("is-active", this.authenticated);
    const hint = this.authenticated
      ? "已登录，点击退出登录"
      : "登录后可修改分类与链接";
    this.button.title = hint;
    this.button.setAttribute("aria-label", hint);
  }

  setAuthenticated(value) {
    this.authenticated = value === true;
    this.sync();
  }
}
