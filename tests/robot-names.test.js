"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const m = source.match(/const robotShortName = \(name\) => \{[^\n]*\};/);
test("robot names are truncated to the first 10 characters with three dots", () => {
  assert.ok(m, "robotShortName helper exists");
  const shorten = vm.runInNewContext(m[0] + "\nrobotShortName", {});
  assert.equal(shorten("Bob"), "Bob");
  assert.equal(shorten("Backend - Bob"), "Backend - ...");
  assert.equal(shorten("Frontend · Dave"), "Frontend ·...");
  assert.equal(shorten("Product · Stu"), "Product · ...");
  assert.equal(shorten("1234567890"), "1234567890");
  assert.equal(shorten("12345678901"), "1234567890...");
  assert.equal(shorten("🤖RobotABCDEF"), "🤖RobotABCD...");
});

test("every 3D robot receives an independent, clickable side-name label", () => {
  assert.match(source, /const sideName = h\("div", "agent-name-side", robotShortName\(a\.name\)\)/);
  assert.match(source, /sideNameObject\.center\.set\(0, 0\.5\)/);
  assert.match(source, /sideNameObject\); \/\/ outside the rotating robot group/);
  assert.match(source, /bot\.nameTag\.position\.copy\(bot\.g\.position\)/);
  assert.match(source, /sideName\.title = a\.name/);
  assert.match(source, /sideName\.addEventListener\("click"/);
  assert.match(source, /statusBadge, sideName, nameTag: sideNameObject, fallbackVisuals/);
  assert.match(source, /b\.sideName\.textContent !== compactName/);
});
