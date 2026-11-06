import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
export const name = pkg.name.split('/')[1];
export const source = path.join(root, 'skills', name);
export const receiptName = '.product-skill-install.json';
export const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
export const exists = p => {try {fs.lstatSync(p); return true;} catch(e) {if(e.code==='ENOENT') return false; throw e;}};
export function fail(code, message, details={}) {throw Object.assign(new Error(message), {code, details});}
export function create(p, bytes) {if(exists(p)) fail('TARGET_EXISTS', 'Refusing existing file', {path:p}); fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,bytes,{flag:'wx'});}
export function files(dir, prefix='') {
  return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(d=>{
    const rel=path.posix.join(prefix,d.name), p=path.join(dir,d.name);
    if(d.isSymbolicLink()) fail('UNSAFE_LINK','Symbolic links are not distributable resources',{path:p});
    if(!d.isDirectory()&&!d.isFile()) fail('UNSAFE_RESOURCE','Expected a regular file',{path:p});
    return d.isDirectory()?files(p,rel):[rel];
  });
}
export const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
export function hashes(dir) {return Object.fromEntries(files(dir).map(f=>[f,hash(path.join(dir,f))]));}
export function copy(from,to) {if(exists(to)) fail('TARGET_EXISTS','Copy destination exists',{path:to}); fs.cpSync(from,to,{recursive:true,dereference:false,errorOnExist:true,force:false});}
export function targetOf(o) {
  if(!o.agent || !/^[a-z][a-z0-9-]{0,63}$/.test(o.agent)) fail('INVALID_AGENT','Supply a valid Agent identifier and its resolved --target');
  if(!o.target || !path.isAbsolute(o.target)) fail('TARGET_REQUIRED','--target must be the absolute exact Skill directory resolved by the current Agent');
  const t=path.resolve(o.target);
  const ownInstalledRuntime = root===path.join(t,'.runtime');
  if(t===path.parse(t).root || t===os.homedir() || t===root || t===source || (!ownInstalledRuntime&&root.startsWith(t+path.sep)) || t.startsWith(root+path.sep)) fail('UNSAFE_TARGET','Target overlaps a protected or source directory');
  let p=path.dirname(t);
  while(p!==path.dirname(p)) {if(exists(p)&&fs.lstatSync(p).isSymbolicLink()) fail('UNSAFE_TARGET','Parent path contains a symlink',{path:p}); p=path.dirname(p);}
  return t;
}
export function operation(target) {
  const p=target+'.operation.json';
  if(!exists(p)) return null;
  if(fs.lstatSync(p).isSymbolicLink()) fail('UNMANAGED_OPERATION','Operation record is a symlink');
  const data=readJSON(p);
  if(data.package!==pkg.name||data.target!==target) fail('UNMANAGED_OPERATION','Operation record belongs to another owner',{path:p});
  return data;
}
function saveOperation(target,fields) {
  const previous=operation(target),p=target+'.operation.json';
  if(previous) fs.renameSync(p,p+'.backup-'+crypto.randomUUID());
  create(p,JSON.stringify({...previous,...fields,package:pkg.name,target,updatedAt:new Date().toISOString()},null,2)+'\n');
}
export function status(o) {
  const target=targetOf(o), installed=exists(target), rp=path.join(target,receiptName);
  const op=operation(target),pending=Boolean(op&&op.phase!=='complete');
  let receipt=null;
  if(installed && !fs.lstatSync(target).isSymbolicLink() && exists(rp)) {
    try {receipt=readJSON(rp);}catch {fail('INVALID_RECEIPT','Receipt is malformed; preserve it before recovery',{path:rp});}
  }
  const managed=Boolean(receipt?.package===pkg.name && receipt?.name===name && receipt?.target===target && receipt?.agent===o.agent);
  if(managed && (!receipt.hashes || typeof receipt.hashes!=='object' || Object.entries(receipt.hashes).some(([f,h])=>path.isAbsolute(f)||f.split(/[\\/]/).includes('..')||typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h)))) fail('INVALID_RECEIPT','Receipt hashes missing or unsafe');
  const edited=managed?Object.entries(receipt.hashes).filter(([f,h])=>exists(path.join(target,f)) && (fs.lstatSync(path.join(target,f)).isSymbolicLink() || hash(path.join(target,f))!==h)).map(([f])=>f):[];
  const missing=managed?Object.keys(receipt.hashes).filter(f=>!exists(path.join(target,f))):[];
  const canonical=managed && Object.entries(hashes(source)).filter(([f])=>!f.startsWith('agents/')).every(([f,h])=>exists(path.join(target,f))&&hash(path.join(target,f))===h) && runtimeFiles().every(f=>exists(path.join(target,'.runtime',f))&&hash(path.join(target,'.runtime',f))===hash(path.join(root,f))) && exists(path.join(target,'.runtime/skill-integrity.json')) && hash(path.join(target,'.runtime/skill-integrity.json'))===hash(path.join(root,'skill-integrity.json'));
  const verified=managed && edited.length===0 && missing.length===0;
  return {ok:true,name,package:pkg.name,version:pkg.version,installedVersion:receipt?.version??null,target,agent:o.agent,installed,managed,current:Boolean(verified&&canonical&&receipt.version===pkg.version&&!pending),edited,missing,owner:receipt?.owner??'self',verification:{verified,algorithm:'sha256'},recovery:{required:pending||(managed&&!verified),backup:op?.backup??receipt?.backup??null,operation:op},entry:path.join(target,'.runtime','bin',name+'.mjs'),hostDiscovery:{authority:'host',status:'pending'}};
}
export function install(o) {
  const before=status(o), t=before.target;
  if(before.installed&&!before.managed) fail('UNMANAGED_TARGET','Existing Skill is user-owned; move it to a verified backup before installing',{target:t});
  if(before.edited.length) fail('LOCAL_EDITS','Managed files have local edits; preserve and reconcile them first',{edited:before.edited});
  if(before.current) return {...before,changed:false};
  if(!doctor().ok) fail('SOURCE_INTEGRITY_FAILED','Verify the acquired package before installation');
  fs.mkdirSync(path.dirname(t),{recursive:true});
  const lock=t+'.install-lock';
  try {fs.mkdirSync(lock);} catch(e) {if(e.code==='EEXIST') fail('LOCKED','Another maintenance operation may be active',{lock});throw e;}
  let stage,backup=before.recovery.required?before.recovery.backup:null,activated=false;
  try {
    stage=fs.mkdtempSync(t+'.stage-');
    for(const f of files(source)) {const p=path.join(stage,f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.copyFileSync(path.join(source,f),p,fs.constants.COPYFILE_EXCL);}
    const runtime=path.join(stage,'.runtime');fs.mkdirSync(runtime);
    for(const f of [...runtimeFiles(),'skill-integrity.json']) {const p=path.join(runtime,f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.copyFileSync(path.join(root,f),p,fs.constants.COPYFILE_EXCL);}
    if(before.installed) {
      const again=status(o);
      if(again.edited.length||!again.managed) fail('LOCAL_EDITS','Concurrent modification detected');
      backup=fs.mkdtempSync(t+'.backup-');
      copy(t,path.join(backup,'skill'));
      for(const f of files(t)) {
        if(f===receiptName || f.startsWith('agents/') || f.startsWith('.runtime/') || Object.hasOwn(readJSON(path.join(t,receiptName)).hashes,f)) continue;
        if(exists(path.join(stage,f))) fail('UNMANAGED_COLLISION','Unmanaged file collides with new managed resource',{file:f,backup});
        fs.mkdirSync(path.dirname(path.join(stage,f)),{recursive:true});fs.copyFileSync(path.join(t,f),path.join(stage,f));
      }
      const metadata=path.join(t,'agents');
      if(exists(metadata)) fs.cpSync(metadata,path.join(stage,'agents'),{recursive:true,force:true});
    }
    const owned=Object.keys(hashes(source)).filter(f=>!f.startsWith('agents/')).concat([...runtimeFiles(),'skill-integrity.json'].map(f=>'.runtime/'+f));
    const digest=Object.fromEntries(owned.map(f=>[f,hash(path.join(stage,f))]));
    create(path.join(stage,receiptName),JSON.stringify({schemaVersion:1,name,package:pkg.name,version:pkg.version,target:t,agent:o.agent,owner:o.owner??before.owner,hashes:digest,backup,installedAt:new Date().toISOString()},null,2)+'\n');
    saveOperation(t,{phase:'synchronizing',agent:o.agent,version:pkg.version,backup});
    if(before.installed) {
      try {fs.renameSync(t,path.join(backup,'previous'));activated=true;}
      catch(e) {
        if(!['EPERM','EACCES','EBUSY'].includes(e.code)) throw e;
        activated=true;
        // Recoverable copy fallback for a live host that locks directory rename.
        const old=readJSON(path.join(t,receiptName));
        for(const f of Object.keys(old.hashes)) if(exists(path.join(t,f))) fs.rmSync(path.join(t,f),{force:true});
        fs.rmSync(path.join(t,receiptName));
        fs.cpSync(stage,t,{recursive:true,force:true});
        fs.rmSync(stage,{recursive:true});stage=null;
      }
    }
    if(stage) {fs.renameSync(stage,t);stage=null;activated=true;}
    const verified=status(o);
    if(!verified.verification.verified) fail('VERIFICATION_FAILED','Skill synchronization incomplete',{backup,target:t});
    saveOperation(t,{phase:'complete',agent:o.agent,version:pkg.version,backup});
    return {...status(o),changed:true,backup,physicalCopy:true};
  } catch(e) {
    if(activated&&backup&&exists(path.join(backup,'skill'))) {
      if(exists(t)) fs.rmSync(t,{recursive:true,force:true});
      copy(path.join(backup,'skill'),t);
    }
    if(operation(t)) saveOperation(t,{phase:'failed-sync',backup,error:e.code??'SYSTEM_ERROR'});
    e.details={...e.details,backup,target:t,recovery:backup?'Original copy is in backup/skill; inspect state before retrying':'Inspect target and lock before retrying'};
    throw e;
  } finally {if(stage&&exists(stage)) fs.rmSync(stage,{recursive:true,force:true});fs.rmSync(lock,{recursive:true,force:true});}
}
export function runtimeFiles() {
  return ['package.json','capabilities.json','README.md','INSTALL.md','UPDATE.md','THIRD_PARTY_NOTICES.md',...['bin','lib','skills'].flatMap(d=>files(path.join(root,d)).map(f=>d+'/'+f))];
}
export function doctor() {
  const expected=readJSON(path.join(root,'skill-integrity.json'));
  const observed=Object.fromEntries(runtimeFiles().map(file=>[file,hash(path.join(root,file))]));
  const valid=Object.keys(expected).length===Object.keys(observed).length&&Object.entries(expected).every(([file,value])=>observed[file]===value);
  return {ok:valid,package:pkg.name,version:pkg.version,node:process.version,local_ready:valid,
    integrity:{verified:valid,algorithm:'sha256'},service_access:'not-probed',hostDiscovery:{authority:'host',status:'pending'}};
}
function cacheDir(o={}) {
  const value=o['state-dir']??process.env.PRODUCT_SKILL_STATE_DIR??path.join(os.homedir(),'.local','state',name);
  if(!path.isAbsolute(value)) fail('INVALID_INPUT','State directory must be absolute');
  return value;
}
function policy(o) {
  const file=path.join(cacheDir(o),'update-policy.json');
  const data=exists(file)?readJSON(file):{mode:'notify'};
  if(!['off','notify'].includes(data.mode)) fail('INVALID_POLICY','Preserve invalid update policy before repair');
  return data;
}
export function updatePolicy(o) {
  const current=policy(o);
  if(o.mode){
    if(!o.yes) fail('CONFIRMATION_REQUIRED','Policy changes require --yes');
    if(!['off','notify'].includes(o.mode)) fail('INVALID_ARGUMENT','Policy supports off or notify');
    const file=path.join(cacheDir(o),'update-policy.json');
    if(exists(file)) fs.renameSync(file,file+'.backup-'+crypto.randomUUID());
    create(file,JSON.stringify({mode:o.mode})+'\n');
  }
  return {ok:true,mode:o.mode??current.mode,automaticInstall:false,channel:'latest',timeoutMs:1500,ttlHours:24,disable:'AGENT_PACKAGE_UPDATE_CHECK=0',owner:runtimeOwner()};
}
function runtimeOwner() {
  const receipt=path.join(root,'..',receiptName);
  return exists(receipt)?readJSON(receipt).owner??'self':'self';
}
export function compareVersions(a,b) {
  const aa=a.split('.').map(Number),bb=b.split('.').map(Number);
  for(let i=0;i<3;i++) if(aa[i]!==bb[i]) return aa[i]-bb[i];
  return 0;
}
async function queryRegistry() {
  const url=process.env.PRODUCT_SKILL_REGISTRY_URL??'https://registry.npmjs.org';
  try {
    const response=await fetch(url+'/'+encodeURIComponent(pkg.name)+'/latest',{signal:AbortSignal.timeout(1500)});
    if(!response.ok) throw Error('registry-status-'+response.status);
    const data=await response.json();
    if(data.name!==pkg.name||!/^\d+\.\d+\.\d+$/.test(data.version)) throw Error('invalid-registry-identity');
    return {ok:true,package:pkg.name,current:pkg.version,latest:data.version,available:compareVersions(data.version,pkg.version)>0,checkedAt:Date.now(),channel:'latest',automaticInstall:false};
  } catch {
    return {ok:false,code:'REGISTRY_UNAVAILABLE',checkedAt:Date.now(),retained:true};
  }
}
export async function checkUpdate(o={},automatic=false) {
  if(runtimeOwner()!=='self') return {ok:true,deferred:true,owner:runtimeOwner(),reason:'parent-managed'};
  if(process.env.AGENT_PACKAGE_UPDATE_CHECK==='0') return {ok:true,disabled:true};
  const settings=policy(o);
  if(automatic&&settings.mode==='off') return {ok:true,disabled:true};
  if(!automatic) return queryRegistry();
  const dir=cacheDir(o),cache=path.join(dir,'update-cache.json');
  let previous=null;
  if(exists(cache)){
    try{previous=readJSON(cache);}catch{return {ok:false,code:'INVALID_CACHE',cache,preserved:true};}
    if(typeof previous.checkedAt!=='number'||previous.package!==pkg.name) return {ok:false,code:'INVALID_CACHE',cache,preserved:true};
    const ttl=previous.ok?86400000:300000;
    if(Date.now()-previous.checkedAt<ttl) return {...previous,cached:true};
  }
  fs.mkdirSync(dir,{recursive:true});
  const lock=path.join(dir,'update-check-lock');
  try{fs.mkdirSync(lock);}catch(e){if(e.code==='EEXIST')return {ok:true,deferred:true,reason:'concurrent-check'};throw e;}
  try{
    const result={...await queryRegistry(),package:pkg.name};
    const pending=path.join(dir,'update-cache-'+crypto.randomUUID()+'.json');
    create(pending,JSON.stringify(result)+'\n');
    if(exists(cache)) fs.renameSync(cache,cache+'.previous-'+crypto.randomUUID());
    fs.renameSync(pending,cache);
    return result;
  }finally{fs.rmSync(lock,{recursive:true,force:true});}
}
function npmEntry() {
  if(process.env.npm_execpath?.endsWith('npm-cli.js')&&exists(process.env.npm_execpath)) return process.env.npm_execpath;
  for(const directory of (process.env.PATH??'').split(path.delimiter)){
    for(const command of process.platform==='win32'?['npm.cmd','npm']:['npm']){
      const file=path.join(directory,command);
      if(!exists(file))continue;
      const real=fs.realpathSync(file);
      const candidates=[real,path.join(path.dirname(real),'node_modules/npm/bin/npm-cli.js'),path.join(path.dirname(real),'../lib/node_modules/npm/bin/npm-cli.js')];
      const entry=candidates.find(candidate=>candidate.endsWith('npm-cli.js')&&exists(candidate));
      if(entry)return entry;
    }
  }
  fail('NPM_UNAVAILABLE','A stable npm CLI is required for package acquisition');
}
export function updateOperation(o) {
  const target=targetOf(o);
  return {ok:true,package:pkg.name,version:pkg.version,target,operation:operation(target),hostDiscovery:{authority:'host',status:'pending'}};
}
export function resume(o) {
  const before=status(o),op=operation(before.target);
  if(!o.yes)fail('CONFIRMATION_REQUIRED','Recovery requires --yes');
  if(before.edited.length)fail('LOCAL_EDITS','Preserve edits before recovery',{edited:before.edited});
  if(!op?.candidateEntry||!exists(op.candidateEntry)) fail('RECOVERY_REQUIRED','No acquired candidate entry; inspect operation or roll back',{operation:op});
  const actual=readJSON(path.join(path.dirname(op.candidateEntry),'../package.json'));
  if(actual.name!==pkg.name||actual.version!==op.to) fail('VERSION_MISMATCH','Recorded candidate identity mismatch');
  const sync=spawnSync(process.execPath,[op.candidateEntry,'skill','update','--agent',o.agent,'--target',before.target,'--json'],{encoding:'utf8',timeout:120000,windowsHide:true,env:{...process.env,AGENT_PACKAGE_UPDATE_CHECK:'0'}});
  let data;
  try{data=JSON.parse(sync.stdout||sync.stderr);}catch{}
  if(sync.status!==0||data?.current!==true) fail('SKILL_SYNC_FAILED','Verified candidate retained; resume without another npm installation',{stage:'skill-synchronization',exitCode:sync.status,child:data,operation:op});
  return {ok:true,package:pkg.name,version:actual.version,packageChanged:true,transaction:op.transaction,entry:data.entry,synchronization:data,hostDiscovery:{authority:'host',status:'pending'}};
}
export function rollback(o) {
  if(!o.yes)fail('CONFIRMATION_REQUIRED','Rollback requires --yes');
  const before=status(o),op=operation(before.target),snapshot=op?.transaction&&path.join(op.transaction,'before');
  if(before.edited.length)fail('LOCAL_EDITS','Preserve edits before rollback',{edited:before.edited});
  if(!snapshot||!exists(snapshot)) fail('RECOVERY_REQUIRED','No pre-acquisition snapshot exists',{operation:op});
  files(snapshot);
  const pending=fs.mkdtempSync(before.target+'.rollback-');
  copy(snapshot,path.join(pending,'restored'));
  const held=path.join(pending,'previous');
  if(exists(before.target))fs.renameSync(before.target,held);
  try{fs.renameSync(path.join(pending,'restored'),before.target);}
  catch(error){if(exists(held))fs.renameSync(held,before.target);throw error;}
  saveOperation(before.target,{phase:'complete',rolledBack:true});
  return {...status(o),rolledBack:true,backup:pending};
}
export async function update(o) {
  if(!o.yes)fail('CONFIRMATION_REQUIRED','Package update requires --yes');
  const before=status(o);
  if(before.owner!=='self')fail('PARENT_MANAGED','Update this installation through its collection owner',{owner:before.owner});
  if(before.installed&&!before.managed)fail('UNMANAGED_TARGET','Resolve existing user-owned target before acquisition');
  if(before.edited.length)fail('LOCAL_EDITS','Reconcile local edits before package acquisition',{edited:before.edited});
  const previous=operation(before.target);
  if(previous&&previous.phase!=='complete')fail('RECOVERY_REQUIRED','Inspect the original operation; resume or roll back without acquiring again',{operation:previous});
  if(exists(path.join(root,'.git')))fail('SOURCE_CHECKOUT','Update this source checkout through Git; install a packed version for package maintenance');
  const check=o['package-file']?null:await checkUpdate(o);
  if(check&&!check.ok)fail(check.code,'Registry evidence unavailable; current installation retained');
  if(check&&!check.available)return {...install(o),packageChanged:false,update:check};
  if(o['package-file']&&(!path.isAbsolute(o['package-file'])||!exists(o['package-file'])))fail('INVALID_INPUT','--package-file must identify an existing absolute tarball');
  fs.mkdirSync(path.dirname(before.target),{recursive:true});
  const lock=before.target+'.update-lock';
  try{fs.mkdirSync(lock);}catch(e){if(e.code==='EEXIST')fail('LOCKED','Package acquisition is already active');throw e;}
  try{
    const transaction=fs.mkdtempSync(before.target+'.update-');
    if(before.installed)copy(before.target,path.join(transaction,'before'));
    const candidate=path.join(transaction,'candidate/node_modules',...pkg.name.split('/'));
    const candidateEntry=path.join(candidate,'bin',name+'.mjs');
    saveOperation(before.target,{phase:'acquisition',agent:o.agent,from:pkg.version,to:check?.latest??null,transaction,preReplacementBackup:before.installed?path.join(transaction,'before'):null,candidateEntry});
    const result=spawnSync(process.execPath,[npmEntry(),'install','--prefix',path.join(transaction,'candidate'),'--ignore-scripts','--no-audit','--no-fund',o['package-file']??pkg.name+'@'+check.latest],{encoding:'utf8',timeout:120000,windowsHide:true,env:{...process.env,npm_config_dry_run:'false',npm_config_json:'false'}});
    if(result.status!==0)fail('ACQUISITION_FAILED','npm acquisition failed; original target retained',{stage:'package-acquisition',exitCode:result.status,signal:result.signal,transaction});
    const actual=readJSON(path.join(candidate,'package.json'));
    if(actual.name!==pkg.name||!/^\d+\.\d+\.\d+$/.test(actual.version)||compareVersions(actual.version,pkg.version)<0||check&&actual.version!==check.latest)fail('VERSION_MISMATCH','Candidate identity mismatch; original target retained',{transaction});
    saveOperation(before.target,{phase:'candidate-ready',to:actual.version});
    return resume(o);
  }finally{fs.rmSync(lock,{recursive:true,force:true});}
}
