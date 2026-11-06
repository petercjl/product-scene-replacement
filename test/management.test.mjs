import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const name=pkg.name.split('/')[1];
const npmCli=process.env.npm_execpath;
async function execute(entry,args=[],env={}) {
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[entry,...args],{cwd:root,windowsHide:true,env:{...process.env,AGENT_PACKAGE_UPDATE_CHECK:'0',...env}});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>stdout+=chunk);
  child.stderr.on('data',chunk=>stderr+=chunk);
  child.on('error',reject);
  child.on('close',code=>resolve({code,stdout,stderr}));
 });
}
async function cli(entry,...args){
 const result=await execute(entry,[...args,'--json']);
 return {...result,data:JSON.parse(result.stdout||result.stderr)};
}
async function npm(args) {
 const result=await execute(npmCli,args,{npm_config_dry_run:'false',npm_config_json:'false'});
 assert.equal(result.code,0,result.stderr);
 return result;
}
test('real packed management entry, isolated installation and update recovery',async t=>{
 assert.ok(npmCli?.endsWith('npm-cli.js'),'Run this suite through npm test');
 const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'product-skill-management-')));
 t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const packs=path.join(temp,'packs');
 await fs.mkdir(packs);
 const packed=await npm(['pack',root,'--pack-destination',packs,'--ignore-scripts','--json']);
 const tarball=path.join(packs,JSON.parse(packed.stdout)[0].filename);
 const consumer=path.join(temp,'bootstrap');
 await npm(['install','--prefix',consumer,tarball,'--ignore-scripts','--no-audit','--no-fund']);
 const source=path.join(consumer,'node_modules',...pkg.name.split('/'));
 const entry=path.join(source,'bin',name+'.mjs');
 const a=path.join(temp,'host-a'),b=path.join(temp,'host-b');
 const targetArgs=target=>['--agent','unnamed-agent','--target',target];
 await t.test('strict parsing and unmanaged destinations preserve all bytes',async()=>{
  for(const args of [
   ['skill','install'],['skill','install',...targetArgs(a),'--target',a],
   ['skill','install','--agent','INVALID','--target',a],['doctor','--target',a],
  ])assert.notEqual((await cli(entry,...args)).code,0);
  await assert.rejects(fs.lstat(a),{code:'ENOENT'});
  const unmanaged=path.join(temp,'unmanaged');
  await fs.mkdir(unmanaged);
  await fs.writeFile(path.join(unmanaged,'keep.txt'),'user');
  assert.equal((await cli(entry,'skill','install',...targetArgs(unmanaged))).data.error.code,'UNMANAGED_TARGET');
  assert.equal(await fs.readFile(path.join(unmanaged,'keep.txt'),'utf8'),'user');
 });
 await t.test('install, same-version no-op, missing repair, edits and UI metadata',async()=>{
  for(const target of [a,b])assert.equal((await cli(entry,'skill','install',...targetArgs(target))).data.current,true);
  assert.equal((await cli(entry,'skill','install',...targetArgs(a))).data.changed,false);
  assert.equal((await cli(entry,'update','install',...targetArgs(a),'--yes')).data.changed,false);
  const metadata=path.join(a,'agents','openai.yaml');
  await fs.appendFile(metadata,'\n# user UI metadata\n');
  await fs.unlink(path.join(a,'scripts','asset-guide.mjs'));
  assert.equal((await cli(entry,'skill','update',...targetArgs(a))).data.current,true);
  assert.match(await fs.readFile(metadata,'utf8'),/user UI metadata/);
  const skill=path.join(a,'SKILL.md'),original=await fs.readFile(skill);
  await fs.appendFile(skill,'\nuser edit\n');
  assert.equal((await cli(entry,'skill','update',...targetArgs(a))).data.error.code,'LOCAL_EDITS');
  await fs.writeFile(skill,original);
  const lock=a+'.install-lock';
  await fs.mkdir(lock);
  await fs.unlink(path.join(a,'scripts','asset-guide.mjs'));
  assert.equal((await cli(entry,'skill','update',...targetArgs(a))).data.error.code,'LOCKED');
  await fs.rmdir(lock);
  assert.equal((await cli(entry,'skill','update',...targetArgs(a))).data.current,true);
  // Exercise locked-directory replacement with a scoped EBUSY injection.
  await fs.unlink(path.join(a,'scripts','asset-guide.mjs'));
  const probe=path.join(temp,'locked-directory-probe.mjs');
  const coreUrl=pathToFileURL(path.join(source,'lib/core.mjs')).href;
  await fs.writeFile(probe,[
   "import fs from 'node:fs';",
   'import {install} from '+JSON.stringify(coreUrl)+';',
   'const target='+JSON.stringify(a)+';',
   'const rename=fs.renameSync;',
   "fs.renameSync=(from,to)=>{if(from===target)throw Object.assign(new Error('locked directory'),{code:'EBUSY'});return rename(from,to);};",
   "console.log(JSON.stringify(install({agent:'unnamed-agent',target})));",
  ].join('\n'));
  const locked=await execute(probe);
  assert.equal(locked.code,0,locked.stderr);
  assert.equal(JSON.parse(locked.stdout).current,true);
 });
 const runtime=path.join(a,'.runtime','bin',name+'.mjs');
 const own=await cli(runtime,'version');
 assert.equal(own.data.version,pkg.version);
 const candidate=path.join(temp,'new-source');
 await fs.cp(source,candidate,{recursive:true});
 const nextVersion=pkg.version.split('.').map(Number);
 nextVersion[2]++;
 const version=nextVersion.join('.');
 const nextPkg={...pkg,version};
 await fs.writeFile(path.join(candidate,'package.json'),JSON.stringify(nextPkg,null,2)+'\n');
 assert.equal((await execute(path.join(candidate,'scripts','sync-version.mjs'),['--write'])).code,0);
 const next=await npm(['pack',candidate,'--pack-destination',packs,'--ignore-scripts','--json']);
 const nextTarball=path.join(packs,JSON.parse(next.stdout)[0].filename);
 await t.test('real npm update replaces only selected target and binds a new managed runtime',async()=>{
  const result=await cli(runtime,'update','install',...targetArgs(a),'--package-file',nextTarball,'--yes');
  assert.equal(result.code,0,result.stderr);
  assert.equal(result.data.version,version);
  assert.equal((await cli(runtime,'version')).data.version,version);
  assert.equal((await cli(path.join(b,'.runtime','bin',name+'.mjs'),'version')).data.version,pkg.version);
  const status=await cli(runtime,'skill','status',...targetArgs(a));
  assert.equal(status.data.current,true);
  const raw=await fs.readFile(path.join(a,'.product-skill-install.json'),'utf8');
  assert.equal(JSON.parse(raw).version,version);
 });
 await t.test('partial-failure preserves original, same candidate resume avoids new acquisition, rollback preserves history',async()=>{
  const broken=path.join(temp,'broken-source');
  await fs.cp(candidate,broken,{recursive:true});
  await fs.appendFile(path.join(broken,'skills',name,'SKILL.md'),'\ncorrupted after identity snapshot\n');
  const bad=await npm(['pack',broken,'--pack-destination',path.join(temp),'--ignore-scripts','--json']);
  const badTarball=path.join(temp,JSON.parse(bad.stdout)[0].filename);
  const oldRuntime=path.join(b,'.runtime','bin',name+'.mjs');
  const result=await cli(oldRuntime,'update','install',...targetArgs(b),'--package-file',badTarball,'--yes');
  assert.equal(result.data.error.code,'SKILL_SYNC_FAILED');
  assert.equal((await cli(oldRuntime,'version')).data.version,pkg.version);
  const op=(await cli(oldRuntime,'update','operation',...targetArgs(b))).data.operation;
  assert.equal(op.phase,'candidate-ready');
  assert.ok(op.preReplacementBackup);
  const acquired=path.resolve(path.dirname(op.candidateEntry),'..');
  await fs.copyFile(path.join(candidate,'skills',name,'SKILL.md'),path.join(acquired,'skills',name,'SKILL.md'));
  assert.equal((await cli(oldRuntime,'update','resume',...targetArgs(b),'--yes')).data.ok,true);
  assert.equal((await cli(oldRuntime,'version')).data.version,version);
  assert.equal((await cli(oldRuntime,'update','resume',...targetArgs(b),'--yes')).data.synchronization.changed,false);
  const rolled=await cli(oldRuntime,'update','rollback',...targetArgs(b),'--yes');
  assert.equal(rolled.data.rolledBack,true);
  assert.equal((await cli(oldRuntime,'version')).data.version,pkg.version);
  assert.ok((await fs.stat(op.transaction)).isDirectory());
 });
 await t.test('deleting bootstrap and sibling leaves a functional isolated runtime',async()=>{
  const isolated=path.join(a,'.runtime','bin',name+'.mjs');
  await fs.rm(consumer,{recursive:true,force:true});
  await fs.rm(b,{recursive:true,force:true});
  assert.equal((await cli(isolated,'doctor')).data.local_ready,true);
  assert.equal((await cli(isolated,'skill','source')).data.sources[0].name,name);
  assert.equal((await cli(isolated,'skill','status',...targetArgs(a))).data.current,true);
  const aa=await fs.stat(path.join(a,'scripts','asset-guide.mjs'));
  const bb=await fs.stat(path.join(a,'.runtime','skills',name,'scripts','asset-guide.mjs'));
  if(process.platform!=='win32')assert.notEqual(aa.ino,bb.ino);
  const parent=path.join(temp,'parent-owned');
  assert.equal((await cli(isolated,'skill','install',...targetArgs(parent),'--owner','collection')).data.current,true);
  const parentEntry=path.join(parent,'.runtime','bin',name+'.mjs');
  assert.equal((await cli(parentEntry,'prepare')).data.update.owner,'collection');
  assert.equal((await cli(parentEntry,'update','install',...targetArgs(parent),'--yes')).data.error.code,'PARENT_MANAGED');
  const oldGuide=process.env.PRODUCT_SKILL_TEST_GUIDE;
  if(oldGuide)assert.equal((await cli(isolated,'asset','check','--guide',oldGuide)).data.ok,true);
 });
});
test('automatic detection cache, offline backoff, opt-out and parent ownership',async t=>{
 const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'product-skill-updates-')));
 t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 let requests=0;
 const server=http.createServer((req,res)=>{requests++;res.setHeader('content-type','application/json');res.end(JSON.stringify({name:pkg.name,version:'0.9.0'}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const env={AGENT_PACKAGE_UPDATE_CHECK:'1',PRODUCT_SKILL_REGISTRY_URL:'http://127.0.0.1:'+server.address().port};
 const entry=path.join(root,'bin',name+'.mjs'),args=['prepare','--state-dir',temp,'--json'];
 const prepare=async()=>JSON.parse((await execute(entry,args,env)).stdout);
 assert.equal((await prepare()).update.available,true);
 assert.equal((await prepare()).update.cached,true);
 assert.equal(requests,1);
 const readOnly=await execute(entry,['update','check','--state-dir',temp,'--json'],env);
 assert.equal(JSON.parse(readOnly.stdout).available,true);
 assert.equal(requests,2);
 const cache=path.join(temp,'update-cache.json');
 const cached=JSON.parse(await fs.readFile(cache,'utf8'));
 cached.checkedAt=0;
 await fs.writeFile(cache,JSON.stringify(cached));
 assert.equal((await prepare()).update.cached,undefined);
 assert.equal(requests,3);
 await fs.mkdir(path.join(temp,'update-check-lock'));
 cached.checkedAt=0;
 await fs.writeFile(cache,JSON.stringify(cached));
 assert.equal((await prepare()).update.reason,'concurrent-check');
 await fs.rmdir(path.join(temp,'update-check-lock'));
 const offline={...env,PRODUCT_SKILL_REGISTRY_URL:'http://127.0.0.1:1'};
 const failed=JSON.parse((await execute(entry,args,offline)).stdout);
 assert.equal(failed.update.code,'REGISTRY_UNAVAILABLE');
 const backedOff=JSON.parse((await execute(entry,args,offline)).stdout);
 assert.equal(backedOff.update.cached,true);
 await fs.writeFile(path.join(temp,'update-cache.json'),'{bad');
 assert.equal((await prepare()).update.code,'INVALID_CACHE');
 assert.equal(await fs.readFile(path.join(temp,'update-cache.json'),'utf8'),'{bad');
 const disabled=JSON.parse((await execute(entry,args,{...env,AGENT_PACKAGE_UPDATE_CHECK:'0'})).stdout);
 assert.equal(disabled.update.disabled,true);
});
