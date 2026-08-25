const fs = require("fs");
const os = require("os");
const path = require("path");
const { DataStore } = require("../db");
const { createApp } = require("../server");

const TEST_TOKEN = "test-admin-token-1234567890";

// Each test creates its own temp directory via mkdtemp, so Jest workers and
// individual tests never share or delete each other's files.
function createTestContext() {
  function getTestDbPath() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-nav-"));
    return path.join(dir, "data.db");
  }

  function writeLegacyData(dbPath, data) {
    fs.writeFileSync(
      path.join(path.dirname(dbPath), "custom-data.json"),
      JSON.stringify(data, null, 2),
      "utf-8"
    );
  }

  function createTestApp(dbPath, options = {}) {
    const store = new DataStore({ dbPath });
    return createApp(store, { adminToken: TEST_TOKEN, ...options });
  }

  return { TEST_TOKEN, getTestDbPath, writeLegacyData, createTestApp };
}

module.exports = { createTestContext, TEST_TOKEN };
