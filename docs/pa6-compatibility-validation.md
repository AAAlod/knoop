# PA6 / Clear6 Plus 真机兼容性验证

验证日期：2026-10-09（Asia/Shanghai）。结论：原始 0.1.12 可安装、启动和导入题库，但无法开始练习；本地兼容修复构建已在真机验证基础练习流程。

## 设备和连接

- 产品：汉王 Clear6 Plus，型号 PA6GB32；ADB 报告 PA6 / HANVON_EBOOK。
- 汉王固件 1.00.71，Android 11 / API 30，ARM64，平台 rk356x。
- 屏幕 758 × 1024，密度 260 dpi。
- WebView：com.android.webview 83.0.4103.120。
- 连点设置上方的“产品名称”可显示“工厂功能”；用户开启调试并授权后，ADB 已可用。
- ADB 截图、标签切换、应用启动、覆盖安装、键盘导航和 Knoop 内的操作均成功。

## 基线问题和修复

1. “开始练习”无响应，用户手动点击也复现。创建会话调用 `crypto.randomUUID()`；此方法的 Chromium 支持始于 92，设备是 83。[MDN 兼容数据](https://github.com/mdn/browser-compat-data/blob/main/api/Crypto.json)。改用 `crypto.getRandomValues()` 生成标准 UUID v4，同步处理练习方案、临时题组、批次和 AI 草稿的 ID 创建。异步创建失败现在也会进入已有错误提示处理。
2. 源码另外使用 `structuredClone()` 和 `Object.hasOwn()`。对 JSON 学习状态及已验证备份使用显式 JSON 快照，别名检查改用 `hasOwnProperty.call`；回归测试通过，但本轮未在设备上进行备份替换或付费 AI 调用。
3. 初始页面标题、返回按钮被状态栏遮挡。Android 11 及以下使用系统窗口边距；真机重启后标题完整显示。
4. 首页计数、题型按钮间距在旧 WebView 上丢失。计数使用网格，题型按钮使用显式外边距。
5. 从长题进入下一题会保留旧滚动位置。下一题完成渲染后回到页顶；最终包已验证页顶标题可见。
6. Vite 的 JavaScript / CSS 构建目标设为 Chrome 83；这只处理编译目标，运行时 API 仍需以上显式兼容处理。

## 真机结果

使用 `artifacts/device-tests/01-basic-bank.json`，设备文件名 `Download/knoop-pa6-test-bank.json`。题库名称含 0.1.11 是既有合成测试包的名字，安装的应用版本为 0.1.12。

| 项目 | 结果与证据 |
| --- | --- |
| 安装、冷启动 | 原始包和修复包均成功，修复包多次覆盖安装，未卸载或清除数据 |
| 文件选择 | 文件选择器对部分 ADB 模拟点击无响应；用户确认手动选择正常。选择返回后解析成功，不能把远程输入限制判定为导入功能失效 |
| 导入预览、确认 | 新增 31 项，单选 20、多选 4、填空 2、背诵卡 2、背诵材料 3；首页显示总 31、可刷 28、背诵 3 |
| 开始练习 | 修复后进入 1 / 28，原始包的阻塞已解除 |
| 长题 | 多次纵向滚动后可达选项和底部提交按钮 |
| 公式 | KaTeX 求和公式显示成功，可横向滑动查看末尾 `=210` |
| 单选 | 错选 B 显示正确答案 A 与错选文字；第二题选 A 显示选对和回答正确 |
| 多选 | 第 21 项选择 A、C 后显示两个选对标记；下一题回到页顶 |
| 目录跳转 | 数字输入、关闭软键盘、跳至 21 / 25 项均成功 |
| 填空 | 软键盘、输入、关闭键盘、提交及不匹配答案的手动判分成功；自动精确判对未单独完成验证，ADB 空格注入表现不稳定 |
| 背诵卡 | 第 27 项可显示答案、解析和下一项按钮 |
| 持久化 | 强制停止并冷启动后保留题库、错题计数和已提交答案；最终停在首页，继续位置 27 / 28，错题 3。位置 27 表示通过目录跳到该项，不代表已答 27 题 |

本轮未覆盖完整发布清单：纯背诵材料流程、收藏/笔记/编辑、备份导出与恢复、大题库压力、在线 AI、TalkBack、横屏及字体缩放仍需后续验证。截图不能验证实体墨水屏残影、闪烁、刷新时间或电池消耗。

## 构建和证据

- `npm run check:ci`：通过，包含构建、仓库检查、旧 API 环境下的 UUID / JSON 快照测试、AI、临时题组、批次与 SQLite 回归。
- `.local-workflow/build-my-release.ps1`：最终构建通过；ARM64 Release，版本 0.1.12 / versionCode 113，签名 v2 / v3 验证通过。
- APK：`artifacts/knoop-v0.1.12-arm64-release.apk`，13,575,494 字节。
- 最终 SHA-256：`eee7b5fad2a1d7f30d16033c23da407dc0384941f811ce5707b435405c2d98e0`，相邻 `.sha256` 文件已更新。
- 原始基线 APK SHA-256：`8a53eaf3c007b305af48f585834bea22ea10234765cd9f23428a756a8f6c2ca5`。
- 本地截图与日志在 Git 忽略的 `artifacts/pa6-validation/`：`release-final.log`、`check-ci.log`、`final-apk.json`、`final-app-log.txt`。
- 关键截图：`29-fixed-home-ready.png`、`34-formula-options.png`、`35-formula-pan.png`、`36-wrong-result.png`、`40-restored-session.png`、`44-multiple-result.png`、`45-next-top.png`、`47-keyboard.png`、`48-blank-result.png`、`52-recall-answer.png`、`53-final-home.png`。

这轮交付是基础兼容修复，本地安装的界面仍为现有主题。后续墨水屏体验适配应优先处理白底黑字、去掉透明底栏和阴影、减少长题滚动，并在获得汉王刷新接口的可靠资料及真机验证后再接入刷新控制。
