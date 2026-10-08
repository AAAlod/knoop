import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const baseline=process.argv.includes('--baseline');
const source=(baseline?execFileSync('git',['-c',`safe.directory=${process.cwd().replaceAll('\\','/')}`,'show','ab17b38:scripts/build-android-release.ps1'],{encoding:'utf8'}):await readFile('scripts/build-android-release.ps1','utf8')).replaceAll('\r\n','\n');
const block=source.slice(source.indexOf('\nif ($Keystore) {'),source.indexOf('\n\n$apk ='));
assert(block.startsWith('\nif ($Keystore) {'));
const dir=await mkdtemp(join(tmpdir(),'knoop-sign-probe-')),results=[];
try {
  for(const mode of ['normal','failure','interrupt']){
    const caseDir=join(dir,mode);await mkdir(caseDir);await writeFile(join(caseDir,'synthetic.jks'),'mock, not a real signing key');
    const script=`$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$artifacts=$PSScriptRoot
$Keystore=Join-Path $PSScriptRoot 'synthetic.jks'
$KeyAlias='synthetic-alias'
$KeystorePasswordEnv='KNOOP_SIGN_PROBE_PASSWORD'
$apksigner='mock-signer'
$aligned='mock-unsigned.apk'
$version='probe'
$mode='${mode}'
function Invoke-Checked([string]$Program,[string[]]$Arguments){
  if($Arguments[0] -eq 'sign'){
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'arguments.json'),(ConvertTo-Json -InputObject $Arguments -Compress))
    if($mode -eq 'failure'){throw 'synthetic signing failure'}
    if($mode -eq 'interrupt'){while($true){Start-Sleep -Milliseconds 20}}
  }
}
${block}
`;
    const path=join(caseDir,'worker.ps1');await writeFile(path,script);
    const child=spawn('pwsh',['-NoProfile','-File',path],{env:{...process.env,KNOOP_SIGN_PROBE_PASSWORD:'synthetic-password-probe-only'},stdio:['ignore','pipe','pipe'],windowsHide:true});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);const finished=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code));});
    if(mode==='interrupt'){let found=false;for(let i=0;i<200;i++){try{await readFile(join(caseDir,'arguments.json'));found=true;break;}catch{await delay(20);}}if(!found){child.kill('SIGKILL');await finished;throw Error('mock signer did not start');}child.kill('SIGKILL');}
    const code=await finished;if(mode==='normal')assert.equal(code,0);if(mode==='failure')assert.notEqual(code,0);
    const args=JSON.parse(await readFile(join(caseDir,'arguments.json'),'utf8'));let left=false;try{await readFile(join(caseDir,'.signing-password.tmp'));left=true;}catch{}
    assert(!output.includes('synthetic-password-probe-only'),'password leaked in logs');
    const pass=args[args.indexOf('--ks-pass')+1];results.push({mode,exitCode:code,passwordFileRemains:left,transport:pass.startsWith('env:')?'environment':'file'});
    if(!baseline){assert.equal(left,false);assert.equal(pass,'env:KNOOP_SIGN_PROBE_PASSWORD');}
  }
  if(baseline)assert.equal(results.find(x=>x.mode==='interrupt').passwordFileRemains,true,'baseline risk not reproduced');
  await mkdir('artifacts/review-f',{recursive:true});await writeFile(`artifacts/review-f/signing-${baseline?'baseline':'regression'}.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{const resolved=join(tmpdir(),'knoop-sign-probe-');assert(dir.startsWith(resolved));await rm(dir,{recursive:true,force:true});}
