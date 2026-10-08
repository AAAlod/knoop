# 工作包 C：完整备份与导入保护

日期：2026-10-09（Asia/Shanghai）。依据用户批准“通过，请继续工作包C”，仅实施 F08 / U03 / F09，未进入 D–F。开始 HEAD 为 `df658ad7bc1d697337dc2197bd97c903715f5f84`，工作区干净；无用户本地修改被丢弃或覆盖。未推送、发布、安装或调用付费 AI 接口。

## 任务 ID 与证据

| ID | 修复前证据 | 最小实施与自动验收 | 状态 |
|---|---|---|---|
| F08 | 既有 bank/bundle 导出只含定义，不能恢复学习状态；这是缺失功能，不声称复现了不存在的恢复接口 | 独立 `knoop-backup` 1.0，公开 schema/规范/样例；12 张学习表、4 类偏好与自增高水位；校验摘要、数量、身份、引用、进度、版本。恢复预览→持久安全副本→再次确认→完整替换事务；偏好日志支持失败/重启恢复 | 自动通过；真机升级/重装演练待验收 |
| U03 | 固定 B 的 `df658ad:src/main.ts`，选择 merge 后题目 JSON 已被覆盖、已有库更新时间已改变、新题已插入 | 选择文件只规划预览；每个 bank 单独确认，取消不写入；真实 SQL 计划给出新增/覆盖/相同/保留/题型和答案变更数量；执行前核对读取快照，过时预览拒绝覆盖；bundle 无效子文件与成功部分同时报告 | 自动通过 |
| F09 | 第一轮对照证实普通题库接受额外字段，AI 拒绝；补充字段定位测试又证实语义错误没有可定位路径 | 普通文件、bundle 子文件和 AI 复用相同 v1.0/v1.1 结构与语义校验；保留 AI 的归一化与 2 道候选等额外限制；重复 ID、孤儿节点、循环、答案错误补充明确字段路径 | 自动通过 |

复现记录保存在 Git 忽略的 `artifacts/review-c/baseline.json`（F09）、`baseline-ui.json`（U03）、`field-location-before.json`（字段定位补测）。前两个对照阶段不同：UI 对照固定旧 main.ts，DB 使用当时的 C 实现；不能把其余 PASS 当作旧版本已有备份能力。`--baseline` 当前仅固定旧 main.ts 用于重复 U03 对照，不会重建最初 F09 的历史对照。

## 数据行为与兼容性

- 保持原题库、bundle、错题回炉和返修协议；v1.0/v1.1 的合法内容继续支持，结构校验遵循已有公开 schema。新增独立备份协议，未更改既有题目 ID 规则、`sqlite:knoop.db`、应用 ID、版本或签名配置。
- 备份覆盖题库/节点/题目、Attempts、sessions、notes、favorites、killed、reviews、答案修订、AI 临时题组与批次，以及折叠、题型过滤、常用组题和最近预设。保留 JSON 原值、历史判分、进度、时间戳和主键。保留 SQLite 已删除记录留下的自增高水位，恢复后新 Attempt 不复用旧边界 ID。
- 允许已有历史生命周期产生的旧引用：已删除会话的 Attempt.session_id、已删除原题的 AI 快照、已删除题组的 savedGroupId、偏好中的失效范围/预设。当前题库与学习实体引用仍严格验证。
- 只读取明确白名单。API Key/API 配置、签名、设备路径、未知 localStorage 键不导出，恢复保留本机 API 配置。SHA-256 用于完整性检测，不用于来源认证。未知备份版本拒绝；来源 appVersion 是提示，同备份协议可恢复，不猜测未来迁移。
- 恢复第一版采用完整替换，不合并不同设备的学习主键。首次准备保存本机安全副本到应用私有存储，界面可重新载入，也可另存到应用外；取消不会替换数据。应用内安全副本不应作为清除应用数据/卸载后的唯一备份，演练前须把完整备份保存到应用外文件。
- 全部学习表、自增序列与 committed 标记由既有池的单连接事务处理。偏好与 SQLite 没有跨存储事务，因此新增内部 `backup_preference_journal`：prepared 恢复旧偏好，committed 完成目标偏好。最后清日志失败时，学习数据可能已提交；界面明确阻止继续学习并提供设置同步重试。重启在学习页面展示前处理日志，不宣称两种存储天然原子。
- 导入预览和执行使用同一 SQL 计划。merge 保留文件遗漏的已有题目，答案修改继续采用 B 的历史判分/修订边界。覆盖警告表述为“可能包含本地编辑”，不声称数据库能识别编辑来源；节点/标题更新沿用既有行为。
- 操作前等待草稿，恢复后重载内存学习状态和偏好；正在执行 AI 任务时要求先结束任务再备份/恢复。未整体重构 UI 或清理旧学习记录。

