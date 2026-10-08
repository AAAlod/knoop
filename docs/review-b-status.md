# 工作包 B：持久化安全与作答一致性

日期：2026-10-09（Asia/Shanghai）。规格参考用户交接文档第 4 节；授权来自用户追加的“请本地提交后继续下一任务包”。只进入 B，未进入 C–F，不推送、不发布。A 的审计记录保存在 `review-remediation-status.md`，已本地提交为 `cf4305afd729f2b36c3761a7dca926c133ea136a`。B 开始时工作区干净，没有覆盖用户修改。

## 任务对照与复现

| ID | 修复前证据（固定 cf4305a） | 本次实施 | 自动验收 |
|---|---|---|---|
| F02 | new/merge/删除/返修/送审/撤审/编辑：第 N 次写入失败留下部分数据 | 最小 Rust `atomic_write` 复用 SQL 插件的既有池，单连接 SQLx Transaction；TS 只规划语句，事务内重核读取快照 | 7 类操作共 34 个写入故障位置，全表与 sqlite_sequence 快照保持一致；merge 保留遗漏题目，审核前斩杀状态保留 |
| F03 | 连续提交产生 2 条 Attempt；记录成功、进度失败留下未提交 UI | 保存互斥与控件禁用；Attempt 和 submitted 同事务；前进成功才改变内存索引；快刷前进失败显示已保存结果并可重试下一题 | 提交/下一题/快刷双击只记 1 次、只前进 1 题；提交失败回滚，快刷前进失败重试不重复记账 |
| F04 | 两个并发判分的第二个覆盖首个结果；同值双击未复现重复数组项 | 临时动作共用互斥；JSON 进度按旧索引/state/results 条件更新；本轮已存在题目结果时拒绝再次追加 | 并发判分首个结果保留，下一题双击不跳题，返回重开恢复 2/3 |
| F05 | 延迟正式草稿使题号退回 0；临时填空旧写入覆盖最新提交；未结束的长按回调覆写提交状态 | 按 session/group 串行草稿；调用时捕获输入；提交、切题、返回前 flush；保存中/页面脱离后长按回调不写入；草稿瞬时失败可重试 | 延迟乱序、快速输入/提交/返回、长按跨提交、瞬时写入失败恢复均通过，浏览器无未处理异常 |
| F06 | 普通编辑/merge 将答案 A 改 B 后，旧错题继续显示 | 按用户确认保留历史判分；新增内部答案修订记录保存前后内容和 Attempt 截止 ID；当前错题列表/计数/导出使用相同截止条件 | A→B 保留旧 Attempt，当前错题为 0，新作答重新计算；解析修改及多选答案顺序变化不重置；重复修订保留历史 |
| F07 | 题组插入后任务第二步写失败产生 orphan | 题组插入与任务 savedGroupId 同事务，事务内检查任务快照与正式题 ID 冲突；重复调用返回已保存题组 | 第二写失败无题组，重试仅 1 份且链接一致；并发保存冲突后重试仍只有 1 份，无付费 API 调用 |

基线对照为 17 组检查：16 个目标断言失败、1 组既有 merge/斩杀行为通过。对照来自 Git 固定提交，未还原/覆盖当前工作区。F04 的已证实问题是后判分覆盖先判分，不将没有复现的重复数组项声称为原有必现问题。

## 数据口径与兼容性

- 用户已确认“保留历史判分；当前错题仅看修改后作答”。普通答案编辑、merge、返修完成均保留 Attempts，不重判。返修完成不再删除旧作答，而是设置同样的截止边界；两处确认文案已更新。显式删除题库仍按用户确认删除其关联记录。
- `question_answer_revisions` 是同一个库内的新增内部表，记录完整前后题目 JSON、最后旧 Attempt ID 与变更时间，不改变既有表身份、题目主键或 public JSON。多选答案排序后比较，单纯改解析不产生答案修订。
- 历史统计继续累计存量判分，沿用排除待返修题目规则；恢复出返修后，原有历史判分重新进入历史汇总。当前错题只看截止 ID 后最近一次作答，并继续排除斩杀/待返修。
- 保持 `sqlite:knoop.db`、应用 ID `com.kehai.knoop`、版本 0.1.10/code 111、题库/回炉协议及签名配置不变。没有读取真实题库或真实 API Key，没有数据重置、旧 orphan 清理或整体 UI 重构。
- 使用本机 Cargo 缓存核对 SQL 插件 2.4.1：单次 execute/select 使用 pool，单独 BEGIN/COMMIT 无法保证同连接。新命令不接受数据库路径，只定位既有 `DbInstances` 中的 `sqlite:knoop.db`。直接依赖的 SQLx 0.8.6 已存在于锁文件，未升级版本。

## 自动验证与证据

