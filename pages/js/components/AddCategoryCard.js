export class AddCategoryCard {
  constructor(container, options = {}) {
    this.container = container;
    this.onClick = options.onClick || (() => {});
  }

  render() {
    this.element = document.createElement("article");
    this.element.className = "card add-category-card";
    this.element.setAttribute("role", "button");
    this.element.setAttribute("tabindex", "0");
    this.element.setAttribute("aria-label", "添加新类别");
    this.element.innerHTML = `<span class="add-category-icon">+</span><span>添加类别</span>`;

    this.element.addEventListener("click", () => this.onClick());
    this.element.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.onClick();
      }
    });

    this.container.appendChild(this.element);
    return this.element;
  }

  setHidden(hidden) {
    if (this.element) this.element.hidden = hidden;
  }
}
