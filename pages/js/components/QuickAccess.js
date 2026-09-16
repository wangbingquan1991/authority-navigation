import { escapeHtml } from "../utils/validators.js";
import { recordClick } from "../utils/clickTracker.js";

// 与分类卡片共用同一套拖拽协议，便于在「快捷入口」与各分类之间互相拖动
const LINK_DRAG_TYPE = "application/x-link-move";

/**
 * 快捷入口横条。
 *
 * 这是一个按点击频率排序的跨分类快捷栏，不是分类：内容全部来自其他分类，
 * 排序依据是使用行为而非主题。因此这里刻意不使用卡片外壳（无背景面 / 无边框 /
 * 无内边距 / 无圆角），也不使用分类图标与分类级标题——一旦与下方分类卡片同构，
 * 就会被读作「又一个分类」。
 *
 * 注意：显示名与持久化键名是分开的。界面显示「快捷入口」，但读写数据仍沿用
 * 历史键名「常用链接」（见 app.js 的 QUICK_LINKS_CATEGORY），否则既有用户
 * 已保存的快捷链接与移除记录会全部失联。
 */
export class QuickAccess {
  constructor(container, options = {}) {
    this.container = container;
    this.label = options.label || "快捷入口";
    this.dataCategory = options.dataCategory || "常用链接";
    this.links = options.links || [];
    this.onAddLink = options.onAddLink || (() => {});
    this.onDeleteLink = options.onDeleteLink || (() => {});
    this.onMoveLink = options.onMoveLink || (() => {});
    this.element = null;
  }

  render() {
    // refresh() 会反复调用，需要先移除上一轮节点，避免横条重复堆叠
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = document.createElement("section");
    this.element.className = "quick-access";
    this.element.setAttribute("aria-labelledby", "quickAccessTitle");

    this.element.innerHTML = `
      <div class="quick-access-head">
        <span class="quick-access-label" id="quickAccessTitle">${escapeHtml(this.label)}</span>
        <span class="quick-access-hint">按使用频率自动排序</span>
        <button type="button" class="quick-access-add" aria-label="添加${escapeHtml(this.label)}">+ 添加</button>
      </div>
      <ul class="quick-access-list"></ul>
    `;

    this.element
      .querySelector(".quick-access-add")
      .addEventListener("click", () => this.onAddLink(this.dataCategory));

    this.setupDropZone();

    // 即使一条链接都没有也保留横条：否则用户清空后无法再通过「+ 添加」加回来
    const ul = this.element.querySelector(".quick-access-list");
    this.links.forEach((link) => ul.appendChild(this.renderItem(link)));

    this.container.appendChild(this.element);
    return this.element;
  }

  renderItem(link) {
    const li = document.createElement("li");
    li.className = "quick-access-item";
    li.draggable = true;
    li.dataset.name = link.name;
    li.dataset.url = link.url;
    li.dataset.category = this.dataCategory;
    li.innerHTML = `
      <a class="quick-chip" href="${escapeHtml(link.url)}" target="_blank" rel="noopener" title="${escapeHtml(link.name)}">${escapeHtml(link.name)}</a>
      <button type="button" class="quick-chip-remove" aria-label="移出${escapeHtml(this.label)}：${escapeHtml(link.name)}" title="移出${escapeHtml(this.label)}">&times;</button>
    `;

    li.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(LINK_DRAG_TYPE, JSON.stringify({
        sourceCategory: this.dataCategory,
        sourceIsDefault: false,
        isCustom: link.custom === true,
        name: link.name,
        url: link.url
      }));
    });

    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
    });

    li.querySelector(".quick-chip").addEventListener("click", () => recordClick(link.url));
    li.querySelector(".quick-chip-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      // 来自默认配置的链接记入移除列表；用户自建的直接移除
      this.onDeleteLink(this.dataCategory, link.url, link.custom !== true);
    });

    return li;
  }

  setupDropZone() {
    this.element.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes(LINK_DRAG_TYPE)) return;
      e.preventDefault();
      this.element.classList.add("link-drag-over");
    });

    this.element.addEventListener("dragleave", (e) => {
      if (this.element.contains(e.relatedTarget)) return;
      this.element.classList.remove("link-drag-over");
    });

    this.element.addEventListener("drop", async (e) => {
      if (!e.dataTransfer.types.includes(LINK_DRAG_TYPE)) return;
      e.preventDefault();
      this.element.classList.remove("link-drag-over");
      const data = e.dataTransfer.getData(LINK_DRAG_TYPE);
      if (!data) return;
      try {
        const link = JSON.parse(data);
        if (link.sourceCategory === this.dataCategory) return;
        await this.onMoveLink(link.sourceCategory, this.dataCategory, link);
      } catch (err) {
        console.error("Invalid link drop data", err);
      }
    });
  }

  setHidden(hidden) {
    if (this.element) this.element.hidden = hidden;
  }
}
