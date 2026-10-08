# Review 整改状态：基线审计 + 工作包 A

日期：2026-10-08（Asia/Shanghai）。规格来源：用户提供的《Knoop 0.1.10-alpha｜双轮 Review 整改与 Codex 实施交接》v1.0。授权范围仅基线审计与 A；B–F 未实施，不推送、不发布。

## 基线审计

- 分支 `main`，HEAD `e6a568b7e7b2d49eaa57b76a4ac522a05d5d3752`，与交接一致；初始 `git status --short` 为空，无用户本地修改需要合并。Git 因目录所有者不同报错，使用单次 `-c safe.directory=D:/.knoop`，未更改全局 Git 配置。
- 已阅读仓库 `AGENTS.md`、其引用的 `C:/Users/kehai/.codex/RTK.md`、README、CHANGELOG、BUILDING、接口规范、main/db/ai-review/batch-review/temp-review/grading、Rust AI 实现、公开及私有构建脚本。README 仍写 0.1.3，实际版本 0.1.10；属 E02，仅记录。
- `npm ci` 在沙箱中失败（npm Exit handler never called）；使用本机缓存执行 `npm ci --offline --no-audit --no-fund` 成功，未更改锁文件。
- 基线 `npm run build`、`check:repo`、`test:ai`、`test:temp`、`test:batch` 均实际通过。
- 基线 `cargo test` 在沙箱中因路径解析/OUT_DIR 失败；本机工具链重试通过：1 个 Rust 单元测试，0 失败，无真实 API 调用。
- 私有 `.local-workflow/build-my-release.ps1` 可用，最终代码检查后已执行并通过签名 Release 验证（详情见下文）。

## 数据与测试隔离

- 正式 SQL 身份：`sqlite:knoop.db`；Tauri SQL 插件 2.4.1 将文件解析到 `app_config_dir()/knoop.db`。已核对 Tauri 2.11.5 `PathPlugin.kt`：Android 的 config/data 目录均为 `activity.dataDir`，因此常规主用户路径为 `/data/user/0/com.kehai.knoop/knoop.db`（别名 `/data/data/com.kehai.knoop/knoop.db`；实际设备/多用户路径未连接核实）。Windows 由 Tauri 解析到 `%APPDATA%/com.kehai.knoop/knoop.db`。可能存在 SQLite `-wal`/`-shm` 文件，不对真实库做操作或复制。
- 库内包含 banks、nodes、questions、sessions、attempts、favorites、killed_questions、notes、question_reviews、ai_review_groups、ai_review_batch_jobs。
- localStorage：`knoop.scopeCollapsed.v1`、`knoop.enabledBrushTypes.v1`、`knoop.scopePresets.v2`、`knoop.recentScopePreset.v2`，属于各设备 WebView 的本地存储。
- AI Key 在 `app_data_dir()/ai-config.json`，Android 同样位于 `activity.dataDir`；本轮未读取真实 Key 内容。签名工具与密码文件保持私有、忽略，不改配置。
- 现有导出为 bank/bundle/error-review/repair-review JSON，通过系统分享、浏览器下载或剪贴板，保存位置由用户/平台决定。没有完整学习状态备份；`artifacts/source-backups` 是源码工作流备份，不是学习库备份（F08 延后）。
- 新回归脚本以 `node:sqlite` 建立独立 `:memory:` 库，运行实际 `src/db.ts` SQL；浏览器调用同一独立测试库。用 3 道题（1 道斩杀）+ 2 条 memorization 合成题库，不连接 Android、不访问真实 DB、不调用 AI API。

## 核对与最小实施计划

