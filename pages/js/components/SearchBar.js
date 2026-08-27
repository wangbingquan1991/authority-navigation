export class SearchBar {
  constructor(container, options = {}) {
    this.container = container;
    this.onInput = options.onInput || (() => {});
  }

  render() {
    this.container.innerHTML = `
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>
      <input type="search" id="search" placeholder="搜索机构、媒体、高校或工具…" autocomplete="off">
      <div class="result-count" id="resultCount" aria-live="polite"></div>
    `;

    this.input = this.container.querySelector("#search");
    this.resultCount = this.container.querySelector("#resultCount");
    this.input.addEventListener("input", () => this.onInput(this.input.value));
  }

  get value() {
    return this.input ? this.input.value : "";
  }

  setResultCount(text) {
    if (this.resultCount) this.resultCount.textContent = text;
  }
}
