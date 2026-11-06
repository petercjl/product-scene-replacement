import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const name=pkg.name.split('/')[1];
function inventory(dir,prefix=''){
 return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(item=>{
  const rel=path.posix.join(prefix,item.name),file=path.join(dir,item.name);
  if(item.isDirectory())return inventory(file,rel);
  if(!item.isFile())throw Error('Only physical resources are distributable: '+file);
  return [rel];
 });
}
const resources=['package.json','capabilities.json','README.md','INSTALL.md','UPDATE.md','THIRD_PARTY_NOTICES.md',...['bin','lib','skills'].flatMap(dir=>inventory(path.join(root,dir)).map(file=>dir+'/'+file))];
if(process.argv.includes('--write')){
 const capFile=path.join(root,'capabilities.json');
 const cap=JSON.parse(fs.readFileSync(capFile,'utf8'));
 cap.version=pkg.version;
 fs.writeFileSync(capFile,JSON.stringify(cap,null,2)+'\n');
 const skill=path.join(root,'skills',name);
 fs.writeFileSync(path.join(skill,'package.json'),JSON.stringify({name,version:pkg.version,package:pkg.name},null,2)+'\n');
 const file=path.join(skill,'SKILL.md');
 const text=fs.readFileSync(file,'utf8');
 const frontmatter='metadata:\n  package: "'+pkg.name+'"\n  version: "'+pkg.version+'"\n';
 fs.writeFileSync(file,text.replace(/\n(?:metadata:\n  package: .*\n  version: .*\n)?---\n/, '\n'+frontmatter+'---\n'));
 const actual=[...new Set([...resources,'skills/'+name+'/package.json'])].sort();
 const hashes=Object.fromEntries(actual.map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
 fs.writeFileSync(path.join(root,'skill-integrity.json'),JSON.stringify(hashes,null,2)+'\n');
}else{
 const cap=JSON.parse(fs.readFileSync(path.join(root,'capabilities.json'),'utf8'));
 const nested=JSON.parse(fs.readFileSync(path.join(root,'skills',name,'package.json'),'utf8'));
 if(cap.package!==pkg.name||cap.version!==pkg.version||nested.version!==pkg.version||nested.package!==pkg.name)throw Error('Release identity mismatch');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'skill-integrity.json'),'utf8'));
 const actual=[...new Set(resources)].sort();
 if(JSON.stringify(Object.keys(manifest).sort())!==JSON.stringify(actual))throw Error('Integrity scope drift');
 for(const file of actual)if(manifest[file]!==createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'))throw Error('Release integrity drift: '+file);
}
