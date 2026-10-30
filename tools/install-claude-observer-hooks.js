#!/usr/bin/env node
"use strict";
// Idempotently add observer-only Claude Code hooks without overriding user hooks.
// --apply writes a backup; default prints a dry-run summary.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const file = process.env.VP_CLAUDE_SETTINGS ||
  path.join(os.homedir(), ".claude", "settings.json");
const apply = process.argv.includes("--apply");
const events = ["SessionStart","UserPromptSubmit","PreToolUse","PostToolUse","PermissionRequest","Stop","SessionEnd"];
const command = '& "' + process.execPath + '" "' +
  path.join(root, "tools", "observer-claude-hook.js") + '"';
try {
  const config = fs.existsSync(file) ?
    JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) : {};
  if (typeof config !== "object" || Array.isArray(config) || !config) throw Error("Settings is not a JSON object");
  const hooks = config.hooks && typeof config.hooks === "object" && !Array.isArray(config.hooks) ?
    config.hooks : {};
  const added = [];
  for (const event of events) {
    const list = Array.isArray(hooks[event]) ? hooks[event] : [];
    const installed = list.some((entry) => (entry.hooks || []).some((hook) =>
      String(hook.command || "").includes("observer-claude-hook.js")));
    if (installed) continue;
    list.push({ hooks: [{ type: "command", shell: "powershell", command, async: true }] });
    hooks[event] = list;
    added.push(event);
  }
  config.hooks = hooks;
  if (apply && added.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const backup = file + ".office-observer-backup-" + Date.now();
    if (fs.existsSync(file)) fs.copyFileSync(file, backup);
    const temp = file + "." + crypto.randomBytes(5).toString("hex") + ".tmp";
    try {
      fs.writeFileSync(temp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      fs.renameSync(temp, file);
    } finally { try { if(fs.existsSync(temp))fs.unlinkSync(temp) } catch {} }
    console.log("Applied: " + added.join(", "));
    console.log("Original backup: " + backup);
  } else console.log((apply ? "Already installed" : "Dry run") + ": " + added.join(", "));
  console.log("Preserved existing hooks; no changes to project AGENTS.md/CLAUDE.md.");
} catch(e) {
  console.error("Could not update Claude settings: " + (e.code || e.message));
  process.exitCode = 1;
}