## 自动验证

| 检查 | 结果与范围 |
|---|---|
| `npm run test:review-c -- --ui` | 18 组通过：11 组 SQLite/格式/语义检查，7 组浏览器检查（含无未处理异常断言） |
| 完整往返 | 合成 12 表均有记录，A 测试库导出→空库恢复→逐表/偏好/序列/统计相等；新 Attempt ID 为 101；API 合成秘密未导出，本机未知配置保留 |
| 恢复故障 | 33 个事务写入故障位置均回滚原表、sqlite_sequence 和偏好；另测 committed 后最终清日志失败，重试保留目标状态 |
| 中断与冲突 | prepared/committed 两种日志恢复；浏览器启动前恢复；设置同步失败阻止返回其他页面；安全副本写入失败、localStorage 写入失败、过时本地笔记/预览均保护原状态 |
| 导入 UI | merge 选择/取消不写 SQL；明确确认后数量与内容一致；bundle 合法/非法/null 子文件分别反馈；成功部分不被后续错误抹去 |
| 校验 | 额外字段、错误 options 类型、空选项、重复 ID、孤儿/循环节点、非法答案在普通/AI 一致拒绝；语义字段定位断言通过；现有合法版本/schema 样例检查通过 |
| A / B 回归 | A 10 组、B 21 组全部通过，包括表单隐式提交、计数、长按、320px 首页、作答互斥、草稿和 34 个事务故障位置 |
| 既有测试 | `test:ai`、`test:temp`、`test:batch`、`check:repo` 全部通过 |
| 原生测试 | `cargo test --offline` 3 个通过：真实 SQLx 事务、多连接池、持久安全副本与文件名校验，以及既有 AI 配置持久化测试 |
| 构建/补充检查 | TypeScript + Vite build、`git diff --check` 通过；生成的校验器不使用运行时 eval/new Function，保持 CSP 兼容 |

测试使用独立内存 SQLite、合成记录与本机已有 Chrome/Playwright；浏览器 native 命令以测试桥接替代，Rust 文件测试只使用临时目录。没有访问真实学习库或真实 API Key。原始最终结果为 `artifacts/review-c/regression-ui.json`，A/B 的结果分别在其同名目录。设置 `PLAYWRIGHT_MODULE_PATH` 和 `CHROME_PATH` 后运行 `rtk proxy npm run test:review-c -- --ui`；无 `--ui` 时执行 11 组底层检查。

## 分步本地提交

1. `d97f344`：定义 Backup 1.0 合约与统一题库校验，先交付 schema/规范/样例/校验测试。
2. `7446f6f`：完整学习快照、导入计划、事务恢复与持久安全副本底层。
3. 界面和验收提交：导入预览、备份入口、二次确认、异常同步重试、浏览器回归与本报告。最终提交号以 Git 日志和最终答复为准。

## 变更文件清单

