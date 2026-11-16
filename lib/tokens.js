// Shared HMAC access tokens for the cmap files page.
// Stateless: token = base64url(payload) + "." + base64url(HMAC-SHA256(payload)).
// Payload: { ref: <Notion page id or null>, exp: <epoch ms> }. No database needed.
// The signing secret is PAYMENT_SECRET (Vercel env var, never in code).

const crypto = require("crypto");

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(str) {
  const b64 = String(str).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function issueToken(secret, ref) {
  const payload = JSON.stringify({
    ref: ref || null,
    exp: Date.now() + TOKEN_TTL_MS,
  });
  const body = b64urlEncode(payload);
  const sig = b64urlEncode(
    crypto.createHmac("sha256", secret).update(body).digest()
  );
  return body + "." + sig;
}

function verifyToken(secret, token) {
  try {
    if (!secret || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const expected = b64urlEncode(
      crypto.createHmac("sha256", secret).update(body).digest()
    );
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(b64urlDecode(body).toString("utf8"));
    if (!payload || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

module.exports = { issueToken, verifyToken, TOKEN_TTL_MS };
