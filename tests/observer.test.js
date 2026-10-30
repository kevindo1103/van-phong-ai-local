"use strict";
const { test }=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createObserver,normalizePr,normalizeIssue,normalizeRun}=require("../lib/observer");
const {createLinks,MAX_PER_TYPE}=require("../lib/observer-links");
const {suggestLinks}=require("../lib/observer-suggestions");

const REPO="sample-org/sample-repo";
function fixture() {
  const pr=[
    {number:1940,title:"feat(B04): staff POS",state:"open",
      updated_at:"2026-10-30T09:06:30Z",draft:false,
      head:{ref:"codex/b04-integration-20261030"},
      html_url:"https://github.com/sample-org/sample-repo/pull/1940"},
    {number:1941,title:"B02 B03 merged",state:"open",draft:false,
      updated_at:"2026-10-30T09:15:00Z",head:{ref:"branch-1941"},
      html_url:"https://github.com/sample-org/sample-repo/pull/1941"},
    {number:1930,title:"B04 old patch",state:"closed",merged_at:"2026-10-29T09:15:00Z",
      updated_at:"2026-10-29T09:15:00Z",head:{ref:"codex/b04-old"},
      html_url:"https://github.com/sample-org/sample-repo/pull/1930"}
  ];
  const issues=[
    {number:1939,title:"B05 D-05 inventory threshold",state:"open",created_at:"2026-10-30T01:00:00Z",
      updated_at:"2026-10-30T09:45:00Z",labels:[{name:"inventory"}],assignees:[{login:"coder"}],
      html_url:"https://github.com/sample-org/sample-repo/issues/1939"},
    {number:1929,title:"B04 release smoke",state:"closed",updated_at:"2026-10-29T09:00:00Z",
      html_url:"https://github.com/sample-org/sample-repo/issues/1929"},
    {number:1940,title:"PR duplicates",state:"open",pull_request:{url:"https://api.github.com/repos/sample-org/sample-repo/pulls/1940"}}
  ];
  const runs={workflow_runs:[
    {id:101,display_title:"B04 tests",name:"PR test",status:"completed",conclusion:"success",
      head_branch:"codex/b04-integration-20261030",updated_at:"2026-10-30T09:05:00Z",
      html_url:"https://github.com/sample-org/sample-repo/actions/runs/101"},
    {id:102,display_title:"Backend tests",name:"pytest",status:"in_progress",
      head_branch:"branch-1941",updated_at:"2026-10-30T09:30:00Z",
      html_url:"https://github.com/sample-org/sample-repo/actions/runs/102"}
  ]};
  return {pr,issues,runs};
}
function mockFetch(f,calls=[],shouldFail=()=>false) {
  return async resource=>{
    calls.push(resource);
    if(shouldFail())throw new Error("GitHub API unavailable");
    if(resource.includes("/pulls?"))return f.pr;
    if(resource.includes("/issues?"))return f.issues;
    if(resource.includes("/actions/runs?"))return f.runs;
    throw Error("Unexpected resource: "+resource);
  };
}
test("observer reads recent PRs, Issues (excluding PRs), CI by exact branch",async()=>{
  const f=fixture(),calls=[];
  const observer=createObserver({repo:REPO,refreshMs:30000,now:()=>1000,fetcher:mockFetch(f,calls)});
  const state=await observer.refresh();
  assert.equal(state.status,"ok");
  assert.equal(state.repo,REPO);
  assert.equal(state.prs.length,3);
  assert.equal(state.issues.length,2);
  assert.equal(state.prs.find(p=>p.number===1930).state,"merged");
  assert.equal(state.issues.find(x=>x.number===1939).state,"open");
  assert.equal(state.issues.find(x=>x.number===1939).assignees[0],"coder");
  assert.ok(!state.issues.some(x=>x.number===1940));
  assert.equal(state.runs.length,2);
  assert.equal(state.prs.find(x=>x.number===1940).ci.status,"success");
  assert.equal(state.prs.find(x=>x.number===1941).ci.status,"running");
  assert.ok(!JSON.stringify(state).includes("ownerId"));
  assert.equal(calls.length,3);
  assert.ok(calls.every(s=>s.startsWith("repos/"+REPO+"/")));
  assert.ok(calls.some(s=>s.includes("/issues?state=all")));
  assert.equal(state.refreshSeconds,60);
  observer.stop();
});
test("observer error retains last successful Issues, PRs and runs while marked stale",async()=>{
  const f=fixture();let error=false;
  const observer=createObserver({repo:REPO,fetcher:mockFetch(f,[],()=>error)});
  assert.equal((await observer.refresh()).issues.length,2);
  error=true;
  const result=await observer.refresh();
  assert.equal(result.status,"error");
  assert.equal(result.issues.length,2);
  assert.equal(result.prs.length,3);
  assert.equal(result.runs.length,2);
  assert.match(result.error,/unavailable/i);
});
test("observer sanitizes Issues and GitHub URLs",()=>{
  assert.equal(normalizePr({},REPO,[]),null);
  assert.equal(normalizeIssue({number:1,pull_request:{}},REPO),null);
  assert.equal(normalizeRun({id:"bad",head_branch:"x"},REPO),null);
  const f=fixture();f.pr[0].html_url="https://evil.example/collect?q=secret";
  assert.equal(normalizePr(f.pr[0],REPO,[]).url,null);
  f.issues[0].html_url="https://github.com.evil.example/issues/1939";
  assert.equal(normalizeIssue(f.issues[0],REPO).url,null);
  f.runs.workflow_runs[0].html_url="https://fake.github.com/sample-org/sample-repo/actions/runs/101";
  assert.equal(normalizeRun(f.runs.workflow_runs[0],REPO).url,null);
});
test("multi PR/Issue links preserve legacy single PR file and support independent removal",(t)=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),"office-multilink-"));
  t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
  const old={"g-fa049483dead":1941};
  fs.writeFileSync(path.join(data,"observer-links.json"),JSON.stringify(old));
  const links=createLinks(data);
  const key="g-fa049483dead";
  assert.deepEqual(links.get(key),{prs:[1941],issues:[]});
  assert.deepEqual(links.get("w-1014c53c07a7"),{prs:[],issues:[]});
  links.add(key,"pr",1940);links.add(key,"pr",1940);
  links.add(key,"issue",1939);links.add(key,"issue",1929);
  assert.deepEqual(links.get(key),{prs:[1941,1940],issues:[1939,1929]});
  const after=JSON.parse(fs.readFileSync(path.join(data,"observer-links.json"),"utf8"));
  assert.equal(after.version,2);
  assert.deepEqual(after.sessions[key].prs,[1941,1940]);
  assert.deepEqual(createLinks(data).get(key),{prs:[1941,1940],issues:[1939,1929]});
  links.remove(key,"pr",1941);
  assert.deepEqual(links.get(key),{prs:[1940],issues:[1939,1929]});
  links.set(key,null); // old API removes PRs but does not remove Issues
  assert.deepEqual(links.get(key),{prs:[],issues:[1939,1929]});
  assert.throws(()=>links.add("../config.json","issue",1939),TypeError);
  assert.throws(()=>links.add(key,"random",1939),TypeError);
  assert.throws(()=>links.add(key,"pr",-1),TypeError);
  const numbers=Array.from({length:MAX_PER_TYPE},(_,i)=>i+1);
  links.replace(key,{prs:numbers,issues:[]});
  assert.throws(()=>links.add(key,"pr",99),RangeError);
  links.replace(key,{prs:[],issues:[]});
  assert.deepEqual(links.all(),{});
});
test("proposals from task/branch are review-only and do not assign work",()=>{
  const f=fixture(),state={
    status:"ok",prs:f.pr.map(p=>normalizePr(p,REPO,[])),
    issues:f.issues.map(x=>normalizeIssue(x,REPO)).filter(Boolean)
  };
  const suggested=suggestLinks({
    name:"B04/B05 fixer",task:"B05 D-05 acceptance; PR #1940",
    progress:"Review B04 staff"
  },state,{prs:[1930],issues:[]});
  assert.ok(suggested.some(s=>s.type==="pr"&&s.number===1940&&s.reason.includes("nhắc trực tiếp")));
  assert.ok(suggested.some(s=>s.type==="issue"&&s.number===1939));
  assert.ok(suggested.every(s=>s.number!==1930));
  assert.ok(suggested.length<=8);
  assert.deepEqual(suggestLinks({name:"Bob",task:""},state,{prs:[],issues:[]}),[]);
  assert.deepEqual(suggestLinks({name:"B04",task:"B04"}, {...state,status:"error"},{prs:[],issues:[]}),[]);
});
test("observer page and client include two assignment groups with user action",()=>{
  const page=fs.readFileSync(path.join(__dirname,"..","public","observer.html"),"utf8");
  const client=fs.readFileSync(path.join(__dirname,"..","public","observer-client.js"),"utf8");
  assert.match(page,/id="issues"/);
  assert.match(page,/observer-client\.js/);
  assert.match(client,/renderLinks\(parts,agent,"pr"/);
  assert.match(client,/renderLinks\(parts,agent,"issue"/);
  assert.match(client,/sendLink\(agent\.key,type,number,operation\)/);
  assert.match(client,/Gợi ý liên kết từ task\/branch/);
  assert.match(client,/không dùng để tự suy luận agent đang hoạt động/);
});
