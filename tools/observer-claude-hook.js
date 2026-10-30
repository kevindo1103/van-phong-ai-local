#!/usr/bin/env node
"use strict";
// Claude Code hook input is JSON on stdin. Ignore prompts, commands and tool results.
// This process must never inject conversation context or block a coding workflow.
const path = require("node:path");
const { loadConfig } = require("../lib/config");
const { ingest } = require("../lib/observer-local");
const cfg = loadConfig(path.resolve(__dirname, ".."));
if (!cfg) process.exit(0);
let input = "", count = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  count += chunk.length;
  if (count > 100000) { process.stdin.pause(); process.exit(0); }
  input += chunk;
});
process.stdin.on("end", () => {
  try { ingest(cfg.dataDir, cfg.projects, JSON.parse(input)); }
  catch { /* observer is best effort only; no stdout or prompt injection */ }
});
process.stdin.on("error", () => process.exit(0));
