const request = require("supertest");
const crypto = require("crypto");
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
const SESSION_COOKIE_NAME = "nav_session";

function sessionCookieFrom(res) {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : [raw];
  const cookie = list.filter(Boolean).find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  return cookie || "";
}

function forgeSession(value) {
  const secret = crypto.createHash("sha256").update(`nav-session::${TEST_TOKEN}`).digest();
  const signature = crypto
    .createHmac("sha256", secret)
    .update(String(value))
    .digest("base64url");
  return `${SESSION_COOKIE_NAME}=${value}.${signature}`;
}

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

  describe("Session login", () => {
    it("reports unauthenticated before login and authenticated after", async () => {
      const app = createTestApp(dbPath);
      const before = await request(app).get("/api/session");
      expect(before.statusCode).toBe(200);
      expect(before.body).toEqual({ authenticated: false });

      const agent = request.agent(app);
      const loginRes = await agent.post("/api/login").send({ token: TEST_TOKEN });
      expect(loginRes.statusCode).toBe(200);
      expect(loginRes.body.authenticated).toBe(true);

      const after = await agent.get("/api/session");
      expect(after.body).toEqual({ authenticated: true });
    });

    it("returns 401 with an identical body for a wrong token", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app).post("/api/login").send({ token: "wrong-token-1234567890" });
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
      expect(sessionCookieFrom(res)).toBe("");
    });

    it("marks the session cookie HttpOnly and SameSite=Strict", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app).post("/api/login").send({ token: TEST_TOKEN });
      const cookie = sessionCookieFrom(res);
      expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
    });

    // 核心诉求：口令只在登录时校验一次，之后写操作凭会话 Cookie 直接通过。
    it("writes with the session cookie and no token header", async () => {
      const app = createTestApp(dbPath);
      const agent = request.agent(app);
      await agent.post("/api/login").send({ token: TEST_TOKEN });

      const res = await agent
        .post("/api/data")
        .send({ categoryOrder: ["国家机关"] });
      expect(res.statusCode).toBe(200);

      const readRes = await request(app).get("/api/data");
      expect(readRes.body.categoryOrder).toEqual(["国家机关"]);
    });

    it("keeps the token header working for scripts", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app)
        .post("/api/data")
        .set("x-admin-token", TEST_TOKEN)
        .send({ categoryOrder: ["985高校"] });
      expect(res.statusCode).toBe(200);
    });

    it("rejects a session cookie whose signature was tampered with", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app)
        .post("/api/data")
        .set("Cookie", forgeSession(Date.now() + 60_000).replace(/.$/, "x"))
        .send({ categoryOrder: ["国家机关"] });
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
    });

    it("rejects an expired session cookie", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app)
        .post("/api/data")
        .set("Cookie", forgeSession(Date.now() - 60_000))
        .send({ categoryOrder: ["国家机关"] });
      expect(res.statusCode).toBe(401);
    });

    it("clears the session on logout so later writes fail", async () => {
      const app = createTestApp(dbPath);
      const agent = request.agent(app);
      await agent.post("/api/login").send({ token: TEST_TOKEN });
      expect((await agent.post("/api/data").send({ categoryOrder: ["国家机关"] })).statusCode).toBe(200);

      const logoutRes = await agent.post("/api/logout");
      expect(logoutRes.statusCode).toBe(200);
      expect(logoutRes.body).toEqual({ authenticated: false });

      const sessionRes = await agent.get("/api/session");
      expect(sessionRes.body).toEqual({ authenticated: false });

      const writeRes = await agent.post("/api/data").send({ categoryOrder: [] });
      expect(writeRes.statusCode).toBe(401);
    });
  });

  describe("Empty-overwrite guard on POST /api/data", () => {
    const SEED = {
      customLinks: {
        "国家机关": [{ name: "人大", url: "https://www.npc.gov.cn", custom: true }]
      },
      customCategories: [],
      removedDefaults: [],
      categoryOrder: ["国家机关"]
    };

    async function seed(app) {
      const res = await request(app)
        .post("/api/data")
        .set("x-admin-token", TEST_TOKEN)
        .send(SEED);
      expect(res.statusCode).toBe(200);
    }

    // 核心防线：旧版 / 缓存前端在内存状态为空时会自然发出空写入，
    // 整库替换语义下这等于删库，必须被拒绝。
    it("refuses to wipe a non-empty store with an empty payload", async () => {
      const app = createTestApp(dbPath);
      await seed(app);

      const res = await request(app)
        .post("/api/data")
        .set("x-admin-token", TEST_TOKEN)
        .send({});
      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe("EMPTY_OVERWRITE");

      // 既有数据必须原样保留
      const readRes = await request(app).get("/api/data");
      expect(readRes.body.customLinks["国家机关"]).toHaveLength(1);
      expect(readRes.body.categoryOrder).toEqual(["国家机关"]);
    });

    it("refuses an explicitly empty payload without the allowEmpty flag", async () => {
      const app = createTestApp(dbPath);
      await seed(app);

      const res = await request(app)
        .post("/api/data")
        .set("x-admin-token", TEST_TOKEN)
        .send({
          customLinks: {},
          customCategories: [],
          removedDefaults: [],
          removedCommonLinks: [],
          categoryOrder: []
        });
      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe("EMPTY_OVERWRITE");

      const readRes = await request(app).get("/api/data");
      expect(readRes.body.customLinks["国家机关"]).toHaveLength(1);
    });

    it("allows an explicit reset when allowEmpty is set", async () => {
      const app = createTestApp(dbPath);
      await seed(app);

      const res = await request(app)
        .post("/api/data")
        .set("x-admin-token", TEST_TOKEN)
        .send({
          customLinks: {},
          customCategories: [],
          removedDefaults: [],
          removedCommonLinks: [],
          categoryOrder: [],
          allowEmpty: true
        });
      expect(res.statusCode).toBe(200);

      const readRes = await request(app).get("/api/data");
      expect(readRes.body.customLinks).toEqual({});
      expect(readRes.body.categoryOrder).toEqual([]);
    });

    it("accepts an empty payload when the store is already empty", async () => {
      const app = createTestApp(dbPath);
      const res = await request(app)
        .post("/api/data")
        .set("x-admin-token", TEST_TOKEN)
        .send({ customLinks: {}, customCategories: [] });
      expect(res.statusCode).toBe(200);
    });

    it("still accepts a non-empty payload", async () => {
      const app = createTestApp(dbPath);
      await seed(app);
      const res = await request(app)
        .post("/api/data")
        .set("x-admin-token", TEST_TOKEN)
        .send({
          customLinks: {
            "985高校": [{ name: "清华", url: "https://www.tsinghua.edu.cn" }]
          },
          customCategories: [],
          removedDefaults: [],
          categoryOrder: ["985高校"]
        });
      expect(res.statusCode).toBe(200);
      expect(res.body.customLinks["985高校"]).toHaveLength(1);
    });
  });

  describe("Pre-write snapshots", () => {
    function preWriteDirFor(dbPath) {
      return path.join(path.dirname(dbPath), "backups", "pre-write");
    }

    function preWriteFiles(dbPath) {
      const dir = preWriteDirFor(dbPath);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((name) => name.endsWith(".db")).sort();
    }

    it("snapshots the previous state before an overwrite", async () => {
      const store = new DataStore({ dbPath });
      await store.write({
        customLinks: {
          "国家机关": [{ name: "人大", url: "https://www.npc.gov.cn", custom: true }]
        },
        customCategories: [],
        removedDefaults: [],
        categoryOrder: ["国家机关"]
      });

      expect(preWriteFiles(dbPath)).toHaveLength(0);

      // 第二次写入前应留下第一次的状态
      await store.write({
        customLinks: {},
        customCategories: [],
        removedDefaults: [],
        categoryOrder: []
      });

      const files = preWriteFiles(dbPath);
      expect(files).toHaveLength(1);

      const restored = new DataStore({ dbPath: path.join(preWriteDirFor(dbPath), files[0]) });
      const snapshot = await restored.read();
      expect(snapshot.customLinks["国家机关"]).toHaveLength(1);
      expect(snapshot.customLinks["国家机关"][0].name).toBe("人大");

      restored.close();
      store.close();
    });

    it("does not snapshot when the store has no content", async () => {
      const store = new DataStore({ dbPath });
      await store.write({
        customLinks: {},
        customCategories: [],
        removedDefaults: [],
        categoryOrder: []
      });
      expect(preWriteFiles(dbPath)).toHaveLength(0);
      store.close();
    });

    it("bounds snapshot growth by rotating the newest N", async () => {
      const store = new DataStore({ dbPath });
      for (let i = 0; i < 14; i++) {
        await store.write({
          customLinks: {
            "国家机关": [{ name: `链接${i}`, url: `https://example.com/${i}`, custom: true }]
          },
          customCategories: [],
          removedDefaults: [],
          categoryOrder: ["国家机关"]
        });
      }
      const files = preWriteFiles(dbPath);
      expect(files.length).toBeGreaterThan(0);
      expect(files.length).toBeLessThanOrEqual(10);
      store.close();
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
