const request = require("supertest");
const fs = require("fs");
const path = require("path");

process.env.DATA_DIR = path.join(__dirname, "test-data");

const app = require("../server");

const DATA_FILE = path.join(process.env.DATA_DIR, "custom-data.json");

function resetDataFile() {
  if (fs.existsSync(DATA_FILE)) {
    fs.unlinkSync(DATA_FILE);
  }
}

function writeTestData(data) {
  if (!fs.existsSync(process.env.DATA_DIR)) {
    fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

describe("Authority Navigation API", () => {
  beforeEach(() => {
    resetDataFile();
  });

  afterAll(() => {
    resetDataFile();
    if (fs.existsSync(process.env.DATA_DIR)) {
      fs.rmdirSync(process.env.DATA_DIR);
    }
  });

  describe("GET /health", () => {
    it("returns ok status", async () => {
      const res = await request(app).get("/health");
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe("GET /api/data", () => {
    it("returns default empty structure when no data exists", async () => {
      const res = await request(app).get("/api/data");
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        customLinks: {},
        customCategories: [],
        removedDefaults: [],
        categoryOrder: []
      });
    });

    it("returns persisted data from file", async () => {
      const testData = {
        customLinks: {
          "国家机关": [{ name: "人大", url: "https://www.npc.gov.cn", custom: true }]
        },
        customCategories: [],
        removedDefaults: [],
        categoryOrder: ["国家机关"]
      };
      writeTestData(testData);

      const res = await request(app).get("/api/data");
      expect(res.statusCode).toBe(200);
      expect(res.body.customLinks["国家机关"]).toHaveLength(1);
      expect(res.body.categoryOrder).toEqual(["国家机关"]);
    });
  });

  describe("POST /api/data", () => {
    it("accepts valid payload and persists it", async () => {
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

      // Verify persistence
      const persisted = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      expect(persisted.customLinks["国家机关"][0].name).toBe("人大");
    });

    it("rejects invalid customLinks type", async () => {
      const res = await request(app)
        .post("/api/data")
        .send({ customLinks: "bad" });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe("customLinks must be an object");
    });

    it("rejects invalid customCategories type", async () => {
      const res = await request(app)
        .post("/api/data")
        .send({ customCategories: "bad" });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe("customCategories must be an array");
    });

    it("sanitizes XSS payloads and rejects invalid URLs", async () => {
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

  describe("GET /", () => {
    it("returns the homepage HTML", async () => {
      const res = await request(app).get("/");
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/html/);
      expect(res.text).toContain("Authority Navigation");
    });
  });

  describe("Security headers", () => {
    it("sets Helmet security headers", async () => {
      const res = await request(app).get("/health");
      expect(res.headers["content-security-policy"]).toBeDefined();
      expect(res.headers["x-frame-options"]).toBeDefined();
      expect(res.headers["strict-transport-security"]).toBeDefined();
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });
  });
});
