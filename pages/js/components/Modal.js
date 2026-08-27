import { escapeHtml } from "../utils/validators.js";

export class Modal {
  constructor(container = document.body) {
    this.container = container;
    this.element = document.createElement("div");
    this.element.className = "modal-overlay";
    this.element.id = "modal";
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="modal-header">
          <h3 id="modalTitle">添加链接</h3>
          <button type="button" class="modal-close" aria-label="关闭">×</button>
        </div>
        <div class="modal-body" id="modalBody">
          <form id="modalForm"></form>
        </div>
        <div class="modal-footer">
          <button type="button" class="modal-cancel">取消</button>
          <button type="submit" class="modal-submit" form="modalForm">保存</button>
        </div>
      </div>
    `;
    this.container.appendChild(this.element);

    this.titleEl = this.element.querySelector("#modalTitle");
    this.bodyEl = this.element.querySelector("#modalBody");
    this.formEl = this.element.querySelector("#modalForm");
    this.closeBtn = this.element.querySelector(".modal-close");
    this.cancelBtn = this.element.querySelector(".modal-cancel");

    this.closeBtn.addEventListener("click", () => this.close());
    this.cancelBtn.addEventListener("click", () => this.close());
    this.element.addEventListener("click", (e) => { if (e.target === this.element) this.close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !this.element.hidden) this.close(); });

    this._onSubmit = null;
    this.formEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const values = {};
      this.fields.forEach(f => { values[f.name] = (this.formEl.elements[f.name].value || "").trim(); });
      if (this._onSubmit && await this._onSubmit(values)) {
        this.close();
      }
    });
  }

  open(title, fields, onSubmit) {
    this.fields = fields || [];
    this._onSubmit = onSubmit;
    this.titleEl.textContent = title;
    const inputsHtml = this.fields.map(f => `
      <label for="${f.name}">${escapeHtml(f.label)}</label>
      <input type="${f.type || "text"}" id="${f.name}" name="${f.name}" placeholder="${escapeHtml(f.placeholder || "")}" ${f.required ? "required" : ""} autocomplete="off">
    `).join("");
    this.bodyEl.innerHTML = `<form id="modalForm">${inputsHtml}</form>`;
    this.formEl = this.element.querySelector("#modalForm");
    this.formEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const values = {};
      this.fields.forEach(f => { values[f.name] = (this.formEl.elements[f.name].value || "").trim(); });
      if (this._onSubmit && await this._onSubmit(values)) {
        this.close();
      }
    });
    this.element.hidden = false;
    setTimeout(() => {
      const first = this.formEl.elements[this.fields[0]?.name];
      if (first) first.focus();
    }, 10);
  }

  close() {
    this.element.hidden = true;
    this._onSubmit = null;
    this.fields = [];
  }
}
