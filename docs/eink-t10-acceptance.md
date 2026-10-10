# T10：厂商刷新能力验证

日期：2026-10-10。用户决定放弃 T9，并授权继续 T10。目标是调查当前 PA6 固件的真实接口、普通应用调用能力及降级方式。用户已反馈实体屏闪烁持续存在；本项不能用截图或软件调用成功宣称闪烁改善。

## 固件调查

设备为 HANVON Clear6 Plus（PA6 / PA6GB32），Android 11 / API 30，固件界面版本基线 `1.00.71`；本轮读取的系统增量标识为 `eng.hanvon.20250524.095811`。只读查询和由设备复制的固件文件保存在 Git 忽略的 `artifacts/eink-t10/`，不将系统 JAR / APK 加入仓库。

| 证据 | 观察与结论 |
| --- | --- |
| `service list` | 存在 `eink: [android.os.IEinkManager]`。日志 `services.txt`。 |
| `framework.jar` | `android.os.EinkManager` 提供 `getMode()`、`setMode(String)`、`sendOneFullFrame()`；这些方法在当前 DEX 中标为公开 SDK / core platform API。类或方法存在仍不等于普通应用调用已验证。 |
| 单次全屏请求 | `sendOneFullFrame()` 增加进程内序号，经 IEinkManager 写 `sys.eink.one_full_mode_timeline`，不是 WebView 黑白遮罩或 CSS 反色。该接口没有硬件完成回执；必须区分请求已发送与实体屏已刷新。 |
| 模式 setter | `setMode(String)` 写全局 `sys.eink.mode`，不是单窗口局刷设置。系统服务还把模式字符串 `7 / 8` 改成 `9`；不能照搬其他厂商或设备的数字含义。全局设置影响其他应用，并且进程被杀后无法保证恢复，本轮不调用它。 |
| 旧版 HanvonEbk | 当前固件的 `android.hwebook.HanvonEbk.setWvMode(int)` 直接返回 0，`getWvMode()` 也直接返回 0；`forceUpdate / onceUpdate` 最终调用这个空实现。不能把返回 0 视为刷新成功，未接入这条路径。 |
| 服务实现 | `EinkService.setProperty()` 中未见调用者权限检查，但它会捕获属性写入异常而不提供成功回执。普通应用调用和属性变化另做实机验证，不从 shell 权限推断应用权限。 |
| 公开资料 | 查阅了[汉王云开发平台](https://developer.hanvon.com/)及针对 Hanvon / PA6 / EinkManager 的搜索，未找到可核对本固件的公开刷新 SDK 文档。本轮结论主要依据用户授权设备中的当前固件；未将其他品牌的接口当作汉王支持证据。 |

相关反汇编摘录为 `framework-eink.txt`、`services-eink.txt`、`hanvon-refresh-methods.txt`。原始文件 SHA-256：

- framework.jar：`1856ff428cdea19304d3a9fadacc95abf446634aa777f136eb34c8cd066b66c0`。
- services.jar：`c1de2f1263c64fe9799a480b42a97e428bc5663ced6cd5b488311efeb4519da2`。

## 最小接入及边界

- 首页增加「屏幕刷新」，进入后只读检测能力；手动点「全屏刷新」才发出单次请求。请求不提交答案、不推进进度、不调用 AI、不自动重试，也不修改系统模式。
- 原生桥仅允许已调查的 HANVON PA6、API 30 和上述增量固件；通过公开方法反射调用厂商类。没有绕过隐藏 API 限制、申请系统 / root 权限或暴露通用属性 setter。
- 缺少服务、方法、固件不匹配或插件加载失败时正常降级，继续使用系统默认刷新。原生与前端均拦截连续请求，至少间隔两秒；请求只在应用窗口有焦点时执行。
- 一次 WebView 帧更新用于让合成器消费厂商单帧请求；它本身不被称为硬件全刷。界面仅报告「已发送刷新请求」，实际刷新及残影效果交用户观察。
- 没有自动局刷、每 N 题全刷或自动模式切换，也没有证据说明日常闪烁已降低。厂商方法的进程内序号与系统属性可能在进程重启后重复，因此单次请求能否被显示链路消费仍需实物确认；必要时隔两秒再次手动请求，不通过自动连刷掩盖限制。

## 验证与产物

| 项目 | 结果 |
| --- | --- |
| 本地统一检查 | `npm run check:ci` 退出 0，含 96 项 UI 回归（既有 88 项 + 原生入口 / 降级专项 8 项）。见 `check-ci.log`、`browser/regression.json` 和其他专项的 `*-regression.json` 快照。远端 Actions 本轮未推送执行。 |
| 自动化边界 | 隔离 SQLite 检查支持 / 不支持 / 插件异常、请求失败恢复、重复点击及冷却、页面离开后的异步竞态、窄屏 / 大字和学习统计隔离。浏览器使用原生 mock，不据此宣称真实硬件接口通过。 |
| 签名构建 | 私有 `.local-workflow/build-my-release.ps1` 成功，Rust / Kotlin / R8 / strip 检查通过。aapt 核对 `0.1.12 / 113`、仅 `arm64-v8a`；apksigner 核对 v2 / v3 签名。见 `release.log`、`apk-badging.txt`、`signing-verify.log`。 |
| APK | `artifacts/eink-t10/knoop-v0.1.12-eink-t10-arm64-release.apk`；13,616,454 字节；SHA-256 `ead93175e11d55a6b3f5ee4d624545e8104f951a49893d4996d9deb3e8ae84e5`。侧文件及 `apk-metadata.json` 已更新。 |
| 签名身份 | 证书 SHA-256 `c186a82aaf6913c599249e624e0db58fb3f6ebaddfa649d3a666aec905f42f1a`，与原安装一致。 |
| PA6 安装 | `adb install -r` Success，设备 base.apk 摘要与本轮任务 APK 一致。设备自动锁屏，用户手动解锁后 MainActivity Status ok，首页正常。见 `device-install.log`、`device-start-unlocked.log`、`device-apk-sha256.txt`。 |
| 普通应用调用 | 签名 Release 的 `KnoopEink` 日志确认 UID `10163`，能力检测成功，`sendOneFullFrame()` 请求正常返回；每次调用前后 `getMode()` 均为 `9`。没有通过 shell 代替应用发送请求。见 `native-final.log`。 |
| 只读核对 | shell `getprop` 被 SELinux 的 `vendor_ebook_prop` 读取限制拒绝，空输出不能解释为属性为空或请求失败，初始 `refresh-before/after.json` 不作为状态变化证据。依据当前 IEinkManager Stub 的常量确认事务 6 为只读 `getProperty`，通过系统服务读取实际值；用户操作期间请求序号由 `2` 变为 `6`，模式始终为 `9`。见 `timeline-service-before/after.txt`、`mode-service-before/after.txt`，没有用裸 Binder 写入。 |
| 实物观察 | 用户于 2026-10-10 手动点击后明确反馈「有全屏闪黑」。这验证了本轮手动请求在当前设备上触发实际全屏刷新；用户未确认残影减轻或日常闪烁改善，因此这两项仍未验证。 |

安装后首页截图 `artifacts/pa6-validation/eink-t10-installed-home.png` 显示题库 1、总 31、可刷 28、背诵 3、错题 1、收藏 0、继续背诵 1 / 3。本轮安装前截图为用户停留的选择模式页，没有安装前首页计数对照，因此不把与旧轮首页不同的错题 / 进度归因于本轮安装。开发侧没有开始练习、提交答案、保存编辑 / 笔记或读取设备学习数据库。

实机刷新入口及反馈截图为 `eink-t10-native-ready.png`、`eink-t10-native-requested.png`、`eink-t10-native-idle.png`、`eink-t10-user-full-refresh.png`。开发侧仅触发一次原生请求探测，后续点击和实体屏观察由用户完成。ADB 截图用于核对布局和反馈，实物全屏闪黑的结论来自用户观察。

## 用户测试清单

1. 首页打开「屏幕刷新」，应显示本设备可请求全屏刷新。只进入页面时不应由 Knoop 自动发出全刷请求；页面切换本身仍可能触发系统刷新。**本轮已确认入口与能力提示正常。**
2. 点「全屏刷新」，应显示「已发送刷新请求」，请观察实际屏幕是否产生一次清晰的全刷、已有残影是否减轻。若没有可见效果，隔两秒再点一次并反馈；不要仅凭提示判通过。**用户已确认全屏闪黑，无需为此重复测试；残影改善未确认。**
3. 快速连点时只应发出一次请求，按钮短暂禁用后恢复；返回再进入、切到后台再返回仍正常。此处允许主动全刷出现闪烁，不代表平常操作的闪烁已经解决。
4. 返回练习确认原有草稿、选择和进度仍在，阅读、提交及翻题按原方式运行；观察日常闪烁是否依旧。无需为测试重复作答或在线生成题组。

## 验收状态

签名 Release 已覆盖安装，普通应用请求与实体全屏闪黑已验证。支持范围仅为当前固件的手动全屏刷新；尚无已验证的可靠自动局刷方案，日常闪烁未标记为解决。

用户于 2026-10-10 要求先推送当前成果，部分问题后续解决。本轮暂停进一步适配；日常闪烁、自动局刷、残影改善和上述清单第 3 / 4 项的剩余手测保留为待办。不能将源码推送或单次全刷成功扩展为全部刷新策略适配成功。
