"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const rooms = require("../public/rooms");

const DIR = "work-sessions";
const VALID_STATES = new Set(["unknown", "active", "idle", "blocked", "done"]);
const FRESH_MS = 5 * 60 * 1000;
const OLD_MS = 24 * 60 * 60 * 1000;
const makeKey = (id) => "w-" + crypto.createHash("sha256").update(id).digest("hex").slice(0, 12);
function safeTitle(v) {
  const s = String(v || "").replace(/[\r\n\t<>]/g, " ").replace(/\s+/g, " ").trim();
  if (!s || s.length > 160) throw new TypeError("Session title must have 1–160 characters");
  return s;
}
function sessionFile(data, key) {
  if (!/^w-[a-f0-9]{12}$/.test(key)) throw new TypeError("Invalid Work session ID");
  return path.join(data, DIR, key + ".json");
}
function upsert(data, input, now = Date.now()) {
  const title = safeTitle(input.title);
  const sourceId = String(input.id || title);
  if (!sourceId || sourceId.length > 200) throw new TypeError("Invalid Work session identifier");
  const key = makeKey(sourceId);
  const state = input.state || "unknown";
  if (!VALID_STATES.has(state)) throw new TypeError("Unknown Work state");
  const file = sessionFile(data, key);
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(file, "utf8")); } catch(e) { if(e.code !== "ENOENT") throw e; }
  const isHeartbeat = input.heartbeat === true;
  const record = {
    version: 1, key, title, state, source: "chatgpt-work",
    firstSeen: Number(previous?.firstSeen) || now,
    lastUpdate: now,
    lastHeartbeat: isHeartbeat ? now : Number(previous?.lastHeartbeat) || null,
    // Unverified screenshot/registry entries never claim to be active.
    verified: isHeartbeat || (previous?.verified === true && input.heartbeat !== false)
  };
  if (!isHeartbeat && !previous?.verified) { record.state = "unknown"; record.verified = false; }
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
  try { files = fs.readdirSync(dir).filter((n) => /^w-[a-f0-9]{12}\.json$/.test(n)); }
  catch(e) { if(e.code !== "ENOENT") throw e; }
  const out = [];
  for (const name of files.slice(0, 150)) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      if (!r || r.key + ".json" !== name || !VALID_STATES.has(r.state)) continue;
      const age = Math.max(0, now - Number(r.lastHeartbeat || 0));
      const heartbeatFresh = !!r.verified && !!r.lastHeartbeat && age <= FRESH_MS;
      const status = heartbeatFresh ? (r.state === "active" ? "active" : r.state === "idle" || r.state === "done" ? "idle" : "away") : "unknown";
      const lastActive = Number(r.lastHeartbeat || 0);
      const where = rooms.resolve(r.title);
      out.push({
        key: r.key, id: r.key, name: safeTitle(r.title).slice(0, 60),
        title: r.title, platform: "work", role: "ChatGPT Work",
        room: where.room, roomSource: where.source, roomLabel: rooms.label(where.room),
        where: where.room, status, flag: heartbeatFresh && r.state === "blocked" ? "blocked" : null,
        connection: !r.verified ? "unlinked" : heartbeatFresh ? "live" : "stale",
        source: "work-bridge", session: r.key.slice(2), host: null,
        lastText: "", lastTextAt: 0, queuePos: null, lastActive,
        sub: 0, hasJournal: false, isNew: now - Number(r.firstSeen || 0) < 3600000,
        createdAt: Number(r.firstSeen || 0), hist: Array(60).fill(0),
      });
    } catch {}
  }
  return out.sort((a,b)=>(b.lastActive || b.createdAt)-(a.lastActive || a.createdAt));
}
module.exports = { upsert, list, makeKey, FRESH_MS };
