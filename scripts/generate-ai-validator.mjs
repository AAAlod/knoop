import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

const schemaPath = resolve("docs/interface-specs/schemas/knoop-bank-v1.1.schema.json");
const outputPath = resolve("src/generated/knoop-bank-v1.1-validator.js");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false, code: { source: true, esm: true } });
const validate = ajv.compile(schema);
let output = standaloneCode(ajv, validate);
const runtimeHelper = 'const func1 = require("ajv/dist/runtime/ucs2length").default;';
if (!output.includes(runtimeHelper)) throw new Error("Generated validator runtime helper changed");
output = output.replace(runtimeHelper, 'const func1 = (value) => Array.from(value).length;');
if (output.includes("require(") || output.includes("new Function")) throw new Error("Generated validator is not CSP compatible");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, output + "\n", "utf8");
