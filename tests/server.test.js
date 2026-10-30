"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { setTimeout: sleep } = require("node:timers/promises");

async function freePort() {
  const srv = net.createServer();
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const port = srv.address().port;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}
test("local HTTP server smoke: offline modules, privacy, remote guard", { timeout: 25000 }, async (t) => {
  const root = path.resolve(__dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vp-http-test-"));
  const port = await freePort();
  const cfgFile = path.join(dir, "config.json");
  fs.writeFileSync(cfgFile, JSON.stringify({
    title: "Test Office", port, host: "127.0.0.1", projects: [dir], dataDir: path.join(dir, "data"),
    claudeDir: path.join(dir, "empty-claude"), codexDir: path.join(dir, "empty-codex"),
    showSessionContent: false, showHeuristicGrades: false
  }));
  const child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root, env: { ...process.env, VP_CONFIG: cfgFile }, windowsHide: true
  });
  let stderr = "";
  child.stderr.on("data", (b) => { stderr += b.toString(); });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(3000)]);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + port;
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error("server crashed: " + stderr);
    try {
      const r = await fetch(base + "/state", { signal: AbortSignal.timeout(1500) });
      if (r.ok) { ready = true; break; }
    } catch {}
    await sleep(100);
  }
  assert.equal(ready, true, "server did not start: " + stderr);
  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /\/vendor\/three\/build\/three\.module\.js/);
  const vendor = await fetch(base + "/vendor/three/build/three.module.js");
  assert.equal(vendor.status, 200);
  assert.match(vendor.headers.get("content-type"), /javascript/);
  await vendor.arrayBuffer();
  const state = await (await fetch(base + "/state")).json();
  assert.equal(state.title, "Test Office");
  assert.equal(state.agents.length, 1);
  assert.equal(state.agents[0].lastText, "");
  const perf = await (await fetch(base + "/perf")).json();
  assert.equal(perf.experimentalScore, false);
  assert.equal((await fetch(base + "/state", { headers: { "cf-ray": "spoofed" } })).status, 401);
  assert.equal((await fetch(base + "/chat/send", {
    method: "POST", headers: { Origin: "https://attacker.invalid", "Content-Type": "application/json" },
    body: "{}"
  })).status, 403);
});
