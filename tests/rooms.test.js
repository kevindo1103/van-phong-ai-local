"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ROOMS, AGENT_ROOMS, ROLE_ROOM, rolePrefixRoom, ownerRoomFromName, resolve, seat, arrange } = require("../public/rooms");
const { createStore } = require("../lib/session-rooms");

test("functional session prefixes send the session to its owner room", () => {
  const mapping = [
    ["Backend: B01", "bob"],
    ["Backend-B02", "bob"],
    ["Frontend | Home", "dave"],
    ["Front-end: Order", "dave"],
    ["[Product] Backlog", "stu"],
    ["QC: Smoke", "gru"],
    ["Infra - Release gate", "gru"],
    ["[Infra] VPS61", "gru"],
    ["PM: Sprint planning", "james"],
    ["CEO: priorities", "ceo"]
  ];
  for (const [name, room] of mapping) {
    assert.equal(rolePrefixRoom(name), room, "wrong owner for " + name);
    assert.deepEqual(resolve(name), { room, source: "prefix" });
  }
  assert.equal(ROLE_ROOM.qc, ROLE_ROOM.infra);
  assert.ok(ROOMS.some((r) => r.id === "gru" && r.label.includes("Infra")));
});

test("known owner name is a backup, unnamed sessions are in the common area", () => {
  const owners = { Kyle: "ceo", Bob: "bob", Dave: "dave", Stu: "stu", Gru: "gru", James: "james" };
  for (const [owner, room] of Object.entries(owners)) {
    assert.equal(ownerRoomFromName(owner + " - work"), room);
    assert.equal(resolve(owner + " - work").room, room);
  }
  for (const name of [
    "Claude 7123cd65", "Codex c9090eff", "session-123",
    "Fix Backend invoice bug", "Bug QC registration", "Infrastructure report",
    "Unknown", "Unassigned", "", "BackendFeature work"
  ]) {
    assert.deepEqual(resolve(name), { room: "unassigned", source: "unassigned" }, name);
  }
  assert.ok(AGENT_ROOMS.includes("unassigned"));
  assert.ok(ROOMS.some((r) => r.id === "unassigned" && /Khu vực chung/i.test(r.label)));
});

test("every assigned room gets individual, stable positions within its boundaries", () => {
  const group = [
    { key: "ceo", room: "ceo" },
    { key: "x-abcdef11", room: "ceo" },
    { key: "c-abcdef12", room: "gru" },
    { key: "c-abcdef13", room: "gru" },
    { key: "c-abcdef14", room: "unassigned" },
    { key: "x-abcdef15", room: "unassigned" },
    { key: "x-abcdef16", room: "unassigned" }
  ];
  const result = arrange(group);
  for (const item of group) {
    const r = ROOMS.find((r) => r.id === item.room);
    const [x, y] = result[item.key];
    assert.ok(x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h,
      item.key + " out of room " + item.room);
  }
  assert.notDeepEqual(result["c-abcdef12"], result["c-abcdef13"]);
  assert.notDeepEqual(result["ceo"], result["x-abcdef11"]);
  assert.deepEqual(arrange([...group].reverse()), result);
  assert.deepEqual(seat("unassigned", 0, 1), arrange([{ key: "c-12345678", room: "unassigned" }])["c-12345678"]);
});

test("manual session-room assignment persists and can return to automatic inference", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vp-room-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir);
  assert.equal(store.get("c-12345678"), null);
  store.set("c-12345678", "gru");
  assert.equal(store.get("c-12345678"), "gru");
  assert.equal(createStore(dir).get("c-12345678"), "gru");
  assert.throws(() => store.set("../../../secret", "gru"), /không hợp lệ/i);
  assert.throws(() => store.set("c-12345678", "script"), /không hợp lệ/i);
  store.set("c-12345678", "auto");
  assert.equal(createStore(dir).get("c-12345678"), null);
});
