"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const rooms = require("../public/rooms");

const SESSION_KEY = /^(?:c|x)-[a-f0-9]{8}$/i;
function createStore(dataDir) {
  const file = path.join(dataDir, "session-rooms.json");
  let data = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, room] of Object.entries(parsed)) {
        if (SESSION_KEY.test(key) && rooms.isAgentRoom(room)) data[key] = room;
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw new Error("Không thể đọc session-rooms.json: " + e.message);
  }
  return {
    get(key) {
      return Object.hasOwn(data, key) ? data[key] : null;
    },
    set(key, room) {
      if (!SESSION_KEY.test(key) || (room !== "auto" && !rooms.isAgentRoom(room)))
        throw new TypeError("Mã phiên hoặc phòng không hợp lệ");
      const next = { ...data };
      if (room === "auto") delete next[key];
      else next[key] = room;
      fs.mkdirSync(dataDir, { recursive: true });
      const tmp = file + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
      try {
        fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600, flag: "wx" });
        fs.renameSync(tmp, file);
      } finally {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      }
      data = next;
    },
    count() { return Object.keys(data).length; }
  };
}
module.exports = { createStore };
