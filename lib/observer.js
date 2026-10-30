"use strict";
// GitHub delivery observer: read-only, bounded, no LLM token usage.
// No PR or Issue ownership is inferred by this poller.
const { execFile } = require("node:child_process");

const REPO_RE=/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const MAX_PRS=75, MAX_ISSUES=100, MAX_RUNS=50, MAX_MATCHED_CI=6;

function clean(s,n=170) {
  return String(s==null?"":s).replace(/[\x00-\x1f\x7f<>]/g," ").trim().slice(0,n);
}
function safeUrl(value,repo) {
  try {
    const u=new URL(String(value||""));
    if(u.protocol==="https:"&&u.hostname==="github.com"&&
        u.pathname.toLowerCase().startsWith("/"+repo.toLowerCase()+"/"))return u.href;
  }catch{}
  return null;
}
function isoMs(value) {
  const n=Date.parse(String(value||""));
  return Number.isFinite(n)?n:null;
}
function validNumber(n) {
  return Number.isSafeInteger(Number(n))&&Number(n)>0&&Number(n)<=9999999;
}
function normalizeRun(v,repo) {
  // Workflow run IDs are much larger than PR/Issue numbers (often > 40 billion).
  if(!v||!Number.isSafeInteger(Number(v.id))||Number(v.id)<=0||!v.head_branch)return null;
  const status=/^(queued|in_progress|waiting|requested|pending|completed)$/.test(String(v.status))?
    String(v.status):"unknown";
  const conclusion=/^(success|failure|cancelled|timed_out|action_required|neutral|skipped|stale)$/.test(String(v.conclusion))?
    String(v.conclusion):null;
  return{
    id:Number(v.id),title:clean(v.display_title||v.name),
    workflow:clean(v.name),branch:clean(v.head_branch,170),
    status,conclusion:status==="completed"?conclusion:null,
    checkedAt:isoMs(v.updated_at),startedAt:isoMs(v.run_started_at),
    url:safeUrl(v.html_url,repo),event:clean(v.event,30)
  };
}
function deriveCi(runs) {
  if(!runs.length)return{status:"not-checked",label:"Chưa có CI trong cửa sổ quan sát"};
  const latest=runs[0];
  if(runs.some(r=>r.status!=="completed"))
    return{status:"running",label:"Có CI đang chạy/chờ",at:latest.checkedAt};
  if(runs.some(r=>["failure","timed_out","action_required"].includes(r.conclusion)))
    return{status:"failure",label:"Có CI lỗi trong cửa sổ",at:latest.checkedAt};
  if(runs.some(r=>r.conclusion==="cancelled"))
    return{status:"cancelled",label:"Có CI bị hủy",at:latest.checkedAt};
  if(runs.some(r=>r.conclusion==="success"))
    return{status:"success",label:"Run gần đây không thấy lỗi",at:latest.checkedAt};
  return{status:"unknown",label:"Chưa rõ kết quả CI",at:latest.checkedAt};
}
function normalizePr(v,repo,runs=[]) {
  if(!v||!validNumber(v.number))return null;
  const branch=clean(v.head?.ref,170);
  const matched=runs.filter(r=>r.branch&&r.branch===branch).slice(0,MAX_MATCHED_CI);
  return{
    number:Number(v.number),title:clean(v.title),branch,
    url:safeUrl(v.html_url,repo),isDraft:!!v.draft,
    updatedAt:isoMs(v.updated_at),
    state:v.merged_at?"merged":v.state==="open"?"open":v.state==="closed"?"closed":"unknown",
    closedAt:isoMs(v.closed_at),mergedAt:isoMs(v.merged_at),
    ci:deriveCi(matched),runs:matched
  };
}
function normalizeIssue(v,repo) {
  // GitHub's /issues endpoint includes pull requests. Do not double-count them.
  if(!v||!validNumber(v.number)||v.pull_request)return null;
  return{
    number:Number(v.number),title:clean(v.title,190),
    url:safeUrl(v.html_url,repo),
    state:v.state==="open"?"open":v.state==="closed"?"closed":"unknown",
    stateReason:clean(v.state_reason,35),updatedAt:isoMs(v.updated_at),
    closedAt:isoMs(v.closed_at),createdAt:isoMs(v.created_at),
    labels:Array.isArray(v.labels)?v.labels.map(x=>clean(typeof x==="string"?x:x?.name,45)).filter(Boolean).slice(0,5):[],
    assignees:Array.isArray(v.assignees)?v.assignees.map(x=>clean(x?.login,45)).filter(Boolean).slice(0,5):[]
  };
}
function makeFetcher(exec=execFile) {
  return resource=>new Promise((resolve,reject)=>{
    exec("gh",["api","--method","GET",resource],{
      windowsHide:true,timeout:25000,maxBuffer:6*1024*1024,encoding:"utf8"
    },(err,stdout)=>{
      if(err)return reject(new Error("GitHub CLI read failed ("+clean(err.code||"unknown",32)+")"));
      try{resolve(JSON.parse(stdout))}
      catch{reject(new Error("GitHub API JSON malformed"))}
    });
  });
}
function createObserver({repo="",refreshMs=120000,fetcher=makeFetcher(),now=Date.now}={}) {
  const valid=REPO_RE.test(repo);
  const intervalMs=Math.max(60000,Math.min(600000,Number(refreshMs)||120000));
  let snapshot={
    repo:valid?repo:null,status:valid?"loading":"disabled",
    checkedAt:null,attemptAt:null,error:null,prs:[],issues:[],runs:[],
    coverage:{prLimit:MAX_PRS,issueLimit:MAX_ISSUES,runLimit:MAX_RUNS,scope:"most-recent-updated"},
    refreshSeconds:Math.round(intervalMs/1000)
  };
  let pending=null,timer=null;
  async function refresh() {
    if(!valid)return snapshot;
    if(pending)return pending;
    const started=now();
    pending=(async()=>{
      try{
        const prefix="repos/"+repo;
        const [prsResponse,issuesResponse,runsResponse]=await Promise.all([
          fetcher(prefix+"/pulls?state=all&sort=updated&direction=desc&per_page="+MAX_PRS),
          fetcher(prefix+"/issues?state=all&sort=updated&direction=desc&per_page="+MAX_ISSUES),
          fetcher(prefix+"/actions/runs?per_page="+MAX_RUNS)
        ]);
        if(!Array.isArray(prsResponse)||!Array.isArray(issuesResponse)||
           !Array.isArray(runsResponse?.workflow_runs))
          throw new Error("GitHub response format changed");
        const runs=runsResponse.workflow_runs.map(r=>normalizeRun(r,repo)).filter(Boolean).slice(0,MAX_RUNS);
        const prs=prsResponse.map(p=>normalizePr(p,repo,runs)).filter(Boolean).slice(0,MAX_PRS);
        const issues=issuesResponse.map(p=>normalizeIssue(p,repo)).filter(Boolean).slice(0,MAX_ISSUES);
        snapshot={
          repo,status:"ok",checkedAt:now(),attemptAt:started,error:null,
          prs,issues,runs,coverage:snapshot.coverage,refreshSeconds:Math.round(intervalMs/1000)
        };
      }catch(e){
        snapshot={...snapshot,status:"error",attemptAt:started,
          error:clean(e?.message||"GitHub unavailable",140)};
      }finally{pending=null}
      return snapshot;
    })();
    return pending;
  }
  function start(){
    if(valid&&!timer){
      void refresh();
      timer=setInterval(()=>{void refresh()},intervalMs);
      timer.unref?.();
    }
  }
  function stop(){if(timer)clearInterval(timer);timer=null}
  return{read:()=>snapshot,refresh,start,stop};
}
module.exports={createObserver,normalizePr,normalizeIssue,normalizeRun,deriveCi,makeFetcher};
