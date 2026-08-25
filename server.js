const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "custom-data.json");

app.use(express.json());
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

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/data", (req, res) => {
  res.json(readData());
});

app.post("/api/data", (req, res) => {
  const payload = req.body || {};
  const data = {
    customLinks: payload.customLinks || {},
    customCategories: payload.customCategories || [],
    removedDefaults: payload.removedDefaults || [],
    categoryOrder: payload.categoryOrder || []
  };
  writeData(data);
  res.json(data);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "pages", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Authority navigation server running on port ${PORT}`);
});
