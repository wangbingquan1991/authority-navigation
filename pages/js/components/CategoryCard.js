import { escapeHtml } from "../utils/validators.js";
import { recordClick } from "../utils/clickTracker.js";

const LINK_DRAG_TYPE = "application/x-link-move";

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
    this.onMoveLink = options.onMoveLink || (() => {});
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
        <h2 title="${escapeHtml(this.category)}">${escapeHtml(this.category)}</h2>
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

    this.setupDropZone();

    this.ul = this.article.querySelector(".links");
    this.links.forEach(link => this.renderLink(link));

    this.container.appendChild(this.article);
    return this.article;
  }

  setupDropZone() {
    this.article.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes(LINK_DRAG_TYPE)) return;
      e.preventDefault();
      this.article.classList.add("link-drag-over");
    });

    this.article.addEventListener("dragleave", (e) => {
      if (this.article.contains(e.relatedTarget)) return;
      this.article.classList.remove("link-drag-over");
    });

    this.article.addEventListener("drop", async (e) => {
      if (!e.dataTransfer.types.includes(LINK_DRAG_TYPE)) return;
      e.preventDefault();
      this.article.classList.remove("link-drag-over");
      const data = e.dataTransfer.getData(LINK_DRAG_TYPE);
      if (!data) return;
      try {
        const link = JSON.parse(data);
        if (link.sourceCategory === this.category) return;
        await this.onMoveLink(link.sourceCategory, this.category, link);
      } catch (err) {
        console.error("Invalid link drop data", err);
      }
    });
  }

  renderLink(link) {
    const li = document.createElement("li");
    li.draggable = true;
    li.dataset.name = link.name;
    li.dataset.url = link.url;
    li.dataset.category = this.category;
    li.innerHTML = `
      <a href="${link.url}" target="_blank" rel="noopener">${escapeHtml(link.name)}</a>
      <button class="delete-btn" aria-label="删除 ${escapeHtml(link.name)}" title="删除">&times;</button>
    `;

    li.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(LINK_DRAG_TYPE, JSON.stringify({
        sourceCategory: this.category,
        sourceIsDefault: this.isDefault,
        isCustom: link.custom === true,
        name: link.name,
        url: link.url
      }));
    });

    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
    });

    const a = li.querySelector("a");
    a.addEventListener("click", () => recordClick(link.url));
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
