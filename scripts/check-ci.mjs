import {spawnSync} from 'node:child_process';
export const checks=['build','check:repo','test:ai','test:temp','test:batch','test:review-a','test:review-b','test:review-c'];
for(const check of checks){
  const result=process.platform==='win32'?spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`npm run ${check}`],{stdio:'inherit',windowsHide:true}):spawnSync('npm',['run',check],{stdio:'inherit'});
  if(result.error){console.error(result.error.message);process.exit(1);}if(result.status!==0)process.exit(result.status||1);
}
