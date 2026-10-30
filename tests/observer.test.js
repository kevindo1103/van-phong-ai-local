"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createObserver, normalizePr, normalizeRun } = require("../lib/observer");
const { createLinks } = require("../lib/observer-links");

const REPO = "sample-org/sample-repo";
function fixture() {
  const pr = [
    { number: 1940, title: "feat(B04): staff POS", state: "open",
      updated_at: "2026-10-30T09:06:30Z", draft: false,
      head: { ref: "codex/b04-integration-20261030" },
      html_url: "https://github.com/sample-org/sample-repo/pull/1940" },
    { number: 1941, title: "B02 B03 merged", state: "open", draft: false,
      updated_at: "2026-10-30T09:15:00Z", head: { ref: "branch-1941" },
      html_url: "https://github.com/sample-org/sample-repo/pull/1941" }
  ];
  const runs = { workflow_runs: [
    { id: 101, display_title: "B04 tests", name: "PR test", status: "completed",
      conclusion: "success", head_branch: "codex/b04-integration-20261030",
      updated_at: "2026-10-30T09:05:00Z", html_url: "https://github.com/sample-org/sample-repo/actions/runs/101" },
    { id: 102, display_title: "Backend tests", name: "pytest", status: "in_progress",
      head_branch: "branch-1941", updated_at: "2026-10-30T09:30:00Z",
      html_url: "https://github.com/sample-org/sample-repo/actions/runs/102" }
  ] };
  return { pr, runs };
}
test("read-only observer correlates PR runs by exact branch and does not assign owners", async () => {
  const f = fixture(), calls = [];
  const o = createObserver({ repo: REPO, refreshMs: 30000, now: () => 1000,
    fetcher: async (resource) => {
      calls.push(resource);
      return resource.includes("/pulls?") ? f.pr : f.runs;
    }
  });
  const result = await o.refresh();
  assert.equal(result.status, "ok");
  assert.equal(result.repo, REPO);
  assert.equal(result.prs.length, 2);
  assert.equal(result.runs.length, 2);
  assert.equal(result.prs[0].ci.status, "success");
  assert.equal(result.prs[1].ci.status, "running");
  assert.equal(result.prs[0].runs[0].branch, "codex/b04-integration-20261030");
  assert.equal(result.prs[1].runs[0].id, 102);
  assert.ok(!JSON.stringify(result).includes("ownerId"));
  assert.equal(calls.length, 2);
  assert.ok(calls.every((x) => x.startsWith("repos/" + REPO + "/")));
  assert.equal(result.refreshSeconds, 60); // minimum polling = 60s
  o.stop();
});

test("fetch failures mark source stale without overwriting last GitHub snapshot", async () => {
  const f = fixture();let fail = false;
  const o = createObserver({ repo: REPO, fetcher: async (resource) => {
    if (fail) throw Object.assign(new Error("denied"), { code: "EPERM" });
    return resource.includes("/pulls?") ? f.pr : f.runs;
  }});
  assert.equal((await o.refresh()).prs.length, 2);
  fail = true;
  const result = await o.refresh();
  assert.equal(result.status, "error");
  assert.equal(result.prs.length, 2);
  assert.match(result.error, /denied/);
});

test("observer ignores malformed payloads or unsafe GitHub URLs", () => {
  assert.equal(normalizePr({}, REPO, []), null);
  assert.equal(normalizeRun({ id: "not-a-number", head_branch: "x" }, REPO), null);
  const f = fixture();f.pr[0].html_url = "https://evil.example/collect?q=secret";
  const item = normalizePr(f.pr[0], REPO, []);
  assert.equal(item.url, null);
  f.runs.workflow_runs[0].html_url = "https://fake.github.com/sample-org/sample-repo/runs/101";
  assert.equal(normalizeRun(f.runs.workflow_runs[0], REPO).url, null);
});

test("explicit session-PR assignment persists, is scoped and never guesses a mapping", (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "office-link-test-"));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const links = createLinks(data);
  assert.deepEqual(links.all(), {});
  assert.equal(links.get("w-1014c53c07a7"), null);
  links.set("w-1014c53c07a7", 1941);
  links.set("g-fa049483dead", 1940);
  assert.equal(createLinks(data).get("w-1014c53c07a7"), 1941);
  assert.equal(createLinks(data).get("g-fa049483dead"), 1940);
  links.set("w-1014c53c07a7", null);
  assert.equal(links.get("w-1014c53c07a7"), null);
  assert.throws(() => links.set("../config.json", 1940), TypeError);
  assert.throws(() => links.set("w-1014c53c07a7", -1), TypeError);
});
test("observer dashboard describes liveness distinct from delivery", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "observer.html"), "utf8");
  assert.match(html, /api\/observer/);
  assert.match(html, /api\/observer\/link/);
  assert.match(html, /liveness kỹ thuật/);
  assert.match(html, /không thay đổi trạng thái hoạt động/);
  assert.match(html, /Không tự suy luận agent đang chạy/);
});
