"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const EVENTS = Object.freeze({
  SessionStart: "idle", UserPromptSubmit: "working", PreToolUse: "tool-running",
  PostToolUse: "working", PostToolUseFailure: "working",
  PermissionRequest: "approval-wait", Stop: "idle", SessionEnd: "ended"
});
const EVENT_TO_LABEL = Object.freeze({
  idle: "Chờ yêu cầu", working: "Đang trong lượt xử lý",
  "tool-running": "Đang gọi công cụ", "approval-wait": "Chờ phê duyệt", ended: "Phiên đã kết thúc"
});
function safe(value, max = 90) {
  return String(value || "").replace(/[<>\\\x00-\x1f\x7f]/g, "").trim().slice(0, max);
}
function withinProjects(cwd, projects) {
  if (!cwd || !Array.isArray(projects) || !projects.length) return false;
  const norm = (p) => path.resolve(String(p)).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const from = norm(cwd);
  return projects.some((p) => { const root = norm(p); return from === root || from.startsWith(root + "/"); });
}
function eventFile(dataDir, key) {
  if (!/^c-[a-f0-9]{8}$/i.test(key)) throw new TypeError("Invalid Claude key");
  return path.join(dataDir, "observer-hooks", key + ".json");
}
function ingest(dataDir, projects, input, time = Date.now()) {
  if (!input || typeof input !== "object" || !EVENTS[input.hook_event_name]) return null;
  const sid = String(input.session_id || "");
  if (!/^[a-f0-9-]{12,80}$/i.test(sid) || !withinProjects(input.cwd, projects)) return null;
  const key = "c-" + sid.slice(0, 8).toLowerCase();
  const stage = EVENTS[input.hook_event_name];
  const record = {
    key, source: "claude-hook", stage, event: input.hook_event_name,
    tool: input.hook_event_name === "PreToolUse" || input.hook_event_name === "PostToolUse" ?
      safe(input.tool_name, 55) : "",
    observedAt: time
  };
  const file = eventFile(dataDir, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(record) + "\n", { mode: 0o600, flag: "wx" });
    for (let i = 0;; i++) {
      try { fs.renameSync(tmp, file); break; }
      catch(e) {
        if (!["EPERM", "EACCES", "EBUSY"].includes(e.code) || i >= 3) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1));
      }
    }
  } finally { try { if(fs.existsSync(tmp))fs.unlinkSync(tmp); } catch {} }
  return record;
}
function read(dataDir, key, now = Date.now()) {
  if (!/^c-[a-f0-9]{8}$/i.test(key)) return null;
  let r;
  try { r = JSON.parse(fs.readFileSync(eventFile(dataDir,key), "utf8")); }
  catch { return null; }
  if (r?.key !== key || r.source !== "claude-hook" || !EVENT_TO_LABEL[r.stage]) return null;
  const age = Math.max(0, now - Number(r.observedAt || 0));
  if (!Number.isFinite(age) || age > 24 * 3600000) return null;
  const fresh = age <= 5 * 60000;
  return {
    source: "claude-hook", state: fresh ? r.stage : "stale",
    lastStage: r.stage, observedAt: Number(r.observedAt),
    evidence: (fresh ? EVENT_TO_LABEL[r.stage] : "Sự kiện Claude Code đã cũ: " + EVENT_TO_LABEL[r.stage]) +
      (r.tool ? " · " + safe(r.tool) : ""),
    event: safe(r.event, 45), fresh
  };
}
module.exports = { ingest, read, withinProjects };
