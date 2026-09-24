export type QuestionType = "single_choice" | "multiple_choice" | "blank" | "recall" | "memorization";

export interface Option { id: string; text: string }
export interface QuestionInput {
  id: string;
  nodeId: string;
  type: QuestionType;
  order: number;
  stem?: string;
  options?: Option[];
  answer?: string | string[];
  front?: string;
  back?: string;
  prompt?: string;
  content?: string;
  keyPoints?: string[];
  explanation?: string;
  tags?: string[];
  source?: unknown;
}
export interface NodeInput { id: string; parentId: string | null; title: string; order: number }
export interface BankFile {
  format: "knoop-bank";
  version: "1.0" | "1.1";
  import: { mode: "new" | "merge"; bankId: string; bankTitle: string };
  nodes: NodeInput[];
  questions: QuestionInput[];
}
export interface BankRow { id: string; title: string; created_at: string; updated_at: string }

export interface BankBundleFile {
  format: "knoop-bundle";
  version: "1.0";
  exportedAt: string;
  banks: BankFile[];
}
export interface NodeRow { id: string; external_id: string; bank_id: string; parent_id: string | null; title: string; sort_order: number }
export interface QuestionRow { id: string; external_id: string; bank_id: string; node_id: string; type: QuestionType; sort_order: number; content_json: string }
export interface SessionRow { id: string; mode: string; scope_json: string; question_ids_json: string; current_index: number; state_json: string; completed_at: string | null }

export interface AiGuidance {
  purpose: string;
  firstStep: string;
  output: string;
}

export interface ErrorReviewFile {
  format: "knoop-error-review";
  version: "1.1";
  exportedAt: string;
  aiGuidance: AiGuidance;
  scope: { type: "current_wrong_questions" };
  items: Array<{
    bank: { id: string; title: string };
    node: { id: string; title: string; path: string[] };
    question: QuestionInput;
    error: {
      latestWrongAttempt: { answeredAt: string; userAnswer: string | string[]; gradingMode: string };
      correctAnswer: string | string[];
      choiceDiff?: { wrongSelected: string[]; missedCorrect: string[] };
      history: { attemptCount: number; wrongCount: number };
    };
  }>;
}


export type ReviewIssue = "stem" | "options" | "answer" | "explanation" | "other";
export interface ReviewRow {
  question_id: string;
  issues_json: string;
  note: string;
  question_snapshot_json: string;
  was_killed_before: number;
  created_at: string;
  updated_at: string;
}

export interface RepairReviewFile {
  format: "knoop-repair-review";
  version: "1.1";
  exportedAt: string;
  aiGuidance: AiGuidance;
  items: Array<{
    bank: { id: string; title: string };
    node: { id: string; title: string; path: string[] };
    question: QuestionInput;
    review: { issues: ReviewIssue[]; note: string; markedAt: string; updatedAt: string };
    latestAttempt?: { answeredAt: string; userAnswer: string | string[]; gradingMode: string; isCorrect: boolean };
  }>;
}

export const parseQuestion = (row: QuestionRow): QuestionInput => JSON.parse(row.content_json) as QuestionInput;
