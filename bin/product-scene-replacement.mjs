#!/usr/bin/env node
import {main} from '../lib/cli.mjs';
main(process.argv.slice(2)).catch(error=>{
  process.stderr.write(JSON.stringify({ok:false,error:{code:error.code??'INTERNAL_ERROR',message:error.message,...error.details}})+'\n');
  process.exitCode=1;
});
