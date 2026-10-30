/* Shared browser/Node room layout and explicit session-prefix resolver.
   Team roles match the user's real Work sessions; unlabelled sessions stay unassigned. */
(function (root, factory) {
  const office = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = office;
  if (root) root.OfficeRooms = office;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const ROOMS = Object.freeze([
    { id: "ceo", label: "CEO · Kyle", x: 20, y: 20, w: 360, h: 200, tone: 0x8a6a3a },
    { id: "bob", label: "Backend · Bob", x: 400, y: 20, w: 360, h: 200, tone: 0x53697d },
    { id: "dave", label: "Frontend · Dave", x: 780, y: 20, w: 400, h: 200, tone: 0x75617e },
    { id: "stu", label: "Product · Stu", x: 20, y: 240, w: 360, h: 200, tone: 0x60816c },
    { id: "agnes", label: "QC · Agnes", x: 400, y: 240, w: 360, h: 200, tone: 0x80645b },
    { id: "gru", label: "Infra · Gru", x: 780, y: 240, w: 400, h: 200, tone: 0x657589 },
    { id: "james", label: "PM · James", x: 20, y: 460, w: 360, h: 200, tone: 0x687995 },
    { id: "edith", label: "Docs · Edith", x: 400, y: 460, w: 360, h: 200, tone: 0x857554 },
    { id: "unassigned", label: "Chưa phân công", x: 780, y: 460, w: 400, h: 200, tone: 0x55575a },
    { id: "dev", label: "DEV (dùng chung)", x: 20, y: 680, w: 560, h: 240, tone: 0x393f46 },
    { id: "lounge", label: "Phòng họp", x: 600, y: 680, w: 580, h: 240, tone: 0x6d7078 },
  ]);
  const AGENT_ROOMS = Object.freeze(["ceo", "bob", "dave", "stu", "agnes", "gru", "james", "edith", "unassigned"]);
  const NAME_ROOM = Object.freeze({ kyle: "ceo", bob: "bob", dave: "dave", stu: "stu", agnes: "agnes", gru: "gru", james: "james", edith: "edith" });
  const ROLE_ROOM = Object.freeze({ ceo: "ceo", backend: "bob", frontend: "dave", product: "stu", qc: "agnes", infra: "gru", pm: "james", project: "james", docs: "edith" });
  const ID_OWNER = Object.freeze({ ceo: "Kyle", bob: "Bob", dave: "Dave", stu: "Stu", agnes: "Agnes", gru: "Gru", james: "James", edith: "Edith" });
  const byId = Object.fromEntries(ROOMS.map((room) => [room.id, room]));
  const ROLE = "(backend|front[- ]?end|product|qc|infra|pm|project|docs|ceo)";
  const BRACKET = new RegExp("^\\s*[\\[(]\\s*" + ROLE + "\\s*[\\])]", "i");
  const SEPARATOR = new RegExp("^\\s*" + ROLE + "\\s*(?=[:|/\\\\_.·—–-])", "i");
  const ALONE = new RegExp("^\\s*" + ROLE + "\\s*$", "i");
  function rolePrefixRoom(value) {
    const s = String(value || "").normalize("NFKC");
    const m = BRACKET.exec(s) || SEPARATOR.exec(s) || ALONE.exec(s);
    const role = m && m[1].toLowerCase().replace(/[- ]/g, "");
    return role ? ROLE_ROOM[role] || null : null;
  }
  function ownerRoomFromName(value) {
    const s = String(value || "").normalize("NFKC").trim();
    const initial = s.match(/^(?:(?:agent|ai|session|claude|codex)\s*[: -]\s*)?(kyle|bob|dave|stu|agnes|gru|james|edith)\b/i);
    const marked = s.match(/(?:^|[|;])\s*(?:owner|agent|phu trach|phụ trách)\s*[:=]\s*(kyle|bob|dave|stu|agnes|gru|james|edith)\b/i);
    return (initial || marked) ? NAME_ROOM[(initial || marked)[1].toLowerCase()] : null;
  }
  function resolve(name) {
    const prefix = rolePrefixRoom(name);
    if (prefix) return { room: prefix, source: "prefix" };
    const owner = ownerRoomFromName(name);
    if (owner) return { room: owner, source: "owner" };
    return { room: "unassigned", source: "unassigned" };
  }
  function isAgentRoom(id) { return AGENT_ROOMS.includes(id); }
  function label(id) { return byId[id] ? byId[id].label : byId.unassigned.label; }
  function seat(roomId, index, total) {
    const r = byId[isAgentRoom(roomId) ? roomId : "unassigned"];
    const n = Math.max(1, total);
    const cols = n <= 3 ? n : n <= 6 ? 3 : 4, rows = Math.max(1, Math.ceil(n / cols));
    const usableH = r.h - 95;
    const x = r.x + (index % cols + 0.5) * r.w / cols;
    const y = r.y + 64 + (Math.floor(index / cols) + 0.5) * usableH / rows;
    return [Math.round(x), Math.round(y)];
  }
  function arrange(agents) {
    const groups = new Map(AGENT_ROOMS.map((id) => [id, []]));
    for (const a of agents || []) groups.get(isAgentRoom(a.room) ? a.room : "unassigned").push(a);
    const result = {};
    for (const [id, members] of groups) {
      members.sort((a, b) => (a.key === "ceo" ? -1 : b.key === "ceo" ? 1 : String(a.key).localeCompare(String(b.key))));
      members.forEach((a, i) => { result[a.key] = seat(id, i, members.length); });
    }
    return result;
  }
  return { ROOMS, AGENT_ROOMS, ROLE_ROOM, ID_OWNER, rolePrefixRoom, ownerRoomFromName, resolve, isAgentRoom, label, seat, arrange };
});
