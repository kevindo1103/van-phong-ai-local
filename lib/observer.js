"use strict";
// Read-only GitHub delivery observer. No ChatGPT tokens and no repo writes.
// GH CLI must already have repository read access via its normal auth profile.
const { execFile } = require("node:child_process");

const REPO_RE = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const MAX_PRS = 25, MAX_RUNS = 45, MAX_CHECKS = 45;

function clean(s, n = 160) {
  return String(s == null ? "" : s).replace(/[\x00-\x1f\x7f<>]/g, " ").trim().slice(0, n);
}
function safeUrl(value, repo) {
  try {
    const u = new URL(String(value || ""));
    if (u.protocol === "https:" && u.hostname === "github.com" &&
      u.pathname.toLowerCase().startsWith("/" + repo.toLowerCase() + "/")) return u.href;
  } catch {}
  return null;
}
function isoMs(value) {
  const n = Date.parse(String(value || ""));
  return Number.isFinite(n) ? n : null;
}
function normalizeRun(v, repo) {
  if (!v || !Number.isSafeInteger(Number(v.id)) || !v.head_branch) return null;
  const status = /^(queued|in_progress|waiting|requested|pending|completed)$/.test(String(v.status)) ? String(v.status) : "unknown";
  const conclusion = /^(success|failure|cancelled|timed_out|action_required|neutral|skipped|stale)$/.test(String(v.conclusion)) ? String(v.conclusion) : null;
  return {
    id: Number(v.id), title: clean(v.display_title || v.name),
    workflow: clean(v.name), branch: clean(v.head_branch, 170),
    status, conclusion: status === "completed" ? conclusion : null,
    checkedAt: isoMs(v.updated_at), startedAt: isoMs(v.run_started_at),
    url: safeUrl(v.html_url, repo),
    event: clean(v.event, 30)
  };
}
function deriveCi(runs) {
  if (!runs.length) return { status: "not-checked", label: "Chưa có CI trong cửa sổ quan sát" };
  const current = runs[0];
  if (runs.some((r) => r.status !== "completed"))
    return { status: "running", label: "Đang có CI chạy/chờ", at: current.checkedAt };
  if (runs.some((r) => r.conclusion === "failure" || r.conclusion === "timed_out" || r.conclusion === "action_required"))
    return { status: "failure", label: "Có CI lỗi", at: current.checkedAt };
  if (runs.some((r) => r.conclusion === "cancelled"))
    return { status: "cancelled", label: "Có CI bị hủy", at: current.checkedAt };
  if (runs.some((r) => r.conclusion === "success"))
    return { status: "success", label: "Các run gần nhất không thấy lỗi", at: current.checkedAt };
  return { status: "unknown", label: "Chưa xác định kết quả CI", at: current.checkedAt };
}
function normalizePr(v, repo, runs = []) {
  if (!v || !Number.isSafeInteger(Number(v.number))) return null;
  const branch = clean(v.head && v.head.ref, 170);
  const branchRuns = runs.filter((r) => r.branch === branch).slice(0, 6);
  return {
    number: Number(v.number), title: clean(v.title), branch,
    url: safeUrl(v.html_url, repo), isDraft: !!v.draft,
    updatedAt: isoMs(v.updated_at), state: v.state === "open" ? "open" : "other",
    ci: deriveCi(branchRuns),
    runs: branchRuns
  };
}
function makeFetcher(exec = execFile) {
  return (resource) => new Promise((resolve, reject) => {
    exec("gh", ["api", "--method", "GET", resource], {
      windowsHide: true, timeout: 25000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8"
    }, (err, stdout) => {
      if (err) return reject(new Error("GitHub CLI read failed (" + clean(err.code || "unknown", 32) + ")"));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("GitHub API JSON malformed")); }
    });
  });
}
function createObserver({ repo = "", refreshMs = 120000, fetcher = makeFetcher(), now = Date.now } = {}) {
  const valid = REPO_RE.test(repo);
  const intervalMs = Math.max(60000, Math.min(600000, Number(refreshMs) || 120000));
  let snapshot = {
    repo: valid ? repo : null, status: valid ? "loading" : "disabled",
    checkedAt: null, attemptAt: null, error: null, prs: [], runs: [],
    refreshSeconds: Math.round(intervalMs / 1000)
  };
  let pending = null, timer = null;
  async function refresh() {
    if (!valid) return snapshot;
    if (pending) return pending;
    const started = now();
    pending = (async () => {
      try {
        const prefix = "repos/" + repo;
        const [prsResponse, runsResponse] = await Promise.all([
          fetcher(prefix + "/pulls?state=open&per_page=" + MAX_PRS),
          fetcher(prefix + "/actions/runs?per_page=" + MAX_RUNS)
        ]);
        if (!Array.isArray(prsResponse) || !Array.isArray(runsResponse?.workflow_runs))
          throw new Error("GitHub response format changed");
        const runs = runsResponse.workflow_runs.map((r) => normalizeRun(r, repo)).filter(Boolean).slice(0, MAX_RUNS);
        const prs = prsResponse.map((p) => normalizePr(p, repo, runs)).filter(Boolean).slice(0, MAX_PRS);
        snapshot = {
          repo, status: "ok", checkedAt: now(), attemptAt: started,
          error: null, prs, runs, refreshSeconds: Math.round(intervalMs / 1000)
        };
      } catch (e) {
        // Retain last successful data but explicitly mark the source as stale.
        snapshot = { ...snapshot, status: "error", attemptAt: started,
          error: clean(e?.message || "GitHub unavailable", 140) };
      } finally { pending = null; }
      return snapshot;
    })();
    return pending;
  }
  function start() {
    if (valid && !timer) {
      void refresh();
      timer = setInterval(() => { void refresh(); }, intervalMs);
      timer.unref?.();
    }
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }
  function read() { return snapshot; }
  return { read, refresh, start, stop };
}
module.exports = { createObserver, normalizePr, normalizeRun, deriveCi, makeFetcher };