- `npm run build`、`check:repo`、`test:ai`、`test:temp`、`test:batch` 通过。
- `npm run test:review-b -- --ui`：21 组通过（12 组 SQLite/批量保存检查 + 9 组真实 main.ts 浏览器场景），其中故障位置 34 个。
- `npm run test:review-a -- --ui`：10 组通过，包含单/多/填编辑保存与送审、Enter、防原生导航、计数、长按/取消与首页 320px。
- `cargo test --offline`：2 个测试通过。新 Rust 测试使用真实 SQLx SQLite 四连接池配置，验证任意写步骤失败回滚、事务内可见性、快照冲突、affectedRows 冲突、COUNT/NULL/COALESCE 结果解码。初次 COUNT 扩展测试发现静态字段类型不能解码计算列，已按插件实现改用 raw value 运行时类型，随后通过。
- `git diff --check` 通过。系统缺少 rustfmt，未安装或修改工具链；不将格式化声明为通过。
- 原始结果在 Git 忽略目录 `artifacts/review-b/baseline-ui.json`、`regression-ui.json`；A 回归结果仍在 `artifacts/review-a/regression-ui.json`。测试使用独立内存 SQLite 与合成数据；Chrome/Playwright 通过本机已有运行时加载，禁止真实 AI API 调用。

重跑浏览器用法与 A 相同，设置 `PLAYWRIGHT_MODULE_PATH` 和 `CHROME_PATH` 后运行 `rtk proxy npm run test:review-b -- --ui`。不带 `--ui` 可重跑 12 组 SQLite 检查；`rtk proxy node scripts/test-review-b.mjs --baseline --ui` 重跑旧版本对照。

## Release 验证

私有 `.local-workflow/build-my-release.ps1` 成功完成：Android ARM64 Release、zipalign、签名及 strip 核验通过；没有安装或发布。

- 输出 `D:/.knoop/artifacts/knoop-v0.1.10-arm64-release.apk`，13,534,534 bytes（12.91 MiB）；比 A 的 13,497,670 bytes 增加 36,864 bytes，约 0.27%。原生库 10,844,368 bytes，唯一 ABI 为 arm64-v8a，`.symtab` 不存在；frontend 1.49 MiB、DEX 1.92 MiB。
- `aapt dump badging` 实测 `com.kehai.knoop`、versionName 0.1.10、versionCode 111，未更改身份/版本。
- `apksigner verify --verbose --print-certs` 实测 v2/v3 通过、1 个签名者；证书 SHA-256 与基线/A 一致：`c186a82aaf6913c599249e624e0db58fb3f6ebaddfa649d3a666aec905f42f1a`。
- APK SHA-256：`B7952D038878FC0B5B5B4AEEE42C7E69DB32AA7106CED998555D3F19CBC80A2B`。
- 最终 native 资源映射包含 `index-DHWr6EQ1.js`，包含 `atomic_write` 命令；已确认 Release 嵌入本次前端及原生实现。

## 变更文件

| 文件 | 内容 |
|---|---|
| `src/db.ts` | 原子写规划、读取前置检查、内部修订表、当前错题条件、正式草稿/判分写入、初始化等待 |
| `src/main.ts` | 作答互斥与失败恢复、草稿捕获/flush、临时动作、长按过期防护、返修/统计文案 |
| `src/state-writes.ts` | 草稿串行队列与最后写入等待/瞬时失败重试 |
| `src/temp-review.ts` | 题组插入准备、按旧进度条件保存 |
| `src/batch-review.ts` | 幂等原子保存已就绪批次 |
| `src-tauri/src/storage.rs`、`src-tauri/src/lib.rs` | 复用池的单连接事务命令及真实 SQLite 测试、命令注册 |
| `src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` | 显式复用已锁定 SQLx 0.8.6，版本无升级 |
| `scripts/test-review-b.mjs`、`package.json` | 基线对照/故障注入/延迟浏览器回归及入口 |
| `scripts/test-review-a.mjs` | 支持新 native transaction 的独立 SQLite bridge；A 基线固定原审计 e6a568b |
| `scripts/test-temp-review.mjs`、`scripts/test-batch-review.mjs` | 既有测试适配进度条件与新增模块导入，保留原断言 |
| `docs/review-b-status.md` | 本次范围、任务映射、验证证据和边界 |

## 尚未验证与下一阶段

Android 真机/模拟器、Tauri IPC 到 Android SQL 插件、低速设备连点与 IME、进程被系统杀死、覆盖安装后的学习数据保留均未测试。浏览器 + 原生 SQLite 单元测试通过，不能等同于这些通过。未连接或安装 APK。

建议先在真机验收 A/B 的编辑保存、双击提交/下一题、草稿返回/重启恢复，以及覆盖安装数据保留，再单独授权 C 的备份与导入保护（F08/U03/F09）。B 完成后停止，等待下一条指令。
