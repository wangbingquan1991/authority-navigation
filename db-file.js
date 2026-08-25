const fs = require("fs");
const path = require("path");

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Atomic write: stage to a temp file in the same directory, then rename into
// place. POSIX rename on the same filesystem is atomic, so a crash mid-write
// never leaves a truncated database or backup file.
function atomicWrite(filePath, data) {
  ensureParentDir(filePath);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, filePath);
}

// Zero-padded timestamp so lexicographic sort equals chronological sort.
function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

// Keep only the newest `keep` backup files in the directory, oldest first.
function rotateBackups(backupDir, keep) {
  if (!fs.existsSync(backupDir)) return;
  const files = fs
    .readdirSync(backupDir)
    .filter((name) => /^backup-\d{8}-\d{6}\.db$/.test(name))
    .sort();
  const excess = files.length - keep;
  for (let i = 0; i < excess; i++) {
    fs.unlinkSync(path.join(backupDir, files[i]));
  }
}

module.exports = { ensureParentDir, atomicWrite, formatTimestamp, rotateBackups };
