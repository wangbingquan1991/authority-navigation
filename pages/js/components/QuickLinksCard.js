import { escapeHtml } from "../utils/validators.js";
import { recordClick } from "../utils/clickTracker.js";

const QUICK_LINKS_ICON = "M13.5 2 3 14h9l-1 8 10.5-12h-9l1-8z";

export class QuickLinksCard {
  constructor(container, options = {}) {
    this.container = container;
    this.title = options.title || "常用链接";
    this.links = options.links || [];
    this.onAddLink = options.onAddLink || (() => {});
    this.onDeleteLink = options.onDeleteLink || (() => {});
    this.element = null;
  }

  render() {
    this.element = document.createElement("article");
    this.element.className = "card quick-links-card";
    this.element.setAttribute("role", "listitem");

    this.element.innerHTML = `
      <div class="card-header">
        <div class="category-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${QUICK_LINKS_ICON}"/></svg></div>
        <h2>${escapeHtml(this.title)}</h2>
        <button class="add-link-btn" aria-label="添加常用链接" title="添加常用链接">+</button>
      </div>
      <ul class="quick-links"></ul>
    `;

    this.element
      .querySelector(".add-link-btn")
      .addEventListener("click", () => this.onAddLink(this.title));

    const ul = this.element.querySelector(".quick-links");
    this.links.forEach((link) => {
      const li = document.createElement("li");
      li.dataset.name = link.name;
      li.dataset.url = link.url;
      li.innerHTML = `
        <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" title="${escapeHtml(link.name)}">${escapeHtml(link.name)}</a>
        <button class="delete-btn" aria-label="删除 ${escapeHtml(link.name)}" title="删除">&times;</button>
      `;
      const a = li.querySelector("a");
      a.addEventListener("click", () => recordClick(link.url));
      li.querySelector(".delete-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        // 来自默认配置的链接标记为 isDefault，删除时记入移除列表；用户自建的直接移除
        this.onDeleteLink(this.title, link.url, link.custom !== true);
      });
      ul.appendChild(li);
    });

    this.container.appendChild(this.element);
    return this.element;
  }

  setHidden(hidden) {
    if (this.element) this.element.hidden = hidden;
  }
}
