import { STORAGE_KEYS, getJson, setJson, removeItem } from "../utils/storage.js";

const TOKEN_KEY = STORAGE_KEYS.ADMIN_TOKEN;

/**
 * 读取本地缓存的管理员 token；不存在或异常时返回空字符串。
 * @returns {string}
 */
export function getCachedAdminToken() {
  const token = getJson(TOKEN_KEY, "");
  return typeof token === "string" ? token.trim() : "";
}

/**
 * 清除缓存的管理员 token（收到 401 时调用，强制下次重新输入）。
 */
export function clearAdminToken() {
  removeItem(TOKEN_KEY);
}

/**
 * prompt 用户输入管理员 token；输入非空时写入 localStorage 并返回（已 trim）。
 * 用户取消或输入为空时返回空字符串，不写入缓存。
 * @param {{ rejected?: boolean }} options rejected=true 表示上一次输入校验失败
 * @returns {string}
 */
export function promptForAdminToken({ rejected = false } = {}) {
  const message = rejected
    ? "管理员口令校验失败，请重新输入："
    : "保存数据需要管理员口令，请输入（将在此设备记住）：";
  let raw = "";
  try {
    raw = window.prompt(message, "") || "";
  } catch (e) {
    return "";
  }
  const token = raw.trim();
  if (token) {
    setJson(TOKEN_KEY, token);
  }
  return token;
}
