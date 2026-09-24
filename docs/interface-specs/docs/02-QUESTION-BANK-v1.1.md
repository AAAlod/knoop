# `knoop-bank` 1.1 规范：`memorization` 扩展

状态：**冻结用于 0.1.0 Alpha 实现**

## 1. 设计原则

`knoop-bank` 1.1 是现有 1.0 的增量扩展。

现有四种类型保持原样：

```text
single_choice
multiple_choice
blank
recall
```

新增第五种：

```text
memorization
```

目的：

> 让简答题、重点段落、英语范文、政治答题框架等“长文本背诵材料”与普通题目共享同一套题库、Node、导入与管理体系。

不另建背诵专用题库格式，避免出现两套题库系统。

---

## 2. 顶层结构

与 1.0 完全一致：

```json
{
  "format": "knoop-bank",
  "version": "1.1",
  "import": {
    "mode": "new",
    "bankId": "epi",
    "bankTitle": "示例主题"
  },
  "nodes": [],
  "questions": []
}
```

变化只有：

1. `version` 为 `1.1`；
2. `questions[]` 允许 `type: "memorization"`。

---

## 3. 兼容要求

### 导入器

实现 1.1 的刷题器 **必须同时接受**：

- `knoop-bank` `1.0`
- `knoop-bank` `1.1`

### 生产者

包含 `memorization` 时：

```json
"version": "1.1"
```

是必须的。

不含 `memorization` 的旧题库可以继续保持 `1.0`，无需迁移。

### 旧客户端

仅支持 1.0 的旧客户端可以拒绝 1.1 文件。

不得为了“兼容”而把 `memorization` 偷换成 `recall`。

---

## 4. `memorization` 结构

最小合法对象：

```json
{
  "id": "epi-ch05-mem-001",
  "nodeId": "epi-ch05",
  "type": "memorization",
  "order": 1,
  "prompt": "简述病例对照研究的优点。",
  "content": "1. 特别适用于罕见病研究。\n2. 相对省时、省力、经济。\n3. 可研究多个暴露因素。"
}
```

完整示例：

```json
{
  "id": "epi-ch05-mem-001",
  "nodeId": "epi-ch05",
  "type": "memorization",
  "order": 1,
  "prompt": "简述病例对照研究的优点。",
  "content": "1. 特别适用于罕见病研究。\n2. 相对省时、省力、经济。\n3. 可研究多个暴露因素。",
  "keyPoints": [
    "适用于罕见病",
    "省时、省力、经济",
    "可研究多个暴露因素"
  ],
  "explanation": "建议按“适用性—效率—暴露因素”三个层次组织答案。",
  "tags": [
    "病例对照研究",
    "简答"
  ]
}
```

---

## 5. 字段定义

| 字段 | 类型 | 必需 | 说明 |
|---|---|---:|---|
| `id` | string | 是 | 题库内稳定 ID |
| `nodeId` | string | 是 | 所属 Node |
| `type` | string | 是 | 固定为 `memorization` |
| `order` | integer | 是 | Node 内排序 |
| `prompt` | string | 是 | 背诵提示、标题、问题或材料名称 |
| `content` | string | 是 | 主背诵内容 |
| `keyPoints` | string[] | 否 | 要点列表 |
| `explanation` | string | 否 | 学习提示、结构说明、记忆提示 |
| `tags` | string[] | 否 | 标签 |
| `source` | any JSON | 否 | 不透明来源元数据；客户端应保存但不强制解释 |

---

## 6. `prompt` 与 `content`

本类型不用 `question / answer`，也不用 `front / back`。

原因：

`memorization` 不一定是一道传统题。

### 简答

```json
{
  "prompt": "简述队列研究的优点。",
  "content": "……"
}
```

### 重点段落

```json
{
  "prompt": "示例主题的定义",
  "content": "……"
}
```

### 英语范文

```json
{
  "prompt": "图画作文：坚持与行动",
  "content": "As is vividly depicted ...\n\nThe picture reveals ...\n\nFrom my perspective, ..."
}
```

因此：

- `prompt` = “我要回忆/背诵什么”
- `content` = “我要掌握的主体内容”

---

## 7. 换行语义

以下字段中的换行具有正式显示语义：

- `prompt`
- `content`
- `explanation`

客户端必须保留：

```text
\n
```

以及段落空行：

```text
\n\n
```

v1.1 的正文格式为：

> **纯文本 + 换行**

暂不定义：

