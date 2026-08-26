const request = require("supertest");
const fs = require("fs");
const path = require("path");
const { DataStore } = require("../db");
const { createApp } = require("../server");

const TEST_DATA_DIR = path.join(__dirname, "test-data");

function resetTestData() {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

function getTestDbPath() {
  return path.join(TEST_DATA_DIR, `test-${Date.now()}.db`);
}

function writeLegacyData(dbPath, data) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(dir, "custom-data.json"),
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}

function createTestApp(dbPath) {
  const store = new DataStore({ dbPath });
  return createApp(store);
}

describe("Authority Navigation API", () => {
  let dbPath;

  beforeEach(() => {
    resetTestData();
    dbPath = getTestDbPath();
  });

  afterAll(() => {
    resetTestData();
  });

  describe("GET /health", () => {
    it("returns ok status", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app).get("/health");
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe("GET /api/data", () => {
    it("returns default empty structure when no data exists", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app).get("/api/data");
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        customLinks: {},
        customCategories: [],
        removedDefaults: [],
        categoryOrder: []
      });
    });

    it("returns persisted data", async () => {
      const app = createTestApp(dbPath);
      const payload = {
        customLinks: {
          "国家机关": [{ name: "人大", url: "https://www.npc.gov.cn", custom: true }]
        },
        customCategories: [],
        removedDefaults: [],
        categoryOrder: ["国家机关"]
      };
      await request(app).post("/api/data").send(payload);

      const res = await request(app).get("/api/data");
      expect(res.statusCode).toBe(200);
      expect(res.body.customLinks["国家机关"]).toHaveLength(1);
      expect(res.body.categoryOrder).toEqual(["国家机关"]);
    });
  });

  describe("POST /api/data", () => {
    it("accepts valid payload and persists it", async () => {
      const app = createTestApp(dbPath);
      const payload = {
        customLinks: {
          "国家机关": [{ name: "人大", url: "https://www.npc.gov.cn", custom: true }]
        },
        customCategories: [
          {
            name: "测试分类",
            icon: "icon",
            links: [{ name: "Example", url: "https://example.com" }]
          }
        ],
        removedDefaults: ["https://removed.example.com"],
        categoryOrder: ["国家机关", "测试分类"]
      };

      const res = await request(app).post("/api/data").send(payload);
      expect(res.statusCode).toBe(200);
      expect(res.body.customLinks["国家机关"]).toHaveLength(1);
      expect(res.body.customCategories).toHaveLength(1);
      expect(res.body.removedDefaults).toHaveLength(1);
      expect(res.body.categoryOrder).toEqual(["国家机关", "测试分类"]);

      // Verify persistence via a fresh read
      const readRes = await request(app).get("/api/data");
      expect(readRes.body.customLinks["国家机关"][0].name).toBe("人大");
    });

    it("rejects invalid customLinks type", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app)
        .post("/api/data")
        .send({ customLinks: "bad" });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe("customLinks must be an object");
    });

    it("rejects invalid customCategories type", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app)
        .post("/api/data")
        .send({ customCategories: "bad" });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe("customCategories must be an array");
    });

    it("sanitizes XSS payloads and rejects invalid URLs", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app)
        .post("/api/data")
        .send({
          customLinks: {
            "国家机关": [
              { name: "<script>alert(1)</script>", url: "javascript:alert(1)" }
            ]
          }
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.customLinks).toEqual({});
    });

    it("filters out non-http/https URLs", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app)
        .post("/api/data")
        .send({
          customLinks: {
            "国家机关": [
              { name: "Valid", url: "https://valid.com" },
              { name: "Invalid", url: "ftp://invalid.com" }
            ]
          }
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.customLinks["国家机关"]).toHaveLength(1);
      expect(res.body.customLinks["国家机关"][0].url).toBe("https://valid.com");
    });

    it("limits string length", async () => {
      const app = createTestApp(dbPath);
      const longName = "a".repeat(300);
      const res = await request(app)
        .post("/api/data")
        .send({
          customLinks: {
            "国家机关": [{ name: longName, url: "https://example.com" }]
          }
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.customLinks["国家机关"][0].name.length).toBe(100);
    });
  });

  describe("Legacy JSON migration", () => {
    it("migrates legacy custom-data.json to SQLite on startup", async () => {
      writeLegacyData(dbPath, {
        customLinks: {
          "国家机关": [{ name: "政协", url: "https://www.cppcc.gov.cn", custom: true }]
        },
        customCategories: [
          {
            name: "我的分类",
            icon: "star",
            links: [{ name: "GitHub", url: "https://github.com" }]
          }
        ],
        removedDefaults: ["https://removed.example.com"],
        categoryOrder: ["我的分类", "国家机关"]
      });

      const app = createTestApp(dbPath);
      const res = await request(app).get("/api/data");
      expect(res.statusCode).toBe(200);
      expect(res.body.customLinks["国家机关"]).toHaveLength(1);
      expect(res.body.customCategories).toHaveLength(1);
      expect(res.body.categoryOrder).toEqual(["我的分类", "国家机关"]);

      // Legacy file should be renamed
      expect(fs.existsSync(path.join(path.dirname(dbPath), "custom-data.json"))).toBe(false);
      expect(fs.existsSync(path.join(path.dirname(dbPath), "custom-data.json.migrated"))).toBe(true);
    });
  });

  describe("GET /", () => {
    it("returns the homepage HTML", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app).get("/");
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/html/);
      expect(res.text).toContain("Authority Navigation");
    });
  });

  describe("Security headers", () => {
    it("sets Helmet security headers", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app).get("/health");
      expect(res.headers["content-security-policy"]).toBeDefined();
      expect(res.headers["x-frame-options"]).toBeDefined();
      expect(res.headers["strict-transport-security"]).toBeDefined();
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });
  });
});
