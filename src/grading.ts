import type { QuestionInput } from "./types";

export function gradeQuestion(question: QuestionInput, answer: string | string[]): boolean | null {
  if (question.type === "single_choice") return Array.isArray(answer) && answer.length === 1 && answer[0] === question.answer;
  if (question.type === "multiple_choice") {
    if (!Array.isArray(answer)) return false;
    const expected = question.answer as string[];
    return answer.length === expected.length && new Set(answer).size === answer.length && answer.every(id => expected.includes(id));
  }
  if (question.type === "blank") return typeof answer === "string" && answer === question.answer ? true : null;
  return null;
}