| ID | 基线判定 | 最小范围 | 验收证据/状态 |
|---|---|---|---|
| F01 | C；浏览器保存实际发生原生导航，submit 事件未取消 | `src/main.ts` 公共按钮 type=button；编辑表单取消 submit；两个保存分支 await 捕获校验错误 | 单/多/填三种题型 × 保存/送审：各写 1 次、不请求新页面、返回收藏原入口；三题型 Enter 保持换行，requestSubmit 被拦截；空题干 0 写入且显示错误。自动通过，真机待验收 |
| U01 | C；首页 summary 缺总内容与 memorization；范围计入斩杀项，模式/会话查询已排除 | `src/db.ts` 总内容/材料计数；`src/main.ts` 范围复用 questionsForScope；首页按启用题型计可刷数 | 5 总内容 / 2 可刷 / 2 背诵；范围、模式、正式会话均为 2 题；停用多选后一致为 1；纯背诵 2 内容可进入 2 项会话；待返修斩杀项排除。自动通过 |
| U02 | C；查询先错后对语义已正确，UI 文案不明确 | `src/main.ts` 列表说明、空状态与统计标签，保留查询语义 | 先错后对：列表移出、当前错题数 0、错误作答次数仍 1、总作答 2、正确率 50%；列表/空态文字一致。自动通过 |
| U07 | UX；已有 480ms 长按及 pointercancel/pointerleave，缺提示 | `src/main.ts` 单/多选加非弹窗提示，`src/style.css` 轻量样式，不改计时器/手势 | 单/多选点选；长按标记/撤销；pointercancel/pointerleave；模拟滚动的 pointercancel 路径均通过。真实触屏滚动待验收 |
| U08 | UX；最近会话缺模式进度；同级入口较多 | `src/main.ts` 主学习入口与会话摘要，常用/AI 次级区保留入口；`src/style.css` 局部样式 | 无库、纯背诵、有库、未完成随机会话 2/2 四状态：320px 布局无溢出，继续入口主色，新练习次色；截图已检查。自动通过，真机待验收 |

先复现 F01/U01，再修复并运行逐项回归；U02 仅修文案；U07/U08 只做低成本局部变化。B 的并发与事务风险没有在本轮故障注入或修复；不将其标记为已证实。

## 最终验证

| 命令/检查 | 实际结果 |
|---|---|
| `rtk proxy npm ci --offline --no-audit --no-fund` | 本机缓存安装通过，锁文件未变化；初次普通 ci 沙箱失败已记录 |
| `rtk proxy npm run build` | 修复后 TypeScript/Vite 通过；沙箱曾报 realpath EPERM，本机环境重试通过 |
| `rtk proxy npm run check:repo` | 通过 |
| `rtk proxy npm run test:ai` | 通过（包含 Vite 产物校验） |
| `rtk proxy npm run test:temp` | 通过 |
| `rtk proxy npm run test:batch` | 通过 |
| `rtk proxy npm run test:review-a` | 4 组真实 SQLite 回归通过 |
| `rtk proxy npm run test:review-a -- --ui` | 合计 10 组检查通过（4 SQLite + 6 浏览器场景组），包含六个编辑保存/送审组合与三题型 Enter/原生 submit/校验 |
| `rtk proxy cargo test`（src-tauri，基线阶段） | 本机环境通过：1 单元测试，0 失败；本轮 Rust 未修改 |
| `rtk proxy pwsh -NoProfile -File .local-workflow/build-my-release.ps1` | Android ARM64 Release 构建、zipalign、签名校验、strip 检查通过 |
| `apksigner verify --verbose --print-certs` 与 `aapt dump badging` | 签名、真实 APK 应用 ID、版本、ABI 核验通过 |
| `git diff --check` | 通过；仅换行规范提示，无 whitespace error |

浏览器用本机 Chrome 无头模式与 Playwright、独立 SQLite bridge 执行真实 main.ts，未运行 Tauri 原生 SQL 插件；SQLite 证明 SQL 行为，不证明插件连接池事务。浏览器在沙箱访问 127.0.0.1 曾失败，已使用本机环境重试。`--baseline` 读取 `git show HEAD` 的 main/db/style 对照：8 组预期断言失败（两组原有数据语义通过）；F01 额外一次真实文档请求、缺 submit preventDefault，U01 显示遗漏均记录。UX 文案/层级断言失败只表示缺少目标行为，不等同于数据风险。

原始证据（Git 忽略）：

