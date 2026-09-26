import validateSchema from "./generated/knoop-bank-v1.1-validator.js";
import { validateBank } from "./db";
import type { BankFile, ErrorReviewFile } from "./types";

export type WrongReviewItem = ErrorReviewFile["items"][number];

const typeAliases: Record<string, "single_choice" | "multiple_choice" | "blank"> = {
  single: "single_choice",
  singleChoice: "single_choice",
  "single-choice": "single_choice",
  multiple: "multiple_choice",
  multipleChoice: "multiple_choice",
  "multiple-choice": "multiple_choice",
  fillBlank: "blank",
  fill_blank: "blank",
  "fill-in-the-blank": "blank",
};

function normalizeQuestionFormats(raw: unknown): void {
  if (!raw || typeof raw !== "object" || !("questions" in raw) || !Array.isArray(raw.questions)) return;
  for (const value of raw.questions) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const question = value as Record<string, unknown>;
    if (typeof question.type === "string" && Object.hasOwn(typeAliases, question.type)) question.type = typeAliases[question.type];
    if ((question.type === "single_choice" || question.type === "blank")
      && Array.isArray(question.answer) && question.answer.length === 1 && typeof question.answer[0] === "string") {
      question.answer = question.answer[0];
    }
    if (question.type === "multiple_choice" && typeof question.answer === "string") {
      question.answer = [question.answer];
    }
  }
}

function questionFormatError(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || !("questions" in raw) || !Array.isArray(raw.questions)) return null;
  for (const [index, value] of raw.questions.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const question = value as Record<string, unknown>;
    const label = `第 ${index + 1} 道候选题`;
    if (typeof question.type === "string" && !["single_choice", "multiple_choice", "blank"].includes(question.type)) {
      return `${label}题型无效：${question.type}；只支持单选、多选和填空`;
    }
    if ((question.type === "single_choice" || question.type === "blank") && typeof question.answer !== "string") {
      return `${label}的 answer 必须是字符串；单选填选项 ID，填空填答案文字`;
    }
    if (question.type === "multiple_choice" && (!Array.isArray(question.answer) || question.answer.some(answer => typeof answer !== "string"))) {
      return `${label}的 answer 必须是选项 ID 字符串数组`;
    }
  }
  return null;
}

export function parseAiReviewBank(
  responseText: string,
  original: WrongReviewItem,
  existingQuestionIds: Set<string>,
): BankFile {
  let raw: unknown;
  try {
    raw = JSON.parse(responseText);
  } catch {
    throw new Error("AI 返回结果不是有效 JSON；请重新生成");
  }
  normalizeQuestionFormats(raw);
  if (!validateSchema(raw)) {
    const detail = questionFormatError(raw);
    const issue = validateSchema.errors?.[0];
    throw new Error(detail ?? `AI 返回结果不符合 Knoop 题库规范：${issue?.instancePath || "根节点"} ${issue?.message || "结构错误"}`);
  }
  const bank = validateBank(raw);
  if (bank.version !== "1.1" || bank.import.mode !== "new" || bank.import.bankId !== "knoop-ai-preview" || bank.import.bankTitle !== "AI 临时回炉") {
    throw new Error("AI 返回了不符合预览要求的题库信息");
  }
  if (bank.nodes.length !== 1 || bank.nodes[0].id !== "review" || bank.nodes[0].parentId !== null || bank.nodes[0].title !== "AI 回炉") {
    throw new Error("AI 返回了不符合预览要求的节点");
  }
  if (bank.questions.length !== 2) {
    throw new Error("AI 应返回 2 道变式题");
  }
  const fingerprint = (question: typeof bank.questions[number]) => JSON.stringify({
    stem: (question.stem ?? "").trim().replace(/\s+/g, " "),
    options: question.options,
    answer: question.answer,
  });
  const originalFingerprint = fingerprint(original.question);
  const seenContent = new Set<string>();
  for (const question of bank.questions) {
    if (question.nodeId !== "review" || !["single_choice", "multiple_choice", "blank"].includes(question.type)) {
      throw new Error(`题目 ${question.id} 的节点或题型不适合回炉`);
    }
    if (question.id === original.question.id || existingQuestionIds.has(question.id)) {
      throw new Error(`题目 ID 已存在或与原题相同：${question.id}`);
    }
    if ("source" in question) {
      throw new Error(`题目 ${question.id} 不得声称未经验证的来源`);
    }
    if (!question.explanation?.trim()) {
      throw new Error(`题目 ${question.id} 缺少解析`);
    }
    if (question.type === "blank" && !String(question.answer ?? "").trim()) {
      throw new Error(`题目 ${question.id} 缺少填空答案`);
    }
    const content = fingerprint(question);
    if (content === originalFingerprint) {
      throw new Error(`题目 ${question.id} 与原题完全相同`);
    }
    if (seenContent.has(content)) {
      throw new Error(`题目 ${question.id} 与另一道候选题重复`);
    }
    seenContent.add(content);
  }
  return bank;
}
