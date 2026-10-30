"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const V = require("../public/office-visibility");

function fixture() {
  const agents = [{
    key:"ceo",name:"Kyle",platform:"human",room:"ceo",status:"idle"
  }];
  for (const id of ["bob","gru","james","dave","stu","agnes","edith"]) {
    agents.push({key:"w-"+id,name:id,platform:"work",room:id,status:"idle",
      connection:"stale",reportedState:"done",lastHeartbeat:100000});
  }
  for(let i=0;i<9;i++)agents.push({
    key:"c-"+String(i).padStart(8,"0"),name:"Claude "+i,
    platform:"claude",room:"unassigned",status:i%2?"away":"idle",
    lastActive:100000
  });
  for(let i=0;i<3;i++)agents.push({
    key:"g-bob"+i,name:"Backend B04 "+i,platform:"chatgpt",room:"bob",status:"unknown",
    connection:"stale",reportedState:"active",lastHeartbeat:100000
  });
  const linked=agents.find(x=>x.key==="g-bob2");
  linked.observation={delivery:{links:{prs:[1940],issues:[1939]}}};
  return agents;
}
test("compact overview shows one representative per room, hides old unassigned pile",()=>{
  const agents=fixture();
  const before=JSON.stringify(agents);
  const chosen=V.choose(agents,{mode:"compact",focusedRoom:"all"});
  assert.equal(chosen.has("ceo"),true);
  assert.equal(chosen.size,8); // human + 7 department representatives
  assert.equal([...chosen].filter(k=>k.startsWith("c-")).length,0);
  assert.equal(chosen.has("g-bob2"),true); // assigned delivery outranks old stale chats
  const counts=V.summary(agents,chosen);
  assert.equal(counts.total,agents.length-1);
  assert.equal(counts.shown,7);
  assert.ok(counts.hidden>=10);
  assert.equal(JSON.stringify(agents),before,"visibility is a view, never mutates agent state");
});
test("relevant live agents stay visible (up to 2) without reviving stale activity",()=>{
  const agents=fixture();
  const live=agents.find(x=>x.key==="g-bob0");
  live.connection="live";live.status="active";
  live.observation={activity:{state:"recent-signal"}};
  const b=agents.find(x=>x.key==="g-bob1");
  b.status="active";b.connection="live";b.observation={activity:{state:"recent-signal"}};
  const visible=V.choose(agents,{mode:"compact"});
  assert.equal(visible.has("g-bob0"),true);
  assert.equal(visible.has("g-bob1"),true);
  assert.equal(visible.has("g-bob2"),false);
  assert.equal(V.isAttention(agents.find(x=>x.key==="g-bob2")),false);
});
test("focused room reveals top four, selecting a hidden session reveals it",()=>{
  const agents=fixture();
  const first=V.choose(agents,{mode:"compact",focusedRoom:"unassigned"});
  assert.equal([...first].filter(k=>k.startsWith("c-")).length,4);
  const selected=agents.filter(x=>x.room==="unassigned").at(-1).key;
  const next=V.choose(agents,{mode:"compact",focusedRoom:"unassigned",selected});
  assert.ok(next.has(selected));
  assert.ok(next.size<=6); // four room avatars, optional selection, CEO
});
test("all mode keeps every robot accessible but is strictly opt-in",()=>{
  const agents=fixture();
  const all=V.choose(agents,{mode:"all"});
  assert.equal(all.size,agents.length);
  assert.equal(V.summary(agents,all).hidden,0);
  assert.equal(V.choose(agents,{mode:"nonsense"}).size,8);
});
test("3D page contains density controls, room counts and a visual visibility policy",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","public","index.html"),"utf8");
  assert.match(html,/src="office-visibility\.js"/);
  assert.match(html,/id="density-compact"/);
  assert.match(html,/id="density-all"/);
  assert.match(html,/id="visibility-caption"/);
  assert.match(html,/OfficeVisibility\.choose\(A/);
  assert.match(html,/ROOM_HEADINGS\.set/);
  assert.match(html,/b\.g\.visible = visible/);
  assert.match(html,/b\.nameTag\.visible = showName/);
  assert.match(html,/shownKeys\.has\(a\.key\)/);
});

test("agent card opens as a brief summary and preserves its controls during SSE updates",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","public","index.html"),"utf8");
  assert.match(html,/let expandedCardKey = null; let lastCardSignature = ""/);
  assert.match(html,/classList\.toggle\("expanded", expanded\)/);
  assert.match(html,/const preview = h\("div", "card-preview"\)/);
  assert.match(html,/preview-work/);
  assert.match(html,/cardSignature === lastCardSignature/);
  assert.match(html,/card:not\(\.expanded\) \.chat/);
  assert.match(html,/card-toggle/);
});
