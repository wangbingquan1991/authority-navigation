const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 前端模块是 ESM，测试运行在 CommonJS 下。quickAccess.js 没有任何 import，
// 因此这里剥掉 export 关键字后用 vm 执行，直接测真实源码——
// 避免为了单测再维护一份逻辑副本。
function loadEsmModule(sourceFile) {
  const src = fs.readFileSync(sourceFile, "utf8");
  const exported = [...src.matchAll(/^export\s+(?:const|function)\s+(\w+)/gm)].map((m) => m[1]);
  const body = src.replace(/^export\s+/gm, "");
  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(`${body}\nmodule.exports = { ${exported.join(", ")} };`, context, {
    filename: sourceFile,
  });
  return context.module.exports;
}

const quickAccessPath = path.join(__dirname, "../pages/js/utils/quickAccess.js");
const { buildQuickAccessPool, rankQuickAccess, QUICK_ACCESS_LIMIT } = loadEsmModule(quickAccessPath);
const defaultConfig = require("../config/default-sites.json");

// 把 config 的 { 名称: { icon, links } } 转成 mergeCategories 输出的数组形态
function defaultCategories() {
  return Object.entries(defaultConfig.categories).map(([name, meta]) => ({
    name,
    icon: meta.icon,
    links: meta.links.map((l) => ({ ...l })),
  }));
}

function statsOf(entries) {
  const stats = {};
  for (const [url, { freq = 0, last = 0 }] of Object.entries(entries)) {
    stats[url] = { hourlyFreq: freq, lastClick: last };
  }
  return stats;
}

