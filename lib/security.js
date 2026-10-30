"use strict";
// Local-first access control. No credentials in URLs. No persistent session secrets.
const crypto = require("node:crypto");

const LOGIN_FORM = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Văn phòng AI – Đăng nhập</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#05070a;color:#eee;font-family:system-ui,sans-serif">
<form method="post" action="/auth/login" style="display:grid;gap:10px;width:min(320px,90vw)">
<b style="font-size:18px">Khóa xem văn phòng</b><input name="key" type="password" autocomplete="off" required autofocus style="padding:12px;border-radius:10px;border:1px solid #333;background:#111;color:#eee;font-size:16px">
<button style="padding:12px;border-radius:10px;border:0;background:#ecc970;font-weight:700">Vào xem</button></form></body></html>`;
const LOOPBACK = /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/;
const RATE_MS = 10 * 60 * 1000;

function isLoopback(req) {
  return LOOPBACK.test(String(req.socket.remoteAddress || ""));
}
function isRemote(req) {
  return !isLoopback(req) || !!req.headers["cf-ray"] || !!req.headers["cf-connecting-ip"];
}
function address(req) {
  const remote = String(req.socket.remoteAddress || "?");
  const forwarded = String(req.headers["cf-connecting-ip"] || "");
  // Never trust a client-supplied forwarded IP over a direct LAN connection.
  if (isLoopback(req) && /^[0-9a-f.:]+$/i.test(forwarded)) return forwarded;
  return remote;
}
function sameOrigin(req) {
  if (!req.headers.origin) return true; // allow native CLIs
  try { return new URL(String(req.headers.origin)).host === req.headers.host; }
  catch { return false; }
}
function safeEqual(a, b) {
  const hash = (s) => crypto.createHash("sha256").update(String(s).slice(0, 4096)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}
function createAuth(accessKey) {
  const key = String(accessKey || "");
  const cookieValue = crypto.randomBytes(32).toString("base64url");
  const wrong = new Map();
  function authorized(req) {
    if (!key) return !isRemote(req);
    const cookies = String(req.headers.cookie || "").split(/;\s*/);
    const session = cookies.find((x) => x.startsWith("vp_session="));
    return !!(session && safeEqual(session.slice("vp_session=".length), cookieValue));
  }
  function requireLogin(res) {
    res.writeHead(401, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(LOGIN_FORM);
  }
  function send(res, code, msg) {
    res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(msg);
  }
  async function login(req, res) {
    if (req.method !== "POST" || !key) return send(res, 404, "Không có đường dẫn này.");
    if (!sameOrigin(req)) return send(res, 403, "Origin không hợp lệ.");
    const who = address(req), now = Date.now();
    const attempts = (wrong.get(who) || []).filter((t) => now - t < RATE_MS);
    if (attempts.length >= 5) return send(res, 429, "Đã thử quá 5 lần. Vui lòng thử lại sau 10 phút.");
    let form = "";
    try {
      for await (const chunk of req) {
        form += chunk.toString("utf8");
        if (form.length > 4096) return send(res, 413, "Yêu cầu quá dài.");
      }
    } catch { return send(res, 400, "Yêu cầu không hợp lệ."); }
    const submitted = new URLSearchParams(form).get("key") || "";
    if (!safeEqual(submitted, key)) {
      wrong.set(who, [...attempts, now]);
      return requireLogin(res);
    }
    wrong.delete(who);
    const secure = !!req.socket.encrypted || (isLoopback(req) && !!req.headers["cf-ray"]);
    const attrs = "Path=/; HttpOnly; SameSite=Strict; Max-Age=86400" + (secure ? "; Secure" : "");
    res.writeHead(303, {
      Location: "/",
      "Set-Cookie": "vp_session=" + cookieValue + "; " + attrs,
      "Cache-Control": "no-store"
    });
    res.end();
  }
  return { authorized, requireLogin, login };
}
module.exports = { createAuth, isLoopback, isRemote, sameOrigin, safeEqual, address };
