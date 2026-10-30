#!/usr/bin/env node
"use strict";
// Opt-in metadata bridge for ChatGPT Work and ChatGPT Chat. No cloud-session polling.
const path = require("node:path");
const { loadConfig } = require("../lib/config");
const work = require("../lib/work-sessions");
const officeRooms = require("../public/rooms");
const { createStore: createRoomStore } = require("../lib/session-rooms");
const cfg = loadConfig(path.resolve(__dirname, ".."));
if (!cfg) { console.error("Run npm run setup first."); process.exit(1); }
const manualRooms = createRoomStore(cfg.dataDir);
const args = process.argv.slice(2);
const command = args.shift() || "help";
function opt(name) {
  const i = args.indexOf("--" + name);
  return i < 0 ? null : args[i + 1] || null;
}
function current(id, kind) {
  const key = work.makeKey(id, kind);
  return work.list(cfg.dataDir).find((s) => s.key === key);
}
function report(entry) {
  const room = manualRooms.get(entry.key) || entry.room;
  return {
    key: entry.key,
    title: entry.title,
    platform: entry.platform,
    room,
    roomLabel: officeRooms.label(room),
    reportedState: entry.reportedState,
    status: entry.status,
    connection: entry.connection,
    lastHeartbeat: entry.lastHeartbeat,
    task: entry.task,
    progress: entry.progress,
    blocker: entry.blocker,
    detailUpdatedAt: entry.detailUpdatedAt,
    ageMinutes: entry.lastHeartbeat ? Math.round((Date.now() - entry.lastHeartbeat) / 6000) / 10 : null
  };
}
function usage() {
  console.log("ChatGPT Work / ChatGPT Chat local bridge. No conversation content is read.");
  console.log('  register --id project-james --name "Project - James" [--kind work|chat]');
  console.log('  heartbeat --id project-james --state active|idle|blocked|done [--task "..."] [--progress "..."] [--blocker "..."]');
  console.log('  heartbeat --id backend-bob --state active --task "Review B04 API" --progress "Đang kiểm tra endpoint tạo đơn"');
  console.log('  heartbeat --id backend-bob --state active --blocker ""   (clear blocker)');
  console.log('  status --id project-james [--kind work|chat]');
  console.log("Heartbeat accepts --id without --name after the first registration.");
  console.log("While a Work task is active, its agent must send a heartbeat every 2–3 minutes.");
  console.log("Active expires after five minutes without a new heartbeat. No synthetic background activity.");
}
try {
  const kind = opt("kind") || "work";
  if (command === "help") usage();
  else if (command === "list") for (const s of work.list(cfg.dataDir)) console.log(JSON.stringify(report(s)));
  else if (command === "register" || command === "heartbeat" || command === "status") {
    const id = opt("id") || opt("name");
    if (!id) throw new Error("Missing --id or --name");
    const existing = current(id, kind);
    if (command === "status") {
      if (!existing) throw new Error("Session is not registered: " + id);
      console.log(JSON.stringify(report(existing)));
    } else {
      const title = opt("name") || existing?.title;
      if (!title) throw new Error("Unknown --id: register it once using --name");
      const state = command === "heartbeat" ? (opt("state") || "active") : "unknown";
      const detail = {};
      for (const field of ["task", "progress", "blocker"]) {
        if (args.includes("--" + field)) {
          const v = opt(field);
          if (v === null) throw new Error("Missing value after --" + field);
          detail[field] = v;
        }
      }
      if (args.includes("--clear-blocker")) detail.blocker = "";
      const record = work.upsert(cfg.dataDir, {
        id, title, state, kind, heartbeat: command === "heartbeat", ...detail
      });
      console.log(JSON.stringify({
        ok: true, signal: command === "heartbeat" ? "received" : "unlinked",
        ...report(current(id, kind)), key: record.key
      }));
    }
  } else { usage(); process.exitCode = 1; }
} catch (e) {
  if (["EPERM", "EACCES"].includes(e.code)) {
    console.error("HEARTBEAT_PERMISSION_DENIED: check Desktop Commander/Work tool authorization for the local command and data directory. System ACLs were not changed.");
  }
  console.error((e.code ? e.code + ": " : "") + e.message);
  process.exitCode = 1;
}
