// Văn phòng ảo 3D cho đội AI (Claude Code + Codex).
// Máy chủ CHỈ ĐỌC: nhật ký phiên có sẵn trên máy (~/.claude, ~/.codex) và sổ điều phối của đội trong thư mục data/
// (việc ưu tiên, gói việc, hòm thư, lượt DEV, cần anh, nội quy…; ghi bằng công cụ tools/vp.js). Mỗi giây đẩy trạng thái lên trình duyệt.
// Không gửi dữ liệu ra ngoài, không sửa file nào của Claude/Codex, che mọi chuỗi giống khóa trước khi hiện.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const security = require("./lib/security");
const officeRooms = require("./public/rooms");
const workSessions = require("./lib/work-sessions");
const { createObserver } = require("./lib/observer");
const claudeObserver = require("./lib/observer-local");
const { createLinks } = require("./lib/observer-links");
const { suggestLinks } = require("./lib/observer-suggestions");
const { createStore: createRoomStore } = require("./lib/session-rooms");
const { execFile } = require("child_process");
const perf = require("./lib/perf");
const chat = require("./lib/chat");
const docs = require("./lib/docs");
const hopthu = require("./lib/hopthu");
const tongquan = require("./lib/tongquan");
const { loadConfig } = require("./lib/config");

const ROOT = __dirname;
const CFG = loadConfig(ROOT);
if (!CFG) { console.error("Chưa có config.json. Chạy trước: npm run setup"); process.exit(1); }
const DATA = CFG.dataDir;
const ROOM_STORE = createRoomStore(DATA);
const DELIVERY_LINKS = createLinks(DATA);
const OBSERVER = createObserver({ repo: CFG.observerRepo, refreshMs: Number(CFG.observerRefreshSeconds || 120) * 1000 });
OBSERVER.start();
const PORT = Number(process.env.PORT || CFG.port);
const KEEP = CFG.keepHours * 3600000;
const FIRST_READ = 8_000_000; // lần đầu chỉ đọc 8 MB cuối mỗi nhật ký
const MAX_READ = 16_000_000;

