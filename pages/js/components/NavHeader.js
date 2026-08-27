export class NavHeader {
  constructor(container) {
    this.container = container;
  }

  render() {
    this.container.innerHTML = `
      <div class="brand">
        <div class="brand-mark">
          <img src="../assets/logo.jpg" alt="权威导航" width="38" height="38" />
        </div>
        <h1>权威导航</h1>
      </div>
      <p class="subtitle">国家机关、权威媒体、重点高校、数据查询、学术法律资源一站式导航，支持自定义增删。</p>
    `;
  }
}