- `artifacts/review-a/baseline-ui.json`：基线对照结果。
- `artifacts/review-a/regression.json`、`regression-ui.json`：最终结果。
- `artifacts/review-a/home-{empty,memo,library,resume}-320.png`：320px 浏览器截图；已查看继续会话截图。
- `artifacts/review-a/baseline-v0.1.10-arm64-release.apk`：构建前 APK 副本，用于签名/体积比较，不修改基线副本。

重跑 SQLite 只需已验证的 Node 24 与锁文件依赖。浏览器测试还需本机 Playwright/Chrome，例如：

```powershell
$env:PLAYWRIGHT_MODULE_PATH = 'C:/Users/kehai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
rtk proxy npm run test:review-a -- --ui
rtk proxy node scripts/test-review-a.mjs --baseline --ui
```

## 签名 APK 证据与兼容性

- 输出：`D:/.knoop/artifacts/knoop-v0.1.10-arm64-release.apk`，13,497,670 bytes（12.87 MiB），与保存的基线 APK 字节数相同，未异常上涨。
- 实际 manifest：`com.kehai.knoop`，versionName `0.1.10`，versionCode `111`；native-code 仅 `arm64-v8a`。
- v2、v3 签名验证通过，1 个签名者；新/基线证书 SHA-256 一致：`c186a82aaf6913c599249e624e0db58fb3f6ebaddfa649d3a666aec905f42f1a`。
- APK SHA-256：`890D47E47D68A678C211F6EE1AA7A9AD830C601FFC80879067FA94B2ECB1559A`。
- 仅含 `lib/arm64-v8a/libknoop_lib.so`，10,810,152 bytes；`.symtab` 不存在；frontend 1.48 MiB，DEX 1.92 MiB。Release strip/LTO/opt-level z/panic unwind 未修改。
- 原生库内的前端资源映射包含最终 `index-DNcNkhVQ.js`，不含基线 `index-vE2Q6W-H.js`；新/基线 native SHA-256 不同，确认签名产物嵌入了本轮前端。
- 协议/Schema、数据库名与主键规则、import new/merge 语义、会话存储格式、应用 ID、版本、签名配置均未改变。`recall` 延续现有“刷题题型”选择与计数，不改为新的材料分类。
- 总内容与背诵材料是全库存量（含斩杀/待返修），可刷是当前启用题型中排除斩杀后的可用数量；范围/模式可背数量也按实际可用池排除斩杀。累计作答沿用现存历史记录且排除待返修，当前错题另外排除斩杀。未迁移、重算或删除真实学习数据。

## 变更文件

| 文件 | 原因 |
|---|---|
| `src/main.ts` | F01/U01/U02/U07/U08 的局部行为与文案；新增编辑保存异常捕获 |
| `src/db.ts` | U01 汇总新增总内容、背诵材料及按启用题型的可刷数，仅 SELECT |
| `src/style.css` | U07 提示与 U08 首页局部样式，共 10 行新增，无全局重构 |
| `package.json` | 增加 `test:review-a`，依赖/版本未变 |
| `scripts/test-review-a.mjs` | 实际 SQL 与浏览器回归、合成数据、HEAD 对照、结果/截图输出 |
| `docs/review-remediation-status.md` | 本次审计、任务 ID、证据、兼容性与待真机事项 |

HEAD 保持 `e6a568b7e7b2d49eaa57b76a4ac522a05d5d3752`；以上六文件为本轮未提交修改。没有提交、推送或发布。

## 余留验收与下一阶段建议

1. Android 真机/模拟器均未运行：编辑保存/送审与软键盘 Enter、从原入口返回；单/多选长按及真实触屏滚动取消；320/360px、横屏、系统字体放大；覆盖安装后的题库、作答、笔记、收藏、会话保留。自动浏览器通过不代表这些通过。
2. 签名证书与身份一致只证明覆盖安装前提，尚未实际安装或验证升级保留数据。APK 保持原版本是按本轮不发布范围处理。
3. 下一次授权建议先完成 A 真机验收，再进入 B：优先 F02 的真实 SQLite 故障注入与事务边界核对；F03/F04/F05 的延迟/连续点击复现必须先于互斥/顺序修复。F06 历史答案修订语义需单独决策。B–F 本轮没有改动，不宣称风险已解决。

本阶段已停止，等待用户下一条指令。