| 文件 | 用途 |
|---|---|
| `src/backup-format.ts` | 白名单、格式类型、规范化摘要 |
| `src/backup-validation.ts` | 完整备份结构和跨表语义校验 |
| `src/backup.ts` | 快照导出、准备恢复、原子替换与偏好中断恢复 |
| `src/db.ts` | 共用题库校验、预览 SQL 计划/快照、内部偏好日志表 |
| `src/ai-review.ts` | 复用共用校验并保留 AI 额外限制 |
| `src/main.ts` | 导入预览/逐项确认、完整备份页面、安全副本重载和恢复异常重试 |
| `src-tauri/src/storage.rs`、`src-tauri/src/lib.rs` | 安全副本保存/列出/读取命令及注册、临时文件单元测试 |
| `src/generated/knoop-bank-v1-validator.js`、`.d.ts` | 预编译 v1.0 校验器 |
| `src/generated/knoop-backup-v1-validator.js`、`.d.ts` | 预编译 Backup 1.0 校验器 |
| `src/generated/knoop-bank-v1.1-validator.d.ts` | 错误字段类型声明；既有 v1.1 JS 规则不变 |
| `scripts/generate-ai-validator.mjs`、`scripts/generate-backup-schema.mjs` | 统一生成器与白名单 schema 生成 |
| `scripts/test-review-c.mjs`、`package.json` | 隔离库、故障注入、浏览器回归入口 |
| `scripts/check-repo.mjs` | 新备份样例/schema 验证 |
| `docs/interface-specs/schemas/knoop-backup-v1.schema.json`、`knoop-bank-v1.schema.json` | 新备份公开结构与已有 v1.0 对应结构 |
| `docs/interface-specs/docs/knoop-backup-v1.md`、`docs/interface-specs/README.md` | 备份协议与索引 |
| `examples/sample-backup.json` | 不含真实数据的空库完整备份样例 |
| `docs/review-c-status.md` | 本次审计和交付证据 |

## Release 核验

按 AGENTS.md 执行私有 `.local-workflow/build-my-release.ps1` 成功，完成 Android ARM64 Release、zipalign、签名与 strip 检查。随后独立核对 `aapt dump badging`、`apksigner verify --verbose --print-certs`、APK 文件和 ZIP 中的 ABI。

- 输出 `artifacts/knoop-v0.1.10-arm64-release.apk`，13,567,302 bytes（12.94 MiB），比 B 增加 32,768 bytes，约 0.24%。仅有 `arm64-v8a`，原生库 10,876,960 bytes，`.symtab` 不存在；frontend 1.64 MiB、DEX 1.92 MiB。
- 实测 `com.kehai.knoop`、versionName 0.1.10、versionCode 111，身份与版本未改。
- v2/v3 签名验证通过，1 个签名者，证书 SHA-256 与基线/A/B 一致：`c186a82aaf6913c599249e624e0db58fb3f6ebaddfa649d3a666aec905f42f1a`。
- APK SHA-256：`2535AADA2EBF2E2BA58259845A78AF565BB2F608BE73EF920C9D9F357D937765`。
- Vite 报告单 JS chunk 586.04 kB 的体积提示，前端增加主要来自预编译新格式校验器；未为此超范围拆分 UI。Gradle 的 SDK XML/实验选项/弃用提示仍存在，构建成功。没有把这些提示描述为零警告。

## 未验证与下一阶段建议

Android 真机/模拟器、WebView 文件选择/分享、Tauri Android IPC、低存储、系统杀进程和覆盖安装/重装均未测试；故障注入与桌面原生 SQLite 通过不能等同于真机通过。未连接设备或安装 APK。

先使用应用外备份与安全测试数据，执行真机导出→空库恢复→逐项对账、prepared/committed 中断恢复和同签名覆盖安装；清数据/卸载演练只在备份已保存在应用外并确认可读后进行。确认 A–C 真机结果后，再授权 D 的高频学习 UX；C 到此停止，等待用户指令。
