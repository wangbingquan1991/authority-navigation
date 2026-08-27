import { escapeHtml } from "../utils/validators.js";

export class CategoryCard {
  constructor(container, options = {}) {
    this.container = container;
    this.category = options.category;
    this.icon = options.icon;
    this.links = options.links || [];
    this.isDefault = options.isDefault !== false;
    this.onAddLink = options.onAddLink || (() => {});
    this.onDeleteLink = options.onDeleteLink || (() => {});
    this.onDeleteCategory = options.onDeleteCategory || (() => {});
    this.article = null;
  }

  render() {
    this.article = document.createElement("article");
    this.article.className = "card";
    this.article.dataset.category = this.category;
    this.article.setAttribute("draggable", "true");
    this.article.setAttribute("role", "listitem");
    this.article.setAttribute("aria-grabbed", "false");

    this.article.innerHTML = `
      <div class="card-header">
        <div class="category-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${escapeHtml(this.icon)}"/></svg></div>
        <h2>${escapeHtml(this.category)}</h2>
        <span class="link-count">${this.links.length}</span>
        <button class="add-link-btn" aria-label="添加链接">+</button>
        ${this.isDefault ? "" : `<button class="delete-category-btn" aria-label="删除类别" title="删除类别">&times;</button>`}
      </div>
      <ul class="links"></ul>
    `;

    const header = this.article.querySelector(".card-header");
    header.querySelector(".add-link-btn").addEventListener("click", () => this.onAddLink(this.category));
    const delCatBtn = header.querySelector(".delete-category-btn");
    if (delCatBtn) {
      delCatBtn.addEventListener("click", () => this.onDeleteCategory(this.category));
    }

    this.ul = this.article.querySelector(".links");
    this.links.forEach(link => this.renderLink(link));

    this.container.appendChild(this.article);
    return this.article;
  }

  renderLink(link) {
    const li = document.createElement("li");
    li.dataset.name = link.name;
    li.dataset.url = link.url;
    li.innerHTML = `
      <a href="${link.url}" target="_blank" rel="noopener">${escapeHtml(link.name)}</a>
      <button class="delete-btn" aria-label="删除 ${escapeHtml(link.name)}" title="删除">&times;</button>
    `;
    li.querySelector(".delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      this.onDeleteLink(this.category, link.url, this.isDefault);
    });
    this.ul.appendChild(li);
  }

  setVisibleCount(count) {
    const badge = this.article.querySelector(".link-count");
    if (badge) badge.textContent = count;
  }
}
