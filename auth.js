const crypto = require("crypto");

const MIN_TOKEN_LENGTH = 16;

// Builds an Express middleware that protects the write endpoint.
// The admin token is hashed once at startup so the per-request comparison
// runs against a fixed-length SHA-256 digest in constant time.
function createAdminAuthMiddleware(adminToken) {
  if (typeof adminToken !== "string" || adminToken.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `ADMIN_TOKEN must be a string of at least ${MIN_TOKEN_LENGTH} characters`
    );
  }

  const expectedDigest = crypto.createHash("sha256").update(adminToken).digest();

  return function requireAdminToken(req, res, next) {
    const provided = req.get("x-admin-token");
    const providedDigest = crypto
      .createHash("sha256")
      .update(typeof provided === "string" ? provided : "")
      .digest();

    // Both digests are always 32 bytes, so timingSafeEqual never throws on
    // length mismatch and the comparison does not short-circuit on length.
    if (!crypto.timingSafeEqual(providedDigest, expectedDigest)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    next();
  };
}

module.exports = { createAdminAuthMiddleware, MIN_TOKEN_LENGTH };
