import {spawnSync} from 'node:child_process';

// Run isolated suites serially so their SQLite adapters and browser evidence stay separate.
const suites=['test-review-ui.mjs','test-eink-ui.mjs','test-eink-layout.mjs','test-eink-bottom.mjs','test-eink-search.mjs','test-eink-reading.mjs','test-eink-paging.mjs','test-eink-feedback.mjs','test-eink-updates.mjs','test-eink-native.mjs'];
for(const suite of suites){
  const result=spawnSync(process.execPath,[`scripts/${suite}`],{stdio:'inherit',windowsHide:true});
  if(result.error){console.error(result.error.message);process.exit(1);}
  if(result.status!==0)process.exit(result.status||1);
}
