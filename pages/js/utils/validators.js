export function normalizeUrl(url) {
  url = String(url).trim();
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url;
}

export function normalize(text) {
  return String(text).toLowerCase().replace(/\s+/g, "");
}

export function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function isValidUrl(str) {
  if (typeof str !== "string" || str.length === 0 || str.length > 2048) return false;
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidName(name) {
  return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 100;
}
