import path from 'node:path';
import {spawnSync} from 'node:child_process';
import * as core from './core.mjs';

export async function main(args) {
  const words=[],options={};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--version'){words.push('version');continue;}
    if(!arg.startsWith('--')){words.push(arg);continue;}
    const key=arg.slice(2);
    if(Object.hasOwn(options,key))core.fail('INVALID_ARGUMENT','Duplicate option: '+arg);
    if(['json','yes','help'].includes(key))options[key]=true;
    else {
      if(!args[i+1]||args[i+1].startsWith('--'))core.fail('INVALID_ARGUMENT','Missing value for '+arg);
      options[key]=args[++i];
    }
  }
  const command=words.join(' ')||'help';
  const manifest=core.readJSON(path.join(core.root,'capabilities.json'));
  const contract=manifest.commandContracts[command];
  if(!contract)core.fail('INVALID_ARGUMENT','Unknown command: '+command);
  for(const key of Object.keys(options))if(!Object.hasOwn(contract.options,'--'+key))core.fail('INVALID_ARGUMENT','Unsupported option --'+key);
  if(options.name&&options.name!==core.name)core.fail('SKILL_NOT_FOUND',options.name);
  let result;
  if(command==='help'||options.help)result={...manifest,commands:manifest.commandContracts,options:contract.options};
  else if(command==='version')result={ok:true,package:core.pkg.name,version:core.pkg.version};
  else if(command==='capabilities')result=manifest;
  else if(command==='install-notice')result={ok:true,partial:true,message:'Read INSTALL.md and UPDATE.md. Resolve skill source, install the complete Skill and runtime into the current Agent’s explicit directory, and verify host discovery.'};
  else if(command==='doctor')result=core.doctor();
  else if(command==='prepare')result={...core.doctor(),update:await core.checkUpdate(options,true)};
  else if(command==='skill source'){
    const item={ok:true,name:core.name,package:core.pkg.name,version:core.pkg.version,source:core.source,path:core.source};
    result={...manifest,...item,complete:true,sources:[item],provenance:{ownership:core.exists(path.join(core.root,'.git'))?'git-source':'package',registryContentVerified:false}};
  }else if(command==='skill status')result=core.status(options);
  else if(command==='skill install'||command==='skill update')result=core.install(options);
  else if(command==='update check')result=await core.checkUpdate(options);
  else if(command==='update status'||command==='update policy')result=core.updatePolicy(options);
  else if(command==='update operation')result=core.updateOperation(options);
  else if(command==='update resume')result=core.resume(options);
  else if(command==='update rollback')result=core.rollback(options);
  else if(command==='update install')result=await core.update(options);
  else if(command==='asset check'||command==='asset write'){
    const required=command==='asset check'?['guide']:['directory','plan'];
    for(const field of required)if(!options[field])core.fail('INVALID_ARGUMENT','Missing --'+field);
    const operation=command==='asset check'?['check',options.guide]:['write',options.directory,options.plan];
    const child=spawnSync(process.execPath,[path.join(core.source,'scripts/asset-guide.mjs'),...operation],{encoding:'utf8',timeout:30000,windowsHide:true});
    try{result=JSON.parse(child.stdout||child.stderr);}catch{core.fail('ASSET_OPERATION_FAILED','Asset tool returned no structured result');}
    if(child.status!==0)process.exitCode=1;
  }
  process.stdout.write(command==='version'&&!options.json?core.pkg.version+'\n':JSON.stringify(result,null,2)+'\n');
  if(result?.ok===false)process.exitCode=1;
}
