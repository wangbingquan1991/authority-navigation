import { downloadJson, readJsonFile, validateImportData } from "../utils/exportImport.js";

export class ImportExport {
  constructor(container, { onExport, onImport, onReset }) {
    this.container = container;
    this.onExport = onExport;
    this.onImport = onImport;
    this.onReset = onReset;
  }

  render() {
    this.container.innerHTML = `
      <button type="button" class="tool-btn export-btn" data-action="export" title="导出数据">
        <i data-lucide="download" width="16" height="16"></i>
        <span>导出</span>
      </button>
      <button type="button" class="tool-btn import-btn" data-action="import" title="导入数据">
        <i data-lucide="upload" width="16" height="16"></i>
        <span>导入</span>
      </button>
      <button type="button" class="tool-btn reset-btn" data-action="reset" title="恢复默认">
        <i data-lucide="rotate-ccw" width="16" height="16"></i>
        <span>恢复默认</span>
      </button>
      <input type="file" class="import-file-input" accept="application/json" hidden />
    `;

    this.container.querySelector("[data-action='export']").addEventListener("click", async () => {
      const data = await this.onExport();
      downloadJson(data);
    });

    const fileInput = this.container.querySelector(".import-file-input");
    this.container.querySelector("[data-action='import']").addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const raw = await readJsonFile(file);
        const data = validateImportData(raw);
        await this.onImport(data);
      } catch (err) {
        alert(err.message);
      } finally {
        fileInput.value = "";
      }
    });

    this.container.querySelector("[data-action='reset']").addEventListener("click", async () => {
      if (confirm("确定要恢复默认设置吗？所有自定义分类、链接和排序都将被清空。")) {
        await this.onReset();
      }
    });
  }
}
