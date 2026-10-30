"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const work = require("../lib/work-sessions");

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "office-details-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("agent-reported task, progress and blocker are visible and survive status-only heartbeats", (t) => {
  const dir = tmp(t), clock = 1_793_345_000_000;
  const props = { id: "backend-bob", kind: "work", title: "Backend - Bob" };
  work.upsert(dir, { ...props, state: "active", heartbeat: true,
    task: "Review B04 order API", progress: "Checking repeated payment confirmation",
    blocker: "Waiting for QC" }, clock);
  let agent = work.list(dir, clock + 500)[0];
  assert.equal(agent.task, "Review B04 order API");
  assert.equal(agent.progress, "Checking repeated payment confirmation");
  assert.equal(agent.blocker, "Waiting for QC");
  assert.equal(agent.detailUpdatedAt, clock);
  assert.equal(agent.connection, "live");
  work.upsert(dir, { ...props, state: "active", heartbeat: true }, clock + 20000);
  agent = work.list(dir, clock + 20010)[0];
  assert.equal(agent.task, "Review B04 order API");
  assert.equal(agent.blocker, "Waiting for QC");
  assert.equal(agent.detailUpdatedAt, clock);
  work.upsert(dir, { ...props, state: "idle", heartbeat: true, blocker: "" }, clock + 30000);
  agent = work.list(dir, clock + 30010)[0];
  assert.equal(agent.blocker, "");
  assert.equal(agent.task, "Review B04 order API");
  assert.equal(agent.detailUpdatedAt, clock + 30000);
  assert.equal(agent.status, "idle");
  agent = work.list(dir, clock + 7 * 60000)[0];
  assert.equal(agent.connection, "stale");
  assert.equal(agent.task, "Review B04 order API");
});

test("task metadata is clipped and never treated as HTML", (t) => {
  const dir = tmp(t), long = "a".repeat(350);
  work.upsert(dir, { id: "work-bob", title: "Backend - Bob", state: "active",
    heartbeat: true, task: "<img src=x onerror=alert(1)>", progress: long }, 1793345000000);
  const result = work.list(dir, 1793345000100)[0];
  assert.ok(!result.task.includes("<"));
  assert.ok(!result.task.includes(">"));
  assert.ok(result.progress.length <= 400);
});

test("CLI can emit task metadata and clear blocker without duplicating the session", (t) => {
  const root = tmp(t), data = path.join(root, "data");
  const config = path.join(root, "config.json");
  fs.writeFileSync(config, JSON.stringify({ dataDir: data, projects: [root], port: 7788 }));
  const cli = path.join(__dirname, "..", "tools", "work-session.js");
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], {
    cwd: root, env: { ...process.env, VP_CONFIG: config }, encoding: "utf8",
    windowsHide: true, timeout: 10000
  });
  assert.equal(run("register", "--id", "backend-bob", "--name", "Backend - Bob").status, 0);
  const a = run("heartbeat", "--id", "backend-bob", "--state", "active",
    "--task", "PR B04: payment", "--progress", "Code review", "--blocker", "Waiting");
  assert.equal(a.status, 0, a.stderr);
  const report = JSON.parse(a.stdout);
  assert.equal(report.task, "PR B04: payment");
  assert.equal(report.progress, "Code review");
  assert.equal(report.blocker, "Waiting");
  const cleared = run("heartbeat", "--id", "backend-bob", "--state", "idle", "--clear-blocker");
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.equal(JSON.parse(cleared.stdout).blocker, "");
  assert.equal(work.list(data).length, 1);
});

test("3D card and robot meshes are interactive and show explicit task reports", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(src, /gl\.domElement\.addEventListener\("pointerup"/);
  assert.match(src, /ray\.intersectObjects\(Object\.values\(bots\)/);
  assert.match(src, /class="work-detail"|h\("section", "work-detail"\)/);
  for (const field of ["a.task", "a.progress", "a.blocker", "a.detailUpdatedAt"])
    assert.ok(src.includes(field), "UI missing " + field);
  assert.match(src, /info\.appendChild\(detail\)/);
  assert.match(src, /work-detail/);
});
