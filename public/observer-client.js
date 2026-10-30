"use strict";
// Observer UI: status and ownership remain independent; links require a click.
const $=id=>document.getElementById(id);
const el=(tag,cls,value)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  node.textContent=String(value??"");
  return node;
};
const ago=t=>!t?"chưa có":Math.max(0,Date.now()-t)<60000?
  Math.ceil(Math.max(0,Date.now()-t)/1000)+"s trước":
  Math.max(0,Date.now()-t)<3600000?
    Math.round((Date.now()-t)/60000)+" phút trước":
    Math.round((Date.now()-t)/3600000)+" giờ trước";
const dt=t=>t?new Date(t).toLocaleString("vi-VN",{
  day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"
}):"–";
const badge=(value,cls="")=>el("span","badge "+cls,value);
function ghLink(url,label){
  try{
    const u=new URL(url);
    if(u.protocol!=="https:"||u.hostname!=="github.com")throw Error();
    const a=el("a","",label);a.href=u.href;a.target="_blank";a.rel="noopener noreferrer";
    return a;
  }catch{return el("span","",label)}
}
const statusLabel=item=>item?.state==="open"?"Đang mở":item?.state==="merged"?"Đã merge":
  item?.state==="closed"?"Đã đóng":"Chưa rõ";
const statusStyle=item=>item?.state==="open"?"live":item?.state==="merged"?"live":"";
function activityLabel(agent){
  const state=agent.observation?.activity?.state;
  const words={
    "recent-signal":"Heartbeat mới","recent-log":"Nhật ký mới",
    working:"Claude đang xử lý","tool-running":"Claude đang gọi tool",
    "approval-wait":"Claude chờ duyệt",idle:"Claude rảnh",
    ended:"Claude kết thúc",stale:"Tín hiệu cũ",
    unlinked:"Chưa kết nối",unknown:"Chưa rõ","not-applicable":"CEO"
  };
  return badge(words[state]||"Chưa xác minh",
    ["recent-signal","recent-log","working","tool-running"].includes(state)?"live":
      ["stale","approval-wait"].includes(state)?"warn":"");
}
const ciBadge=ci=>badge(ci?.label||"Chưa có CI",
  ci?.status==="success"?"live":ci?.status==="failure"?"fail":
    ci?.status==="running"?"warn":"");
