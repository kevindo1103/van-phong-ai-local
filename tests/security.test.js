"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createAuth, sameOrigin, isRemote, address } = require("../lib/security");

function request(body, remoteAddress = "192.168.1.7", extras = {}) {
  const req = Readable.from([body]);
  req.method = "POST";
  req.socket = { remoteAddress };
  req.headers = { host: "localhost:7788", origin: "http://localhost:7788", ...extras };
  return req;
}
function response() {
  return {
    status: null, headers: null, body: "",
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(s = "") { this.body += String(s); }
  };
}
test("local-only mode rejects remote clients, even with spoofed forwarding", () => {
  const auth = createAuth("");
  assert.equal(auth.authorized(request("", "127.0.0.1")), true);
  assert.equal(auth.authorized(request("", "192.168.1.7")), false);
  assert.equal(auth.authorized(request("", "127.0.0.1", { "cf-ray": "example" })), false);
  const spoof = request("", "192.168.1.7", { "cf-connecting-ip": "127.0.0.1" });
  assert.equal(isRemote(spoof), true);
  assert.equal(address(spoof), "192.168.1.7");
});
test("login uses POST cookie, requires same origin and never accepts URL key", async () => {
  const auth = createAuth("correct-horse-battery");
  const pre = request("", "127.0.0.1", { cookie: "vp_session=wrong" });
  assert.equal(auth.authorized(pre), false);
  const badOrigin = response();
  await auth.login(request("key=correct-horse-battery", "127.0.0.1",
    { origin: "https://attacker.example" }), badOrigin);
  assert.equal(badOrigin.status, 403);
  assert.equal(sameOrigin(request("", "127.0.0.1")), true);
  const ok = response();
  await auth.login(request("key=correct-horse-battery", "127.0.0.1"), ok);
  assert.equal(ok.status, 303);
  assert.match(ok.headers["Set-Cookie"], /HttpOnly; SameSite=Strict/);
  const cookie = ok.headers["Set-Cookie"].split(";")[0];
  assert.equal(auth.authorized(request("", "127.0.0.1", { cookie })), true);
});
test("failed logins are rate-limited without trusting request headers", async () => {
  const auth = createAuth("pass");
  for (let i = 0; i < 5; i++) {
    const res = response();
    await auth.login(request("key=bad", "192.168.1.100"), res);
    assert.equal(res.status, 401);
  }
  const blocked = response();
  await auth.login(request("key=pass", "192.168.1.100"), blocked);
  assert.equal(blocked.status, 429);
});
