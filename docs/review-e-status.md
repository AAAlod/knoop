# 工作包 E：AI 临时练习闭环

开始 HEAD `c448e01`，工作区干净。先固定 D 的代码复现，再实施；完成本包验证和本地提交后才进入 F。未调用真实 AI、推送、发布或安装 APK。

| ID | 实施与证据 |
|---|---|
| A01 | 基线重载后候选丢失。增加独立待审核草稿表、列表及来源快照；生成后先存草稿，重载恢复，明确保存/丢弃/再次付费生成。保存为题组与消费草稿同事务。两处写入故障均回滚；已删除原题仍可按历史快照保存；重试消费不生成重复组。先复现本机草稿写失败后的候选丢失，再增加保持页面/阻止离开/重试本机保存，测试只发送一次 mock 请求。强制退出会丢失尚未落盘的候选。 |
| A02 | 基线完成页无逐题回顾。增加本次答案、标准答案、解析和判分回顾；4 题错 2 题生成独立 2 题错题重练组，保留原结果及模型/来源/生成时间，不新增正式 Attempt。 |
| A03 | 基线不能选择部分原题。支持逐题勾选、前 N 道和清空；开始前显示原题/候选/批次数并确认费用。20 道选择 3 道，显示 3/6/2，实际只向选定 3 道发送请求，取消确认为 0 请求。 |
| A04 | 增加单题/批量取消与重试费用提示、同步启动保护；双击只有一次请求。失败批次保留已校验原题，确认重试只请求缺失原题；取消重试确认无请求。取消不能保证服务商不收费。 |
| A05 | 基线未复现清除配置丢失。前端模拟测试证实清除后重载仍为空、服务失败不损坏学习数据；Rust 检查配置重载/清除，以及 HTTP 401/不合法响应不回显合成 Key 或响应正文。没有引入 Keystore。 |

新增草稿是学习数据，因此完整备份升级为 1.1，新增第 13 张白名单表及计数；1.0 先验证原 Schema/摘要，显式补空草稿，再验证语义。富数据 1.0 往返测试保持原文件、历史判分、偏好与自增高水位；1.1 往返覆盖非空草稿。普通题库/Bundle 协议、数据库文件身份、应用 ID、签名配置不变。旧版应用无法读取 1.1，升级后应另存新备份。

变更文件：`src/ai-drafts.ts`、`src/main.ts`、`src/temp-review.ts`、`src/db.ts`、`src/style.css`；备份 `src/backup-format.ts`、`src/backup-validation.ts`、`src/backup.ts`、新增生成的 1.1 validator、`scripts/generate-ai-validator.mjs`、`scripts/generate-backup-schema.mjs`、1.1 Schema 与协议说明/索引、1.0 迁移说明；`src-tauri/src/ai.rs`（错误隐私测试）、`src-tauri/src/storage.rs`（安全副本兼容 1.1）；`scripts/test-review-e.mjs`、`scripts/review-test-harness.mjs`、`scripts/test-review-c.mjs`、`scripts/test-temp-review.mjs`、`package.json`、`CHANGELOG.md`、本报告。

自动验证：E 9 组通过；基线 A01–A04 四项缺口复现失败，A05 和浏览器无异常通过。证据 `artifacts/review-e/baseline.json`、`regression.json`、`persistence-fault-before.json`。A 10、B 21、C 19、D 8 组全部通过；C 恢复 35 个数据库写入故障位置全部回滚。AI/临时题组/批次三个既有测试套件、TypeScript/Vite、仓库检查、Rust 4 项均通过。浏览器和 SQLite 使用隔离适配器，原生签名构建单独验证；桌面测试不能替代 Android WebView/IPC。

Android 真机尚未测试：强停后草稿恢复、逐题回顾与错题重练、部分批量选择、覆盖安装、软键盘/字体放大及备份恢复。真实服务计费/取消由服务商决定，本轮没有发送付费请求。最终 F 提供合成库与离线 AI 学习状态备份，供用户实机检查。

Release：私有构建成功；独立验证 `com.kehai.knoop`、0.1.10/code 111、仅 arm64-v8a，v2/v3 签名通过，证书 SHA-256 `c186a82aaf6913c599249e624e0db58fb3f6ebaddfa649d3a666aec905f42f1a` 未变。阶段 APK 13,571,398 bytes、SHA-256 `30024493E50C38C8BD8BC0A833D19BEF64F0236B9AB8F9FB6673D79C3D796901`。最终 F 单独输出 0.1.11。`git diff --check` 通过。
