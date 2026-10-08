import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';
const result=await build({entryPoints:['src/backup-format.ts'],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
const module={exports:{}};new Function('module','exports',result.outputFiles[0].text)(module,module.exports);
const {backupTables,preferenceKeys}=module.exports;
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const fields={text:{type:'string'},nullableText:{type:['string','null']},integer:{type:'integer',minimum:Number.MIN_SAFE_INTEGER,maximum:Number.MAX_SAFE_INTEGER},unsigned:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},positive:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},flag:{enum:[0,1]}};
const tables=Object.fromEntries(Object.entries(backupTables).map(([name,columns])=>[name,{type:'array',items:object(Object.fromEntries(Object.entries(columns).map(([column,kind])=>[column,fields[kind]])))}]));
const schema={
  $schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://knoop.local/schemas/knoop-backup-v1.schema.json',title:'Knoop Backup 1.0',
  ...object({format:{const:'knoop-backup'},version:{const:'1.0'},appVersion:{type:'string',pattern:'^\\d+\\.\\d+\\.\\d+$'},exportedAt:{type:'string',minLength:1},tables:object(tables),counts:object(Object.fromEntries(Object.keys(tables).map(name=>[name,fields.unsigned]))),sequences:object({attempts:fields.unsigned,question_answer_revisions:fields.unsigned}),preferences:object(Object.fromEntries(preferenceKeys.map(key=>[key,fields.nullableText]))),integrity:object({algorithm:{const:'SHA-256'},digest:{type:'string',pattern:'^[0-9a-f]{64}$'}})})
};
writeFileSync('docs/interface-specs/schemas/knoop-backup-v1.schema.json',JSON.stringify(schema,null,2)+'\n');
