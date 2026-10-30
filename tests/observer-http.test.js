"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { setTimeout: sleep } = require("node:timers/promises");
const sessions = require("../lib/work-sessions");

async function freePort() {
  const s = net.createServer();
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  const port = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  return port;
}
test("observer endpoint is local-only, read-only, and keeps liveness distinct from delivery", {timeout:24000}, async (t) => {
  const root = path.resolve(__dirname, ".."), dir = fs.mkdtempSync(path.join(os.tmpdir(), "observer-http-"));
  const port = await freePort(), dataDir = path.join(dir, "data");
  const conf = path.join(dir, "config.json");
  fs.writeFileSync(conf, JSON.stringify({
    host:"127.0.0.1", port, dataDir, projects:[dir], observerRepo:"",
    claudeDir:path.join(dir,"none-claude"), codexDir:path.join(dir,"none-codex")
  }));
  const record = sessions.upsert(dataDir, {
    id:"project-james", title:"Project - James",state:"active",heartbeat:true,
    task:"B05 inventory reconciliation"
  });
  const process = spawn(processExec(), [path.join(root, "server.js")],{
    cwd:root, windowsHide:true, env:{...global.process.env,VP_CONFIG:conf}
  });
  let stderr = "";process.stderr.on("data",(b)=>{stderr+=b.toString()});
  t.after(async()=>{
    if(process.exitCode===null){
      process.kill();
      await Promise.race([new Promise((r)=>process.once("exit",r)),sleep(1500)]);
    }
    fs.rmSync(dir,{recursive:true,force:true});
  });
  const base = "http://127.0.0.1:"+port;
  let ready=false;
  for(let i=0;i<65;i++){
    if(process.exitCode!==null) throw Error("Server died "+stderr);
    try{ const r=await fetch(base+"/api/observer",{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break} }catch{}
    await sleep(120);
  }
  assert.equal(ready,true);
  const r=await fetch(base+"/api/observer");
  const state=await r.json();
  assert.equal(state.observer.status,"disabled");
  assert.equal(state.observer.prs.length,0);
  const james=state.agents.find((a)=>a.key===record.key);
  assert.ok(james);
  assert.equal(james.observation.activity.state,"recent-signal");
  assert.equal(james.observation.work.state,"active");
  assert.equal(james.observation.work.task,"B05 inventory reconciliation");
  assert.equal(james.observation.delivery.prNumber,null);
  assert.equal(james.observation.delivery.status,"unlinked");
  const bad=await fetch(base+"/api/observer/link",{method:"POST",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({session:record.key,pr:1941})});
  assert.equal(bad.status,400);
  const attacker=await fetch(base+"/api/observer/link",{method:"POST",
    headers:{"Content-Type":"application/json",Origin:"https://evil.example"},
    body:JSON.stringify({session:record.key,pr:1941})});
  assert.equal(attacker.status,403);
  const page=await fetch(base+"/observer.html");
  assert.equal(page.status,200);
  assert.match(await page.text(),/Agent Observer/);
});
function processExec(){return global.process.execPath;}
