import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

for(const name of ["knoop-bank-v1.1","knoop-bank-v1","knoop-backup-v1"]){
const schemaPath = resolve(`docs/interface-specs/schemas/${name}.schema.json`);
const outputPath = resolve(`src/generated/${name}-validator.js`);
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false, code: { source: true, esm: true } });
const validate = ajv.compile(schema);
let output = standaloneCode(ajv, validate);
output = output.replace(/const (\w+) = require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/g, 'const $1 = (value) => Array.from(value).length;');
if (output.includes("require(") || output.includes("new Function")) throw new Error("Generated validator is not CSP compatible");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, output + "\n", "utf8");
writeFileSync(outputPath.replace(/\.js$/,'.d.ts'), 'interface ValidationIssue { instancePath: string; message?: string; keyword: string; params: Record<string, string> }\ndeclare const validate: ((data: unknown) => boolean) & { errors?: ValidationIssue[] | null };\nexport default validate;\n', "utf8");
}