describe("快捷入口候选池", () => {
  describe("buildQuickAccessPool", () => {
    it("把各分类的链接全部纳入候选池，并按 URL 去重", () => {
      const categories = [
        { name: "A", links: [{ name: "a1", url: "https://a1.com" }] },
        { name: "B", links: [{ name: "b1", url: "https://b1.com" }, { name: "a1 重复", url: "https://a1.com" }] },
      ];
      const pool = buildQuickAccessPool({ categories });
      expect(pool.map((l) => l.url)).toEqual(["https://a1.com", "https://b1.com"]);
    });

    it("记录链接真正所属的分类，供拖拽改分类使用", () => {
      const categories = [{ name: "国家机关", links: [{ name: "中国政府网", url: "https://www.gov.cn" }] }];
      const pool = buildQuickAccessPool({ categories });
      expect(pool[0].sourceCategory).toBe("国家机关");
    });

    it("只存在于快捷入口的链接，sourceCategory 为 null", () => {
      const pool = buildQuickAccessPool({
        customQuickLinks: [{ name: "我的内网", url: "https://oa.example.com" }],
      });
      expect(pool).toHaveLength(1);
      expect(pool[0].sourceCategory).toBeNull();
      expect(pool[0].custom).toBe(true);
    });

    it("区分「默认分类的原有条目」与「用户自建链接」", () => {
      const categories = [
        { name: "国家机关", isDefault: true, links: [{ name: "中国政府网", url: "https://www.gov.cn" }] },
        { name: "我的收藏", isDefault: false, links: [{ name: "内网", url: "https://oa.example.com", custom: true }] },
      ];
      const pool = buildQuickAccessPool({ categories });
      expect(pool.find((l) => l.url === "https://www.gov.cn").sourceIsStock).toBe(true);
      expect(pool.find((l) => l.url === "https://oa.example.com").sourceIsStock).toBe(false);
    });

    it("被固定到快捷入口，不会把原有条目说成自建链接", () => {
      const categories = [
        { name: "国家机关", isDefault: true, links: [{ name: "中国政府网", url: "https://www.gov.cn" }] },
      ];
      const pool = buildQuickAccessPool({
        categories,
        customQuickLinks: [{ name: "中国政府网", url: "https://www.gov.cn" }],
      });
      const entry = pool.find((l) => l.url === "https://www.gov.cn");
      expect(entry.sourceIsStock).toBe(true);
      expect(entry.custom).toBe(false);
      expect(entry.sourceCategory).toBe("国家机关");
    });

    it("剔除已移出快捷入口的链接，即使它仍存在于某个分类里", () => {
      const categories = [{ name: "A", links: [{ name: "a1", url: "https://a1.com" }] }];
      const pool = buildQuickAccessPool({ categories, removedCommonLinks: ["https://a1.com"] });
      expect(pool).toHaveLength(0);
    });

    it("显式加入快捷入口的链接优先于移出记录（否则重新加入不会生效）", () => {
      const pool = buildQuickAccessPool({
        customQuickLinks: [{ name: "a1", url: "https://a1.com" }],
        removedCommonLinks: ["https://a1.com"],
      });
      expect(pool.map((l) => l.url)).toEqual(["https://a1.com"]);
    });

    it("分类里的自建链接同样进入候选池", () => {
      const categories = [{ name: "我的分类", links: [{ name: "自建", url: "https://mine.com", custom: true }] }];
      const pool = buildQuickAccessPool({ categories });
      expect(pool.map((l) => l.url)).toEqual(["https://mine.com"]);
      expect(pool[0].custom).toBe(true);
    });

    it("忽略缺少 url 的脏数据", () => {
      const pool = buildQuickAccessPool({
        categories: [{ name: "A", links: [{ name: "无网址" }, { name: "空网址", url: "" }] }],
        customQuickLinks: [null, { name: "ok", url: "https://ok.com" }],
      });
      expect(pool.map((l) => l.url)).toEqual(["https://ok.com"]);
    });

    it("空输入返回空数组", () => {
      expect(buildQuickAccessPool()).toEqual([]);
      expect(buildQuickAccessPool({})).toEqual([]);
    });
  });

  describe("rankQuickAccess", () => {
    const categories = [
      { name: "A", links: [{ name: "a1", url: "https://a1.com" }] },
      { name: "B", links: [{ name: "b1", url: "https://b1.com" }] },
    ];
    const seeds = [{ name: "b1", url: "https://b1.com" }];

    it("冷启动（无任何点击记录）时回落到默认精选顺序", () => {
      const pool = buildQuickAccessPool({ categories, seedLinks: seeds });
      const ranked = rankQuickAccess(pool, {}, 10);
      expect(ranked.map((l) => l.name)).toEqual(["b1", "a1"]);
    });

    it("冷启动时用户显式加入的排在默认精选之前", () => {
      const pool = buildQuickAccessPool({
        categories,
        seedLinks: seeds,
        customQuickLinks: [{ name: "我的内网", url: "https://oa.example.com" }],
      });
      const ranked = rankQuickAccess(pool, {}, 10);
      expect(ranked.map((l) => l.name)).toEqual(["我的内网", "b1", "a1"]);
    });

    it("分类里的链接只要用得多，就会浮到未点击的默认精选之前", () => {
      const pool = buildQuickAccessPool({ categories, seedLinks: seeds });
      const stats = statsOf({ "https://a1.com": { freq: 8 }, "https://b1.com": { freq: 0 } });
      const ranked = rankQuickAccess(pool, stats, 10);
      expect(ranked.map((l) => l.name)).toEqual(["a1", "b1"]);
    });

    it("自定义添加的网址能凭使用频率进入快捷入口", () => {
      const categories = [
        { name: "国家机关", links: [{ name: "默认站", url: "https://d1.com" }] },
        { name: "我的收藏", links: [{ name: "我的内网OA", url: "https://oa.example.com", custom: true }] },
      ];
      const pool = buildQuickAccessPool({ categories });
      const stats = statsOf({ "https://oa.example.com": { freq: 12 } });
      const ranked = rankQuickAccess(pool, stats, 10);
      expect(ranked[0].name).toBe("我的内网OA");
      expect(ranked[0].sourceCategory).toBe("我的收藏");
    });

    it("已移出快捷入口的链接不会因使用频率高而回来", () => {
      const pool = buildQuickAccessPool({
        categories,
        seedLinks: seeds,
        removedCommonLinks: ["https://a1.com"],
      });
      const stats = statsOf({ "https://a1.com": { freq: 999 } });
      const ranked = rankQuickAccess(pool, stats, 10);
      expect(ranked.map((l) => l.url)).toEqual(["https://b1.com"]);
    });

    it("频率相同时最近点击的优先", () => {
      const pool = buildQuickAccessPool({ categories });
      const stats = statsOf({
        "https://a1.com": { freq: 5, last: 100 },
        "https://b1.com": { freq: 5, last: 200 },
      });
      expect(rankQuickAccess(pool, stats, 10).map((l) => l.name)).toEqual(["b1", "a1"]);
    });

    it("按 limit 截断", () => {
      const many = Array.from({ length: 40 }, (_, i) => [{ name: `c${i}`, url: `https://c${i}.com` }]);
      const pool = buildQuickAccessPool({ categories: many.map((links, i) => ({ name: `n${i}`, links })) });
      expect(pool).toHaveLength(40);
      expect(rankQuickAccess(pool, {}, 5)).toHaveLength(5);
      expect(rankQuickAccess(pool, {}, QUICK_ACCESS_LIMIT)).toHaveLength(QUICK_ACCESS_LIMIT);
    });

    it("返回结果不携带内部排序字段", () => {
      const pool = buildQuickAccessPool({ categories });
      expect(Object.keys(rankQuickAccess(pool, {}, 1)[0]).sort()).toEqual(
        ["custom", "name", "sourceCategory", "sourceIsStock", "url"]
      );
    });

    it("空池安全返回", () => {
      expect(rankQuickAccess([], {}, 10)).toEqual([]);
      expect(rankQuickAccess()).toEqual([]);
    });
  });

  describe("与真实默认配置结合", () => {
    const categories = defaultCategories();
    const seeds = defaultConfig.commonLinks;

    it("冷启动时展示的就是默认精选那 25 条，且保持原顺序", () => {
      const pool = buildQuickAccessPool({ categories, seedLinks: seeds });
      const ranked = rankQuickAccess(pool, {}, QUICK_ACCESS_LIMIT);
      expect(ranked.map((l) => l.url)).toEqual(seeds.slice(0, QUICK_ACCESS_LIMIT).map((l) => l.url));
    });

    it("候选池覆盖全站链接，远多于默认精选", () => {
      const pool = buildQuickAccessPool({ categories, seedLinks: seeds });
      const allUrls = new Set(categories.flatMap((c) => c.links.map((l) => l.url)));
      expect(pool.length).toBeGreaterThanOrEqual(allUrls.size);
      expect(pool.length).toBeGreaterThan(seeds.length);
    });

    it("不在默认精选里的分类链接，靠使用频率可以挤进快捷入口", () => {
      const pool = buildQuickAccessPool({ categories, seedLinks: seeds });
      const seedUrls = new Set(seeds.map((l) => l.url));
      const candidate = pool.find((l) => !seedUrls.has(l.url));

      expect(candidate).toBeDefined();
      // 冷启动时它进不来
      const cold = rankQuickAccess(pool, {}, QUICK_ACCESS_LIMIT).map((l) => l.url);
      expect(cold).not.toContain(candidate.url);

      // 用得多之后它排到最前
      const stats = statsOf({ [candidate.url]: { freq: 50 } });
      const warm = rankQuickAccess(pool, stats, QUICK_ACCESS_LIMIT);
      expect(warm[0].url).toBe(candidate.url);
      expect(warm).toHaveLength(QUICK_ACCESS_LIMIT);
    });
  });
});
