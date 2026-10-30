"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("office view is the legible default, with optional panoramic dashboards", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(page, /viewMode = "office", focusedRoom = "all"/);
  assert.match(page, /showWallScreens\(false\)/);
  assert.match(page, /id="view-office"/);
  assert.match(page, /id="view-wide"/);
  assert.match(page, /id="office-directory"/);
  assert.match(page, /id="dir-rooms"/);
  assert.match(page, /id="dir-sessions"/);
  assert.match(page, /function renderDirectory\(s\)/);
  assert.match(page, /function roomCamera\(id\)/);
  assert.match(page, /classList\.toggle\("summary"/);
  assert.match(page, /if \(visible && !wall.loaded\)/);
  assert.match(page, /if \(!visible && wall.loaded\)/);
  assert.match(page, /href="\/favicon\.svg"/);
});

test("room directory includes the configured owners", () => {
  const office = require("../public/rooms");
  const names = Object.keys(office.ID_OWNER);
  assert.deepEqual(names, ["ceo", "bob", "dave", "stu", "gru", "james"]);
  for (const name of names) assert.ok(office.label(name).length >= 4);
});
