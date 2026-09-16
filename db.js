const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");
const {
  ensureParentDir,
  atomicWrite,
  formatTimestamp,
  preWriteStamp,
  rotateBackups,
  rotatePreWriteSnapshots,
} = require("./db-file");

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "data.db");

// 写前快照保留份数：写入频率远高于定时备份，单独轮转、份数略多
const PRE_WRITE_KEEP = 10;
const PRE_WRITE_DIR_NAME = "pre-write";

let SQL;
async function getSql() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
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
  atomicWrite(dbPath, Buffer.from(db.export()));
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

/**
 * 库里是否有值得留档的内容。
 * 只看真实的用户内容，不看 settings 的占位行——否则每次「写到空库」
 * 都会留下没有回滚价值的快照，把保留窗口挤满。
 * @param {object} db
 * @returns {boolean}
 */
function hasStoredContent(db) {
  const countRows = (table) => {
    const stmt = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return Number(row.total) || 0;
  };

  if (countRows("custom_links") + countRows("custom_categories") > 0) return true;

  // 移除记录与排序同样是用户改动过的内容，但空数组只是默认值，不算
  return ["removedDefaults", "removedCommonLinks", "categoryOrder"].some((key) => {
    const value = readSetting(db, key, []);
    return Array.isArray(value) && value.length > 0;
  });
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
    const removedCommonLinks = readSetting(db, "removedCommonLinks", []);

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

    return { customLinks, customCategories, removedDefaults, removedCommonLinks, categoryOrder };
  }

  async write(data, options = {}) {
    const db = await this.getDb();

    // 写前快照：write() 是「先 DELETE 全表再重插」的整库替换语义，
    // 一旦写入内容有误（例如空数据），既有数据会被整体抹掉。
    // 因此在动刀之前先把当前状态留档，配合定时备份实现秒级回滚。
    // 快照只是兜底，失败不应阻断写入本身，故整体 try/catch 吞掉异常。
    if (options.snapshot !== false) {
      this.snapshotBeforeWrite(db);
    }

    // Settings
    writeSetting(db, "categoryOrder", data.categoryOrder || []);
    writeSetting(db, "removedDefaults", data.removedDefaults || []);
    writeSetting(db, "removedCommonLinks", data.removedCommonLinks || []);

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

  /**
   * 把当前内存库导出为写前快照文件。
   * 单独放在 backups/pre-write/ 下，避免与定时备份争抢同一保留窗口。
   * @param {object} db
   * @returns {string|null} 快照路径；无内容或失败时返回 null
   */
  snapshotBeforeWrite(db) {
    try {
      if (!hasStoredContent(db)) return null;
      const dir = path.join(path.dirname(this.dbPath), "backups", PRE_WRITE_DIR_NAME);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const filePath = path.join(dir, `pre-write-${preWriteStamp(new Date())}.db`);
      atomicWrite(filePath, Buffer.from(db.export()));
      rotatePreWriteSnapshots(dir, PRE_WRITE_KEEP);
      return filePath;
    } catch (err) {
      console.error("Pre-write snapshot failed:", err.message);
      return null;
    }
  }

  // Snapshot the in-memory database to a backup file using db.export() (a
  // logically consistent full copy), then rotate away surplus old backups.
  async backup(backupDir, keep = 7) {
    const db = await this.getDb();
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const data = db.export();
    const filePath = path.join(backupDir, `backup-${formatTimestamp(new Date())}.db`);
    atomicWrite(filePath, Buffer.from(data));
    rotateBackups(backupDir, keep);
    return filePath;
  }
}

module.exports = { DataStore, DEFAULT_DB_PATH, getLegacyFilePath };
