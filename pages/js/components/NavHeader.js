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
    `;
  }
}
