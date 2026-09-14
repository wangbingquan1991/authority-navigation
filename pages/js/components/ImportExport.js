import { downloadJson, readJsonFile, validateImportData } from "../utils/exportImport.js?v=2";

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
        <button type="button" class="icon-btn" data-action="import" aria-label="增量导入"
                title="增量导入（合并到现有数据，自动去重）；按住 Shift 点击则全量替换">
          <i data-lucide="upload" width="18" height="18"></i>
        </button>
        <button type="button" class="icon-btn icon-btn-danger" data-action="reset" aria-label="恢复默认" title="恢复默认">
          <i data-lucide="rotate-ccw" width="18" height="18"></i>
        </button>
      </div>
      <input type="file" class="import-file-input" accept="application/json,.json" hidden />
    `;

    this.container.querySelector("[data-action='export']").addEventListener("click", async () => {
      const data = await this.onExport();
      downloadJson(data);
    });

    const fileInput = this.container.querySelector(".import-file-input");

    // 按住 Shift 点击导入 = 全量替换；文件选择框是异步的，
    // 所以在这里就把意图记下来，供选择文件之后使用。
    let replaceMode = false;
    this.container.querySelector("[data-action='import']").addEventListener("click", (e) => {
      replaceMode = e.shiftKey === true;
      fileInput.click();
    });

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const raw = await readJsonFile(file);
        const data = validateImportData(raw);
        const stats = await this.onImport(data, { replace: replaceMode });
        alert(this.describe(stats));
      } catch (err) {
        alert(err.message);
      } finally {
        fileInput.value = "";
        replaceMode = false;
      }
    });

    this.container.querySelector("[data-action='reset']").addEventListener("click", async () => {
      if (confirm("确定要恢复默认设置吗？所有自定义分类、链接和排序都将被清空。")) {
        await this.onReset();
      }
    });
  }

  /** 把导入结果整理成一句人类可读的提示 */
  describe(stats) {
    if (!stats) return "导入完成。";

    if (stats.empty) {
      return "文件里没有发现可导入的链接。";
    }

    if (stats.replace) {
      return `已全量替换：${stats.categories} 个分类、${stats.links} 条链接。`;
    }

    const parts = [`新增 ${stats.addedLinks} 条链接`];
    if (stats.addedCategories) parts.push(`新建 ${stats.addedCategories} 个分类`);
    if (stats.skippedLinks) parts.push(`跳过重复 ${stats.skippedLinks} 条`);
    if (stats.invalidLinks) parts.push(`忽略无效 ${stats.invalidLinks} 条`);

    const names = Object.keys(stats.byCategory || {});
    const detail = names.length ? `\n\n${names.map(n => `· ${n}：${stats.byCategory[n]} 条`).join("\n")}` : "";
    return `导入完成（增量合并）：${parts.join("，")}。${detail}`;
  }
}
