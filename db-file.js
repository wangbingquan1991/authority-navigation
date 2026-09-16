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

// 写前快照的额外毫秒位：整库替换可能在同一秒内连续发生多次
// （如一次拖拽同时触发「加到目标分类」和「从源分类移除」），
// 仅精确到秒会互相覆盖，丢掉可回滚的中间状态。
function preWriteStamp(date) {
  return `${formatTimestamp(date)}-${String(date.getMilliseconds()).padStart(3, "0")}`;
}

const BACKUP_FILE_PATTERN = /^backup-\d{8}-\d{6}\.db$/;
const PRE_WRITE_FILE_PATTERN = /^pre-write-\d{8}-\d{6}-\d{3}\.db$/;

// Keep only the newest `keep` files matching `pattern`, oldest first.
function rotateMatchingFiles(dir, keep, pattern) {
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((name) => pattern.test(name))
    .sort();
  const excess = files.length - keep;
  for (let i = 0; i < excess; i++) {
    fs.unlinkSync(path.join(dir, files[i]));
  }
}

// Keep only the newest `keep` backup files in the directory, oldest first.
function rotateBackups(backupDir, keep) {
  rotateMatchingFiles(backupDir, keep, BACKUP_FILE_PATTERN);
}

// 写前快照单独轮转：避免高频写入的快照把定时备份挤出保留窗口。
function rotatePreWriteSnapshots(dir, keep) {
  rotateMatchingFiles(dir, keep, PRE_WRITE_FILE_PATTERN);
}

module.exports = {
  ensureParentDir,
  atomicWrite,
  formatTimestamp,
  preWriteStamp,
  rotateBackups,
  rotatePreWriteSnapshots,
  rotateMatchingFiles,
  BACKUP_FILE_PATTERN,
  PRE_WRITE_FILE_PATTERN,
};
