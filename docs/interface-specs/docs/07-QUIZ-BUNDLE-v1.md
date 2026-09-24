# knoop-bundle 1.0

用途：将多个 `knoop-bank` 题库封装进同一个 JSON 文件，便于一次导出、传输和串联导入。

## 顶层结构

```json
{
  "format": "knoop-bundle",
  "version": "1.0",
  "exportedAt": "2026-09-23T09:00:00.000Z",
  "banks": []
}
```

字段：

- `format`：固定为 `knoop-bundle`。
- `version`：固定为 `1.0`。
- `exportedAt`：导出时间，ISO 8601 字符串。
- `banks`：一个或多个完整的 `knoop-bank` 对象。

## bank 语义

每个 `banks[]` 元素仍然保持原题库接口，不增加 bundle 专属字段。

允许：

- `knoop-bank` 1.0
- `knoop-bank` 1.1
- `import.mode = new`
- `import.mode = merge`

导入时按 `banks` 顺序逐个执行，并使用每个 bank 自己的 `import.mode / bankId / bankTitle`。

一个 bank 导入失败时，不应回滚已经成功的其他 bank，也不应阻止后续 bank 继续尝试导入。最终统一汇报成功数、失败数和返修完成数。

## 导出规则

- 单题库导出继续生成 `knoop-bank`，不强制套 bundle。
- 同时选择两个或更多题库时生成 `knoop-bundle`。
- 当前应用导出的 bundle 内部 bank 使用现有 `buildBankExport` 语义，因此默认 `import.mode = new`。

## 不包含的内容

bundle 仍属于“静态题库内容导出”，不包含：

- Attempts
- 收藏
- 斩杀
- 审核 / 待返修状态
- 笔记
- Session / 学习进度
- 范围折叠状态

这些是本机学习状态，不应污染题库接口。

## 语义校验

JSON Schema 主要验证 bundle 包装层和 bank 基础结构。应用导入时还必须继续调用现有 `knoop-bank` 语义校验，包括：

- Node ID 唯一性；
- Node 父子引用；
- Node 循环；
- Question ID 唯一性；
- Question → Node 引用；
- 选择题 answer → option 引用；
- 1.0 / 1.1 与 `memorization` 兼容关系；
- bundle 内 `bankId` 不得重复。
