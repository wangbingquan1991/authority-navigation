// ============================================================
// 登录态管理
// ============================================================
// 口令只在登录时提交一次：校验通过后服务端下发 HttpOnly 会话 Cookie，
// 之后的写入请求浏览器自动携带，不再重复校验口令，
// 也不再在 localStorage 中保存口令明文。
// ============================================================

const LEGACY_TOKEN_KEY = "nav_admin_token_v1";

// 历史版本会把口令明文存进 localStorage，这里在模块加载时清理一次。
try {
  localStorage.removeItem(LEGACY_TOKEN_KEY);
} catch (e) {
  // localStorage 不可用（隐私模式等）时忽略。
}

/**
 * 查询当前是否已登录。
 * 网络异常时按“未登录”处理，让界面显示登录入口而不是报错。
 * @returns {Promise<boolean>}
 */
export async function checkSession() {
  try {
    const res = await fetch("/api/session", { credentials: "same-origin" });
    if (!res.ok) return false;
    const body = await res.json();
    return body.authenticated === true;
  } catch (e) {
    return false;
  }
}

/**
 * 用管理员口令换取登录会话。
 * 口令正确返回 true；口令错误返回 false；限流或网络异常抛出 Error。
 * @param {string} token
 * @returns {Promise<boolean>}
 */
export async function login(token) {
  let res;
  try {
    res = await fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
  } catch (e) {
    throw new Error("无法连接服务器，登录失败，请稍后重试。");
  }

  if (res.status === 401) return false;
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After"), 10);
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? `请 ${retryAfter} 秒后重试。`
      : "请稍后重试。";
    throw new Error(`尝试过于频繁，已触发速率限制，${wait}`);
  }
  if (!res.ok) {
    throw new Error(`登录失败（HTTP ${res.status}）`);
  }
  return true;
}

/**
 * 退出登录，清除服务端会话 Cookie。
 */
export async function logout() {
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  } catch (e) {
    // 网络异常时本地登录态同样作废，无需向用户报错。
  }
}
