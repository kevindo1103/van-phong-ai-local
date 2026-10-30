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

async function ephemeralPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
test("local UI registers a new ChatGPT alias and room, but does not fake a heartbeat", {timeout:25000}, async(t)=>{
  const root=path.resolve(__dirname,"..");
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"office-new-chat-"));
  const port=await ephemeralPort();
  const dataDir=path.join(dir,"data"),config=path.join(dir,"config.json");
  fs.writeFileSync(config,JSON.stringify({
    title:"New Chat Test",port,host:"127.0.0.1",projects:[dir],dataDir,
    claudeDir:path.join(dir,"no-claude"),codexDir:path.join(dir,"no-codex")
  }));
  const child=spawn(process.execPath,[path.join(root,"server.js")],{
    cwd:root,env:{...process.env,VP_CONFIG:config},windowsHide:true
  });
  let stderr="";
  child.stderr.on("data",b=>{stderr+=b.toString();});
  t.after(async()=>{
    if(child.exitCode===null){
      child.kill();
      await Promise.race([new Promise(resolve=>child.once("exit",resolve)),sleep(2500)]);
    }
    fs.rmSync(dir,{recursive:true,force:true});
  });
  const base="http://127.0.0.1:"+port;
  let ready=false;
  for(let i=0;i<80;i++){
    if(child.exitCode!==null)throw Error("Server died: "+stderr);
    try{
      const r=await fetch(base+"/state",{signal:AbortSignal.timeout(1000)});
      if(r.ok){ready=true;break;}
    }catch{}
    await sleep(100);
  }
  assert.ok(ready,"Server startup timeout: "+stderr);
  const get=await fetch(base+"/api/sessions/register");
  assert.equal(get.status,405);
  const post=(body,headers={})=>fetch(base+"/api/sessions/register",{
    method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)
  });
  assert.equal((await post({name:"Bad room",room:"random-room"})).status,400);
  assert.equal((await post({name:"",room:"ceo"})).status,400);
  assert.equal((await post({name:"ChatGPT Sandbox",room:"ceo"},{Origin:"https://attacker.invalid"})).status,403);
  const response=await post({name:"ChatGPT - Product consultation",room:"stu"});
  assert.equal(response.status,201);
  const created=await response.json();
  assert.equal(created.ok,true);
  assert.equal(created.room,"stu");
  assert.equal(created.status,"unlinked");
  assert.match(created.bridgeId,/^chat-[a-f0-9]{24}$/);
  assert.equal(created.key,work.makeKey(created.bridgeId,"chat"));
  const state=await (await fetch(base+"/state")).json();
  const entry=state.agents.find((a)=>a.key===created.key);
  assert.ok(entry);
  assert.equal(entry.platform,"chatgpt");
  assert.equal(entry.bridgeId,created.bridgeId);
  assert.equal(entry.room,"stu");
  assert.equal(entry.connection,"unlinked");
  assert.equal(entry.status,"unknown");
  assert.equal(entry.lastHeartbeat,null);
  const second=await (await post({name:"ChatGPT - Product consultation",room:"stu"})).json();
  assert.notEqual(second.key,created.key);
  const slashResponse=await post({name:"B04/B05 fixer",room:"bob"});
  assert.equal(slashResponse.status,201);
  const slashSession=await slashResponse.json();
  assert.equal(slashSession.title,"B04/B05 fixer");
  assert.equal(slashSession.room,"bob");
  const missing=await fetch(base+"/api/unknown-route");
  assert.equal(missing.status,404);
  assert.match(missing.headers.get("content-type"),/application\/json/);
  assert.match((await missing.json()).error,/API/);
  assert.equal(work.list(dataDir).length,3);
  const html=await (await fetch(base+"/")).text();
  for(const id of ["chat-add-toggle","chat-add-form","chat-add-room","chat-add-command"])
    assert.ok(html.includes('id="'+id+'"'),"missing "+id);
  assert.match(html,/chatHeartbeatCommand/);
  assert.match(html,/const raw = await response\.text\(\)/);
  assert.match(html,/response\.status === 404/);
  assert.match(html,/state refresh deferred/);
});

test("transient EPERM in atomic replacement is retried without changing NTFS permissions", (t) => {
  const data=fs.mkdtempSync(path.join(os.tmpdir(),"office-eperm-retry-"));
  t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
  const source=fs.renameSync;
  let count=0;
  fs.renameSync=function(...args){
    count++;
    if(count<=2){const e=new Error("File temporarily busy");e.code="EPERM";throw e;}
    return source(...args);
  };
  try {
    const created=work.upsert(data,{id:"retry-session",title:"Backend - Bob",state:"active",heartbeat:true});
    assert.ok(created.key);
    assert.equal(count,3);
    assert.equal(work.list(data).length,1);
  }finally{fs.renameSync=source;}
  assert.equal(fs.existsSync(path.join(data,"work-sessions",work.makeKey("retry-session")+".json")),true);
});
