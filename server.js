const express = require("express");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "custom-data.json");

// Security headers via Helmet
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
app.use(express.static(path.join(__dirname, "pages")));
app.use("/assets", express.static(path.join(__dirname, "assets")));

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readData() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    return { customLinks: {}, customCategories: [], removedDefaults: [], categoryOrder: [] };
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      customLinks: parsed.customLinks || {},
      customCategories: parsed.customCategories || [],
      removedDefaults: parsed.removedDefaults || [],
      categoryOrder: parsed.categoryOrder || []
    };
  } catch (err) {
    console.error("Failed to read custom data file:", err.message);
    return { customLinks: {}, customCategories: [], removedDefaults: [], categoryOrder: [] };
  }
}

function writeData(data) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

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

app.get("/api/data", (req, res) => {
  res.json(readData());
});

app.post("/api/data", (req, res) => {
  const validation = validatePayload(req.body);
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }
  writeData(validation.data);
  res.json(validation.data);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "pages", "index.html"));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, () => {
  console.log(`Authority navigation server running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  server.close(() => {
    process.exit(0);
  });
});
