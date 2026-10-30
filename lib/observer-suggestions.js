"use strict";
// Propose candidate PR/Issue links from explicit references and task codes.
// Proposals are NEVER persisted without a user clicking "Add".
function codes(input) {
  return [...new Set((String(input||"").toUpperCase().match(/\b(?:B0[1-9](?:-\d{2,3})?|D-\d{2,3})\b/g)||[]))];
}
function references(input) {
  return [...new Set([...String(input||"").matchAll(/(?:\b(?:PR|PULL REQUEST|ISSUE)\s*#?\s*|#)(\d{1,7})\b/gi)]
    .map(x=>Number(x[1])).filter(Number.isSafeInteger))];
}
function suggestLinks(agent,observer,links) {
  if(observer?.status!=="ok")return[];
  const linkedPR=links?.prs||[],linkedIssues=links?.issues||[];
  const ownTask=[agent.task||"",agent.progress||""].join(" ");
  const ownName=agent.name||"";
  const exact=new Set(references(ownTask));
  const taskCodes=codes(ownTask),nameCodes=codes(ownName);
  const linkedBranches=(observer.prs||[]).filter(p=>linkedPR.includes(p.number))
    .map(p=>p.branch||"").join(" ");
  const branchCodes=codes(linkedBranches);
  const candidates=[
    ...(observer.prs||[]).map(pr=>({type:"pr",data:pr})),
    ...(observer.issues||[]).map(issue=>({type:"issue",data:issue}))
  ];
  const out=[];
  for(const {type,data} of candidates) {
    if(!data||type==="pr"&&linkedPR.includes(data.number)||
       type==="issue"&&linkedIssues.includes(data.number))continue;
    let reason="",rank=0;
    const candidateCodes=new Set(codes([data.title,data.branch].join(" ")));
    const taskMatched=taskCodes.find(c=>candidateCodes.has(c));
    const branchMatched=branchCodes.find(c=>candidateCodes.has(c));
    const nameMatched=nameCodes.find(c=>candidateCodes.has(c));
    if(exact.has(data.number)){reason="Phiên nhắc trực tiếp #"+data.number;rank=4}
    else if(taskMatched){reason="Trùng mã công việc "+taskMatched;rank=3}
    else if(branchMatched){reason="Trùng mã branch PR đã gán "+branchMatched;rank=2}
    else if(nameMatched){reason="Tên phiên chứa mã "+nameMatched+" (cần xác nhận)";rank=1}
    if(!rank)continue;
    out.push({type,number:data.number,title:data.title,url:data.url,rank,reason});
  }
  return out.sort((a,b)=>b.rank-a.rank||Number(b.number)-Number(a.number)).slice(0,8);
}
module.exports={codes,references,suggestLinks};
