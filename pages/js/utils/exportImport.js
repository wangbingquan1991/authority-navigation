export function downloadJson(data, filename = "authority-navigation-data.json") {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || file.type !== "application/json") {
      reject(new Error("请选择 JSON 文件"));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        resolve(parsed);
      } catch (err) {
        reject(new Error("文件内容不是有效的 JSON"));
      }
    };
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

export function validateImportData(data) {
  if (!data || typeof data !== "object") {
    throw new Error("数据格式错误：必须为 JSON 对象");
  }

  // Support v2 export format: { version: 2, custom, merged, config }
  const source = data.version === 2 && data.custom ? data.custom : data;

  const result = {
    customLinks: {},
    customCategories: [],
    removedDefaults: [],
    removedCommonLinks: [],
    categoryOrder: []
  };

  if (source.customLinks !== undefined) {
    if (typeof source.customLinks !== "object" || Array.isArray(source.customLinks)) {
      throw new Error("customLinks 必须是对象");
    }
    for (const [category, items] of Object.entries(source.customLinks)) {
      if (!Array.isArray(items)) continue;
      result.customLinks[category] = items
        .filter(item => item && typeof item === "object")
        .map(item => ({
          name: String(item.name || "").slice(0, 100),
          url: String(item.url || "").slice(0, 2048),
          custom: item.custom === true
        }))
        .filter(item => item.name && item.url);
    }
  }

  if (source.customCategories !== undefined) {
    if (!Array.isArray(source.customCategories)) {
      throw new Error("customCategories 必须是数组");
    }
    result.customCategories = source.customCategories
      .filter(cat => cat && typeof cat === "object" && cat.name)
      .map(cat => ({
        name: String(cat.name).slice(0, 100),
        icon: String(cat.icon || "").slice(0, 500),
        links: (cat.links || [])
          .filter(item => item && typeof item === "object")
          .map(item => ({
            name: String(item.name || "").slice(0, 100),
            url: String(item.url || "").slice(0, 2048),
            custom: item.custom === true
          }))
          .filter(item => item.name && item.url)
      }));
  }

  if (source.removedDefaults !== undefined) {
    if (!Array.isArray(source.removedDefaults)) {
      throw new Error("removedDefaults 必须是数组");
    }
    result.removedDefaults = source.removedDefaults
      .map(url => String(url || "").slice(0, 2048))
      .filter(url => url);
  }

  if (source.removedCommonLinks !== undefined) {
    if (!Array.isArray(source.removedCommonLinks)) {
      throw new Error("removedCommonLinks 必须是数组");
    }
    result.removedCommonLinks = source.removedCommonLinks
      .map(url => String(url || "").slice(0, 2048))
      .filter(url => url);
  }

  if (source.categoryOrder !== undefined) {
    if (!Array.isArray(source.categoryOrder)) {
      throw new Error("categoryOrder 必须是数组");
    }
    result.categoryOrder = source.categoryOrder
      .map(name => String(name || "").slice(0, 100))
      .filter(name => name);
  }

  return result;
}
