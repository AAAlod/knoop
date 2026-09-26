import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?=[A-Z]:)/, '');
const read = (path) => readFileSync(join(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const failures = [];
const assert = (ok, message) => { if (!ok) failures.push(message); };
const pkg = json('package.json');
const lock = json('package-lock.json');
const tauri = json('src-tauri/tauri.conf.json');
const cargo = read('src-tauri/Cargo.toml');
const gradle = read('src-tauri/gen/android/app/build.gradle.kts');
assert(pkg.name === 'knoop' && /^\d+\.\d+\.\d+$/.test(pkg.version), 'package identity');
assert(lock.name === pkg.name && lock.version === pkg.version && lock.packages?.['']?.version === pkg.version, 'lockfile identity');
assert(tauri.productName === 'Knoop' && tauri.identifier === 'com.kehai.knoop' && tauri.version === pkg.version, 'Tauri identity');
assert(/name\s*=\s*"knoop"/.test(cargo) && /name\s*=\s*"knoop_lib"/.test(cargo), 'Rust identity');
assert(cargo.includes('version = "' + pkg.version + '"'), 'Cargo version');
const tauriProperties = read('src-tauri/gen/android/app/tauri.properties');
assert(tauriProperties.includes('tauri.android.versionName=' + pkg.version), 'Android versionName');
for (const setting of ['strip = true', 'lto = true', 'opt-level = "z"', 'codegen-units = 1', 'panic = "unwind"']) assert(cargo.includes(setting), `Release profile: ${setting}`);
assert(gradle.includes('applicationId = "com.kehai.knoop"'), 'Android applicationId');
assert(read('src/db.ts').includes('sqlite:knoop.db'), 'SQLite filename');
assert(!JSON.stringify(tauri.app.security.csp).includes('unsafe-eval'), 'CSP unsafe-eval');

const ignored = new Set(['.git', '.tools', '.local-workflow', 'artifacts', 'node_modules', 'dist', 'target', '.gradle', 'build']);
const oldStem = String.fromCharCode(109, 105, 110, 105, 109, 97, 108);
const oldNames = [oldStem, String.fromCharCode(36855, 31616, 21047, 39064, 22120)];
const forbiddenFiles = /(?:\.apk|\.aab|\.jks|\.keystore|\.db|\.sqlite|\.sqlite3|\.bak|\.tmp|\.zip|\.so)$/i;
const textFiles = /\.(?:ts|tsx|js|mjs|json|md|toml|rs|kt|kts|xml|pro|properties|gradle|html|css|ps1)$/i;
function scan(dir) {
  for (const name of readdirSync(dir)) {
    if (ignored.has(name)) continue;
    const path = join(dir, name);
    const rel = relative(root, path).split(sep).join('/');
    if (rel.startsWith('src-tauri/gen/schemas/') || (rel.includes('/jniLibs/') && rel.endsWith('.so'))) continue;
    if (oldNames.some(x => rel.toLowerCase().includes(x))) failures.push(`old filename: ${rel}`);
    if (statSync(path).isDirectory()) { scan(path); continue; }
    if (forbiddenFiles.test(name) || name === 'local.properties' || name.startsWith('.env')) failures.push(`private/build file: ${rel}`);
    const bytes = readFileSync(path);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) failures.push(`UTF-8 BOM: ${rel}`);
    if (textFiles.test(name)) {
      const value = bytes.toString('utf8').toLowerCase();
      if (oldNames.some(x => value.includes(x))) failures.push(`old naming: ${rel}`);
      if (/(?:[a-z]:\\\\|[a-z]:\\)[^\s'"`]+/i.test(value)) failures.push(`absolute Windows path: ${rel}`);
    }
  }
}
scan(root);
const formats = new Set(['knoop-bank', 'knoop-bundle', 'knoop-error-review', 'knoop-repair-review']);
for (const format of formats) {
  assert(read('src/types.ts').includes('"' + format + '"'), 'TypeScript format: ' + format);
  assert(read('src/db.ts').includes('"' + format + '"'), 'Runtime format: ' + format);
}
const schemaForExample = new Map([
  ['sample-bank.json', 'knoop-bank-v1.1.schema.json'],
  ['sample-bundle.json', 'knoop-bundle-v1.schema.json'],
  ['sample-error-review.json', 'knoop-error-review-v1.1.schema.json'],
  ['sample-repair-review.json', 'knoop-repair-review-v1.1.schema.json'],
]);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const name of readdirSync(join(root, 'examples')).filter(x => x.endsWith('.json'))) {
  const example = json(`examples/${name}`);
  assert(formats.has(example.format), `example format: ${name}`);
  const schemaName = schemaForExample.get(name);
  assert(schemaName, `unmapped example: ${name}`);
  if (schemaName) {
    const validate = ajv.compile(json(`docs/interface-specs/schemas/${schemaName}`));
    assert(validate(example), `schema mismatch: ${name} ${ajv.errorsText(validate.errors)}`);
  }
}
for (const name of readdirSync(join(root, 'docs/interface-specs/schemas')).filter(x => x.endsWith('.json'))) {
  const schema = json(`docs/interface-specs/schemas/${name}`);
  assert(schema.$schema && schema.title?.startsWith('Knoop'), `schema identity: ${name}`);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log('Repository check passed.');
