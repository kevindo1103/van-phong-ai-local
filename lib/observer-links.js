"use strict";
// Explicit user-controlled session-to-PR links. No automatic agent ownership inference.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const KEY = /^(?:ceo|(?:w|g)-[a-f0-9]{12}|(?:c|x)-[a-f0-9]{8})$/i;
const VALID_PR = (n) => Number.isSafeInteger(n) && n >= 1 && n <= 999999;
function createLinks(dataDir) {
  const file = path.join(dataDir, "observer-links.json");
  let state = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, n] of Object.entries(parsed))
        if (KEY.test(key) && VALID_PR(n)) state[key] = n;
    }
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  function set(key, number) {
    if (!KEY.test(key) || (number != null && !VALID_PR(number)))
      throw new TypeError("Invalid session or PR number");
    const next = { ...state };
    if (number == null) delete next[key]; else next[key] = number;
    fs.mkdirSync(dataDir, { recursive: true });
    const temp = file + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
    try {
      fs.writeFileSync(temp, JSON.stringify(next, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      // Retry only transient Windows locks; do not change ACLs.
      for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(temp, file); break; }
        catch (e) {
          if (!["EPERM", "EACCES", "EBUSY"].includes(e.code) || attempt >= 4) throw e;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
        }
      }
      state = next;
    } finally { try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {} }
  }
  return { get: (key) => state[key] || null, set, all: () => ({ ...state }) };
}
module.exports = { createLinks };
