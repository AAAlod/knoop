# 0.2.0 Alpha 发布验证

日期：2026-10-11。用户要求推送当前成果、打 `0.2.0 Alpha` tag 并编写墨水屏适配发布变更日志。沿用仓库命名 `v0.2.0-alpha`，GitHub 发布标记为 prerelease，附签名 ARM64 APK 与 SHA-256 文件。

## 版本与构建

- npm / 锁文件、Cargo / 锁文件、Tauri、README、Android 版本统一为 `0.2.0`；Android versionCode 从 `113` 提升到 `114`。应用 ID、签名与题库 / 备份协议保持不变。
- `npm run check:ci` 成功，含 98 项 UI 回归；布局最终实现使用本轮版本重新检查。日志 `artifacts/release-0.2.0/check-ci.log`，专项结果快照为同目录 `*-regression.json`。
- `.local-workflow/build-my-release.ps1` 成功，Rust / Gradle、ARM64 唯一原生库、strip 及签名检查通过。`aapt` 核对 `0.2.0 / 114`、仅 `arm64-v8a`；`apksigner` 核对 v2 / v3 签名。
- APK：`artifacts/release-0.2.0/knoop-v0.2.0-arm64-release.apk`，13,616,454 字节；SHA-256 `a6f511d09d23a488fdef5a2d4c27d8840f9b00f06a2798bc0d07d0c177c65860`。
- 签名证书 SHA-256：`c186a82aaf6913c599249e624e0db58fb3f6ebaddfa649d3a666aec905f42f1a`，与已有 PA6 安装使用的签名一致。
- 产物、版本、签名和校验文件均保存在 Git 忽略的 `artifacts/release-0.2.0/`；签名密钥、密码及系统文件未加入仓库。

## 真机与验收边界

T11 的相同布局此前已使用 `0.1.12 / 113` 签名 Release 覆盖安装 PA6，并检查 17 个位置的前后截图，详见 [布局验收](eink-compact-layout.md)。本次 `0.2.0 / 114` 构建完成时 PA6 已断开，`adb install -r` 返回 device not found；因此本次未安装 0.2.0，也没有 0.2.0 新截图或设备包摘要。

用户要求推送和 Alpha 发布不代表尚未完成的手测已通过。大字号、键盘实物体验和点击舒适度等待办继续保留；日常闪烁仍存在、自动局刷与残影改善未验证。发布说明已明确这些限制，不使用构建或浏览器检查冒充实体屏验收。

发布日志见 [0.2.0 Alpha](releases/v0.2.0-alpha.md) 和 [CHANGELOG](../CHANGELOG.md)。
