"use strict";
// Explicit session-to-multiple-PR/Issue links. Never infer owners automatically.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const KEY = /^(?:ceo|(?:w|g)-[a-f0-9]{12}|(?:c|x)-[a-f0-9]{8})$/i;
const VALID_NUMBER = (n) => Number.isSafeInteger(n) && n >= 1 && n <= 9999999;
const TYPES = Object.freeze({pr:"prs",issue:"issues"});
const MAX_PER_TYPE = 25;
const empty = () => ({prs:[],issues:[]});
function normalize(raw) {
  if (VALID_NUMBER(raw)) return {prs:[raw],issues:[]}; // migrate legacy {session: prNumber}
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty();
  const result = empty();
  for (const type of ["prs","issues"]) {
    if (!Array.isArray(raw[type])) continue;
    result[type] = [...new Set(raw[type].filter(VALID_NUMBER))].slice(0,MAX_PER_TYPE);
  }
  return result;
}
function createLinks(dataDir) {
  const file = path.join(dataDir,"observer-links.json");
  let state = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file,"utf8"));
    const source = parsed?.version === 2 && parsed?.sessions && typeof parsed.sessions === "object" ?
      parsed.sessions : parsed;
    if (source && typeof source === "object" && !Array.isArray(source)) {
      for (const [key,value] of Object.entries(source)) {
        if (!KEY.test(key)) continue;
        const record = normalize(value);
        if (record.prs.length || record.issues.length) state[key]=record;
      }
    }
  } catch(e) { if(e.code !== "ENOENT")throw e; }

  function commit(next) {
    fs.mkdirSync(dataDir,{recursive:true});
    const temp = file + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
    try {
      fs.writeFileSync(temp,JSON.stringify({version:2,sessions:next},null,2)+"\n",{flag:"wx",mode:0o600});
      for(let i=0;;i++){
        try {fs.renameSync(temp,file);break}
        catch(e) {
          if(!["EPERM","EACCES","EBUSY"].includes(e.code)||i>=4)throw e;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25*(i+1));
        }
      }
      state=next;
    } finally {try{if(fs.existsSync(temp))fs.unlinkSync(temp)}catch{}}
  }
  function checkKey(key) {
    if (!KEY.test(String(key || ""))) throw new TypeError("Invalid session key");
  }
  function get(key) {
    return normalize(state[key]);
  }
  function mutate(key, kind, number, operation) {
    checkKey(key);
    if (!Object.hasOwn(TYPES,kind) || !VALID_NUMBER(number))
      throw new TypeError("Invalid issue/PR number or kind");
    if (!["add","remove"].includes(operation)) throw new TypeError("Invalid link operation");
    const field=TYPES[kind], current=get(key);
    const values=current[field];
    if(operation==="add" && !values.includes(number)) {
      if(values.length>=MAX_PER_TYPE)throw new RangeError("Max "+MAX_PER_TYPE+" links per type");
      values.push(number);
    }
    if(operation==="remove")current[field]=values.filter((n)=>n!==number);
    const next={...state};
    if(!current.prs.length && !current.issues.length)delete next[key];
    else next[key]=current;
    if(JSON.stringify(next) !== JSON.stringify(state))commit(next);
    return get(key);
  }
  function replace(key,links) {
    checkKey(key);
    const updated=normalize(links);
    const next={...state};
    if(updated.prs.length || updated.issues.length)next[key]=updated;
    else delete next[key];
    if(JSON.stringify(next)!==JSON.stringify(state))commit(next);
    return get(key);
  }
  // For old clients: one-PR assignment. Only legacy callers use this method.
  function set(key,number) {
    const links=get(key);
    return replace(key,{prs:number==null?[]:[number],issues:links.issues});
  }
  return {get,add:(key,kind,num)=>mutate(key,kind,num,"add"),
    remove:(key,kind,num)=>mutate(key,kind,num,"remove"),replace,set,
    all:()=>Object.fromEntries(Object.entries(state).map(([k,v])=>[k,normalize(v)]))};
}
module.exports={createLinks,MAX_PER_TYPE};
