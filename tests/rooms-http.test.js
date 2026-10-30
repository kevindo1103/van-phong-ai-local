"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { setTimeout: sleep } = require("node:timers/promises");

async function port() {
  const srv = net.createServer();
  await new Promise((done) => srv.listen(0, "127.0.0.1", done));
  const p = srv.address().port;
  await new Promise((done) => srv.close(done));
  return p;
}
test("session owner room routing is reflected in HTTP state and persists across manual changes", { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vp-room-server-"));
  const cwd = path.join(dir, "project");
  const codexDir = path.join(dir, "codex");
  const sessions = path.join(codexDir, "sessions", "2026", "10", "30");
  const p = await port();
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(sessions, { recursive: true });
  const entries = [
    ["11111111-2222-3333-4444-555555555555", "Backend: B01", "bob"],
    ["22222222-2222-3333-4444-555555555555", "Frontend: B04", "dave"],
    ["33333333-2222-3333-4444-555555555555", "Product: B02", "stu"],
    ["44444444-2222-3333-4444-555555555555", "QC: review", "agnes"],
    ["55555555-2222-3333-4444-555555555555", "Infra: deploy", "gru"],
    ["66666666-2222-3333-4444-555555555555", "PM: B01-B05", "james"],
    ["77777777-2222-3333-4444-555555555555", "Kyle: CEO office", "ceo"],
    ["88888888-2222-3333-4444-555555555555", "Untitled task", "unassigned"]
  ];
  for (const [uuid] of entries) {
    const first = JSON.stringify({ type: "session_meta", timestamp: new Date().toISOString(),
      payload: { id: uuid, cwd, timestamp: new Date().toISOString() } });
    fs.writeFileSync(path.join(sessions, uuid + ".jsonl"), first + "\n");
  }
  fs.writeFileSync(path.join(codexDir, "session_index.jsonl"),
    entries.map(([id, thread_name]) => JSON.stringify({ id, thread_name })).join("\n") + "\n");
  const cfgFile = path.join(dir, "config.json");
  fs.writeFileSync(cfgFile, JSON.stringify({
    title: "Room Test", port: p, host: "127.0.0.1", projects: [cwd],
    dataDir: path.join(dir, "office-data"), claudeDir: path.join(dir, "claude-empty"), codexDir,
    keepHours: 24, showSessionContent: false, showHeuristicGrades: false
  }));
  const root = path.resolve(__dirname, "..");
  const proc = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root, env: { ...process.env, VP_CONFIG: cfgFile }, windowsHide: true
  });
  let stderr = "";
  proc.stderr.on("data", (b) => { stderr += b.toString(); });
  t.after(async () => {
    if (proc.exitCode === null) {
      proc.kill();
      await Promise.race([new Promise((done) => proc.once("exit", done)), sleep(3000)]);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + p;
  let state;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error("server exit: " + stderr);
    try {
      const response = await fetch(base + "/state", { signal: AbortSignal.timeout(1600) });
      if (response.ok) {
        const data = await response.json();
        if (data.agents.length >= entries.length + 1) { state = data; break; }
      }
    } catch {}
    await sleep(100);
  }
  assert.ok(state, "agent discovery did not complete: " + stderr);
  for (const [uuid, , room] of entries) {
    const agent = state.agents.find((a) => a.session === uuid.slice(0, 8));
    assert.ok(agent, "missing " + uuid);
    assert.equal(agent.room, room, "wrong room for " + agent.name);
  }
  const target = "x-88888888";
  let result = await fetch(base + "/api/rooms/assign", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: target, room: "gru" }) });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).room, "gru");
  assert.equal((await (await fetch(base + "/state")).json()).agents.find((a) => a.key === target).room, "gru");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "office-data", "session-rooms.json"), "utf8"))[target], "gru");
  result = await fetch(base + "/api/rooms/assign", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: target, room: "auto" }) });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).room, "unassigned");
  const badRoom = await fetch(base + "/api/rooms/assign", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: target, room: "../bad" }) });
  assert.equal(badRoom.status, 400);
  assert.equal((await fetch(base + "/rooms.js")).status, 200);
  assert.equal((await fetch(base + "/2d.html")).status, 200);
  assert.equal((await fetch(base + "/board.html")).status, 200);
});
