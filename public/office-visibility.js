/* Pure presentation policy for Agent Office 3D.
 * Does not mutate the server state, agent room assignment or liveness.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OfficeVisibility = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const LIVE_STAGES = new Set(["recent-signal", "recent-log", "working", "tool-running", "approval-wait"]);
  function isFresh(a) {
    return a && a.connection !== "stale" && a.connection !== "unlinked";
  }
  function isAttention(a) {
    if (!a || a.platform === "human") return false;
    if (a.flag === "waiting") return true;
    const stage = a.observation?.activity?.state;
    if (LIVE_STAGES.has(stage)) return true;
    if (a.flag === "blocked" && isFresh(a)) return true;
    return a.status === "active" && isFresh(a);
  }
  function linkCount(a) {
    const refs = a?.observation?.delivery?.links || {};
    return (refs.prs?.length || 0) + (refs.issues?.length || 0);
  }
  function score(a) {
    if (a.platform === "human") return 10000;
    if (a.flag === "waiting") return 9000;
    if (isAttention(a)) return 8000;
    if (linkCount(a)) return 6000 + Math.min(300, linkCount(a) * 30);
    if (a.task || a.observation?.work?.task) return 4000;
    if (a.reportedState === "blocked") return 3000;
    if (a.connection === "live") return 2000;
    if (a.status === "idle") return 500;
    if (a.status === "away") return 100;
    return 250;
  }
  function mostRelevant(members) {
    return [...members].sort((a, b) =>
      score(b) - score(a) ||
      (b.lastHeartbeat || b.lastActive || b.createdAt || 0) -
      (a.lastHeartbeat || a.lastActive || a.createdAt || 0) ||
      String(a.key).localeCompare(String(b.key)));
  }
  function choose(agents, opts = {}) {
    const items = Array.isArray(agents) ? agents : [];
    const mode = opts.mode === "all" ? "all" : "compact";
    const focusedRoom = opts.focusedRoom || "all";
    const selected = opts.selected || null;
    if (mode === "all") return new Set(items.map(a => a.key));
    const shown = new Set();
    const groups = new Map();
    for (const a of items) {
      if (a.platform === "human") { shown.add(a.key); continue; }
      const room = a.room || "unassigned";
      if (!groups.has(room)) groups.set(room, []);
      groups.get(room).push(a);
    }
    for (const [room, members] of groups) {
      // When focused, show the selected room only. Its older sessions remain
      // available in the sidebar even if their avatars are not drawn.
      if (focusedRoom !== "all" && room !== focusedRoom) continue;
      const ranked = mostRelevant(members);
      let limit = focusedRoom === "all" ? 1 : 4;
      // The unassigned room is often populated by unknown/old CLI journals.
      // Keep its floor free until there is meaningful confirmed activity.
      if (room === "unassigned" && focusedRoom === "all" &&
          !ranked.some(a => isAttention(a) || linkCount(a) || a.task)) limit = 0;
      const attention = ranked.filter(isAttention);
      if (focusedRoom === "all" && attention.length > 1) limit = 2;
      for (const item of ranked.slice(0, limit)) shown.add(item.key);
    }
    // Selecting a session in the directory always reveals that robot, even
    // if it was previously hidden, without changing its actual status.
    if (selected && items.some(a => a.key === selected)) shown.add(selected);
    return shown;
  }
  function summary(agents, shown) {
    const all = (agents || []).filter(a => a.platform !== "human");
    const count = all.filter(a => shown.has(a.key)).length;
    return { total: all.length, shown: count, hidden: all.length - count };
  }
  return { choose, summary, score, mostRelevant, isAttention, linkCount };
});
