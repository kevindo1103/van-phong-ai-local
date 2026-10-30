"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const VP = path.resolve(__dirname, "..", "tools", "vp.js");
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), "vp-local-test-"));
function call(dir, ...args) {
  return spawnSync(process.execPath, [VP, ...args], {
    encoding: "utf8", windowsHide: true, timeout: 10000,
    env: { ...process.env, VP_DATA: dir }
  });
}
function asyncCall(dir, ...args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [VP, ...args], {
      env: { ...process.env, VP_DATA: dir }, windowsHide: true
    });
    let out = "", err = "";
    p.stdout.on("data", (b) => { out += b.toString(); });
    p.stderr.on("data", (b) => { err += b.toString(); });
    p.on("error", (e) => resolve({ status: -1, stdout: out, stderr: e.message }));
    p.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });
}
test("DEV lock is atomic across simultaneous independent agents", async (t) => {
  const dir = mk(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const [a, b] = await Promise.all([
    asyncCall(dir, "luot", "lay", "--goi", "one", "--vai", "Kyle"),
    asyncCall(dir, "luot", "lay", "--goi", "two", "--vai", "Agnes")
  ]);
  assert.deepEqual([a.status, b.status].sort(), [0, 1]);
  const lock = JSON.parse(fs.readFileSync(path.join(dir, "DEV.lock"), "utf8"));
  assert.ok(["Kyle", "Agnes"].includes(lock.owner));
  const loser = lock.owner === "Kyle" ? "Agnes" : "Kyle";
  assert.notEqual(call(dir, "luot", "nha", "--vai", loser, "--ket-qua", "dat").status, 0);
  assert.equal(call(dir, "luot", "nha", "--vai", lock.owner, "--ket-qua", "dat").status, 0);
  assert.equal(fs.existsSync(path.join(dir, "DEV.lock")), false);
  assert.notEqual(call(dir, "luot", "nha", "--vai", lock.owner, "--ket-qua", "dat").status, 0);
});
test("DEV queue respects first arrival and clears after release", (t) => {
  const dir = mk(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(call(dir, "luot", "cho", "--vai", "Stu", "--goi", "B04").status, 0);
  assert.equal(call(dir, "luot", "cho", "--vai", "Agnes", "--goi", "B04").status, 0);
  assert.notEqual(call(dir, "luot", "lay", "--vai", "Agnes", "--goi", "B04").status, 0);
  assert.equal(call(dir, "luot", "lay", "--vai", "Stu", "--goi", "B04").status, 0);
  assert.equal(call(dir, "luot", "nha", "--vai", "Stu", "--ket-qua", "dat").status, 0);
  assert.equal(call(dir, "luot", "lay", "--vai", "Agnes", "--goi", "B04").status, 0);
  assert.equal(call(dir, "luot", "nha", "--vai", "Agnes", "--ket-qua", "hong").status, 0);
  const lines = fs.readFileSync(path.join(dir, "DEV-LUOT.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.filter((x) => JSON.parse(x).su_kien === "lay").length, 2);
});
test("DEV refuses to overwrite a damaged lock", (t) => {
  const dir = mk(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "DEV.lock"), "partial-data");
  assert.notEqual(call(dir, "luot", "lay", "--vai", "Stu", "--goi", "B01").status, 0);
  assert.equal(fs.readFileSync(path.join(dir, "DEV.lock"), "utf8"), "partial-data");
});
