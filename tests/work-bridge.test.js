"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { setTimeout: sleep } = require("node:timers/promises");
const work = require("../lib/work-sessions");

test("manual Work sessions are visible but never marked active without a heartbeat", (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "work-bridge-test-"));
  t.after(() => fs.rmSync(data, { recursive:true, force:true }));
  const now = 1_793_300_000_000;
  for (const [title,room] of [
    ["Backend · Bob","bob"], ["Frontend · Dave","dave"], ["Product · Stu","stu"],
    ["QC · Agnes","agnes"], ["Infra · Gru","gru"], ["Project · James","james"],
    ["Docs · Edith","edith"]
  ]) {
    work.upsert(data,{title},now);
    const entry = work.list(data,now).find((x)=>x.name===title);
    assert.ok(entry,title);
    assert.equal(entry.room,room,title);
    assert.equal(entry.status,"unknown",title);
    assert.equal(entry.connection,"unlinked",title);
  }
  assert.equal(work.list(data,now).length,7);
});
test("Work heartbeat is active only while fresh and never reads conversation contents", (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "work-bridge-test-"));
  t.after(() => fs.rmSync(data, { recursive:true, force:true }));
  const now = 1_793_300_000_000;
  const a = work.upsert(data,{id:"thread-1",title:"Backend · Bob",state:"active",heartbeat:true},now);
  const file = path.join(data,"work-sessions",a.key+".json");
  assert.equal(fs.existsSync(file),true);
  let [s] = work.list(data,now+1000);
  assert.equal(s.status,"active");assert.equal(s.connection,"live");assert.equal(s.room,"bob");
  assert.equal(s.lastText,"");
  [s] = work.list(data,now+work.FRESH_MS+1);
  assert.equal(s.status,"unknown");assert.equal(s.connection,"stale");
  assert.throws(()=>work.upsert(data,{title:"Bad",state:"untrusted",heartbeat:false},now),/unknown/i);
});
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve)=>server.listen(0,"127.0.0.1",resolve));
  const port=server.address().port;await new Promise((resolve)=>server.close(resolve));return port;
}
test("HTTP office includes Work metadata and manual room assignment without pretending live", {timeout:25000}, async(t)=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),"office-work-http-"));
  const root=path.resolve(__dirname,"..");
  const port=await freePort();
  t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
  fs.writeFileSync(path.join(data,"config.json"),JSON.stringify({
    port,host:"127.0.0.1",dataDir:path.join(data,"data"),projects:[data],
    claudeDir:path.join(data,"none-claude"),codexDir:path.join(data,"none-codex"),showSessionContent:false
  }));
  const e=work.upsert(path.join(data,"data"),{title:"QC · Agnes"},Date.now());
  const child=spawn(process.execPath,[path.join(root,"server.js")],{
    cwd:root,env:{...process.env,VP_CONFIG:path.join(data,"config.json")},windowsHide:true
  });
  let stderr="";
  child.stderr.on("data",x=>stderr+=x.toString());
  t.after(async()=>{if(child.exitCode===null) {child.kill();await Promise.race([new Promise(resolve=>child.once("exit",resolve)),sleep(2500)]);}});
  let state;
  const base="http://127.0.0.1:"+port;
  for(let i=0;i<80;i++){
    if(child.exitCode!==null) throw new Error(stderr);
    try{const r=await fetch(base+"/state",{signal:AbortSignal.timeout(1500)});if(r.ok){state=await r.json();if(state.agents.some(x=>x.key===e.key))break;}}
    catch{}
    await sleep(100);
  }
  const agent=state.agents.find(x=>x.key===e.key);
  assert.ok(agent);assert.equal(agent.room,"agnes");assert.equal(agent.status,"unknown");
  assert.equal(agent.connection,"unlinked");
  const response=await fetch(base+"/api/rooms/assign",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({session:e.key,room:"bob"})
  });
  assert.equal(response.status,200);
  const next=await (await fetch(base+"/state")).json();
  assert.equal(next.agents.find(x=>x.key===e.key).room,"bob");
});