- Markdown；
- HTML；
- LaTeX；
- 图片；
- 富文本。

这样可以保证 AI 生成和移动端渲染稳定。

---

## 8. `keyPoints`

`keyPoints` 是可选字段：

```json
{
  "keyPoints": [
    "适用于罕见病",
    "省时省力",
    "多个暴露因素"
  ]
}
```

用途：

- 以后支持“只看答题要点”；
- 简答自评；
- 背诵提纲；
- 英语作文结构检查。

0.1.0 Alpha 客户端可以：

- 保存该字段；
- 暂时不在 UI 使用。

不得因为 UI 尚未实现而在导入时删除它。

---

## 9. 与 `recall` 的边界

### `recall`

适合快速提取：

- 定义；
- 名词；
- 短句；
- 简短列表；
- 正反面卡片。

典型：

```json
{
  "type": "recall",
  "front": "疾病分布的三个维度",
  "back": "人群、地区、时间。"
}
```

### `memorization`

适合需要保持结构或较长表达的内容：

- 简答；
- 论述框架；
- 重点段落；
- 作文范文；
- 翻译范文；
- 政治分析题模板。

判断原则：

> 如果内容更像“一张卡片”，用 `recall`；如果更像“一段需要组织和复述的材料”，用 `memorization`。

不要只按字符数机械判断。

---

## 10. 学习行为

`memorization` 默认属于背诵材料，而不是判分题。

因此 v1.1 规定：

- 不自动产生 Attempt；
- 不进入当前错题；
- 不计入正确率；
- 不要求自动判分；
- 不要求手动“对/错”。

### 普通背诵

```text
prompt
→ 用户主动回忆
→ 点击“显示内容”
→ content + explanation
```

### 快刷背诵

```text
prompt
content
explanation
```

直接显示全部，不增加“揭晓”操作。

---

## 11. 与题库统计的关系

为了避免统计语义混乱，推荐区分：

```text
题数
```

和未来可能增加的：

```text
背诵材料数
```

若当前 UI 只有统一“题数”，实现阶段应明确其口径。

推荐从 0.1.0 Alpha 开始：

> 首页“题数”只统计会产生刷题 Attempt 的 `single_choice / multiple_choice / blank`。

`recall` 和 `memorization` 可归为学习材料数量，后续 UI 再决定是否展示。

该统计约定属于产品实现建议，不影响 JSON 文件合法性。

---

## 12. 原有四种题型

### single_choice

必需：

- `stem`
- `options`，至少 2 项
- `answer`：string，必须引用一个 option ID

### multiple_choice

必需：

- `stem`
- `options`，至少 2 项
- `answer`：非空 string[]，每项必须引用 option ID

### blank

必需：

- `stem`
- `answer`：string

### recall

必需：

- `front`
- `back`

以上字段语义与 1.0 不变。

---

## 13. Node 与 ID 语义

沿用 1.0：

- `node.id` 在单个题库内唯一；
- `question.id` 在单个题库内唯一；
- 一个题/材料只绑定一个 `nodeId`；
- `parentId: null` 表示根 Node；
- `order` 为整数排序值。

跨题库唯一身份为：

```text
bankId + question.id
```

---

## 14. `new` / `merge`

沿用 1.0：

### `new`

创建新题库。

- `bankId` 已存在时应拒绝；
- question/node ID 冲突应拒绝。

### `merge`

合并进已存在的同一 `bankId`。

- 同 ID 的 Node/Question 按导入内容更新；
- 文件中没有出现的本地内容不得因 merge 被隐式删除。

如果用户在刷题器 UI 手工编辑过某题，而后续 merge 文件包含同一 ID，则 merge 内容可以覆盖该本地编辑。

---

## 15. Schema 与语义校验

Schema：

```text
schemas/knoop-bank-v1.1.schema.json
```

Schema 能验证字段结构，但实现必须额外检查：

- Node ID 唯一；
- Question ID 唯一；
- Node parent 引用合法；
- Node 不形成循环；
- Question 的 `nodeId` 合法；
- 选择题 option ID 唯一；
- `answer` 引用实际 option；
- merge 后完整 Node 图仍不形成循环。

---

## 16. v1.1 非目标

当前不加入：

- Markdown 富文本；
- 图片附件；
- 音频；
- 自动背诵评分；
- FSRS；
- 间隔重复；
- AI 内置生成；
- 背诵熟练度模型。

这些不应阻塞 `memorization` 的第一版落地。
