const path = require("path");

const DEFAULT_INTERVAL_HOURS = 6;
const DEFAULT_KEEP = 7;

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function defaultBackupDir(store) {
  return path.join(path.dirname(store.dbPath), "backups");
}

// Starts a periodic snapshot scheduler. The timer is unref'd so it never keeps
// the process alive, and the returned stop() clears it for graceful shutdown.
function startBackupScheduler(store, options = {}) {
  const intervalHours = parsePositiveInt(
    options.intervalHours ?? process.env.BACKUP_INTERVAL_HOURS,
    DEFAULT_INTERVAL_HOURS
  );
  const keep = parsePositiveInt(
    options.keep ?? process.env.BACKUP_KEEP,
    DEFAULT_KEEP
  );
  const backupDir = options.backupDir || defaultBackupDir(store);

  const intervalMs = intervalHours * 60 * 60 * 1000;

  const timer = setInterval(() => {
    store.backup(backupDir, keep).catch((err) => {
      console.error("Scheduled backup failed:", err.message);
    });
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return {
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = { startBackupScheduler };
