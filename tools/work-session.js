#!/usr/bin/env node
"use strict";
// Lightweight opt-in heartbeat bridge for ChatGPT Work agents using Desktop Commander.
// This is NOT a ChatGPT API nor a polling mechanism for cloud conversations.
const path = require("node:path");
const { loadConfig } = require("../lib/config");
const work = require("../lib/work-sessions");
const cfg = loadConfig(path.resolve(__dirname, ".."));
if (!cfg) { console.error("Run npm run setup first."); process.exit(1); }
const args = process.argv.slice(2);
const command = args.shift() || "help";
function opt(name) {
  const i = args.indexOf("--" + name);
  return i < 0 ? null : args[i + 1] || null;
}
function usage() {
  console.log("ChatGPT Work local bridge. No ChatGPT conversation is read.");
  console.log('  register --name "Backend - Bob — task" [--id stable-id]');
  console.log('  heartbeat --name "Backend - Bob — task" [--id stable-id] [--state active|idle|blocked|done]');
  console.log('  list');
  console.log("No heartbeat = Unlinked. Heartbeat expires after five minutes.");
}
try {
  if (command === "help") usage();
  else if (command === "list") for (const s of work.list(cfg.dataDir)) console.log(s.key, s.name, s.roomLabel, s.connection, s.status);
  else if (command === "register" || command === "heartbeat") {
    const title = opt("name"), id = opt("id") || title;
    if (!title) throw new Error("Missing --name");
    const state = command === "heartbeat" ? (opt("state") || "active") : "unknown";
    const entry = work.upsert(cfg.dataDir, { id, title, state, heartbeat: command === "heartbeat" });
    console.log(JSON.stringify({ ok: true, key: entry.key, name: entry.title, signal: command === "heartbeat" ? "received" : "unlinked" }));
  } else { usage(); process.exitCode = 1; }
} catch(e) { console.error(e.message); process.exitCode = 1; }
