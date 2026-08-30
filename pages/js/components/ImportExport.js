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
      <div class="icon-btn-group" role="group" aria-label="数据管理">
        <button type="button" class="icon-btn" data-action="export" aria-label="导出数据" title="导出数据">
          <i data-lucide="download" width="18" height="18"></i>
        </button>
        <button type="button" class="icon-btn" data-action="import" aria-label="导入数据" title="导入数据">
          <i data-lucide="upload" width="18" height="18"></i>
        </button>
        <button type="button" class="icon-btn icon-btn-danger" data-action="reset" aria-label="恢复默认" title="恢复默认">
          <i data-lucide="rotate-ccw" width="18" height="18"></i>
        </button>
      </div>
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
