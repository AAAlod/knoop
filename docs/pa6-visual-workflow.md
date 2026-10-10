# PA6 真机视觉检查工作流

本工作流于 2026-10-09 在汉王 Clear6 Plus 上验证。它用于后续 Knoop 墨水屏 UI 的截图检查、修改和复测；具体基线结果见 [兼容性验证记录](pa6-compatibility-validation.md)。

墨水屏适配的 Review、实施阶段和验收标准见 [适配计划](eink-adaptation-plan.md)。

## 已知设备与开发方向

- 汉王 Clear6 Plus，型号 PA6GB32；ADB 显示 `model:PA6`。
- Android 11 / API 30，ARM64；屏幕 758 × 1024，密度 260 dpi。
- 汉王固件 1.00.71；WebView 83.0.4103.120。
- 应用包名 `com.kehai.knoop`，启动 Activity 为 `.MainActivity`。
- 现阶段优先适配该设备的墨水屏学习体验，通用 Android 手机和平板适配安排到 2027 年再推进，详见 [README](../README.md)。

## 连接设备

USB 文件传输（MTP）只能读共享存储；控制应用需要设备上的 ADB 调试和电脑授权。

在 PA6 的设置页面，连续点击上方信息区的 **“产品名称”**，可以显示隐藏的 **“工厂功能”** 入口。通过该入口开启调试，连接 USB 后在设备上允许电脑调试。首次授权需用户在设备上完成；已授权且正常连接时直接继续检查。

Windows 默认 Android SDK 安装下，ADB 可通过以下环境变量路径定位：

```text
%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
```

以下命令在项目根目录的 PowerShell 中运行。先查询设备，再把 `$pa6Serial` 设置成实际列表中 PA6 对应的序列号；不要假设列表里的第一个设备就是 PA6。

```powershell
$pa6Adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
rtk proxy $pa6Adb devices -l
$pa6Serial = 'YOUR_PA6_SERIAL'
```

正常状态为 `device`；`unauthorized` 需要设备确认授权，`offline` 或列表为空时需排查连接。电脑的完全权限不能替代设备授权。

设备信息可用以下命令重新确认，固件或 WebView 更新后应更新验证记录：

```powershell
rtk proxy $pa6Adb -s $pa6Serial shell getprop ro.build.version.release
rtk proxy $pa6Adb -s $pa6Serial shell getprop ro.product.cpu.abilist
rtk proxy $pa6Adb -s $pa6Serial shell wm size
rtk proxy $pa6Adb -s $pa6Serial shell wm density
rtk proxy $pa6Adb -s $pa6Serial shell dumpsys webviewupdate
```

## 获取并检查当前截图

将截图保存在 `artifacts/pa6-validation/`。该目录被 Git 忽略，可使用明确的文件名区分修改前后及场景；持久结论写入文档，不能只依赖本地截图。

```powershell
New-Item -ItemType Directory -Force -Path artifacts/pa6-validation | Out-Null
rtk proxy $pa6Adb -s $pa6Serial shell screencap -p /sdcard/Download/knoop-adb-probe.png
rtk proxy $pa6Adb -s $pa6Serial pull /sdcard/Download/knoop-adb-probe.png artifacts/pa6-validation/current.png
rtk proxy $pa6Adb -s $pa6Serial shell rm /sdcard/Download/knoop-adb-probe.png
```

生成后用图像查看工具读取电脑上的 PNG；在 Codex 中可使用 `view_image`，路径为项目目录下的绝对路径。先检查当前画面，再决定下一步操作。截图和拉取分开进行，可避免旧版 Windows PowerShell 的二进制重定向损坏 PNG。这里只删除本工作流自己创建的临时截图。

启动后可能先截到尚未加载完成的画面，应短暂等待后重新截图；不要用启动瞬间的空画面直接判定白屏。

## 操作与排查

ADB 支持点击、滑动、返回键、键盘导航及启动应用。以下坐标只是已用过的示例，必须根据新截图调整：

```powershell
rtk proxy $pa6Adb -s $pa6Serial shell am start -W -n com.kehai.knoop/.MainActivity
rtk proxy $pa6Adb -s $pa6Serial shell input tap 380 264
rtk proxy $pa6Adb -s $pa6Serial shell input swipe 380 810 380 280 500
rtk proxy $pa6Adb -s $pa6Serial shell input keyevent 4
```

常用键值：`4` 返回，`19/20/21/22` 上/下/左/右，`61` Tab，`66` 确认，`67` 删除，`123` 移至末尾。每次操作后获取新截图确认结果；软键盘出现、滚动、字号或窗口边距改变都会让旧坐标失效。

