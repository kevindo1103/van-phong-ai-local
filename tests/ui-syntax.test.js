"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

for (const file of ["index.html", "2d.html", "board.html"]) {
  test("browser scripts and room layout are valid in " + file, () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "public", file), "utf8");
    assert.match(html, /src="rooms\.js"/);
    const scripts = [...html.matchAll(/<script(?:\s+type="([^"]+)")?>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length > 0, file + " is missing inline JS");
    for (const script of scripts) {
      if (script[1] === "importmap") { JSON.parse(script[2]); continue; }
      const module = script[1] === "module";
      const check = spawnSync(process.execPath, module ? ["--check", "--input-type=module"] : ["--check"], {
        input: script[2], encoding: "utf8", windowsHide: true, timeout: 8000
      });
      assert.equal(check.status, 0, file + " script syntax: " + check.stderr);
    }
  });
}
