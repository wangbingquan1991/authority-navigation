const crypto = require("crypto");

const MIN_TOKEN_LENGTH = 16;

// 登录成功后下发的会话 Cookie：只存「过期时间 + HMAC 签名」，
// 不含口令本身，服务端无需存储会话表即可校验。
const SESSION_COOKIE_NAME = "nav_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : "").digest();
}

/**
 * 常数时间比对管理员口令。
 * 先做 SHA-256 归一为等长摘要，避免长度短路泄漏，也避免 timingSafeEqual 抛错。
 * @param {string} adminToken 服务端配置的口令
 * @param {string} provided 请求携带的口令
 * @returns {boolean}
 */
function verifyAdminToken(adminToken, provided) {
  return crypto.timingSafeEqual(sha256(provided), sha256(adminToken));
}

// Builds an Express middleware that protects the write endpoint.
// The admin token is hashed once at startup so the per-request comparison
// runs against a fixed-length SHA-256 digest in constant time.
function createAdminAuthMiddleware(adminToken) {
  if (typeof adminToken !== "string" || adminToken.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `ADMIN_TOKEN must be a string of at least ${MIN_TOKEN_LENGTH} characters`
    );
  }

  const expectedDigest = sha256(adminToken);

  return function requireAdminToken(req, res, next) {
    const provided = req.get("x-admin-token");
    const providedDigest = sha256(provided);

    // Both digests are always 32 bytes, so timingSafeEqual never throws on
    // length mismatch and the comparison does not short-circuit on length.
    if (!crypto.timingSafeEqual(providedDigest, expectedDigest)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    next();
  };
}

/**
 * 派生会话签名密钥：默认由 ADMIN_TOKEN 派生，因此无需额外配置、
 * 且重启后已有会话依然有效；也允许通过 SESSION_SECRET 显式覆盖。
 */
function deriveSessionSecret(adminToken, override) {
  if (typeof override === "string" && override.length >= MIN_TOKEN_LENGTH) {
    return Buffer.from(override);
  }
  return crypto.createHash("sha256").update(`nav-session::${adminToken}`).digest();
}

function parseCookies(header) {
  const cookies = {};
  if (typeof header !== "string" || header.length === 0) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    cookies[key] = part.slice(index + 1).trim();
  }
  return cookies;
}

function signSession(secret, expiresAt) {
  const payload = String(expiresAt);
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifySessionValue(secret, value) {
  if (typeof value !== "string" || value.length === 0) return false;
  const index = value.lastIndexOf(".");
  if (index <= 0) return false;

  const payload = value.slice(0, index);
  const provided = Buffer.from(value.slice(index + 1));
  const expected = Buffer.from(
    crypto.createHmac("sha256", secret).update(payload).digest("base64url")
  );
  if (provided.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(provided, expected)) return false;

  const expiresAt = Number.parseInt(payload, 10);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function isSecureRequest(req) {
  if (req.secure) return true;
  const proto = req.get && req.get("x-forwarded-proto");
  return typeof proto === "string" && proto.split(",")[0].trim() === "https";
}

function buildCookie(value, { maxAgeSeconds, secure }) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * 会话管理器：签发、校验、清除登录态。
 * 校验只做 HMAC + 过期时间判断，不查库，因此写接口的开销与原来一致。
 * @param {string} adminToken
 * @param {{ sessionSecret?: string, sessionTtlMs?: number }} [options]
 */
function createSessionAuth(adminToken, options = {}) {
  const secret = deriveSessionSecret(adminToken, options.sessionSecret);
  const ttlMs = Number.isFinite(options.sessionTtlMs) && options.sessionTtlMs > 0
    ? options.sessionTtlMs
    : SESSION_TTL_MS;

  return {
    ttlMs,

    /** 请求是否携带有效会话 */
    verifyRequest(req) {
      const cookies = parseCookies(req.headers ? req.headers.cookie : "");
      return verifySessionValue(secret, cookies[SESSION_COOKIE_NAME]);
    },

    /** 下发会话 Cookie，返回过期时间戳 */
    issue(req, res) {
      const expiresAt = Date.now() + ttlMs;
      res.setHeader("Set-Cookie", buildCookie(signSession(secret, expiresAt), {
        maxAgeSeconds: Math.floor(ttlMs / 1000),
        secure: isSecureRequest(req)
      }));
      return expiresAt;
    },

    /** 清除会话 Cookie */
    clear(req, res) {
      res.setHeader("Set-Cookie", buildCookie("", {
        maxAgeSeconds: 0,
        secure: isSecureRequest(req)
      }));
    }
  };
}

/**
 * 写接口认证：登录会话优先，其次是兼容的 x-admin-token 口令 Header。
 * 这样浏览器端登录一次即可连续保存，脚本 / CI 仍可用 Header 直接调用。
 * @param {string} adminToken
 * @param {{ sessionSecret?: string, sessionTtlMs?: number }} [options]
 */
function createWriteAuthMiddleware(adminToken, options = {}) {
  const sessionAuth = createSessionAuth(adminToken, options);
  const requireAdminToken = createAdminAuthMiddleware(adminToken);

  return function requireWriteAuth(req, res, next) {
    if (sessionAuth.verifyRequest(req)) return next();
    return requireAdminToken(req, res, next);
  };
}

module.exports = {
  MIN_TOKEN_LENGTH,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  createAdminAuthMiddleware,
  createSessionAuth,
  createWriteAuthMiddleware,
  verifyAdminToken
};
