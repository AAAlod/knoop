# 工作包 F：基础检查与 0.1.11 实机交付

开始 HEAD `ab17b38`，工作区干净。按用户授权在 D/E 独立验证、提交后进入 F。没有推送、发布、设备安装或真实 AI 请求。

| ID | 结果与验证证据 |
|---|---|
| E01 | 新增 GitHub Actions：只读权限、Node 24、npm ci、同一 `check:ci` 入口；TypeScript/Vite、仓库检查、AI/临时组/批次与 A/B/C SQLite 回归，不含签名密钥或 APK 发布。实际入口注入 TS2322 得到退出 2，注入 AI 测试断言失败退出 1，恢复文件后完整入口退出 0；`artifacts/review-f/ci-failure-probes.json`。依赖用 `npm ci --offline` 成功安装。没有推送，所以 GitHub 托管 runner 尚未执行；这不是托管 CI 通过证据。基础 Ubuntu CI 不安装 Tauri GUI/Android 原生工具，Rust 在本地另验。 |
| E02 | README、package/lock、Tauri、Cargo/lock、Android versionName 一致为 0.1.11；versionCode 111→112。保留全部 CHANGELOG 历史，补齐 A–F，发布构建先执行版本一致性检查。 |
| E03 | 先用合成密码/模拟 signer 复现旧脚本强制中断遗留明文文件。本机 apksigner help 证实 `env:` 支持，现脚本不写临时密码。正常/失败/强制中断三条探针无文件、无密码回显，证据 `signing-baseline.json` / `signing-regression.json`。这些是模拟签名进程测试；真实签名由最终 Release 单独证明。私有脚本已有进程环境 finally 清理，未变更原 Keystore/别名/应用身份。 |
| E04 | 在 D/E 中随具体行为提取 `directory-search.ts` 和 `ai-drafts.ts`，纯目录逻辑只依赖类型；草稿复用已有单向事务接口。F 的 CI、签名探针及夹具生成是独立脚本，没有再整体重构 UI/数据库。新业务边界均有必要的行为测试。 |
| E05 | 未加入账号/同步、复杂调度、RAG、Agent 框架、动态主题、统计图表或品牌动画。 |

变更文件：`.github/workflows/checks.yml`、`scripts/check-ci.mjs`、`scripts/test-ci-guards.mjs`、`scripts/test-release-signing.mjs`、`scripts/build-android-release.ps1`、`scripts/check-repo.mjs`、`scripts/generate-device-fixtures.mjs`、`scripts/test-device-fixtures.mjs`、`scripts/review-test-harness.mjs`；`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`、`src-tauri/gen/android/app/tauri.properties`；`README.md`、`CHANGELOG.md`、`docs/BUILDING.md`、`docs/device-test-checklist-0.1.11.md`、本报告。没有更改正式题库协议、数据库文件身份、应用 ID 或签名 Key。

最终自动回归：A 10、B 21、C 19、D 8、E 9 组全部通过；B 34 个写入故障位置及 C 35 个恢复写入故障位置回滚通过；Rust 4 项通过；三个既有 AI/临时组/批次套件、构建/仓库检查通过。生成夹具全部按实际 runtime 校验；1.1 完整状态恢复后所有表/偏好/统计一致，1.0 显式迁移、无效文件预期拒绝。夹具 UI 4 项通过（merge 计数、两阶段恢复、无 Key 的草稿/错题/已校验批次保存、摘要错误拒绝），0 真实请求。模拟适配器与桌面 Chrome 测试不等同于 Android WebView/IPC。

测试包包含 11 个 JSON 测试输入、manifest、README 与逐项 CHECKLIST：综合 31 项、merge、纯背诵、部分失败 Bundle、无效答案、100/1,000/10,000 题压力、含非空草稿的 1.1 完整学习备份、旧 1.0 备份和坏摘要备份。离线备份由隔离内存库生成，不复制真实用户数据或 Key。内容计数与操作用途在 manifest/清单中明确；恢复文件完整替换，先保存用户外部备份。

尚未验证：Android 覆盖安装、真正强停/事务中断、软键盘/导航栏/旋转/字体、真实网络 TLS/取消/计费、真实模型质量；GitHub 托管 CI。下一阶段先由用户按清单在实机验收，只修复有操作步骤和证据的反馈，不自动扩展下一工作包或发布。

最终 Release：`.local-workflow/build-my-release.ps1` 成功，环境变量传密码的真实签名通过；独立 aapt/apksigner 验证 0.1.11/code 112、`com.kehai.knoop`、仅 arm64-v8a、v2/v3 签名、strip 无 .symtab。证书 SHA-256 `c186a82aaf6913c599249e624e0db58fb3f6ebaddfa649d3a666aec905f42f1a` 与基线一致；没有签名临时密码文件。APK 13,571,398 bytes，SHA-256 `735E7A2B5D3B70C0A09C98D89C63D642CF8813B0218B49DCDE21AB54D0429C4F`，位于 `artifacts/knoop-v0.1.11-arm64-release.apk`，另有 `.sha256` 文件。合成测试 ZIP 155,895 bytes、SHA-256 `D430EE6C51284C03B0C90066BE3E5BE37CDF36B1F3354D0DF4962E645111C7D3`，只包含 14 个测试 JSON/Markdown 文件，无 APK/签名材料。Vite 既有大 chunk 警告、SDK XML/Gradle 弃用警告未阻断构建；本轮未据此进行额外 UI/依赖重构。
