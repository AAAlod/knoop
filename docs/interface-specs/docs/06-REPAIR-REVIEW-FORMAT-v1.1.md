# `knoop-repair-review` 1.1

1.1 是 1.0 的增量导出版本。原题、审核区域、审核意见、最近作答等字段语义保持不变，仅在顶层增加 `aiGuidance`。

```json
{
  "format": "knoop-repair-review",
  "version": "1.1",
  "exportedAt": "...",
  "aiGuidance": {
    "purpose": "检查或返修用户标记的问题题目。",
    "firstStep": "若用户未说明处理方式，先确认是检查用户修改还是直接返修；若审核意见注明用户已修改，则默认先检查，不擅自重写。若用户已明确要求，则直接执行。",
    "output": "直接返修原题时保持原 bankId 和 question.id，并输出 knoop-bank merge；变式题使用新 question.id。"
  },
  "items": []
}
```

“用户已修改，需要检查”在 v1.1 中通过审核意见表达，不新增数据库或题库字段。AI 看到该语义时应优先检查用户修改；只有用户要求或确有必要时再重写。

`aiGuidance` 是最小工作约定，不是完整 Prompt，也不得覆盖当前对话中的明确用户指令。

Schema：`schemas/knoop-repair-review-v1.1.schema.json`。
