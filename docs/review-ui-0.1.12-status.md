# 0.1.12 UI / 文案 / 心智模型整改

依据：用户提供的 `knoop-ui-copy-ux-review-2026-10-09.md`（静态 Review）；本轮版本由用户选择为 0.1.12 / Android code 113。

## 基线

- 起点 main：`f24991d05d960e406edc963dcd5ace79cd6e6db0`；工作区干净，与 origin/main 一致。0.1.11-alpha 标签与旧 APK 保留。
- main.ts / style.css blob 与 Review 对应：`22f58da3b269246b9e9ead9aedee51aff9199084` / `6b306dc7f1d0ce39508e582fafc734a20deda856`。
- 新增 `scripts/test-review-ui.mjs`，在原始 HEAD 的源码上运行：7 个整改断言失败，1 个运行安全检查通过。证据：`artifacts/review-ui/baseline.json`。
- 合成题库：20 单选 + 1 多选 + 1 背诵；本次随机数量填 3，保存方案实际记录 21，确认设置不一致。整章选择显示内部节点数量，目录标题缺少开始/跳转意图，AI 展示“已校验”，答题低频操作并列且无文字结果标识。
- 全部 UI 复现调用合成 SQLite 与模拟原生桥；未发出真实付费 AI 请求。

## 第一提交：文案

- 删除首页副标题、口径解释，保留题库 / 总 / 可刷 / 背诵四个数值；错题及统计说明默认折叠。
- 统一练习、方案、AI 题组等名称，压缩提交、自判、搜索、完成页按钮，移除无信息增量的空状态说明。
- 用户数据、题库协议、数据库身份、应用 ID、签名配置及数据操作语义均保持原状。版本元数据升至 0.1.12 / 113。
- 验证：`npm run check:ci` 通过；`npm run test:review-a -- --ui` 10 / 10 通过，包括保存/送审/Enter 和独立计数。
- `.local-workflow/build-my-release.ps1` 构建通过：0.1.12，ARM64，签名 v2/v3 验证通过，strip 通过；日志 `artifacts/review-ui/release-step1.log`。
- 首次构建因误改 winapi-util 的锁定版本失败；已恢复该依赖至原版本 0.1.11，再完整构建通过，无依赖升级。

真机覆盖安装、Android 字体/键盘/旋转及真实 AI 服务尚未测试。