function field(label,value){
  const node=el("div","","");
  node.append(el("b","",label),el("span","",value));
  return node;
}
function renderStats(observer,agents){
  const nonHuman=agents.filter(a=>a.platform!=="human");
  const activity=nonHuman.filter(a=>["recent-signal","recent-log","working","tool-running","approval-wait"]
    .includes(a.observation?.activity?.state)).length;
  const reported=nonHuman.filter(a=>a.observation?.work?.task).length;
  const linked=nonHuman.filter(a=>{
    const links=a.observation?.delivery?.links;
    return links&&(links.prs?.length||links.issues?.length);
  }).length;
  const openPR=(observer.prs||[]).filter(p=>p.state==="open").length;
  const openIssue=(observer.issues||[]).filter(issue=>issue.state==="open").length;
  const vals=[
    [activity,"Phiên có tín hiệu kỹ thuật mới"],
    [reported,"Phiên có báo cáo công việc"],
    [linked,"Phiên đã gán PR/Issue"],
    [openPR,"PR mở trong cửa sổ"],
    [openIssue,"Issue mở trong cửa sổ"]
  ];
  $("stats").replaceChildren(...vals.map(([value,label])=>{
    const box=el("div","stat","");
    box.append(el("b","",value),el("small","",label));
    return box;
  }));
}
async function sendLink(session,type,number,operation){
  const response=await fetch("/api/observer/link",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({session,type,number,operation})
  });
  let body;
  try{body=await response.json()}catch{throw Error("API không trả JSON (HTTP "+response.status+")")}
  if(!response.ok||!body.ok)throw Error(body.error||"HTTP "+response.status);
  return body.links;
}
async function changeLink(agent,type,number,operation,button){
  if(!number)return;
  if(button)button.disabled=true;
  $("feedback").textContent="";
  try{
    await sendLink(agent.key,type,number,operation);
    $("feedback").textContent=(operation==="add"?"Đã gán ":"Đã gỡ ")+
      (type==="pr"?"PR":"Issue")+" #"+number+" · "+agent.name+
      ". Đây là phân công thủ công, không phải tín hiệu đang chạy.";
    await refresh();
  }catch(err){$("feedback").textContent="Không lưu được: "+err.message}
  finally{if(button)button.disabled=false}
}
function renderLinks(card,agent,kind,numbers,objects,missing,available){
  const row=el("div","link-group",""),title=el("h3","",kind==="pr"?"PR phụ trách":"Issue phụ trách");
  row.appendChild(title);
  if(!numbers.length)row.append(el("p","muted","Chưa gán "+(kind==="pr"?"PR":"Issue")+"."));
  const list=el("div","link-chip-list","");
  for(const number of numbers) {
    const item=objects.find(p=>p.number===number),chip=el("div","link-chip","");
    const details=el("div","chip-details","");
    details.append(
      item?ghLink(item.url,"#"+number+" · "+item.title):el("span","","#"+number+" · Không nằm trong cửa sổ GitHub gần đây"),
      el("small","",item?statusLabel(item)+" · GitHub đã quan sát":"Liên kết thủ công được giữ lại")
    );
    if(kind==="pr"&&item)details.append(ciBadge(item.ci));
    const remove=el("button","chip-remove","Gỡ");
    remove.setAttribute("aria-label","Gỡ "+(kind==="pr"?"PR":"Issue")+" #"+number+" của "+agent.name);
    remove.addEventListener("click",()=>changeLink(agent,kind,number,"remove",remove));
    chip.append(details,remove);list.append(chip);
  }
  row.append(list);
  const controls=el("div","linkrow","");
  const select=document.createElement("select");
  select.setAttribute("aria-label","Chọn "+kind+" để gán cho "+agent.name);
  const def=document.createElement("option");def.value="";def.textContent=
    "Chọn "+(kind==="pr"?"PR":"Issue")+" mới";select.append(def);
  for(const item of available) {
    if(numbers.includes(item.number))continue;
    const option=document.createElement("option");
    option.value=String(item.number);
    option.textContent="#"+item.number+" · "+item.title.slice(0,65)+(item.state!=="open"?" ["+item.state+"]":"");
    select.append(option);
  }
  const button=el("button","","Thêm "+(kind==="pr"?"PR":"Issue"));
  button.disabled=select.options.length<=1;
  button.addEventListener("click",()=>changeLink(agent,kind,Number(select.value),"add",button));
  controls.append(select,button);row.append(controls);
  card.append(row);
}
function renderSuggestions(card,agent){
  const suggestions=agent.observation?.delivery?.suggestions||[];
  if(!suggestions.length)return;
  const details=document.createElement("details");
  details.className="suggestions";
  details.appendChild(el("summary","","Gợi ý liên kết từ task/branch ("+suggestions.length+")"));
  details.append(el("p","muted","Chưa gán tự động. Kiểm tra đúng owner trước khi nhấn Gán."));
  for(const suggestion of suggestions){
    const row=el("div","suggestion-row","");
    const desc=el("div","","");
    desc.append(
      ghLink(suggestion.url,(suggestion.type==="pr"?"PR":"Issue")+" #"+suggestion.number+" · "+suggestion.title),
      el("small","",suggestion.reason)
    );
    const button=el("button","","Gán");
    button.addEventListener("click",()=>changeLink(agent,suggestion.type,suggestion.number,"add",button));
    row.append(desc,button);details.append(row);
  }
  card.append(details);
}
function renderSessions(agents,observer){
  const cards=[];
  const prs=observer.prs||[],issues=observer.issues||[];
  for(const agent of agents.filter(a=>a.platform!=="human")){
    const obs=agent.observation||{},live=obs.activity||{},work=obs.work||{},delivery=obs.delivery||{};
    const links=delivery.links||{prs:[],issues:[]};
    const card=el("article","session","");
    const head=el("div","head",""),identity=el("div","","");
    identity.append(el("div","title",agent.name),el("div","caption",agent.room+" · "+agent.platform+" · "+agent.key));
    head.append(identity,activityLabel(agent));card.append(head);
    const meta=el("div","meta","");
    meta.append(
      field("Liveness · nguồn",live.source||"chưa xác minh"),
      field("Quan sát cuối",ago(live.observedAt)),
      field("Work · trạng thái báo",work.state||"unknown"),
      field("Lần báo cáo việc",ago(work.observedAt))
    );
    card.append(meta);
    const report=el("div","report","");
    report.append(el("b","","Việc đã báo: "),
      el("span","",work.task||"Chưa có báo cáo công việc."));
    if(work.progress)report.append(el("p","",work.progress));
    if(work.blocker)report.append(el("p","", "Vướng mắc: "+work.blocker));
    card.append(report);
    const parts=el("div","links-layout","");
    renderLinks(parts,agent,"pr",links.prs||[],delivery.prs||[],
      delivery.missingPrNumbers||[],prs);
    renderLinks(parts,agent,"issue",links.issues||[],delivery.issues||[],
      delivery.missingIssueNumbers||[],issues);
    card.append(parts);
    renderSuggestions(card,agent);
    card.append(el("div","note","PR/Issue là bằng chứng delivery · không dùng để tự suy luận agent đang hoạt động."));
    cards.push(card);
  }
  $("sessions").replaceChildren(...(cards.length?cards:[el("div","report","Chưa có phiên AI.")]));
}
function githubCard(item,type){
  const card=el("div","pr","");
  const head=el("div","head","");
  head.append(el("b","",(type==="pr"?"PR":"Issue")+" #"+item.number+
    (item.isDraft?" · Draft":"")),badge(statusLabel(item),statusStyle(item)));
  card.append(head,ghLink(item.url,item.title));
  if(type==="pr")card.append(ciBadge(item.ci));
  if(type==="issue"&&item.labels?.length)card.append(el("small","","Labels: "+item.labels.join(", ")));
  card.append(el("small","",(type==="pr"?item.branch:"GitHub Issue")+
    " · cập nhật "+dt(item.updatedAt)));
  return card;
}
function renderGithub(observer){
  const prs=observer.prs||[],issues=observer.issues||[],runs=observer.runs||[];
  const openPr=prs.filter(p=>p.state==="open"),closedPr=prs.filter(p=>p.state!=="open");
  const openIssue=issues.filter(i=>i.state==="open"),closedIssue=issues.filter(i=>i.state!=="open");
  $("pr-summary").textContent=openPr.length+" đang mở · "+closedPr.length+" gần đây đã đóng/merge";
  $("issue-summary").textContent=openIssue.length+" đang mở · "+closedIssue.length+" gần đây đã đóng";
  const prShown=[...openPr.slice(0,14),...closedPr.slice(0,6)];
  const issueShown=[...openIssue.slice(0,16),...closedIssue.slice(0,5)];
  $("prs").replaceChildren(...(prShown.length?prShown.map(p=>githubCard(p,"pr")):
    [el("div","report","Không có PR trong cửa sổ quan sát.")]));
  $("issues").replaceChildren(...(issueShown.length?issueShown.map(i=>githubCard(i,"issue")):
    [el("div","report","Không có Issue trong cửa sổ quan sát.")]));
  $("runs").replaceChildren(...(runs.length?runs.slice(0,10).map(run=>{
    const card=el("div","run",""),head=el("div","head","");
    head.append(el("b","",run.workflow||"Workflow"),badge(
      run.status==="completed"?run.conclusion||"completed":run.status,
      run.status!=="completed"?"warn":run.conclusion==="success"?"live":
        run.conclusion==="failure"?"fail":""));
    card.append(head,ghLink(run.url,"Run #"+run.id),
      el("small","",run.branch+" · "+dt(run.checkedAt)));
    return card;
  }):[el("div","report","Chưa có CI gần đây.")]));
}
async function refresh(){
  try {
    const response=await fetch("/api/observer",{cache:"no-store"});
    if(!response.ok)throw Error("HTTP "+response.status);
    const data=await response.json(),observer=data.observer||{},agents=data.agents||[];
    let message="GitHub: "+(observer.repo||"chưa cấu hình")+" · "+(observer.status||"loading");
    message+=observer.checkedAt?" · xác nhận lần cuối "+dt(observer.checkedAt):" · chưa kiểm tra";
    if(observer.error)message+=" · "+observer.error;
    $("source").textContent=message+" · polling "+
      (observer.refreshSeconds||120)+" giây · zero LLM token";
    renderStats(observer,agents);
    renderSessions(agents,observer);
    renderGithub(observer);
  }catch(e){$("source").textContent="Không đọc được Agent Observer: "+e.message}
}
$("reload").addEventListener("click",refresh);
refresh();setInterval(refresh,15000);