系统文件选择器的部分条目对 ADB 模拟点击没有响应。本轮用户确认手动选择文件可用；键盘导航也可用于排查。遇到这种情况，区分模拟输入限制与应用功能错误，必要时请用户完成一次手动选择后继续验证。ADB 文本输入的空格也曾不稳定，不应将注入的字符串直接当成用户预期输入。

本机已有 Git 忽略的便利脚本 `.local-workflow/pa6-validate.ps1`，支持截图、点击、返回、上滑及会话目录跳题。脚本中的序列号与跳题坐标针对本轮设备和布局；先检查脚本和当前画面。干净检出中没有该脚本时，使用上述命令即可复现工作流。

## PA6 机身实体键

2026-10-10 用户实物确认本台 PA6 **只有电源键**，没有机身翻页键或音量键。T9 的输入设备 / 键位调查见 [实体键调查记录](eink-t9-acceptance.md)。驱动声明的方向码或 GPIO 自定义码不能作为机身翻页键存在的证据，也不能用 ADB 模拟成功代替实际按键采集。

当前不新增机身按键翻屏映射，电源键保留系统休眠 / 唤醒行为，阅读使用触屏上屏 / 下屏。外接输入设备尚未测试，未来适配需先采集实际事件，并保护输入焦点与草稿。

## 当前固件的手动全屏刷新

2026-10-10 T10 已验证当前 PA6 / API 30 / 增量固件 `eng.hanvon.20250524.095811` 的 `android.os.EinkManager.sendOneFullFrame()`：Knoop 签名 Release 以普通应用 UID 调用，用户确认出现全屏闪黑。入口为首页「屏幕刷新」。仅手动请求，不修改全局模式，不自动全刷；其他设备或固件降级为系统默认刷新。详见 [T10 验证记录](eink-t10-acceptance.md)。

`HanvonEbk.setWvMode()` 在本固件中为空实现，不能依据返回 0 声称刷新成功；`EinkManager.setMode()` 则修改全局模式，本轮未接入。手动全刷成功不能证明日常闪烁减少或残影改善。

ADB shell 的 `getprop sys.eink.*` 在本机被 SELinux 限制读取，空输出不能当作实际值。必要的只读服务核对方法及证据见 T10 记录；不要猜测事务码、写入全局属性或绕过设备权限。

## 修改和复测循环

1. 确认 ADB 设备已授权，记录版本、屏幕与 WebView，截图复现待修改页面。
2. 检查文字、公式、控件边界、顶部与底部遮挡、滚动可达性和无需辨色的状态提示，再修改对应代码。
3. 运行适用的代码检查。常用入口为 `rtk proxy npm run check:ci`；按改动和失败情况补充必要验证。
4. 对应用代码或发布元数据改动，运行 `rtk proxy pwsh -NoProfile -File .local-workflow/build-my-release.ps1`，确认输出 APK 的版本、ARM64 架构和签名结果。该脚本与签名工具是本机私有文件。
5. 使用实际构建输出覆盖安装，保留现有学习数据：

   ```powershell
   rtk proxy $pa6Adb -s $pa6Serial install -r artifacts/knoop-v0.1.12-arm64-release.apk
   rtk proxy $pa6Adb -s $pa6Serial shell am start -W -n com.kehai.knoop/.MainActivity
   ```

   上述 APK 名称是当前版本的例子；以后必须使用构建输出报告的实际路径。若需要停止旧进程以重新加载，使用 `shell am force-stop com.kehai.knoop`，不要通过卸载或清除数据重置环境。
6. 重新进入修改场景，截图比较并操作复测；涉及状态保存时，强制停止后冷启动确认结果仍在。
7. 将版本、场景、通过与未测项目、截图和日志位置写入验证记录。新包生成后核对或更新相邻 SHA-256 文件，避免沿用旧包摘要。

使用合成题库进行验证，现有样本在 `artifacts/device-tests/`，可通过 `rtk proxy npm run fixtures:device` 生成。保留设备上的学习数据，备份替换和在线 AI 不是普通视觉检查的必要步骤。

## 验收边界

截图可直接验证布局、内容、公式、状态文字与操作后的结果。本轮基础运行和数据保存已打通，可以据此持续迭代墨水屏 UI。

截图仍是系统帧缓冲中的图像，不包含实体墨水屏残影、刷新闪烁或实际对比度；这些效果需要用户观察实物。对自动刷新接口的接入也需要可靠资料和真机验证，不能只凭截图声明通过。

设备不在线时仍可进行代码检查和其他环境的布局检查，但应明确记录“PA6 真机未复测”，不要把它们等同于真机验收。
