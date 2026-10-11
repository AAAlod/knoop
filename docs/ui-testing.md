# UI 自动检查

使用 Node.js 24。UI 专项运行真实应用入口、CSS 与 KaTeX 字体，数据库使用隔离的内存 SQLite，原生桥由测试替身提供；不会读取 PA6 学习数据或调用付费 AI。

## 干净检出的运行方式

在项目根目录执行：

```sh
npm ci
npm run setup:ui
npm run check:ci
```

`playwright` 在开发依赖与锁文件中固定版本；`setup:ui` 下载该版本配套的 Chromium。Linux 如缺少浏览器系统库，使用 `npx playwright install --with-deps chromium`，与 CI 的安装步骤一致。无需私有模块目录或预装 Chrome。

只运行 UI 可使用 `npm run test:ui`。该入口依次执行：

| 命令 | 覆盖范围 | 输出 |
| --- | --- | --- |
| `test:review-ui` | 既有产品流程、状态和数据隔离 | `artifacts/review-ui/` |
| `test:eink-ui` | 黑白状态、禁用和焦点、真实公式资源 | `artifacts/eink-t1/browser/` |
| `test:eink-layout` | 窄屏、大字、间距与触控尺寸；PA6 首页 AI 入口、顺序 / 随机模式操作同屏可达 | `artifacts/eink-t2/browser/` |
| `test:eink-bottom` | 动态底栏、同行菜单、键盘视口与草稿 | `artifacts/eink-t3/browser/` |
| `test:eink-search` | 无 inert、中文组合输入、过期点击、保存等待、万题目录 | `artifacts/eink-t4/browser/` |
| `test:eink-reading` | 固定顶栏、阅读位置、编辑 / 目录往返、新题与临时组 | `artifacts/eink-t5/browser/` |
| `test:eink-paging` | 上屏 / 下屏、边界、长文与公式覆盖、字号 / 键盘、草稿与判分隔离 | `artifacts/eink-t6/browser/` |
| `test:eink-feedback` | 持续错误与关闭、就近成功反馈、草稿重试、失败恢复与保存忙碌 | `artifacts/eink-t7/browser/` |
| `test:eink-updates` | 收藏 / 快刷 / 背诵展开 / 同题判分的节点保留、公式渲染范围、焦点草稿和提示稳定性 | `artifacts/eink-t8/browser/` |
| `test:eink-native` | 全屏刷新入口、能力缺失降级、重复请求 / 冷却、异步页面竞态和学习数据隔离；硬件接口另做 Release 实机验证 | `artifacts/eink-t10/browser/` |

每套写入 `regression.json` 和相关截图，失败返回非零；统一入口在任一套失败时停止。`.github/workflows/checks.yml` 安装浏览器及系统依赖后执行同一 `check:ci`，失败时上传 UI 证据。远端工作流是否通过，以实际 Actions 运行结果为准。

可选环境变量 `CHROME_PATH` 指定其他浏览器，`PLAYWRIGHT_MODULE_PATH` 指定调试用模块；它们不是正常运行的前置条件。验证标准入口时应清除这两个变量，以避免本机配置掩盖缺失依赖。

## 验证边界

浏览器打包目标为 `chrome83`。搜索测试另外移除现代浏览器的 inert 行为，固定虚拟时钟来重复触发 debounce / IME / 保存等待竞态；大题库检查限制每批渲染数量并保留原始题号。虚拟时钟用于控制事件顺序，不能据此测量真实输入耗时或保证 PA6 性能。

现代 Chromium 不能代表 PA6 的旧 WebView、汉王输入法或实体墨水屏。签名 APK、覆盖安装及用户逐项手测仍遵循 [任务记录](eink-task-tracker.md)；安装与截图方法见 [PA6 工作流](pa6-visual-workflow.md)。
