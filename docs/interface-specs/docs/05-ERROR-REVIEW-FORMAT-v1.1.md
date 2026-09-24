# `knoop-error-review` 1.1

1.1 是 1.0 的增量导出版本。题目、错误答案、`choiceDiff`、历史统计等语义全部保持不变，仅在顶层增加 `aiGuidance`。

```json
{
  "format": "knoop-error-review",
  "version": "1.1",
  "exportedAt": "...",
  "aiGuidance": {
    "purpose": "用于错因分析、原题质量检查、变式训练和定向训练。",
    "firstStep": "若用户未说明处理目标，先确认希望进行错因分析、修订原题、生成变式题还是定向训练；若用户已明确要求，则直接执行。",
    "output": "需要生成或修订题目时输出 knoop-bank；修订原题保持原 question.id，变式题使用新 question.id。"
  },
  "scope": { "type": "current_wrong_questions" },
  "items": []
}
```

`aiGuidance` 是给接收端 AI 的最小自描述信息，不是完整 Prompt。它不得覆盖用户在当前对话中已经给出的明确指令。

Schema：`schemas/knoop-error-review-v1.1.schema.json`。
