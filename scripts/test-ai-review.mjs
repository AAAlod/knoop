import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { build as viteBuild } from "vite";

const bundle = await build({
  entryPoints: ["src/ai-review.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  logLevel: "silent",
});
const dir = await mkdtemp(join(tmpdir(), "knoop-ai-test-"));
try {
  const file = join(dir, "ai-review.cjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const originalFunction = globalThis.Function;
  globalThis.Function = function () { throw new Error("CSP blocks unsafe-eval"); };
  let parseAiReviewBank;
  try {
    ({ parseAiReviewBank } = createRequire(import.meta.url)(file));
  } finally {
    globalThis.Function = originalFunction;
  }
  const original = { question: { id: "original", stem: "原题" } };
  const question = (id, stem) => ({
    id, nodeId: "review", type: "single_choice", order: 0, stem,
    options: [{ id: "A", text: "正确" }, { id: "B", text: "错误" }],
    answer: "A", explanation: "根据题干可判断。",
  });
  const bank = () => ({
    format: "knoop-bank", version: "1.1",
    import: { mode: "new", bankId: "knoop-ai-preview", bankTitle: "AI 临时回炉" },
    nodes: [{ id: "review", parentId: null, title: "AI 回炉", order: 0 }],
    questions: [question("variation-1", "变式一"), question("variation-2", "变式二")],
  });
  const browserBundle = await build({
    entryPoints: ["src/ai-review.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const browserFile = join(dir, "ai-review-browser.mjs");
  await writeFile(browserFile, browserBundle.outputFiles[0].contents);
  const { parseAiReviewBank: parseInBrowser } = await import(pathToFileURL(browserFile).href);
  await viteBuild({
    configFile: false,
    logLevel: "silent",
    build: {
      lib: { entry: "src/generated/knoop-bank-v1.1-validator.js", formats: ["es"], fileName: () => "validator.mjs" },
      outDir: dir,
      emptyOutDir: false,
      minify: true,
    },
  });
  const { default: validateInVite } = await import(pathToFileURL(join(dir, "validator.mjs")).href);
  assert.equal(validateInVite(bank()), true, "Vite output must call the generated string length helper");
  assert.equal(parseInBrowser(JSON.stringify(bank()), original, new Set()).questions.length, 2);
  assert.equal(parseAiReviewBank(JSON.stringify(bank()), original, new Set()).questions.length, 2);
  const singleAlias = bank(); singleAlias.questions[0].type = "single-choice"; singleAlias.questions[0].answer = ["A"];
  assert.equal(parseAiReviewBank(JSON.stringify(singleAlias), original, new Set()).questions[0].answer, "A");
  const multipleAlias = bank(); multipleAlias.questions[0].type = "multipleChoice";
  assert.deepEqual(parseAiReviewBank(JSON.stringify(multipleAlias), original, new Set()).questions[0].answer, ["A"]);
  const blankAlias = bank(); blankAlias.questions[0].type = "fill_blank";
  delete blankAlias.questions[0].options; blankAlias.questions[0].answer = ["填空答案"];
  assert.equal(parseAiReviewBank(JSON.stringify(blankAlias), original, new Set()).questions[0].answer, "填空答案");
  const ambiguousAnswer = bank(); ambiguousAnswer.questions[0].answer = ["A", "B"];
  assert.throws(() => parseAiReviewBank(JSON.stringify(ambiguousAnswer), original, new Set()), /第 1 道候选题的 answer 必须是字符串/);
  const unknownType = bank(); unknownType.questions[1].type = "choice";
  assert.throws(() => parseAiReviewBank(JSON.stringify(unknownType), original, new Set()), /第 2 道候选题题型无效/);
  assert.throws(() => parseAiReviewBank("not json", original, new Set()), /不是有效 JSON/);
  const wrongAnswer = bank(); wrongAnswer.questions[0].answer = "Z";
  assert.throws(() => parseAiReviewBank(JSON.stringify(wrongAnswer), original, new Set()), /答案不是有效选项/);
  const source = bank(); source.questions[0].source = { page: 1 };
  assert.throws(() => parseAiReviewBank(JSON.stringify(source), original, new Set()), /不得声称/);
  const sameId = bank(); sameId.questions[0].id = "original";
  assert.throws(() => parseAiReviewBank(JSON.stringify(sameId), original, new Set()), /与原题相同/);
  assert.throws(() => parseAiReviewBank(JSON.stringify(bank()), original, new Set(["variation-1"])), /已存在/);
  console.log("AI review validation cases passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
