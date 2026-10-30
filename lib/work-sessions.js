"use strict";
// Local-only metadata bridge for ChatGPT Work and ordinary ChatGPT conversations.
// A named conversation is NOT "active" until it reports a real heartbeat.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const rooms = require("../public/rooms");

const DIR = "work-sessions"; // preserve existing Work registrations and storage
const VALID_STATES = new Set(["unknown", "active", "idle", "blocked", "done"]);
const VALID_KINDS = new Set(["work", "chat"]);
const FRESH_MS = 5 * 60 * 1000;
const OLD_MS = 24 * 60 * 60 * 1000;
// Only explicit, compact, agent-reported task metadata is accepted. Never parse chat content.
const DETAIL_LIMITS = Object.freeze({ task: 180, progress: 400, blocker: 260 });
function cleanDetail(value, max) {
  const s = String(value ?? "").replace(/[<>\x00-\x1F\x7F]/g, " ").replace(/\s+/g, " ").trim();
  return s.slice(0, max);
}
function makeKey(id, kind = "work") {
  if (!VALID_KINDS.has(kind)) throw new TypeError("Unknown conversation type");
  // Preserve historical Work IDs; ChatGPT Chat is a separate namespace.
  const hashId = kind === "chat" ? "chat:" + String(id) : String(id);
  return (kind === "chat" ? "g-" : "w-") +
    crypto.createHash("sha256").update(hashId).digest("hex").slice(0, 12);
}
function safeTitle(v) {
  const s = String(v || "").replace(/[\r\n\t<>]/g, " ").replace(/\s+/g, " ").trim();
  if (!s || s.length > 160) throw new TypeError("Session title must have 1–160 characters");
  return s;
}
function sessionFile(data, key) {
  if (!/^[wg]-[a-f0-9]{12}$/.test(key)) throw new TypeError("Invalid conversation key");
  return path.join(data, DIR, key + ".json");
}
function upsert(data, input, now = Date.now()) {
  const title = safeTitle(input.title);
  const kind = input.kind || "work";
  if (!VALID_KINDS.has(kind)) throw new TypeError("Unknown conversation type");
  if (kind === "chat" && !input.id) throw new TypeError("ChatGPT Chat needs a stable conversation ID");
  const sourceId = String(input.id || title);
  if (!sourceId || sourceId.length > 200 ||
      (kind === "chat" && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,127}$/.test(sourceId))) {
    throw new TypeError("Invalid conversation identifier");
  }
  const key = makeKey(sourceId, kind);
  const state = input.state || "unknown";
  if (!VALID_STATES.has(state)) throw new TypeError("Unknown conversation state");
  const file = sessionFile(data, key);
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  const isHeartbeat = input.heartbeat === true;
  const record = {
    version: 2, key, kind, title, state,
    source: kind === "chat" ? "chatgpt-chat" : "chatgpt-work",
    firstSeen: Number(previous?.firstSeen) || now,
    lastUpdate: now,
    lastHeartbeat: isHeartbeat ? now : Number(previous?.lastHeartbeat) || null,
    verified: isHeartbeat || previous?.verified === true
  };
  if (!isHeartbeat) {
    // Updating the display name never changes previously verified state.
    record.state = previous?.verified ? previous.state : "unknown";
    record.verified = previous?.verified === true;
  }
  let detailChanged = false;
  for (const [field, limit] of Object.entries(DETAIL_LIMITS)) {
    const oldValue = typeof previous?.[field] === "string" ? previous[field] : "";
    record[field] = Object.hasOwn(input, field) ? cleanDetail(input[field], limit) : oldValue;
    if (record[field] !== oldValue) detailChanged = true;
  }
  // Updating heartbeat alone must NOT change the task-report timestamp.
  record.detailUpdatedAt = detailChanged ? now : Number(previous?.detailUpdatedAt) || null;
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, "." + key + "-" + crypto.randomBytes(6).toString("hex") + ".tmp");
  try {
    fs.writeFileSync(tmp, JSON.stringify(record) + "\n", { mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, file);
  } finally { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {} }
  return record;
}
function list(data, now = Date.now()) {
  const dir = path.join(data, DIR);
  let files = [];
  try { files = fs.readdirSync(dir).filter((n) => /^[wg]-[a-f0-9]{12}\.json$/.test(n)); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  const out = [];
  for (const name of files.slice(0, 150)) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      if (!r || r.key + ".json" !== name || !VALID_STATES.has(r.state)) continue;
      const kind = r.kind || "work"; // backward compatibility with previous local records
      if (!VALID_KINDS.has(kind)) continue;
      if ((kind === "chat" ? "g-" : "w-") !== r.key.slice(0, 2)) continue;
      const age = Math.max(0, now - Number(r.lastHeartbeat || 0));
      const verified = !!r.verified && Number(r.lastHeartbeat) > 0;
      const heartbeatFresh = verified && age <= FRESH_MS;
      // Active must have a fresh heartbeat. Idle/done/blocked are retained as
      // last-reported, explicitly STALE after five minutes (not actively working).
      const retained = verified && age <= OLD_MS;
      const lastIdle = retained && (r.state === "idle" || r.state === "done");
      const status = r.state === "active" && heartbeatFresh ? "active" : lastIdle ? "idle" : "unknown";
      const lastActive = Number(r.lastHeartbeat || 0);
      const where = rooms.resolve(r.title);
      out.push({
        key: r.key, id: r.key, name: safeTitle(r.title).slice(0, 60),
        title: r.title, platform: kind === "chat" ? "chatgpt" : "work",
        role: kind === "chat" ? "ChatGPT Chat" : "ChatGPT Work",
        room: where.room, roomSource: where.source, roomLabel: rooms.label(where.room),
        where: where.room, status, flag: heartbeatFresh && r.state === "blocked" ? "blocked" : null,
        connection: !verified ? "unlinked" : heartbeatFresh ? "live" : "stale",
        reportedState: retained ? r.state : "unknown", lastHeartbeat: verified ? Number(r.lastHeartbeat) : null,
        source: kind === "chat" ? "chatgpt-chat-bridge" : "work-bridge",
        session: r.key.slice(2), host: null,
        task: cleanDetail(r.task || "", DETAIL_LIMITS.task),
        progress: cleanDetail(r.progress || "", DETAIL_LIMITS.progress),
        blocker: cleanDetail(r.blocker || "", DETAIL_LIMITS.blocker),
        detailUpdatedAt: Number(r.detailUpdatedAt) || null,
        detailSource: "agent-reported",
        lastText: "", lastTextAt: 0, queuePos: null, lastActive,
        sub: 0, hasJournal: false, isNew: now - Number(r.firstSeen || 0) < 3600000,
        createdAt: Number(r.firstSeen || 0), hist: Array(60).fill(0)
      });
    } catch {}
  }
  return out.sort((a, b) => (b.lastActive || b.createdAt) - (a.lastActive || a.createdAt));
}
module.exports = { upsert, list, makeKey, FRESH_MS, OLD_MS };
