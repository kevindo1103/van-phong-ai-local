/* Shared browser/Node room layout and explicit session-prefix resolver.
   Prefix maps the FUNCTION to its owner; unlabelled sessions stay unassigned. */
(function (root, factory) {
  const office = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = office;
  if (root) root.OfficeRooms = office;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const ROOMS = Object.freeze([
    { id: "ceo", label: "CEO · Kyle", x: 20, y: 20, w: 360, h: 230, tone: 0x8a6a3a },
    { id: "bob", label: "Backend · Bob", x: 400, y: 20, w: 360, h: 230, tone: 0x53697d },
    { id: "dave", label: "Frontend · Dave", x: 780, y: 20, w: 400, h: 230, tone: 0x75617e },
    { id: "stu", label: "Product · Stu", x: 20, y: 270, w: 360, h: 230, tone: 0x60816c },
    { id: "gru", label: "QC & Infra · Gru", x: 400, y: 270, w: 360, h: 230, tone: 0x80645b },
    { id: "james", label: "PM · James", x: 780, y: 270, w: 400, h: 230, tone: 0x687995 },
    { id: "unassigned", label: "Khu vực chung · Chưa có tên", x: 20, y: 520, w: 360, h: 240, tone: 0x55575a },
    { id: "dev", label: "DEV (dùng chung)", x: 400, y: 520, w: 360, h: 240, tone: 0x393f46 },
    { id: "lounge", label: "Phòng họp", x: 780, y: 520, w: 400, h: 240, tone: 0x6d7078 },
  ]);
  const AGENT_ROOMS = Object.freeze(["ceo", "bob", "dave", "stu", "gru", "james", "unassigned"]);
  const NAME_ROOM = Object.freeze({ kyle: "ceo", bob: "bob", dave: "dave", stu: "stu", gru: "gru", james: "james" });
  const ROLE_ROOM = Object.freeze({ ceo: "ceo", backend: "bob", frontend: "dave", product: "stu", qc: "gru", infra: "gru", pm: "james" });
  const ID_OWNER = Object.freeze({ ceo: "Kyle", bob: "Bob", dave: "Dave", stu: "Stu", gru: "Gru", james: "James" });
  const byId = Object.fromEntries(ROOMS.map((room) => [room.id, room]));
  const ROLE = "(backend|front[- ]?end|product|qc|infra|pm|ceo)";
  const BRACKET = new RegExp("^\\s*[\\[(]\\s*" + ROLE + "\\s*[\\])]", "i");
  const SEPARATOR = new RegExp("^\\s*" + ROLE + "\\s*(?=[:|/\\\\_.—–-])", "i");
  const ALONE = new RegExp("^\\s*" + ROLE + "\\s*$", "i");
  function rolePrefixRoom(value) {
    const s = String(value || "").normalize("NFKC");
    const m = BRACKET.exec(s) || SEPARATOR.exec(s) || ALONE.exec(s);
    const role = m && m[1].toLowerCase().replace(/[- ]/g, "");
    return role ? ROLE_ROOM[role] || null : null;
  }
  function ownerRoomFromName(value) {
    const s = String(value || "").normalize("NFKC").trim();
    const initial = s.match(/^(?:(?:agent|ai|session|claude|codex)\s*[: -]\s*)?(kyle|bob|dave|stu|gru|james)\b/i);
    const marked = s.match(/(?:^|[|;])\s*(?:owner|agent|phu trach|phụ trách)\s*[:=]\s*(kyle|bob|dave|stu|gru|james)\b/i);
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
    const usableH = r.h - 106;
    const x = r.x + (index % cols + 0.5) * r.w / cols;
    const y = r.y + 66 + (Math.floor(index / cols) + 0.5) * usableH / rows;
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
