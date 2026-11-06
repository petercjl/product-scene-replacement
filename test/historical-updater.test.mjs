// Published 0.1.1 has no archived updater entry. Verify the historical-mode
// migration using the actual published bytes and real npm, with a true backup.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const name=pkg.name.split('/')[1];

test('published binless historical-mode migration preserves original resources',async t=>{
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'historical-product-skill-')));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const old=path.join(dir,'old-package');
 const installed=spawnSync(process.execPath,[process.env.npm_execpath,'install','--prefix',old,pkg.name+'@0.1.1','--ignore-scripts','--no-audit','--no-fund'],{encoding:'utf8',timeout:120000,windowsHide:true});
 assert.equal(installed.status,0,installed.stderr);
 const publicRoot=path.join(old,'node_modules',...pkg.name.split('/'));
 const publicPkg=JSON.parse(await fs.readFile(path.join(publicRoot,'package.json'),'utf8'));
 assert.equal(publicPkg.version,'0.1.1');
 assert.equal(publicPkg.bin,undefined,'There was no published management updater to replay');
 const target=path.join(dir,'skill');
 await fs.cp(path.join(publicRoot,'skills',name),target,{recursive:true});
 const before=await fs.readFile(path.join(target,'SKILL.md'));
 const entry=path.join(root,'bin',name+'.mjs');
 const invoke=()=>spawnSync(process.execPath,[entry,'skill','install','--agent','generic-host','--target',target,'--json'],{encoding:'utf8',windowsHide:true});
 assert.equal(JSON.parse(invoke().stderr).error.code,'UNMANAGED_TARGET');
 const backup=path.join(dir,'verified-backup');
 await fs.rename(target,backup);
 assert.deepEqual(await fs.readFile(path.join(backup,'SKILL.md')),before);
 const migrated=invoke();
 assert.equal(migrated.status,0,migrated.stderr);
 const runtime=path.join(target,'.runtime','bin',name+'.mjs');
 const result=spawnSync(process.execPath,[runtime,'doctor','--json'],{encoding:'utf8',windowsHide:true});
 assert.equal(JSON.parse(result.stdout).local_ready,true);
 assert.deepEqual(await fs.readFile(path.join(backup,'SKILL.md')),before);
});
