import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/compat.ts'], bundle: true, write: false, format: 'cjs', target: 'chrome83' });
const sandbox = {
  module: { exports: {} },
  crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
};
runInNewContext(result.outputFiles[0].text, sandbox);
const { createUuid, cloneJson } = sandbox.module.exports;
const ids = Array.from({ length: 1000 }, () => createUuid());
assert(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
assert.equal(new Set(ids).size, ids.length);
const original = { tables: { questions: [{ text: '墨水屏', value: null, correct: true }] }, preferences: ['A', 'C'] };
const snapshot = cloneJson(original);
assert.equal(JSON.stringify(snapshot), JSON.stringify(original));
original.tables.questions[0].text = 'changed';
original.preferences.push('B');
assert.equal(snapshot.tables.questions[0].text, '墨水屏');
assert.equal(snapshot.preferences.length, 2);
console.log('PASS: secure UUIDs and independent JSON snapshots without randomUUID or structuredClone');
