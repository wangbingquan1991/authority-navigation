const express = require("express");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
const { rateLimit } = require("express-rate-limit");
const { DataStore } = require("./db");
const { createAdminAuthMiddleware, MIN_TOKEN_LENGTH } = require("./auth");
const { startBackupScheduler } = require("./backup");

const PORT = process.env.PORT || 3000;
const WRITE_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const DEFAULT_SITES_PATH = process.env.DEFAULT_SITES_PATH || path.join(__dirname, "config", "default-sites.json");
function loadDefaultSites() {
  try {
    const raw = fs.readFileSync(DEFAULT_SITES_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to load default sites config:", err.message);
    return { categories: {}, defaultCategoryIcon: "M12 2v20 M2 12h20" };
  }
}

function resolveAdminToken(options) {
  const token = options.adminToken || process.env.ADMIN_TOKEN;
  if (typeof token !== "string" || token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `ADMIN_TOKEN must be configured as a string of at least ${MIN_TOKEN_LENGTH} characters to protect the write endpoint`
    );
  }
  return token;
}

function resolveWriteRateLimitMax() {
  const raw = process.env.WRITE_RATE_LIMIT_MAX;
  if (raw === undefined || raw === "") return 50;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return parsed;
}

// Security headers via Helmet
function createApp(store, options = {}) {
  const adminToken = resolveAdminToken(options);
  const app = express();

  // trust proxy must be set before any rate limiter so req.ip reflects the
  // real client address behind the Nginx reverse proxy. Without it all
  // traffic would share a single rate-limit bucket.
  app.set("trust proxy", 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        fontSrc: ["'self'", "https:", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }));

  app.use(express.json({ limit: "1mb" }));

  const noCacheStatic = (root) => express.static(root, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html") || filePath.endsWith(".js") || filePath.endsWith(".css")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    }
  });

  app.use(noCacheStatic(path.join(__dirname, "pages")));
  app.use("/assets", noCacheStatic(path.join(__dirname, "assets")));
  app.use("/config", noCacheStatic(path.join(__dirname, "config")));

  function sanitizeString(input, maxLength = 200) {
    if (typeof input !== "string") return "";
    return input
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, maxLength);
  }

  function isValidUrl(str) {
    if (typeof str !== "string" || str.length === 0 || str.length > 2048) return false;
    try {
      const url = new URL(str);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  function validateAndSanitizeLinkItem(item) {
    if (!isPlainObject(item)) return null;
    const name = sanitizeString(item.name, 100);
    const url = sanitizeString(item.url, 2048);
    if (!name || !isValidUrl(url)) return null;
    return { name, url, custom: item.custom === true };
  }

  function validateCustomCategory(cat) {
    if (!isPlainObject(cat)) return null;
    const name = sanitizeString(cat.name, 100);
    if (!name) return null;

    const links = [];
    if (Array.isArray(cat.links)) {
      for (const item of cat.links) {
        const sanitized = validateAndSanitizeLinkItem(item);
        if (sanitized) links.push(sanitized);
      }
    }
    return { name, icon: sanitizeString(cat.icon, 500), links };
  }

  function validatePayload(payload) {
    if (!isPlainObject(payload)) {
      return { error: "Payload must be a JSON object" };
    }

    const result = {
      customLinks: {},
      customCategories: [],
      removedDefaults: [],
      categoryOrder: []
    };

    if (payload.customLinks !== undefined) {
      if (!isPlainObject(payload.customLinks)) {
        return { error: "customLinks must be an object" };
      }
      for (const [category, items] of Object.entries(payload.customLinks)) {
        const key = sanitizeString(category, 100);
        if (!key) continue;
        if (!Array.isArray(items)) {
          return { error: `customLinks[${key}] must be an array` };
        }
        const sanitizedItems = [];
        for (const item of items) {
          const sanitized = validateAndSanitizeLinkItem(item);
          if (sanitized) sanitizedItems.push(sanitized);
        }
        if (sanitizedItems.length > 0) {
          result.customLinks[key] = sanitizedItems;
        }
      }
    }

    if (payload.customCategories !== undefined) {
      if (!Array.isArray(payload.customCategories)) {
        return { error: "customCategories must be an array" };
      }
      for (const cat of payload.customCategories) {
        const sanitized = validateCustomCategory(cat);
        if (sanitized && sanitized.links.length > 0) {
          result.customCategories.push(sanitized);
        }
      }
    }

    if (payload.removedDefaults !== undefined) {
      if (!Array.isArray(payload.removedDefaults)) {
        return { error: "removedDefaults must be an array" };
      }
      for (const url of payload.removedDefaults) {
        const sanitized = sanitizeString(url, 2048);
        if (isValidUrl(sanitized)) {
          result.removedDefaults.push(sanitized);
        }
      }
    }

    if (payload.categoryOrder !== undefined) {
      if (!Array.isArray(payload.categoryOrder)) {
        return { error: "categoryOrder must be an array" };
      }
      for (const name of payload.categoryOrder) {
        const sanitized = sanitizeString(name, 100);
        if (sanitized && !result.categoryOrder.includes(sanitized)) {
          result.categoryOrder.push(sanitized);
        }
      }
    }

    return { data: result };
  }

  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/config", (req, res) => {
    res.json(loadDefaultSites());
  });

  app.get("/api/data", async (req, res, next) => {
    try {
      const data = await store.read();
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // Rate limiting runs before authentication so brute-force token attempts
  // are counted in the same window as legitimate writes.
  const writeRateLimiter = rateLimit({
    windowMs: WRITE_RATE_LIMIT_WINDOW_MS,
    limit: resolveWriteRateLimitMax(),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests" },
  });

  const requireAdminToken = createAdminAuthMiddleware(adminToken);

  app.post("/api/data", writeRateLimiter, requireAdminToken, async (req, res, next) => {
    try {
      const validation = validatePayload(req.body);
      if (validation.error) {
        return res.status(400).json({ error: validation.error });
      }
      await store.write(validation.data);
      res.json(validation.data);
    } catch (err) {
      next(err);
    }
  });

  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "pages", "index.html"));
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error("Unhandled error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  const store = new DataStore();

  let app;
  try {
    app = createApp(store);
  } catch (err) {
    console.error(`Startup failed: ${err.message}`);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`Authority navigation server running on port ${PORT}`);
  });

  const backupScheduler = startBackupScheduler(store);

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down gracefully`);
    backupScheduler.stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
