"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const work = require("../lib/work-sessions");

test("a registered Work thread can refresh active with ID only, not a second record", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "office-heartbeat-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, "office-data");
  const config = path.join(dir, "config.json");
  fs.writeFileSync(config, JSON.stringify({ dataDir, projects: [dir], port: 7788 }));
  const cli = path.join(__dirname, "..", "tools", "work-session.js");
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], {
    cwd: path.dirname(cli), encoding: "utf8", windowsHide: true, timeout: 10000,
    env: { ...process.env, VP_CONFIG: config }
  });
  const register = run("register", "--id", "project-james", "--name", "Project - James");
  assert.equal(register.status, 0, register.stderr);
  assert.equal(JSON.parse(register.stdout).signal, "unlinked");
  const first = run("heartbeat", "--id", "project-james", "--state", "active");
  assert.equal(first.status, 0, first.stderr);
  const event = JSON.parse(first.stdout);
  assert.equal(event.room, "james");
  assert.equal(event.connection, "live");
  assert.equal(event.status, "active");
  assert.equal(event.key, work.makeKey("project-james"));
  const status = run("status", "--id", "project-james");
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).lastHeartbeat, event.lastHeartbeat);
  assert.equal(work.list(dataDir).length, 1);
  const end = run("heartbeat", "--id", "project-james", "--state", "done");
  assert.equal(end.status, 0, end.stderr);
  assert.equal(JSON.parse(end.stdout).status, "idle");
  assert.equal(work.list(dataDir).length, 1);
  assert.notEqual(run("heartbeat", "--id", "never-registered", "--state", "active").status, 0);
  assert.equal(work.list(dataDir).length, 1);
});

test("stale ACTIVE is labeled as last reported, never displayed as verified live", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  const start = page.indexOf("const BADGES = ");
  const stop = page.indexOf("// Ba lớp vẽ:", start);
  assert.ok(start > 0 && stop > start);
  const badgeOf = vm.runInNewContext(page.slice(start, stop) + "\nbadgeOf", {});
  assert.deepEqual(Array.from(badgeOf({
    platform: "work", connection: "stale", reportedState: "active", status: "unknown"
  })), ["ACTIVE · CŨ", "stale"]);
  assert.deepEqual(Array.from(badgeOf({
    platform: "work", connection: "stale", reportedState: "blocked", status: "unknown"
  })), ["BLOCKED · CŨ", "stale"]);
  assert.deepEqual(Array.from(badgeOf({
    platform: "work", connection: "stale", reportedState: "done", status: "idle"
  })), ["IDLE · CŨ", "stale"]);
});

test("ChatGPT Chat has a separate namespace and supports room assignment without faking activity", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "office-chat-bridge-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { createStore } = require("../lib/session-rooms");
  const workItem = work.upsert(dir, { id: "same-alias", title: "Project - James" }, Date.now());
  const chatItem = work.upsert(dir, { id: "same-alias", title: "ChatGPT · Office Assistant", kind: "chat" }, Date.now());
  assert.notEqual(workItem.key, chatItem.key);
  assert.ok(chatItem.key.startsWith("g-"));
  const rows = work.list(dir);
  assert.equal(rows.length, 2);
  const chatRow = rows.find((x) => x.key === chatItem.key);
  assert.equal(chatRow.platform, "chatgpt");
  assert.equal(chatRow.connection, "unlinked");
  assert.equal(chatRow.status, "unknown");
  const roomStore = createStore(dir);
  roomStore.set(chatRow.key, "ceo");
  assert.equal(createStore(dir).get(chatRow.key), "ceo");
  assert.throws(() => work.upsert(dir, { title: "Unknown chat", kind: "chat" }), /stable conversation ID/i);
});
