import { CategoryCard } from "./CategoryCard.js";
import { AddCategoryCard } from "./AddCategoryCard.js";
import { setupDragAndDrop } from "../utils/dragDrop.js";
import { normalize } from "../utils/validators.js";

export class CategoryGrid {
  constructor(container, options = {}) {
    this.container = container;
    this.categories = [];
    this.onAddLink = options.onAddLink || (() => {});
    this.onDeleteLink = options.onDeleteLink || (() => {});
    this.onDeleteCategory = options.onDeleteCategory || (() => {});
    this.onReorder = options.onReorder || (() => {});
    this.onAddCategory = options.onAddCategory || (() => {});
    this.onFilterChange = options.onFilterChange || (() => {});
    this.cards = [];
    this.addCard = null;
    this.dragSrc = null;
  }

  render(categories = this.categories) {
    this.categories = categories;
    this.container.innerHTML = "";
    this.cards = [];

    for (const category of this.categories) {
      const card = new CategoryCard(this.container, {
        category: category.name,
        icon: category.icon,
        links: category.links,
        isDefault: category.isDefault,
        onAddLink: this.onAddLink,
        onDeleteLink: this.onDeleteLink,
        onDeleteCategory: this.onDeleteCategory
      });
      const el = card.render();
      this.cards.push({ card, element: el });
      this.setupDrag(el);
    }

    this.addCard = new AddCategoryCard(this.container, { onClick: this.onAddCategory });
    this.addCard.render();
  }

  setupDrag(element) {
    setupDragAndDrop(element, {
      getData: () => element.dataset.category,
      onDragStart: () => { this.dragSrc = element; },
      onDragEnd: () => {
        this.dragSrc = null;
        this.container.querySelectorAll(".card").forEach(c => c.classList.remove("drag-over"));
      },
      onDrop: async () => {
        if (!this.dragSrc || this.dragSrc === element) return;
        const cards = [...this.container.querySelectorAll(".card:not(.add-category-card)")];
        const srcIndex = cards.indexOf(this.dragSrc);
        const targetIndex = cards.indexOf(element);
        if (srcIndex === -1 || targetIndex === -1) return;
        const newOrder = cards.map(c => c.dataset.category);
        newOrder.splice(srcIndex, 1);
        newOrder.splice(targetIndex, 0, this.dragSrc.dataset.category);
        await this.onReorder(newOrder);
      }
    });
  }

  filter(query = "") {
    const raw = String(query).trim();
    const normalized = normalize(raw);
    let visibleCards = 0;
    let visibleLinks = 0;

    if (this.addCard) this.addCard.setHidden(normalized.length > 0);

    this.cards.forEach(({ card, element }) => {
      const category = card.category || "";
      const links = element.querySelectorAll(".links li");
      let cardMatches = normalize(category).includes(normalized);
      let cardVisibleLinks = 0;

      links.forEach(li => {
        const text = li.dataset.name || "";
        const href = li.dataset.url || "";
        const match = normalize(text).includes(normalized) || normalize(href).includes(normalized);
        li.hidden = normalized.length > 0 && !match;
        if (!li.hidden) cardVisibleLinks++;
        if (match) cardMatches = true;
      });

      card.setVisibleCount(cardVisibleLinks);
      element.hidden = !cardMatches;
      if (!element.hidden) {
        visibleCards++;
        visibleLinks += cardVisibleLinks;
      }
    });

    this.onFilterChange({ raw, normalized, visibleCards, visibleLinks });
  }
}
