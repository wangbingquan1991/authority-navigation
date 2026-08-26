const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "data.db");
const LEGACY_DATA_FILE = path.join(DATA_DIR, "custom-data.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

let SQL;
async function getSql() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function loadDb(dbPath) {
  ensureParentDir(dbPath);
  const sql = await getSql();
  if (fs.existsSync(dbPath)) {
    const filebuffer = fs.readFileSync(dbPath);
    return new sql.Database(filebuffer);
  }
  return new sql.Database();
}

function persistDb(db, dbPath) {
  ensureParentDir(dbPath);
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function initSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      icon TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS custom_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_name TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      is_custom INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_links_category ON custom_links(category_name);
  `);
}

function getLegacyFilePath(dbPath) {
  return path.join(path.dirname(dbPath), "custom-data.json");
}

async function migrateLegacyData(db, dbPath) {
  const legacyFile = getLegacyFilePath(dbPath);
  if (!fs.existsSync(legacyFile)) return;

  try {
    const raw = fs.readFileSync(legacyFile, "utf-8");
    const parsed = JSON.parse(raw);

    const insertSetting = db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
    );
    insertSetting.run(["categoryOrder", JSON.stringify(parsed.categoryOrder || [])]);
    insertSetting.run(["removedDefaults", JSON.stringify(parsed.removedDefaults || [])]);

    const insertCategory = db.prepare(
      "INSERT OR REPLACE INTO custom_categories (name, icon, sort_order) VALUES (?, ?, ?)"
    );
    const insertLink = db.prepare(
      "INSERT INTO custom_links (category_name, name, url, is_custom, sort_order) VALUES (?, ?, ?, ?, ?)"
    );
    const deleteLinks = db.prepare("DELETE FROM custom_links WHERE category_name = ?");

    // Migrate custom links attached to default categories
    if (parsed.customLinks && typeof parsed.customLinks === "object") {
      let order = 0;
      for (const [categoryName, items] of Object.entries(parsed.customLinks)) {
        if (!Array.isArray(items) || items.length === 0) continue;
        deleteLinks.run([categoryName]);
        for (const item of items) {
          insertLink.run([
            categoryName,
            String(item.name || "").slice(0, 100),
            String(item.url || "").slice(0, 2048),
            item.custom === true ? 1 : 0,
            order++
          ]);
        }
      }
    }

    // Migrate custom categories
    if (Array.isArray(parsed.customCategories)) {
      parsed.customCategories.forEach((cat, catIndex) => {
        if (!cat.name) return;
        insertCategory.run([
          String(cat.name).slice(0, 100),
          String(cat.icon || "").slice(0, 500),
          catIndex
        ]);
        deleteLinks.run([cat.name]);
        if (Array.isArray(cat.links)) {
          cat.links.forEach((item, linkIndex) => {
            insertLink.run([
              String(cat.name).slice(0, 100),
              String(item.name || "").slice(0, 100),
              String(item.url || "").slice(0, 2048),
              item.custom === true ? 1 : 0,
              linkIndex
            ]);
          });
        }
      });
    }

    persistDb(db, dbPath);

    // Rename legacy file so migration runs only once
    fs.renameSync(legacyFile, `${legacyFile}.migrated`);
    console.log("Legacy JSON data migrated to SQLite successfully");
  } catch (err) {
    console.error("Failed to migrate legacy data:", err.message);
  }
}

function readSetting(db, key, defaultValue) {
  const stmt = db.prepare("SELECT value FROM settings WHERE key = ?");
  const result = stmt.getAsObject([key]);
  stmt.free();
  if (!result || !result.value) return defaultValue;
  try {
    return JSON.parse(result.value);
  } catch {
    return defaultValue;
  }
}

function writeSetting(db, key, value) {
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  stmt.run([key, JSON.stringify(value)]);
  stmt.free();
}

class DataStore {
  constructor(options = {}) {
    this.dbPath = options.dbPath || DEFAULT_DB_PATH;
    this.legacyFile = options.legacyFile || getLegacyFilePath(this.dbPath);
    this.dbPromise = this.init();
  }

  async init() {
    const db = await loadDb(this.dbPath);
    initSchema(db);
    await migrateLegacyData(db, this.dbPath);
    return db;
  }

  async getDb() {
    return this.dbPromise;
  }

  close() {
    this.dbPromise.then((db) => db.close()).catch(() => {});
  }

  async read() {
    const db = await this.getDb();
    const categoryOrder = readSetting(db, "categoryOrder", []);
    const removedDefaults = readSetting(db, "removedDefaults", []);

    const categoryStmt = db.prepare("SELECT name FROM custom_categories");
    const customCategoryNames = new Set();
    while (categoryStmt.step()) {
      customCategoryNames.add(categoryStmt.getAsObject().name);
    }
    categoryStmt.free();

    const linkStmt = db.prepare(
      "SELECT category_name, name, url, is_custom FROM custom_links ORDER BY sort_order"
    );
    const linksByCategory = {};
    while (linkStmt.step()) {
      const row = linkStmt.getAsObject();
      if (!linksByCategory[row.category_name]) {
        linksByCategory[row.category_name] = [];
      }
      linksByCategory[row.category_name].push({
        name: row.name,
        url: row.url,
        custom: row.is_custom === 1,
      });
    }
    linkStmt.free();

    const customLinks = {};
    const customCategories = [];

    for (const [categoryName, links] of Object.entries(linksByCategory)) {
      if (customCategoryNames.has(categoryName)) {
        const catStmt = db.prepare("SELECT icon FROM custom_categories WHERE name = ?");
        const catRow = catStmt.getAsObject([categoryName]);
        catStmt.free();
        customCategories.push({
          name: categoryName,
          icon: catRow ? catRow.icon : "",
          links,
        });
      } else {
        customLinks[categoryName] = links;
      }
    }

    return { customLinks, customCategories, removedDefaults, categoryOrder };
  }

  async write(data) {
    const db = await this.getDb();

    // Settings
    writeSetting(db, "categoryOrder", data.categoryOrder || []);
    writeSetting(db, "removedDefaults", data.removedDefaults || []);

    // Clear existing data
    db.run("DELETE FROM custom_links");
    db.run("DELETE FROM custom_categories");

    // Insert custom categories first
    const customCategoryNames = new Set();
    if (Array.isArray(data.customCategories)) {
      const insertCategory = db.prepare(
        "INSERT INTO custom_categories (name, icon, sort_order) VALUES (?, ?, ?)"
      );
      data.customCategories.forEach((cat, index) => {
        if (!cat.name) return;
        customCategoryNames.add(cat.name);
        insertCategory.run([cat.name, cat.icon || "", index]);
      });
      insertCategory.free();
    }

    // Insert links
    const insertLink = db.prepare(
      "INSERT INTO custom_links (category_name, name, url, is_custom, sort_order) VALUES (?, ?, ?, ?, ?)"
    );

    if (data.customLinks && typeof data.customLinks === "object") {
      Object.entries(data.customLinks).forEach(([categoryName, items]) => {
        if (!Array.isArray(items)) return;
        items.forEach((item, index) => {
          insertLink.run([
            categoryName,
            item.name,
            item.url,
            item.custom === true ? 1 : 0,
            index
          ]);
        });
      });
    }

    if (Array.isArray(data.customCategories)) {
      data.customCategories.forEach((cat) => {
        if (!cat.name || !Array.isArray(cat.links)) return;
        cat.links.forEach((item, index) => {
          insertLink.run([
            cat.name,
            item.name,
            item.url,
            item.custom === true ? 1 : 0,
            index
          ]);
        });
      });
    }

    insertLink.free();
    persistDb(db, this.dbPath);
  }
}

module.exports = { DataStore, DEFAULT_DB_PATH, getLegacyFilePath };
