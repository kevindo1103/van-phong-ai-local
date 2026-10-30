"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const hooks = require("../lib/observer-local");

test("Claude hook records lifecycle metadata but never prompt contents or tool input", (t)=>{
  const data = fs.mkdtempSync(path.join(os.tmpdir(),"observer-hook-"));
  t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
  const cwd=path.join(data,"project");fs.mkdirSync(cwd);
  const sid="a1234567-1234-4567-890a-123456789abc",id="c-a1234567";
  const event={hook_event_name:"PreToolUse",session_id:sid,cwd,
    tool_name:"Bash",tool_input:{command:"echo SECRET_ABC"},prompt:"SECRET_PROMPT"};
  const result=hooks.ingest(data,[cwd],event,1793350000000);
  assert.equal(result.key,id);
  const f=path.join(data,"observer-hooks",id+".json");
  const raw=fs.readFileSync(f,"utf8");
  assert.ok(!raw.includes("SECRET"));
  assert.ok(!raw.includes("tool_input"));
  let r=hooks.read(data,id,1793350000050);
  assert.equal(r.state,"tool-running");
  assert.equal(r.source,"claude-hook");
  assert.equal(r.fresh,true);
  r=hooks.read(data,id,1793350000000+7*60000);
  assert.equal(r.state,"stale");
  assert.equal(r.fresh,false);
  assert.equal(hooks.ingest(data,[cwd],{...event,cwd:path.join(data,"other")}),null);
  assert.equal(hooks.ingest(data,[cwd],{...event,session_id:"../../invalid"}),null);
});
test("Claude hook CLI accepts stdin JSON and does not output new LLM context", (t)=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"observer-cli-"));
  t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const cwd=path.join(tmp,"project");fs.mkdirSync(cwd);
  const config=path.join(tmp,"config.json"),dataDir=path.join(tmp,"data");
  fs.writeFileSync(config,JSON.stringify({dataDir,projects:[cwd]}));
  const cli=path.join(__dirname,"..","tools","observer-claude-hook.js");
  const input=JSON.stringify({hook_event_name:"PermissionRequest",session_id:"b1234567-1234-4567-890a-123456789abc",cwd,tool_name:"Write",tool_input:{secrets:"do-not-save"}});
  const result=spawnSync(process.execPath,[cli],{input,encoding:"utf8",windowsHide:true,env:{...process.env,VP_CONFIG:config}});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,"");
  assert.equal(hooks.read(dataDir,"c-b1234567")?.state,"approval-wait");
});
test("installer appends async hooks without replacing existing user hooks", (t)=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"observer-installer-"));
  t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const file=path.join(tmp,"settings.json");
  const original={statusLine:{type:"command",command:"existing"},hooks:{PreToolUse:[{matcher:"Grep|Glob",hooks:[{type:"command",command:"other-tool"}]}]}};
  fs.writeFileSync(file,JSON.stringify(original));
  const script=path.join(__dirname,"..","tools","install-claude-observer-hooks.js");
  const run=(...argv)=>spawnSync(process.execPath,[script,...argv],{
    encoding:"utf8",windowsHide:true,env:{...process.env,VP_CLAUDE_SETTINGS:file}
  });
  assert.equal(run().status,0);
  assert.equal(JSON.parse(fs.readFileSync(file,"utf8")).hooks.PreToolUse.length,1);
  assert.equal(run("--apply").status,0);
  let settings=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.equal(settings.statusLine.command,"existing");
  assert.equal(settings.hooks.PreToolUse.length,2);
  assert.equal(settings.hooks.SessionStart[0].hooks[0].async,true);
  assert.equal(settings.hooks.PostToolUse[0].hooks[0].type,"command");
  assert.equal(run("--apply").status,0);
  settings=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.equal(settings.hooks.PreToolUse.length,2);
});