// ---------- tiện ích ----------
const now = () => Date.now();
function mask(s) {
  if (!s) return "";
  const pin = chat.currentPin(); if (pin && /^\d{6}$/.test(pin)) s = String(s).split(pin).join("‹PIN›"); // không lộ mã PIN nhắn tin
  return String(s)
    .replace(/[A-Za-z]:[\\/][^\s|;,]*secrets?[^\s|;,]*/gi, "‹thư mục khóa›")
    .replace(/((?:api[_-]?)?key|token|secret|password|passwd|pwd|bearer)\s*[:=]\s*\S+/gi, "$1=‹ẩn›")
    .replace(/\b(sk|pk|rk|ghp|gho|github_pat|xox[abp]|AKIA|AIza)[-_A-Za-z0-9]{12,}/g, "‹khóa›")
    .replace(/[A-Za-z0-9_\-+/=]{48,}/g, "…")
    .replace(/\*\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
// Che khóa trong sổ sách mà vẫn giữ xuống dòng và định dạng Markdown (nội quy, bài học…).
function maskDoc(s) {
  if (!s) return "";
  const pin = chat.currentPin(); if (pin && /^\d{6}$/.test(pin)) s = String(s).split(pin).join("‹PIN›");
  return String(s)
    .replace(/[A-Za-z]:[\\/][^\s|;,`]*secrets?[^\s|;,`]*/gi, "‹thư mục khóa›")
    .replace(/((?:api[_-]?)?key|token|secret|password|passwd|pwd)\s*[:=]\s*[^\s`|]+/gi, "$1=‹ẩn›")
    .replace(/\b(sk|pk|rk|ghp|gho|github_pat|xox[abp]|AKIA|AIza)[-_A-Za-z0-9]{12,}/g, "‹khóa›")
    .replace(/\b(?=[A-Za-z0-9+/=]*[A-Z])(?=[A-Za-z0-9+/=]*[a-z])(?=[A-Za-z0-9+/=]*\d)[A-Za-z0-9+/=]{40,}\b/g, "…");
}
const clip = (s, n = 180) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
function safeStat(p) { try { return fs.statSync(p); } catch { return null; } }
function readRange(p, start, end) {
  const fd = fs.openSync(p, "r");
  try { const buf = Buffer.alloc(Math.max(0, end - start)); fs.readSync(fd, buf, 0, buf.length, start); return buf; } finally { fs.closeSync(fd); }
}
function firstLine(f) {
  const fd = fs.openSync(f, "r");
  try { const b = Buffer.alloc(1 << 20); const n = fs.readSync(fd, b, 0, b.length, 0); const nl = b.subarray(0, n).indexOf(10); return b.subarray(0, nl < 0 ? n : nl).toString("utf8"); } finally { fs.closeSync(fd); }
}
const boDau = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim();

// ---------- phiên nào thuộc dự án của bạn ----------
const normP = (p) => path.resolve(String(p || "")).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const PROJECTS = (CFG.projects || []).filter(Boolean);
const inProject = (cwd) => !PROJECTS.length || PROJECTS.some((p) => { const a = normP(cwd), b = normP(p); return a === b || a.startsWith(b + "/"); });
// Claude Code đặt tên thư mục nhật ký theo đường dẫn dự án: mọi ký tự không phải chữ/số thành "-".
const encDir = (p) => path.resolve(p).replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
const claudeDirOk = (d) => !PROJECTS.length || PROJECTS.some((p) => { const e = encDir(p), x = d.toLowerCase(); return x === e || x.startsWith(e + "-"); });
const hidden = new Set(CFG.hide || []);

// ---------- nhân viên ----------
// Phòng (mã nội bộ → tên hiện): ceo = Giám đốc (bạn), manager = Quản lý, coord = Điều phối, g1 = Kiểm tra & duyệt, claude, codex, dev.
const agents = [];
const byKey = {};
function mark(a, t) { a.mins.add(Math.floor(t / 60000)); if (a.mins.size > 12000) { const cut = Math.floor((now() - 8 * 86400000) / 60000); for (const m of a.mins) if (m < cut) a.mins.delete(m); } }
function blank(a) { return { ...a, file: null, size: 0, offset: 0, mtime: 0, lastText: "", lastTail: "", lastTextAt: 0, working: false, subActive: 0, mins: new Set(), done: [], tools: [], lastUserAt: 0, ceoLastAt: 0, ceoLastText: "" }; }
const ceo = blank({ key: "ceo", name: CFG.ownerName, role: "Chủ văn phòng", platform: "human", room: "ceo", journal: "none:ceo", ceo: true, aliases: [CFG.ownerName, "CEO", "Giám đốc"] });
agents.push(ceo); byKey.ceo = ceo;
function override(name, id) { return (CFG.staff || []).find((s) => s.match && (String(name).toLowerCase().includes(String(s.match).toLowerCase()) || String(id).startsWith(s.match))); }
// Priority: persisted per-session override > configured staff override > title role prefix
// (Backend, Frontend, Product, QC, PM, CEO) > owner name > unassigned.
function roomInfo(rawName, displayedName, o) {
  if (o && officeRooms.isAgentRoom(o.room)) return { room: o.room, source: "config" };
  const byRole = officeRooms.rolePrefixRoom(rawName) || officeRooms.rolePrefixRoom(displayedName);
  if (byRole) return { room: byRole, source: "prefix" };
  const byName = officeRooms.ownerRoomFromName(displayedName) || officeRooms.ownerRoomFromName(rawName);
  return byName ? { room: byName, source: "owner" } : { room: "unassigned", source: "unassigned" };
}
function effectiveRoom(a) {
  const manual = ROOM_STORE.get(a.key);
  if (manual) return { room: manual, source: "manual" };
  const o = override(a.sourceTitle || a.name, a.id) || override(a.name, a.id);
  return roomInfo(a.sourceTitle || a.name, a.name, o);
}
function addAgent(platform, id, file, name, createdAt) {
  const key = (platform === "codex" ? "x-" : "c-") + id.slice(0, 8);
  if (byKey[key]) return byKey[key];
  const o = override(name, id), nm = clip(mask((o && o.name) || name), 40), assigned = roomInfo(name, nm, o);
  const a = blank({ key, id, platform, journal: platform + ":" + id, autoName: !(o && o.name), name: nm, aliases: [nm],
    role: (o && o.role) || (platform === "codex" ? "Kỹ sư Codex" : "Kỹ sư Claude Code"),
    room: assigned.room, roomSource: assigned.source, sourceTitle: name, auto: true, createdAt: createdAt || now() });
  a.file = file;
  agents.push(a); byKey[key] = a; return a;
}
function setName(a, name) {
  if (!a.autoName || !name) return;
  a.sourceTitle = name;
  const n = clip(mask(name), 40); if (n === a.name) return;
  a.name = n; a.aliases = [n];
  const info = effectiveRoom(a); a.room = info.room; a.roomSource = info.source;
}

// Sổ đăng ký phiên Claude đang mở (~/.claude/sessions/<pid>.json): phiên nào đang chạy/rảnh, tên phiên, mã giao diện local_….
// Chỉ đọc file .json; không bao giờ đọc file khóa trong thư mục này.
let live = new Map(), hostToJournal = new Map();
function readLive() {
  const dir = path.join(CFG.claudeDir, "sessions"), m = new Map(), hm = new Map();
  let files = []; try { files = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)); } catch {}
  for (const f of files) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    try { process.kill(d.pid, 0); } catch { continue; } // tiến trình đã tắt
    if (!d.sessionId || !inProject(d.cwd || "")) continue;
    m.set(d.sessionId, { name: d.name || null, busy: d.status === "busy", host: String(d.hostSessionId || "").replace(/^local_/, "") || null });
    const host = String(d.hostSessionId || "").replace(/^local_/, ""); if (host) hm.set(host, d.sessionId);
  }
  live = m; hostToJournal = hm;
}
const toJournal = (s) => { s = String(s || "").replace(/^local_/, ""); for (const [h, j] of hostToJournal) if (s.length >= 8 && h.startsWith(s.slice(0, 8))) return j; return s; };

function claudeTitle(f) {
  const st = safeStat(f); if (!st) return null;
  const tail = readRange(f, Math.max(0, st.size - 2_000_000), st.size).toString("utf8");
  const all = [...tail.matchAll(/"(?:customTitle|agentName)":"((?:[^"\\]|\\.){1,80})"/g)];
  if (all.length) { try { return JSON.parse(`"${all[all.length - 1][1]}"`); } catch {} }
  return null;
}
function codexNames() {
  const m = {};
  try { for (const l of fs.readFileSync(path.join(CFG.codexDir, "session_index.jsonl"), "utf8").split("\n")) { try { const j = JSON.parse(l); if (j.id && j.thread_name) m[j.id] = j.thread_name; } catch {} } } catch {}
  return m;
}
function walk(dir, out) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (e.name.endsWith(".jsonl")) out.push(p); }
}
const notStaff = new Set();
function discover() {
  const t = now();
  // Claude Code: ~/.claude/projects/<thư mục dự án>/<mã phiên>.jsonl
  const pdir = path.join(CFG.claudeDir, "projects");
  let dirs = []; try { dirs = fs.readdirSync(pdir).filter(claudeDirOk); } catch {}
  for (const d of dirs) {
    let files = []; try { files = fs.readdirSync(path.join(pdir, d)).filter((x) => x.endsWith(".jsonl")); } catch {}
    for (const x of files) {
      const id = x.slice(0, -6), f = path.join(pdir, d, x);
      if (hidden.has(id) || byKey["c-" + id.slice(0, 8)]) continue;
      const st = safeStat(f); if (!st || (t - st.mtimeMs > KEEP && !live.has(id))) continue;
      const L = live.get(id);
      addAgent("claude", id, f, (L && L.name) || claudeTitle(f) || `Claude ${id.slice(0, 8)}`, st.birthtimeMs);
    }
  }
  // Codex: ~/.codex/sessions/YYYY/MM/DD/*.jsonl, dòng đầu ghi thư mục làm việc (cwd).
  // Phiên chạy nhiều ngày vẫn ghi vào thư mục của ngày tạo, nên quét cả cây rồi lọc theo giờ sửa file.
  const files = []; walk(path.join(CFG.codexDir, "sessions"), files);
  let names = null;
  for (const f of files) {
    if (notStaff.has(f)) continue;
    const st = safeStat(f); if (!st || t - st.mtimeMs > KEEP) continue;
    let meta; try { meta = JSON.parse(firstLine(f)).payload || {}; } catch { notStaff.add(f); continue; }
    if (!meta.id || hidden.has(meta.id) || !inProject(meta.cwd || "")) { notStaff.add(f); continue; }
    const ex = byKey["x-" + meta.id.slice(0, 8)];
    if (ex) { if (ex.file !== f && st.mtimeMs > (safeStat(ex.file) || { mtimeMs: 0 }).mtimeMs) { ex.file = f; ex.offset = 0; ex.size = 0; } continue; }
    names = names || codexNames();
    addAgent("codex", meta.id, f, names[meta.id] || `Codex ${meta.id.slice(0, 8)}`, Date.parse(meta.timestamp || "") || st.birthtimeMs);
  }
  // cập nhật tên (phiên đổi tên giữa chừng) và cho nghỉ người im quá lâu
  for (const a of agents) {
    if (a.ceo) continue;
    if (a.platform === "claude") { const L = live.get(a.id); setName(a, (L && L.name) || claudeTitle(a.file)); }
    else { names = names || codexNames(); setName(a, names[a.id]); }
  }
  for (let i = agents.length - 1; i >= 0; i--) { const a = agents[i]; if (!a.ceo && a.mtime && t - a.mtime > KEEP && !live.has(a.id)) { agents.splice(i, 1); delete byKey[a.key]; } }
}
// Tìm người theo mã phiên (đầy đủ hoặc 8 ký tự đầu, cả mã giao diện local_…) hoặc theo tên.
function agentFromId(id) {
  if (!id) return null;
  const s = toJournal(id).toLowerCase();
  if (s.length < 8) return null;
  for (const a of agents) if (!a.ceo && (a.id.toLowerCase().startsWith(s.slice(0, 13)) || s.startsWith(a.id.toLowerCase().slice(0, 13)))) return a.key;
  return null;
}
function agentFromLabel(label) {
  if (!label) return null;
  const s = String(label).toLowerCase().trim();
  const hex = (s.match(/\b[0-9a-f]{8}(?:-[0-9a-f]{4})?/) || [])[0];
  if (hex) { const k = agentFromId(hex); if (k) return k; }
  const b = boDau(s);
  for (const a of agents) { if (a.ceo) continue; if ((a.aliases || [a.name]).some((x) => x && (s.includes(x.toLowerCase()) || b.includes(boDau(x))))) return a.key; }
  if (/\b(ceo|giám đốc|giam doc)\b/i.test(s) || s.includes(String(CFG.ownerName).toLowerCase())) return "ceo";
  return null;
}

// ---------- tin nhắn ----------
const events = [];
const seenEvt = new Set();
function pushEvent(e) {
  if (!e.body) e.body = e.title;
  const key = `${e.kind}|${e.from}|${e.to}|${e.title.slice(0, 60)}`, b = Math.floor(e.t / 60000);
  if (seenEvt.has(key + b) || seenEvt.has(key + (b - 1))) return;
  seenEvt.add(key + b); if (seenEvt.size > 20000) seenEvt.clear();
  events.push(e); events.sort((x, y) => x.t - y.t);
  if (events.length > 500) events.splice(0, events.length - 500);
}
function titleOf(text) { const first = mask(String(text).split("\n").find((l) => l.trim()) || ""); return clip(first.replace(/^<[^>]+>\s*/, ""), 120); }
function textOfContent(c) {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.filter((x) => x && /^(text|output_text|input_text)$/.test(x.type)).map((x) => x.text || "").join("\n");
  return "";
}
const NOT_HUMAN = /^(<|# AGENTS\.md|This session is being continued|\[Request interrupted|Caveat:|Another Claude session)/;
// Bạn gõ việc cho một phiên: Giám đốc "nói" với phiên đó.
function ownerSays(a, t, txt) {
  if (t > ceo.ceoLastAt) { ceo.ceoLastAt = t; ceo.ceoLastText = clip(mask(txt), 160); }
  mark(ceo, t);
  pushEvent({ t, kind: "ceo", from: "ceo", to: a.key, title: clip(mask(txt), 110), body: clip(mask(txt), 700) });
}
function keep7(arr) { const cut = now() - 7 * 86400000; while (arr.length && arr[0].t < cut) arr.shift(); }

// ---------- đọc nhật ký Claude Code ----------
function parseClaude(a, line) {
  let j; try { j = JSON.parse(line); } catch { return; }
  const t = Date.parse(j.timestamp || "") || now();
  const msg = j.message || {};
  if (j.type === "assistant") {
    mark(a, t);
    if (msg.stop_reason === "end_turn") { a.done.push({ t }); keep7(a.done); }
    for (const c of Array.isArray(msg.content) ? msg.content : []) {
      if (c.type === "text" && c.text && c.text.trim()) { a.lastText = clip(mask(c.text), 600); a.lastTail = mask(c.text).slice(-500); a.lastTextAt = t; }
      if (c.type === "tool_use") {
        const inp = c.input || {}, n = c.name || "";
        if (/SendMessage|send_message/.test(n)) {
          const to = agentFromId(inp.session_id || inp.to) || agentFromLabel(inp.to);
          const body = inp.message || "";
          if (to && to !== a.key && body) pushEvent({ t, kind: "msg", from: a.key, to, title: titleOf(body), body: clip(mask(body), 700) });
        }
        if (n === "AskUserQuestion" || n === "ExitPlanMode") {
          const q = n === "ExitPlanMode" ? "Duyệt kế hoạch trước khi làm" : ((inp.questions || []).map((x) => `${x.question} ${(x.options || []).map((o, i) => `(${String.fromCharCode(97 + i)}) ${o.label}`).join("; ")}`).join(" · ") || "Câu hỏi cho bạn");
          a.pendingAsk = { id: c.id, t, text: clip(mask(q), 300) };
        }
      }
    }
  }
  if (j.type === "user") {
    const content = msg.content;
    if (Array.isArray(content)) for (const x of content) if (x && x.type === "tool_result") {
      a.tools.push({ t, err: !!x.is_error }); if (a.tools.length > 5000) a.tools.splice(0, 1000);
      if (a.pendingAsk && x.tool_use_id === a.pendingAsk.id) a.pendingAsk = null; // bạn đã trả lời hộp hỏi
    }
    const txt = textOfContent(content);
    if (!txt) return;
    const m = txt.match(/<cross-session-message from="([^"]+)"(?: from-session="([^"]+)")?(?: from-name="([^"]+)")?[^>]*>\s*([\s\S]*)/);
    if (m) {
      const from = agentFromId(m[2]) || agentFromId(m[1]) || agentFromLabel(m[3]);
      const raw = m[4].replace(/<\/cross-session-message>[\s\S]*$/, "");
      if (from && from !== a.key) pushEvent({ t, kind: "msg", from, to: a.key, title: titleOf(raw), body: clip(mask(raw), 700) });
      return;
    }
    const typed = typeof content === "string" || (Array.isArray(content) && !content.some((x) => x.type === "tool_result"));
    const s = txt.trim();
    if (typed && !j.isMeta && s && !NOT_HUMAN.test(s)) { a.lastUserAt = t; ownerSays(a, t, s); }
  }
}
// ---------- đọc nhật ký Codex ----------
function parseCodex(a, line) {
  if (line.length > 200000) return;
  let j; try { j = JSON.parse(line); } catch { return; }
  const t = Date.parse(j.timestamp || "") || now();
  const p = j.payload || {};
  if (j.type === "response_item" || j.type === "event_msg") mark(a, t);
  if (j.type === "response_item" && p.type === "message") {
    const txt = textOfContent(p.content);
    if (p.role === "assistant" && txt.trim()) { a.lastText = clip(mask(txt), 600); a.lastTail = mask(txt).slice(-500); a.lastTextAt = t; }
    if (p.role === "user" && txt.trim()) {
      const peer = txt.match(/\[PEER MESSAGE[^\]]*\]\s*([^\n(]+)/);
      const body = peer ? txt.slice(txt.indexOf(peer[0]) + peer[0].length) : txt;
      const tag = body.match(/\[(VIỆC|GẤP|BÁO|CHẶN|REVIEW|CẦN ANH)[^\n]*/);
      if (peer || tag) {
        const from = agentFromLabel(peer ? peer[1] : (body.match(/—\s*([^\n→]+)→/) || [])[1] || body);
        if (from && from !== a.key) pushEvent({ t, kind: "msg", from, to: a.key, title: titleOf(tag ? tag[0] : body), body: clip(mask(body), 700) });
      } else if (!NOT_HUMAN.test(txt.trim())) { a.lastUserAt = t; ownerSays(a, t, txt.trim()); }
    }
  }
  if (j.type === "response_item" && p.type === "function_call_output") {
    const out = typeof p.output === "string" ? p.output : JSON.stringify(p.output || "");
    a.tools.push({ t, err: /exit code:?\s*[1-9]|"exit_code":\s*[1-9]/i.test(out.slice(0, 400)) }); if (a.tools.length > 5000) a.tools.splice(0, 1000);
  }
  if (j.type === "event_msg") {
    if (p.type === "task_started") a.working = true;
    if (p.type === "task_complete") { a.working = false; a.done.push({ t }); keep7(a.done); }
  }
}
function pollAgent(a) {
  if (!a.file) return;
  const st = safeStat(a.file); if (!st) return;
  a.mtime = st.mtimeMs;
  if (st.size === a.size) return;
  if (st.size < a.offset) a.offset = 0;
  let start = a.offset || Math.max(0, st.size - FIRST_READ);
  if (st.size - start > MAX_READ) start = st.size - MAX_READ;
  const jumped = start !== a.offset;
  const buf = readRange(a.file, start, st.size);
  const skip = jumped && start > 0 ? buf.indexOf(10) + 1 : 0;
  const lastNl = buf.lastIndexOf(10);
  if (lastNl < skip) return;
  a.offset = start + lastNl + 1; a.size = st.size;
  const parse = a.platform === "codex" ? parseCodex : parseClaude;
  for (const line of buf.slice(skip, lastNl).toString("utf8").split("\n")) if (line) parse(a, line);
  if (a.platform === "claude") { // phiên con (subagent) đang chạy
    const sub = path.join(path.dirname(a.file), path.basename(a.file, ".jsonl"), "subagents");
    let n = 0; try { for (const f of fs.readdirSync(sub)) { const s = safeStat(path.join(sub, f)); if (s && now() - s.mtimeMs < 120000) n++; } } catch {}
    a.subActive = n;
  }
}

// ---------- lượt DEV (môi trường thử chung của đội) ----------
// data/DEV.lock: người đang giữ lượt {owner, package, started, loai_luot}. data/DEV-LUOT.jsonl: sự kiện cho / huy_cho / lay / nha (ghi bằng tools/vp.js luot …).
let dev = { holder: null, holderLabel: null, holderSince: null, package: null, lastRows: [], weekRows: [], idleSince: null, queue: [], lastRowAt: null };
let luotSig = "";
function readDev() {
  let lock = null;
  try { const raw = fs.readFileSync(path.join(DATA, "DEV.lock"), "utf8").trim(); if (raw) lock = JSON.parse(raw); } catch {}
  dev.holder = null; dev.package = null; dev.holderSince = null; dev.holderLabel = null;
  if (lock) {
    dev.holderLabel = clip(mask(lock.owner || ""), 60);
    dev.holder = agentFromId((String(lock.owner || "").match(/[0-9a-f]{8}(?:-[0-9a-f]{4})?/) || [])[0]) || agentFromLabel(lock.owner);
    dev.package = clip(mask(lock.package || ""), 80);
    dev.holderSince = Date.parse(lock.started || "") || null;
  }
  const f = path.join(DATA, "DEV-LUOT.jsonl"), st = safeStat(f);
  const sig = st ? st.mtimeMs + ":" + st.size : "-";
  if (sig !== luotSig) {
    luotSig = sig;
    const ev = []; if (st) for (const l of fs.readFileSync(f, "utf8").replace(/^﻿/, "").split("\n")) { try { if (l.trim()) ev.push(JSON.parse(l)); } catch {} }
    const who = (e) => agentFromId((String(e.phien || "").match(/[0-9a-f]{8}(?:-[0-9a-f]{4})?/) || [])[0]) || agentFromLabel(e.vai || e.phien);
    const same = (a, b) => (a.phien && a.phien === b.phien) || (a.vai && b.vai && boDau(a.vai) === boDau(b.vai));
    // hàng chờ: "cho" chưa có "lay"/"huy_cho" sau đó của cùng người
    const open = ev.filter((e, i) => e.su_kien === "cho" && !ev.slice(i + 1).some((x) => (x.su_kien === "lay" || x.su_kien === "huy_cho") && same(e, x)));
    dev.queue = open.map((e, i) => ({ n: String(i + 1), what: clip(mask(`${e.goi || "?"}${e.sha ? " · " + String(e.sha).slice(0, 8) : ""}`), 70), who: clip(mask(e.vai || e.phien || ""), 60), since: Date.parse(e.luc || "") || null, agent: who(e) }));
    // lượt: mỗi "lay" ghép với "nha" kế tiếp của cùng người
    const rows = [];
    ev.forEach((e, i) => {
      if (e.su_kien !== "lay") return;
      const end = ev.slice(i + 1).find((x) => x.su_kien === "nha" && same(e, x));
      const t0 = Date.parse(e.luc || "") || 0, t1 = end ? Date.parse(end.luc || "") || t0 : null;
      const fail = !!(end && /hỏng|hong|fail|chưa đạt|chua dat|quay về|rollback/i.test(String(end.ket_qua || "")));
      rows.push({ start: t0, end: t1, t: t1 || t0, agent: who(e), who: clip(mask(e.vai || e.phien || ""), 60), pkg: clip(mask(e.goi || "?"), 60),
        state: end ? clip(mask(`NHẢ · ${end.ket_qua || ""}`), 140) : "ĐANG GIỮ", result: end ? clip(mask(end.ghi_chu || ""), 260) : "", released: !!end, fail,
        usd: end && end.usd != null && !isNaN(+end.usd) ? +end.usd : null, raw: clip(mask(JSON.stringify(e)), 300), loai: e.loai || "" });
    });
    dev.lastRows = rows.slice(-40);
    dev.weekRows = rows.filter((r) => r.start >= now() - 7 * 86400000);
  }
  dev.lastRowAt = dev.lastRows.length ? Math.max(...dev.lastRows.map((r) => r.t)) : null;
  dev.idleSince = dev.holder || dev.holderLabel ? null : dev.lastRowAt;
}

// ---------- việc ưu tiên + gói việc ----------
// data/UU-TIEN.json: thứ tự việc (dang_lam / tam_dung), mỗi việc trỏ tới mục trong data/goi/<gói>/viec.json ("gói:MÃ").
let uu = { sig: "", data: null, err: null };
function readUuTien() {
  const f = path.join(DATA, "UU-TIEN.json"), st = safeStat(f), sig = st ? st.mtimeMs + ":" + st.size : "-";
  if (sig === uu.sig) return uu;
  try { uu = { sig, data: JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")), err: null }; }
  catch (e) { uu = { sig, data: null, err: st ? "UU-TIEN.json đọc lỗi: " + clip(String(e.message || e), 120) : "chưa có data/UU-TIEN.json" }; }
  return uu;
}
let tasks = [], tasksSig = "";
const SEEN_FILE = path.join(DATA, ".task-seen.json"); // văn phòng tự ghi: lúc từng mục đổi trạng thái
const itemSeen = new Map(Object.entries((() => { try { return JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")); } catch { return {}; } })()));
function readTasks() {
  const d = readUuTien().data;
  const defs = d && Array.isArray(d.dang_lam) ? d.dang_lam.map((v) => ({ n: v.thu_tu, name: v.viec, items: v.muc || [] })) : [];
  const pkgs = [...new Set(defs.flatMap((t) => t.items.map((x) => x.split(":")[0])))];
  const sig = uu.sig + "|" + pkgs.map((p) => { const st = safeStat(path.join(DATA, "goi", p, "viec.json")); return st ? st.mtimeMs + ":" + st.size : "-"; }).join("|") + "|" + luotSig;
  if (sig === tasksSig) return;
  tasksSig = sig;
  const cache = {};
  const item = (pkg, id) => {
    if (!cache[pkg]) { try { cache[pkg] = JSON.parse(fs.readFileSync(path.join(DATA, "goi", pkg, "viec.json"), "utf8").replace(/^﻿/, "")); } catch { cache[pkg] = { viec: [] }; } }
    return (cache[pkg].viec || []).find((v) => v.id === id);
  };
  const mtimeOf = (t) => { let m = 0; for (const x of t.items) { const st = safeStat(path.join(DATA, "goi", x.split(":")[0], "viec.json")); if (st) m = Math.max(m, st.mtimeMs); } return m || now(); };
  tasks = defs.map((t) => {
    const its = t.items.map((x) => { const [p, id] = x.split(":"); return { id, pkg: p, v: item(p, id) }; });
    let state = "todo", lanSua = 0;
    if (its.length) {
      const done = its.filter((x) => x.v && x.v.dat).length;
      state = done === its.length ? "done" : done > 0 || its.some((x) => x.v && (x.v.sha || x.v.lan_sua || x.v.bang_chung)) ? "doing" : "todo";
      lanSua = Math.max(0, ...its.map((x) => (x.v && x.v.lan_sua) || 0));
    }
    const open = its.find((x) => x.v && !x.v.dat) || its[0];
    const gc = String((open && open.v && open.v.ghi_chu) || "");
    let changedAt = 0;
    for (const x of its) {
      const k = t.n + ":" + x.pkg + ":" + x.id, sg = JSON.stringify(x.v || null), old = itemSeen.get(k);
      if (!old) itemSeen.set(k, { sg, at: mtimeOf(t) }); else if (old.sg !== sg) itemSeen.set(k, { sg, at: now() });
      changedAt = Math.max(changedAt, itemSeen.get(k).at);
    }
    const holder = agentFromLabel((d.dang_lam.find((v) => v.thu_tu === t.n) || {}).chu);
    return { n: t.n, name: t.name, pkgs: [...new Set(its.map((x) => x.pkg))], state, lanSua, parts: its.map((x) => ({ id: x.id, dat: !!(x.v && x.v.dat) })),
      evidence: clip(mask(String((its.find((x) => x.v && x.v.bang_chung) || {}).v?.bang_chung || "")), 160), openId: open ? open.id : null, holderKey: holder, note: clip(mask(gc.split(" | ").pop()), 240), changedAt };
  });
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(SEEN_FILE, JSON.stringify(Object.fromEntries(itemSeen))); } catch {}
}

// ---------- máy: ổ đĩa + dịch vụ Docker (tùy chọn) ----------
const badSince = {};
const RETIRED = new Set(CFG.dockerRetired || []);
let sys = { cFreeGB: null, diskLabel: path.parse(os.homedir()).root, containers: [], checkedAt: 0 };
function readSys() {
  try { const s = fs.statfsSync(path.parse(os.homedir()).root); sys.cFreeGB = +(s.bavail * s.bsize / 1e9).toFixed(1); } catch {}
  if (!CFG.dockerFilter) return;
  execFile("docker", ["ps", "-a", "--filter", CFG.dockerFilter, "--format", "{{.Names}}|{{.State}}|{{.Status}}"], { timeout: 8000, windowsHide: true }, (err, out) => {
    if (err) return;
    sys.containers = out.trim().split("\n").filter(Boolean).map((l) => { const [n, s, st] = l.split("|"); const pre = String(CFG.dockerStrip || ""), name = pre && n.startsWith(pre) ? n.slice(pre.length) : n; return { name, state: s, status: st, retired: RETIRED.has(name) && s !== "running" }; });
    sys.checkedAt = now();
  });
}

// ---------- cần anh làm ----------
// (1) sổ data/CAN-ANH.md; (2) phiên đang mở hộp hỏi bạn; (3) tin gắn thẻ [CẦN ANH]; (4) phiên có vẻ dừng chờ bạn (đoán, xếp sau).
let canAnh = [], canAnhSig = "";
function readCanAnh() {
  const f = path.join(DATA, "CAN-ANH.md"), st = safeStat(f); if (!st) { canAnh = []; return; }
  const sig = st.mtimeMs + ":" + st.size; if (sig === canAnhSig) return; canAnhSig = sig;
  const rows = [];
  for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    if (!/^\|\s*CA-/.test(l)) continue;
    const c = l.split("|").map((x) => x.trim());
    const at = Date.parse((c[2] || "").replace(" ", "T")) || st.mtimeMs;
    const who = agentFromId((c[3].match(/\b([0-9a-f]{8})\b/) || [])[1]) || agentFromLabel(c[3]);
    rows.push({ id: c[1], since: at, whoLabel: clip(mask(c[3]), 60), who, text: clip(mask(c[4]), 300), options: clip(mask(c[5] || ""), 300), open: /^CHỜ/i.test(c[6] || "") });
  }
  canAnh = rows;
}
const ASK_REPLY = /\?|anh (duyệt|chọn|quyết|cho phép|xác nhận|có muốn)|nói "?làm đi|anh trả lời|(chờ|đợi) anh (duyệt|quyết|trả lời|chọn|xác nhận)/i;
const ASK_EXPLICIT = /(chờ|cần|xin|hỏi|đợi)\s+(CEO|anh|chị|sếp)\s+(quyết|duyệt|xác nhận|trả lời|cho phép|chọn|bấm|làm|đăng nhập|cấp|mở)|CEO (cần|phải) (quyết|duyệt|xác nhận)|\b(cần|chờ) (CEO|sếp)\b/i;
const NOT_ASK = /không (cần|chờ|phải chờ) (CEO|anh|sếp)|không chờ CEO/i;
function askLine(text, re) {
  const parts = String(text).split(/(?<=[.?!])\s+|\n+/).map((x) => x.trim()).filter((x) => x && (x.match(/\|/g) || []).length < 2);
  for (let i = parts.length - 1; i >= 0; i--) if (re.test(parts[i])) return clip(parts[i], 240);
  return clip(parts[parts.length - 1] || "", 240);
}
function ceoAsks(out, t) {
  const items = [], seen = new Set();
  for (const r of canAnh) if (r.open) { items.push({ kind: "so", exact: true, who: r.who, whoLabel: r.whoLabel, since: r.since, text: r.text + (r.options ? " — " + r.options : ""), id: r.id, answered: !!(r.who && byKey[r.who] && byKey[r.who].lastUserAt > r.since) }); if (r.who) seen.add(r.who); }
  for (const s of out) { const a = byKey[s.key]; if (a && a.pendingAsk && t - a.pendingAsk.t < 24 * 3600000) { items.push({ kind: "hoi", exact: true, who: s.key, since: a.pendingAsk.t, text: a.pendingAsk.text }); seen.add(s.key); } }
  for (const e of events) if (t - e.t < 24 * 3600000 && /^\s*\[CẦN ANH/.test(e.body || e.title) && !seen.has(e.from)) { items.push({ kind: "tag", exact: true, who: e.from, to: e.to, since: e.t, text: clip(e.body || e.title, 300) }); seen.add(e.from); }
  for (const s of out) {
    const a = byKey[s.key]; if (!a || a.ceo || !a.lastTail || s.status === "active" || seen.has(s.key)) continue;
    const tail = a.lastTail.split(/(?<=[.?!])\s+/).filter((x) => (x.match(/\|/g) || []).length < 2).join(" ");
    if (a.lastUserAt && a.lastTextAt > a.lastUserAt && t - a.lastTextAt < 24 * 3600000 && /\b(anh|chị|sếp|CEO)\b/i.test(tail) && ASK_REPLY.test(tail.slice(-300)) && !NOT_ASK.test(tail)) {
      items.push({ kind: "reply", guess: true, who: s.key, since: a.lastTextAt, text: askLine(tail, /\?|anh (duyệt|chọn|quyết|cho phép|xác nhận|muốn|nói)|làm đi/i) }); seen.add(s.key);
    } else if (t - a.lastTextAt < 12 * 3600000 && ASK_EXPLICIT.test(tail) && !NOT_ASK.test(tail)) {
      items.push({ kind: "stop", guess: true, who: s.key, since: a.lastTextAt, text: askLine(tail, ASK_EXPLICIT) }); seen.add(s.key);
    }
  }
  return items.sort((x, y) => (!!x.guess - !!y.guess) || x.since - y.since).slice(0, 14);
}

// ---------- tiền AI theo ngày ----------
// Ước tính từ token đếm được trong nhật ký × bảng giá API trong config.json (gói thuê bao tháng thì không tốn thêm theo số này),
// cộng với số tiền các lượt DEV tự khai khi nhả lượt (vp luot nha --usd …) cho phần gọi AI ngoài Claude/Codex.
function moneyOf(week, t) {
  const day0 = new Date(t); day0.setHours(0, 0, 0, 0);
  const est = perf.costDays(CFG.prices, 7);
  const days = Array.from({ length: 7 }, (_, i) => ({ t: +day0 - (6 - i) * 86400000, usd: est[i] || 0, est: est[i] || 0, turns: 0, unknown: 0, calls: 0 }));
  const today = [];
  for (const r of week) {
    if (!r.end) continue;
    const d = days.find((x) => r.end >= x.t && r.end < x.t + 86400000); if (!d) continue;
    if (r.usd == null) d.unknown++; else { d.usd += r.usd; d.turns++; }
    if (d === days[6]) today.push({ t: r.end, who: r.agent, pkg: r.pkg, usd: r.usd });
  }
  return { cap: CFG.aiCapUsd, days, today: today.reverse(), source: "uoc-tinh", note: "ước tính theo giá API trong config.json + tiền lượt DEV tự khai" };
}

function enrichAgentObservations(out, observerState, time) {
  for (const a of out) {
    const external = a.platform === "work" || a.platform === "chatgpt";
    const signal = external ? a.lastHeartbeat : a.lastActive;
    const recentSignal = signal && time - signal < (external ? 5 * 60000 : 90000);
    const hook = a.platform === "claude" ? claudeObserver.read(DATA, a.key, time) : null;
    // Local log activity is only a recent filesystem event, not proof of
    // model inference. Claude lifecycle hooks are stronger when fresh.
    const activity = a.platform === "human" ? "not-applicable" :
      external ? a.connection === "live" ? "recent-signal" : a.connection === "unlinked" ? "unlinked" : "stale" :
      hook?.fresh ? hook.lastStage : recentSignal ? "recent-log" : signal ? "stale" : "unknown";
    if (hook?.fresh) {
      if (hook.lastStage === "working" || hook.lastStage === "tool-running") a.status = "active";
      else if (hook.lastStage === "idle" || hook.lastStage === "approval-wait") a.status = "idle";
      else if (hook.lastStage === "ended") a.status = "away";
    }
    const links = DELIVERY_LINKS.get(a.key);
    const linkedPrs = links.prs.map(n=>observerState.prs.find(p=>p.number===n)).filter(Boolean);
    const linkedIssues = links.issues.map(n=>observerState.issues.find(issue=>issue.number===n)).filter(Boolean);
    const suggestions = suggestLinks(a,observerState,links);
    a.observation = {
      activity: {
        state: activity, source: hook?.fresh ? "claude-hook" : external ? "agent-heartbeat" :
          a.platform === "human" ? "none" : "local-journal",
        observedAt: hook?.fresh ? hook.observedAt : signal || null,
        evidence: hook?.fresh ? hook.evidence : external ? "Heartbeat do phiên chủ động gửi" :
          a.platform === "human" ? "Không giám sát liveness cho CEO" :
          "Thời gian cập nhật nhật ký local (không xác nhận suy luận)"
      },
      work: {
        state: external ? (a.reportedState || "unknown") : "unknown",
        task: external ? a.task || "" : "",
        progress: external ? a.progress || "" : "",
        blocker: external ? a.blocker || "" : "",
        observedAt: external ? a.detailUpdatedAt || null : null,
        source: external && a.detailUpdatedAt ? "agent-reported" : "unreported"
      },
      delivery: {
        links, prs:linkedPrs, issues:linkedIssues, suggestions,
        missingPrNumbers:links.prs.filter(n=>!linkedPrs.some(p=>p.number===n)),
        missingIssueNumbers:links.issues.filter(n=>!linkedIssues.some(issue=>issue.number===n)),
        // Backward compatibility for older 3D clients while they reload.
        prNumber:links.prs[0]||null, pr:linkedPrs[0]||null,
        status:links.prs.length||links.issues.length?"linked":"unlinked",
        source:"github-read-only + user-confirmed links",
        checkedAt:observerState.checkedAt
      }
    };
  }
}
// ---------- ảnh chụp trạng thái ----------
function statusOf(a, t) {
  if (a.ceo) return a.ceoLastAt && t - a.ceoLastAt < 15 * 60000 ? "active" : "away";
  const quiet = a.mtime ? t - a.mtime : Infinity;
  let st = quiet < 90000 || (a.working && quiet < 10 * 60000) ? "active" : quiet < 6 * 3600000 ? "idle" : "away";
  if (a.platform === "claude") { const L = live.get(a.id); if (L) st = L.busy ? "active" : "idle"; else if (live.size && quiet > 90000) st = "away"; }
  return st;
}
function snapshot() {
  const t = now(), nowMin = Math.floor(t / 60000);
  const out = agents.map((a) => {
    const info = a.ceo ? { room: "ceo", source: "human" } : effectiveRoom(a);
    a.room = info.room; a.roomSource = info.source;
    let status = statusOf(a, t), where = a.room, flag = null;
    if (dev.holder === a.key) { where = "dev"; status = "active"; }
    const qi = (dev.queue || []).findIndex((q) => q.agent === a.key);
    const lt = a.ceo ? a.ceoLastText : a.lastText;
    if (!a.ceo && /\[CHẶN\]|bị chặn|đang chặn|\bblocked\b/i.test(lt) && status !== "active" && status !== "away" && t - a.lastTextAt < 3 * 3600000) flag = "blocked";
    else if (qi >= 0 && where !== "dev") { flag = "waiting"; where = "g1q"; }
    const L = !a.ceo && live.get(a.id);
    return { key: a.key, name: a.name, role: a.role, platform: a.platform, room: a.room, roomSource: a.roomSource, roomLabel: officeRooms.label(a.room), where, status, flag, session: a.ceo ? null : a.id.slice(0, 8), host: L && L.host ? L.host.slice(0, 8) : null,
      lastText: CFG.showSessionContent ? lt : "", lastTextAt: a.ceo ? a.ceoLastAt : a.lastTextAt, queuePos: qi >= 0 ? qi + 1 : null, lastActive: a.ceo ? a.ceoLastAt : a.mtime, sub: a.subActive || 0,
      hasJournal: !!(a.file || a.ceo), isNew: !a.ceo && t - a.createdAt < 3600000, createdAt: a.ceo ? null : a.createdAt, hist: Array.from({ length: 60 }, (_, i) => (a.mins.has(nowMin - 59 + i) ? 1 : 0)) };
  });
  // Work conversations are opt-in: only metadata registered locally is visible.
  // No "active" status is inferred from Recents; a recent explicit heartbeat is required.
  for (const external of workSessions.list(DATA, t)) {
    const manual = ROOM_STORE.get(external.key);
    if (manual) {
      external.room = manual; external.where = manual;
      external.roomSource = "manual"; external.roomLabel = officeRooms.label(manual);
    }
    out.push(external);
  }
  const observerState = OBSERVER.read();
  enrichAgentObservations(out, observerState, t);
  const recent = events.filter((e) => t - e.t < 24 * 3600000);
  const alerts = [];
  if (dev.idleSince && t - dev.idleSince > 15 * 60000 && dev.queue.length) alerts.push({ level: "warn", text: `DEV trống ${Math.round((t - dev.idleSince) / 60000)} phút, hàng chờ còn ${dev.queue.length} gói` });
  if (dev.holderSince && t - dev.holderSince > 60 * 60000) alerts.push({ level: "warn", text: `Lượt DEV đã giữ ${Math.round((t - dev.holderSince) / 60000)} phút (${dev.holderLabel || "?"})` });
  for (const a of out) if (a.flag === "blocked") alerts.push({ level: "bad", text: `${a.name} đang bị chặn` });
  if (sys.cFreeGB != null && sys.cFreeGB < 15) alerts.push({ level: "bad", text: `Ổ ${sys.diskLabel} chỉ còn ${sys.cFreeGB} GB` });
  const bad = sys.containers.filter((c) => !c.retired && (c.state !== "running" || /unhealthy|Restarting/i.test(c.status)));
  for (const c of sys.containers) { if (bad.includes(c)) badSince[c.name] = badSince[c.name] || t; else delete badSince[c.name]; }
  const longBad = bad.filter((c) => t - badSince[c.name] >= 180000);
  if (longBad.length) alerts.push({ level: "bad", text: `DEV: ${longBad.map((c) => c.name).join(", ")} không khỏe hơn 3 phút` });
  const team = Array.from({ length: 180 }, (_, i) => { const m = nowMin - 179 + i; let c = 0, cx = 0, cl = 0; for (const a of agents) if (!a.ceo && a.mins.has(m)) { c++; if (a.platform === "codex") cx++; else cl++; } return { t: m * 60000, n: c, codex: cx, claude: cl }; });
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const turns = dev.lastRows.filter((r) => r.end && r.end >= +day0).map((r) => ({ start: r.start, end: r.end, agent: r.agent, who: r.who, pkg: r.pkg, fail: r.fail, state: r.state }));
  if (dev.holderSince) turns.push({ start: dev.holderSince, end: t, agent: dev.holder, who: dev.holderLabel, pkg: dev.package, fail: false, live: true, state: "đang giữ lượt" });
  const week = dev.weekRows || [];
  const unclosed = week.filter((r) => !r.end && !(dev.holderLabel && r === week[week.length - 1]));
  const match = { total: week.length, ok: week.length - unclosed.length, pct: week.length ? Math.floor(((week.length - unclosed.length) / week.length) * 100) : 100, bad: unclosed.slice(-20).map((r) => ({ t: r.start, pkg: r.pkg, why: "lấy lượt mà chưa nhả", line: r.raw })) };
  const st = Object.fromEntries(out.map((a) => [a.key, a]));
  const taskView = tasks.map((tk) => {
    const rows = week.filter((r) => tk.pkgs.some((p) => r.pkg === p || r.pkg.startsWith(p)));
    const lt = rows[rows.length - 1] || null;
    const holder = tk.holderKey || (lt && lt.agent) || null;
    const since = Math.max(tk.changedAt || 0, lt ? lt.t : 0);
    const stale = tk.state !== "done" && since && t - since > 3600000 && !(holder && st[holder] && st[holder].status === "active");
    const liveT = !!(lt && !lt.end && (dev.holder || dev.holderLabel) && lt === week[week.length - 1]);
    return { ...tk, holder, since, stale, last: lt && { t: lt.t, live: liveT, unread: !lt.end && !liveT, fail: lt.fail, pkg: lt.pkg, state: lt.state, result: lt.result, usd: lt.usd, raw: !lt.end && !liveT ? lt.raw : null } };
  });
  const ht = hopthuNow();
  if (ht.tong && ht.tong.nhac2) alerts.push({ level: "bad", text: `Hòm thư: ${ht.tong.nhac2} tin đã đọc lại ≥ 2 lần mà chưa xong` });
  const { weekRows, ...devOut } = dev;
  return { now: t, title: CFG.title, subtitle: CFG.subtitle, ownerName: CFG.ownerName, tinKet: { at: t, items: [] }, agents: out, dev: { ...devOut, lastRows: dev.lastRows.slice(-25), match },
    turns, team, tasks: taskView, sys, events: (CFG.showSessionContent ? recent : recent.map((e) => ({ ...e, title: "Nội dung phiên đã ẩn", body: "" }))).slice(-300), alerts,
    asks: ceoAsks(out, t).map((a) => (CFG.showSessionContent || a.kind === "so" ? a : { ...a, text: "Có yêu cầu từ phiên AI (nội dung đã ẩn)" })),
    observer: { repo: observerState.repo, status: observerState.status,
      checkedAt: observerState.checkedAt, attemptAt: observerState.attemptAt,
      error: observerState.error, refreshSeconds: observerState.refreshSeconds,
      prCount: observerState.prs.filter(p=>p.state==="open").length,
      issueCount: observerState.issues.filter(i=>i.state==="open").length,
      windowPrCount:observerState.prs.length, windowIssueCount:observerState.issues.length }, money: moneyOf(week, t) };
}

// ---------- vòng lặp ----------
readLive(); discover();
setInterval(() => { try { readLive(); } catch {} }, 3000);
setInterval(() => { try { discover(); } catch (e) { console.error("discover:", e.message); } }, 5000);
function tick() { for (const a of agents) { try { pollAgent(a); } catch {} } try { readDev(); } catch {} }
tick(); readTasks(); readSys(); readCanAnh();
setInterval(tick, 1000);
setInterval(() => { try { readTasks(); } catch {} try { readCanAnh(); } catch {} }, 1000);
setInterval(readSys, 15000);
perf.scanAll(agents.filter((a) => !a.ceo)); setInterval(() => perf.scanAll(agents.filter((a) => !a.ceo)), 3000);

// hòm thư, tổng quan, sổ sách: tính lại vài giây/lần, file chỉ đọc lại khi đổi
let hopthuCache = { at: 0, data: null };
function hopthuNow() {
  if (!hopthuCache.data || now() - hopthuCache.at >= 10000) { try { hopthuCache = { at: now(), data: hopthu.build(DATA, mask, agents) }; } catch (e) { hopthuCache = { at: now(), data: { error: String(e.message || e), roles: [], tong: {}, pending: { n: 0, ds: [] } } }; } }
  return hopthuCache.data;
}
let tqCache = { at: 0, json: null };
function tongquanNow() {
  if (tqCache.json && now() - tqCache.at < 3000) return tqCache.json;
  let json;
  try { const u = readUuTien(); json = JSON.stringify(tongquan.build({ uu: u.data, uuErr: u.err, snap: snapshot(), ht: hopthuNow(), dataDir: DATA, mask, clip })); }
  catch (e) { json = JSON.stringify({ error: clip(mask(String(e.message || e)), 200), rows: [], bots: [] }); }
  tqCache = { at: now(), json }; return json;
}
let docsCache = { at: 0, json: null };
function docsNow() {
  if (docsCache.json && now() - docsCache.at < 1500) return docsCache.json;
  const s = snapshot();
  const d = docs.build(CFG, DATA, mask, maskDoc, { tasks: s.tasks, asks: s.asks, dev: { holder: s.dev.holder, holderLabel: s.dev.holderLabel, package: s.dev.package, holderSince: s.dev.holderSince, idleSince: s.dev.idleSince, queue: s.dev.queue },
    agents: s.agents.map((a) => ({ key: a.key, name: a.name, session: a.session, host: a.host, status: a.status, room: a.room, platform: a.platform, role: a.role })) });
  docsCache = { at: now(), json: JSON.stringify(d) }; return docsCache.json;
}

// ---------- máy chủ web ----------
const clients = new Set(), perfClients = new Set();
let perfCache = null;
const perfNow = () => { if (!perfCache || now() - perfCache.at > 1500) perfCache = { at: now(), data: perf.compute(agents.filter((a) => !a.ceo), snapshot().agents, events, dev.weekRows || [], { showHeuristicGrades: CFG.showHeuristicGrades }) }; return perfCache.data; };
setInterval(() => { if (!clients.size) return; const d = "data: " + JSON.stringify(snapshot()) + "\n\n"; for (const r of clients) r.write(d); }, 1000);
setInterval(() => { if (!perfClients.size) return; const d = "data: " + JSON.stringify(perfNow()) + "\n\n"; for (const r of perfClients) r.write(d); }, 2000);

// Local-only by default. Remote viewing requires accessKey and POST login (never URL query).
const AUTH = security.createAuth(CFG.accessKey);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const json = (res, body) => { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
function sse(req, res, set, first) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("data: " + JSON.stringify(first) + "\n\n"); set.add(res); req.on("close", () => set.delete(res));
}
// A user may explicitly assign a session. This never renames or modifies the agent.
async function assignSessionRoom(req, res) {
  let raw = "";
  try {
    for await (const chunk of req) {
      raw += chunk.toString("utf8");
      if (raw.length > 2048) {
        res.writeHead(413, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ error: "Yêu cầu quá dài" }));
      }
    }
    const body = JSON.parse(raw || "{}");
    const key = String(body.session || ""), room = String(body.room || "");
    const agent = byKey[key] || workSessions.list(DATA).find((a) => a.key === key);
    if (!agent || agent.ceo) {
      res.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ error: "Không tìm thấy session" }));
    }
    if (room !== "auto" && !officeRooms.isAgentRoom(room)) {
      res.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ error: "Phòng không hợp lệ" }));
    }
    ROOM_STORE.set(key, room);
    const info = effectiveRoom(agent); agent.room = info.room; agent.roomSource = info.source;
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true, session: key, room: info.room, roomLabel: officeRooms.label(info.room), source: info.source }));
  } catch {
    if (!res.headersSent) {
      res.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "Không thể lưu thay đổi" }));
    }
  }
}
// Register a ChatGPT chat alias from the localhost UI. A new session is not
// treated as active until the real conversation reports a heartbeat.
async function registerChatSession(req, res) {
  const sendError = (code, message) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: message }));
  };
  try {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk.toString("utf8");
      if (raw.length > 2048) return sendError(413, "Thông tin quá dài");
    }
    const form = JSON.parse(raw || "{}");
    if (typeof form.name !== "string" || !form.name.trim() || form.name.trim().length > 100)
      return sendError(400, "Tên phiên phải có từ 1 đến 100 ký tự");
    const room = String(form.room || "unassigned");
    if (!officeRooms.isAgentRoom(room)) return sendError(400, "Phòng không hợp lệ");
    const bridgeId = "chat-" + crypto.randomBytes(12).toString("hex");
    const record = workSessions.upsert(DATA, {
      id: bridgeId, kind: "chat", title: form.name.trim(), heartbeat: false, state: "unknown"
    });
    if (room !== "unassigned") ROOM_STORE.set(record.key, room);
    res.writeHead(201, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({
      ok: true, key: record.key, bridgeId, title: record.title,
      room, roomLabel: officeRooms.label(room), status: "unlinked",
      note: "Đã đăng ký alias local. Chưa có heartbeat từ cuộc trò chuyện."
    }));
  } catch (e) {
    if (e instanceof SyntaxError) return sendError(400, "JSON không hợp lệ");
    console.error("registerChatSession failed", e?.code || e?.message);
    if (!res.headersSent) sendError(500, "Không thể lưu phiên: " + String(e?.code || "unknown"));
  }
}
// Explicit, user-confirmed multi PR/Issue links. No delivery metadata
// can mark an agent as active or claim an agent owns the referenced work.
async function linkObserverPr(req, res) {
  const reply=(code,body)=>{
    res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
    res.end(JSON.stringify(body));
  };
  try {
    let raw="";
    for await(const chunk of req) {
      raw+=chunk.toString("utf8");
      if(raw.length>1800)return reply(413,{error:"Request too large"});
    }
    const body=JSON.parse(raw||"{}");
    const session=String(body.session||"");
    if(!/^(?:[wg]-[a-f0-9]{12}|[cx]-[a-f0-9]{8})$/i.test(session))
      return reply(400,{error:"Invalid session ID"});
    const agent=snapshot().agents.find(a=>a.key===session);
    if(!agent)return reply(404,{error:"Session not found"});
    const observer=OBSERVER.read();
    // Legacy API: {session, pr:number|null} replaces the single PR link,
    // but preserves linked Issues when the old browser is still open.
    if(!Object.hasOwn(body,"type")&&Object.hasOwn(body,"pr")) {
      const n=body.pr===null?null:Number(body.pr);
      if(n!==null&&(!Number.isSafeInteger(n)||observer.status!=="ok"||
        !observer.prs.some(pr=>pr.number===n)))
        return reply(400,{error:"PR not found in current observer window"});
      const links=DELIVERY_LINKS.set(session,n);
      return reply(200,{ok:true,session,links,source:"user-confirmed"});
    }
    const type=String(body.type||"");
    const operation=String(body.operation||"add");
    const number=Number(body.number);
    if(!["pr","issue"].includes(type)||!["add","remove"].includes(operation)||
       !Number.isSafeInteger(number)||number<1||number>9999999)
      return reply(400,{error:"Invalid PR/Issue operation"});
    if(operation==="add") {
      if(observer.status!=="ok")return reply(503,{error:"GitHub source unavailable, cannot verify item"});
      const available=type==="pr"?observer.prs:observer.issues;
      if(!available.some(item=>item.number===number))
        return reply(400,{error:"Item not found in current GitHub window. Refresh observer or use an item from the list."});
    }
    const links=operation==="add"?DELIVERY_LINKS.add(session,type,number):
      DELIVERY_LINKS.remove(session,type,number);
    return reply(200,{ok:true,session,links,source:"user-confirmed"});
  } catch(e) {
    console.error("Observer link:",String(e?.code||e?.message).slice(0,100));
    return reply(e instanceof SyntaxError||e instanceof TypeError?400:
      e instanceof RangeError?409:500,{error:"Could not save observer link"});
  }
}
http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "SAMEORIGIN"); // embedded same-origin dashboard iframes
  if (url.pathname === "/auth/login") return AUTH.login(req, res).catch(() => { if (!res.headersSent) { res.writeHead(500); res.end(); } });
  if (!AUTH.authorized(req)) return AUTH.requireLogin(res);
  if (req.method === "POST" && !security.sameOrigin(req)) { res.writeHead(403); return res.end("Invalid Origin"); }
  if (url.pathname === "/api/sessions/register") {
    if (req.method !== "POST") { res.writeHead(405); return res.end(); }
    return registerChatSession(req, res);
  }
  if (url.pathname === "/api/rooms/assign") {
    if (req.method !== "POST") { res.writeHead(405); return res.end(); }
    return assignSessionRoom(req, res);
  }
  if (url.pathname === "/api/observer/link") {
    if (req.method !== "POST") { res.writeHead(405); return res.end(); }
    return linkObserverPr(req, res);
  }
  if (url.pathname === "/api/observer") {
    if (req.method !== "GET") { res.writeHead(405); return res.end(); }
    return json(res, { observer: OBSERVER.read(), links: DELIVERY_LINKS.all(),
      agents: snapshot().agents.map((a) => ({ key: a.key, name: a.name, room: a.room, platform: a.platform, observation: a.observation })) });
  }
  if (url.pathname === "/events") return sse(req, res, clients, snapshot());
  if (url.pathname === "/state") return json(res, snapshot());
  if (url.pathname === "/perf-events") return sse(req, res, perfClients, perfNow());
  if (url.pathname === "/perf") return json(res, perfNow());
  if (url.pathname === "/hopthu") return json(res, hopthuNow());
  if (url.pathname === "/tongquan") return json(res, tongquanNow());
  if (url.pathname === "/docs") return json(res, docsNow());
  if (url.pathname.startsWith("/chat/")) {
    chat.handle(req, res, url, { CFG, DATA, agentByKey: (k) => byKey[k], onEvent: pushEvent, ht: hopthuNow }).then((r) => { if (r === false) { res.writeHead(404); res.end(); } }).catch(() => { if (!res.headersSent) { res.writeHead(500); res.end(); } });
    return;
  }
  // API misses are JSON, never a static-file 404 plain-text response.
  if (url.pathname.startsWith("/api/")) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ error: "API không tồn tại trên phiên Văn phòng AI đang chạy (HTTP 404)." }));
  }
  // Three.js is served locally from a strictly scoped package directory.
  const vendor = url.pathname.startsWith("/vendor/three/");
  const base = path.resolve(ROOT, vendor ? "node_modules/three" : "public");
  let name;
  try {
    name = decodeURIComponent(vendor ? url.pathname.slice("/vendor/three/".length) : url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  } catch { res.writeHead(400); return res.end(); }
  const p = path.resolve(base, name);
  if (p !== base && !p.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
  if (vendor && !(/\.(?:js|css|json|map)$/i.test(p))) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("không có"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream", "Cache-Control": "no-cache" }); res.end(buf);
  });
}).listen(PORT, CFG.host, () => {
  console.log(`\n  ${CFG.title} đang chạy`);
  console.log(`  Mở trên máy này:  http://localhost:${PORT}`);
  console.log(`  Dự án theo dõi:   ${PROJECTS.length ? PROJECTS.join(", ") : "mọi dự án trên máy"}`);
  console.log(`  Sổ điều phối:     ${DATA}`);
  console.log(`  Khóa xem:         ${CFG.accessKey ? "đang bật" : "tắt (chỉ truy cập local khi không có accessKey)"}\n`);
});
