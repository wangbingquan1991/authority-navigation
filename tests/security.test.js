const request = require("supertest");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { DataStore } = require("../db");
const { startBackupScheduler } = require("../backup");
const {
  TEST_TOKEN,
  getTestDbPath,
  createTestApp,
} = require("./helpers").createTestContext();

const PROJECT_ROOT = path.join(__dirname, "..");

function runServerWithEnv(env) {
  return spawnSync(process.execPath, ["server.js"], {
    cwd: PROJECT_ROOT,
    env,
    encoding: "utf-8",
    timeout: 15000,
  });
}

describe("Security hardening", () => {
  let dbPath;

  beforeEach(() => {
    dbPath = getTestDbPath();
  });

  describe("Authentication", () => {
    it("returns 401 when the token header is missing", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app)
        .post("/api/data")
        .send({ categoryOrder: ["国家机关"] });
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
      expect(res.headers["www-authenticate"]).toBeUndefined();
    });

    it("returns an identical 401 body for a wrong token (no distinction)", async () => {
      const app = createTestApp(dbPath);
      const missing = await request(app)
        .post("/api/data")
        .send({ categoryOrder: ["国家机关"] });
      const wrong = await request(app)
        .post("/api/data")
        .set("x-admin-token", "wrong-token-1234567890")
        .send({ categoryOrder: ["国家机关"] });
      expect(missing.statusCode).toBe(401);
      expect(wrong.statusCode).toBe(401);
      expect(wrong.body).toEqual(missing.body);
    });

    it("persists data with a correct token", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app)
        .post("/api/data")
        .set("x-admin-token", TEST_TOKEN)
        .send({ categoryOrder: ["国家机关"] });
      expect(res.statusCode).toBe(200);
      expect(res.body.categoryOrder).toEqual(["国家机关"]);

      const readRes = await request(app).get("/api/data");
      expect(readRes.body.categoryOrder).toEqual(["国家机关"]);
    });

    it("keeps read endpoints anonymous", async () => {
      const app = createTestApp(dbPath);
      const dataRes = await request(app).get("/api/data");
      expect(dataRes.statusCode).toBe(200);
      const healthRes = await request(app).get("/health");
      expect(healthRes.statusCode).toBe(200);
    });

    it("returns 401 for an empty token header value", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app)
        .post("/api/data")
        .set("x-admin-token", "")
        .send({ categoryOrder: ["国家机关"] });
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
    });

    // Regression: duplicate x-admin-token headers must not bypass auth.
    // Node.js joins duplicate headers with ", " (e.g. "tok,tok"), which must
    // fail the digest comparison. supertest overwrites same-name headers, so
    // we invoke the middleware directly with the comma-joined value.
    it("rejects duplicate x-admin-token headers even when both are correct", async () => {
      const { createAdminAuthMiddleware } = require("../auth");
      const middleware = createAdminAuthMiddleware(TEST_TOKEN);
      const joined = `${TEST_TOKEN},${TEST_TOKEN}`;
      const req = { get: (name) => (name.toLowerCase() === "x-admin-token" ? joined : undefined) };
      const res = {
        statusCode: 0,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
      };
      let passed = false;
      await middleware(req, res, () => { passed = true; });
      expect(passed).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
    });

    it("fails to start when ADMIN_TOKEN is unset", () => {
      const env = { ...process.env };
      delete env.ADMIN_TOKEN;
      const result = runServerWithEnv(env);
      expect(result.status).not.toBe(0);
    });

    it("fails to start when ADMIN_TOKEN is shorter than 16 characters", () => {
      const result = runServerWithEnv({ ...process.env, ADMIN_TOKEN: "short" });
      expect(result.status).not.toBe(0);
    });
  });

  describe("Rate limiting on POST /api/data", () => {
    afterEach(() => {
      delete process.env.WRITE_RATE_LIMIT_MAX;
    });

    it("returns 429 with Retry-After after exceeding the write limit", async () => {
      process.env.WRITE_RATE_LIMIT_MAX = "3";
      const app = createTestApp(dbPath);

      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post("/api/data")
          .set("x-admin-token", TEST_TOKEN)
          .send({ categoryOrder: ["国家机关"] });
        expect(res.statusCode).toBe(200);
      }

      const res = await request(app)
        .post("/api/data")
        .set("x-admin-token", TEST_TOKEN)
        .send({ categoryOrder: ["国家机关"] });
      expect(res.statusCode).toBe(429);
      expect(res.body).toEqual({ error: "Too many requests" });
      expect(res.headers["retry-after"]).toBeDefined();
    });

    it("counts failed-auth attempts toward the limit (rate limit before auth)", async () => {
      process.env.WRITE_RATE_LIMIT_MAX = "3";
      const app = createTestApp(dbPath);

      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post("/api/data")
          .set("x-admin-token", "wrong-token-1234567890")
          .send({ categoryOrder: [] });
        expect(res.statusCode).toBe(401);
      }

      const res = await request(app)
        .post("/api/data")
        .set("x-admin-token", TEST_TOKEN)
        .send({ categoryOrder: ["国家机关"] });
      expect(res.statusCode).toBe(429);
    });

    it("does not rate-limit read endpoints", async () => {
      process.env.WRITE_RATE_LIMIT_MAX = "3";
      const app = createTestApp(dbPath);

      for (let i = 0; i < 3; i++) {
        await request(app)
          .post("/api/data")
          .set("x-admin-token", TEST_TOKEN)
          .send({ categoryOrder: ["国家机关"] });
      }

      const dataRes = await request(app).get("/api/data");
      expect(dataRes.statusCode).toBe(200);
      const healthRes = await request(app).get("/health");
      expect(healthRes.statusCode).toBe(200);
    });
  });

  describe("Backup", () => {
    it("writes a restorable backup via db.export()", async () => {
      const store = new DataStore({ dbPath });
      await store.write({
        customLinks: {
          "国家机关": [{ name: "人大", url: "https://www.npc.gov.cn", custom: true }]
        },
        customCategories: [],
        removedDefaults: [],
        categoryOrder: ["国家机关"]
      });

      const backupDir = path.join(path.dirname(dbPath), "backups");
      const backupPath = await store.backup(backupDir);
      expect(fs.existsSync(backupPath)).toBe(true);
      expect(path.basename(backupPath)).toMatch(/^backup-\d{8}-\d{6}\.db$/);

      const restored = new DataStore({ dbPath: backupPath });
      const data = await restored.read();
      expect(data.customLinks["国家机关"]).toHaveLength(1);
      expect(data.customLinks["国家机关"][0].name).toBe("人大");

      restored.close();
      store.close();
    });

    it("rotates away surplus backups keeping only the newest N", async () => {
      const store = new DataStore({ dbPath });
      await store.read();

      const backupDir = path.join(path.dirname(dbPath), "backups");
      const keep = 2;

      jest.useFakeTimers();
      try {
        for (let i = 0; i < 5; i++) {
          jest.setSystemTime(new Date(2026, 0, 1, 0, 0, i));
          await store.backup(backupDir, keep);
        }
      } finally {
        jest.useRealTimers();
      }

      const files = fs
        .readdirSync(backupDir)
        .filter((name) => name.endsWith(".db"))
        .sort();
      expect(files).toHaveLength(keep);
      expect(files).toContain("backup-20260101-000003.db");
      expect(files).toContain("backup-20260101-000004.db");
      expect(files).not.toContain("backup-20260101-000000.db");

      store.close();
    });

    it("leaves no .tmp residue after an atomic persist", async () => {
      const store = new DataStore({ dbPath });
      await store.write({
        customLinks: {},
        customCategories: [],
        removedDefaults: [],
        categoryOrder: []
      });

      expect(fs.existsSync(dbPath)).toBe(true);
      expect(fs.existsSync(`${dbPath}.tmp`)).toBe(false);
      const tmpFiles = fs
        .readdirSync(path.dirname(dbPath))
        .filter((name) => name.endsWith(".tmp"));
      expect(tmpFiles).toHaveLength(0);

      store.close();
    });

    it("clears the interval after stop()", () => {
      jest.useFakeTimers();
      try {
        const backup = jest.fn().mockResolvedValue("/tmp/backup.db");
        const store = { backup };
        const scheduler = startBackupScheduler(store, {
          intervalHours: 1,
          backupDir: path.join(path.dirname(dbPath), "backups")
        });

        jest.advanceTimersByTime(60 * 60 * 1000);
        expect(backup).toHaveBeenCalledTimes(1);

        scheduler.stop();
        jest.advanceTimersByTime(2 * 60 * 60 * 1000);
        expect(backup).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
