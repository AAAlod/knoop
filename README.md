# Knoop

> 一个本地优先的个人知识练习工具。

**0.1.1 Alpha**

[简体中文](README.md)

Knoop 最初只是一个临时需求：我想要一个能直接导入自己题库、在 Android 设备上使用的简单刷题器。

实际使用过程中，它逐渐加入了题库树、跨题库组题、背诵、笔记、错题回炉、题目审核与返修、LaTeX 等功能，于是成为了现在的 Knoop。

目前它仍然主要服务于我自己的学习流程，也仍处于 Alpha 阶段。

## 功能

目前支持：

- 单选、多选、填空、卡片和长文本背诵；
- 顺序、随机、错题和快刷模式；
- 树状题库与跨题库范围组题；
- 题目目录、搜索和常用组题预设；
- 收藏、笔记、编辑、斩杀；
- 题目审核、返修和同 ID merge；
- 错题与返修 JSON 导出；
- 多题库导入与 bundle 导出；
- 本地 KaTeX / LaTeX 公式渲染。

一个比较典型的使用循环是：

```text
练习
↓
做错 / 发现题目问题
↓
回顾、编辑或审核
↓
自行修改，或交给外部 AI / 工具处理
↓
merge 回题库
↓
继续练习
```

## 本地优先

Knoop 当前没有账号系统，也不依赖云端学习服务。

题库、作答记录、笔记、收藏和其他学习状态主要保存在设备本地。目前也没有跨设备同步。

因此在卸载应用、清除应用数据或进行较大版本迁移前，建议自行备份重要题库和数据。

## 题库格式

Knoop 使用结构化 JSON 作为题库和部分学习数据的交换格式。

现有协议名称为 `knoop-bank`、`knoop-bundle`、`knoop-error-review` 和 `knoop-repair-review`。

详细格式、Schema 和示例见：

```text
docs/interface-specs/
examples/
```

导入 JSON 会修改本地题库内容，尤其是 `merge` 可以覆盖相同 ID 的已有题目。Alpha 阶段建议只导入来源可信的题库，并保留原始文件。

## 技术

Knoop 目前主要使用：

- TypeScript
- Vite
- Tauri 2
- Rust
- SQLite
- KaTeX

主要目标平台是 Android 手机和平板。

## 构建

安装依赖后运行 `npm run build` 构建前端；Android Release 的工具要求、构建命令和可选签名方式见 [构建说明](docs/BUILDING.md)。

## 名字

Knoop 来自 knowledge loop 的想法，也可以理解为：

**Knowledge Nodes, Offline Organization & Practice**

另外，`knoop` 本身也带有“结 / 节点”一类的意象，和这个工具逐渐形成的知识节点与练习循环比较契合。

## License

Knoop 使用 **Mozilla Public License 2.0（MPL-2.0）**。

完整协议见 [`LICENSE`](LICENSE)。

第三方依赖仍分别遵循它们各自的许可证。
