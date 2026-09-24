# `knoop-repair-review` 1.0 规范

方向：刷题器 → AI。用途：题目质量审核与返修，不用于直接导入刷题器。

核心原则：

> 错题表示“用户可能没有掌握”；待返修表示“题目本身可能有问题”。两类数据必须分开。

顶层：

```json
{
  "format": "knoop-repair-review",
  "version": "1.0",
  "exportedAt": "2026-09-22T12:30:00+08:00",
  "items": []
}
```

每个 `items[]` 包含：

- `bank`：题库 ID / 标题；
- `node`：节点 ID / 标题 / path；
- `question`：原题完整静态内容；
- `review`：审核问题位置、审核意见、标记时间和更新时间；
- `latestAttempt`：可选；最近一次作答，含答案、判分方式、正误和时间。

`review.issues` 可取：

- `stem`：题干或主要内容；
- `options`：选项；
- `answer`：答案；
- `explanation`：解析；
- `other`：其他。

AI 完成真正的原题返修时，应输出正常 `knoop-bank`，使用：

- 同 `bankId`；
- 同 `question.id`；
- `import.mode = "merge"`。

这样刷题器会替换原题，并自动完成对应待返修状态。

如果生成的是变式题或新增定向训练题，则必须使用新 question ID，不得复用原题 ID。
