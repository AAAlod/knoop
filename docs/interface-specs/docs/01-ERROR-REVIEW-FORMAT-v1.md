# `knoop-error-review` 1.0 规范

状态：**冻结用于 0.1.0 Alpha 实现**

## 1. 目的

`knoop-error-review` 是刷题器导出的 **AI 回炉分析接口**。

它不是题库，不用于直接重新导入刷题器。其主要用途是：

```text
刷题
→ 错误 Attempt
→ 导出 error-review JSON
→ AI 错因分析
→ 修原题 / 生成变式题 / 生成定向训练题
→ 输出 normal knoop-bank
→ 重新导入刷题器
```

本接口特意保留：

- 原题完整内容；
- 用户最近一次错误答案；
- 正确答案；
- 选择题的“错选 / 漏选”差异；
- 最小历史统计。

这样 AI 能判断错误模式，而不仅知道“这道题错了”。

---

## 2. 顶层结构

```json
{
  "format": "knoop-error-review",
  "version": "1.0",
  "exportedAt": "2026-09-21T16:30:00+08:00",
  "scope": {
    "type": "current_wrong_questions"
  },
  "items": []
}
```

字段：

| 字段 | 类型 | 必需 | 说明 |
|---|---|---:|---|
| `format` | string | 是 | 固定为 `knoop-error-review` |
| `version` | string | 是 | 固定为 `1.0` |
| `exportedAt` | RFC 3339 / ISO 8601 datetime | 是 | 导出时间 |
| `scope` | object | 是 | 本次导出范围 |
| `items` | array | 是 | 错题条目；允许空数组 |

### v1.0 scope

v1.0 第一版只要求：

```json
{
  "type": "current_wrong_questions"
}
```

其含义是：

> 每道题以“最新一次有效 Attempt”为准；最新一次为错误时，属于当前错题。

未来可增加最近 N 天、某题库、某范围等 scope，但不得改变 v1.0 已有字段语义。

---

## 3. Item 结构

每个 `items[]` 包含四块：

```json
{
  "bank": {},
  "node": {},
  "question": {},
  "error": {}
}
```

### 3.1 `bank`

```json
{
  "id": "epi",
  "title": "示例主题"
}
```

用于消除跨题库 question ID 的歧义。

### 3.2 `node`

```json
{
  "id": "epi-ch03",
  "title": "第三章 描述性研究",
  "path": [
    "示例主题",
    "第三章 描述性研究"
  ]
}
```

`path` 按根节点 → 当前节点排列。

它主要用于给 AI 提供知识位置上下文，不用于重新导入。

### 3.3 `question`

`question` 应尽可能保留刷题器当前保存的原题字段。

v1.0 错题回炉只导出会产生 Attempt 的三种题型：

- `single_choice`
- `multiple_choice`
- `blank`

`recall` 和 `memorization` 不产生正确/错误 Attempt，因此不得进入本接口。

保留字段包括：

- `id`
- `nodeId`
- `type`
- `order`
- `stem`
- `options`（选择题）
- `answer`
- `explanation`（如有）
- `tags`（如有）
- `source`（如有；刷题器将其视为不透明 JSON 元数据）

### 3.4 `error`

核心结构：

```json
{
  "latestWrongAttempt": {
    "answeredAt": "2026-09-21T15:42:13+08:00",
    "userAnswer": "C",
    "gradingMode": "auto"
  },
  "correctAnswer": "B",
  "choiceDiff": {
    "wrongSelected": ["C"],
    "missedCorrect": ["B"]
  },
  "history": {
    "attemptCount": 3,
    "wrongCount": 2
  }
}
```

---

## 4. 用户答案规范化

导出接口 **不直接暴露数据库内部 `user_answer` 字符串**。

导出器必须将其解析并规范化为与标准答案相同的形状：

| 题型 | `userAnswer` | `correctAnswer` |
|---|---|---|
| `single_choice` | string | string |
| `multiple_choice` | string[] | string[] |
| `blank` | string | string |

例如数据库内部单选题可能保存为：

```json
["C"]
```

导出时应规范化成：

```json
"C"
```

这样 AI 不需要理解刷题器内部存储细节。

---

## 5. `choiceDiff`

仅用于：

- `single_choice`
- `multiple_choice`

结构：

```json
{
  "wrongSelected": ["C"],
  "missedCorrect": ["B"]
}
```

定义：

### `wrongSelected`

用户选择了、但标准答案不包含的选项 ID。

### `missedCorrect`

标准答案包含、但用户没有选择的选项 ID。

例如多选题：

```text
正确答案：A B D
用户答案：A C D
```

导出：

```json
{
  "wrongSelected": ["C"],
  "missedCorrect": ["B"]
}
```

单选题也按集合差定义。

### blank

填空题不得包含 `choiceDiff`。

AI 应直接比较：

```text
userAnswer
vs
correctAnswer
```

判断是否属于概念混淆、表述错误、记忆错误等。

---

## 6. `gradingMode`

`latestWrongAttempt.gradingMode` 保存刷题器记录的判分方式。

当前推荐值：

- `auto`
- `manual`

但为了兼容未来扩展，本规范将其定义为非空字符串，而不是封闭枚举。

AI 可以把它作为辅助信息，不应仅凭该字段推断知识掌握程度。

---

## 7. `history`

v1.0 只输出最小统计：

```json
{
  "attemptCount": 5,
  "wrongCount": 4
}
```

定义：

- `attemptCount`：该题所有有效 Attempt 数量；
- `wrongCount`：其中错误 Attempt 数量。

必须满足：

```text
attemptCount >= 1
wrongCount >= 1
wrongCount <= attemptCount
```

v1.0 不导出完整 Attempt 历史，以控制文件大小并降低 AI 噪声。

---

## 8. AI 使用约定

AI 读取本接口后，应优先完成：

1. 判断原题是否存在题面、选项、答案或解析质量问题；
2. 判断用户错误更可能属于：
   - 概念混淆；
   - 条件遗漏；
   - 错误辨析；
   - 漏选；
   - 多选；
   - 记忆错误；
   - 表述/拼写问题；
3. 根据错误模式决定训练类型；
4. 输出正常 `knoop-bank`，而不是再输出 `knoop-error-review`。

变式题应改变知识调用方式，而不是仅替换无关数字或措辞。

优先可改变：

- 设问方向；
- 条件组合；
- 干扰项角度；
- 正问 / 反问；
- 场景；
- 知识边界；
- 信息距离。

---

## 9. 唯一标识

一条错题的外部稳定身份由：

```text
bank.id + question.id
```

共同确定。

不得假定不同题库之间的 `question.id` 全局唯一。

---

## 10. Schema 与语义校验

JSON Schema 文件：

```text
schemas/knoop-error-review-v1.schema.json
```

Schema 能检查：

- 必填字段；
- 题型对应的数据结构；
- 答案类型；
- `choiceDiff` 是否只出现在选择题；
- 基础字符串、数组、整数约束。

实现还必须额外检查：

- `node.id` 与 `question.nodeId` 的逻辑一致性；
- `wrongSelected` / `missedCorrect` 是否引用有效 option ID；
- `wrongCount <= attemptCount`；
- `correctAnswer` 与 `question.answer` 等价；
- latestWrongAttempt 实际为错误 Attempt。

---

## 11. v1.0 非目标

当前不包含：

- AI 自动错因标签；
- 全部历史 Attempt；
- 响应时间；
- 选项排除过程；
- 置信度；
- 用户手写备注；
- 自动生成训练建议。

这些未来可增量扩展，但不应阻塞 v1.0。
