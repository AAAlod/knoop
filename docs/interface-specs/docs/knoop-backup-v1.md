# Knoop Backup 1.0

新版本应用读取 1.0 并显式迁移，导出使用 [Backup 1.1](knoop-backup-v1.1.md)，以覆盖新增待审核草稿。以下保留 1.0 的历史协议定义。

`knoop-backup` 是独立的完整学习状态备份协议，不替代或修改 `knoop-bank` / `knoop-bundle`。公开结构见 `../schemas/knoop-backup-v1.schema.json`，合成空库例子见 `../../../examples/sample-backup.json`。

## 覆盖范围

必填顶层字段：format、version、appVersion、exportedAt、tables、counts、sequences、preferences、integrity。未知顶层字段、表、列和设置键均拒绝。API 配置、API Key、签名材料、设备路径、构建产物不在白名单内。

`tables` 保存 12 张学习表的显式列：banks、nodes、questions、sessions、attempts、favorites、killed_questions、notes、question_reviews、question_answer_revisions、ai_review_groups、ai_review_batch_jobs。主键、JSON 字符串、历史判分、答案修订截止 ID、时间戳保持原值。counts 必须与每张表的行数完全一致；主键唯一，当前题库/节点/题目及学习引用必须有效，JSON 内部结构、题目身份、进度范围须校验。

历史 Attempt 的 session_id 允许引用已删除的跨题库旧会话；临时题组/批次的原题是生成当时快照，允许原正式题目已删除，savedGroupId 允许指向用户已主动删除的题组。不能以这些历史引用为由删除历史记录。偏好中的失效节点/已删除预设 ID 保留，继续使用现有界面的失效提示。

`sequences` 保存 attempts 与 question_answer_revisions 的 SQLite 自增高水位。即使最大记录已被删除，恢复后也不得复用已用于答案修订边界的 ID。必须是安全整数且不低于现存 ID/截止 ID。

`preferences` 只包含 `knoop.scopeCollapsed.v1`、`knoop.enabledBrushTypes.v1`、`knoop.scopePresets.v2`、`knoop.recentScopePreset.v2`。值为原 localStorage 字符串，null 表示不存在。前三项必须能解析并符合既有数据形状。不会遍历 localStorage 或导出其他键。

## 完整性与兼容性

integrity.algorithm 固定为 SHA-256，digest 为 64 位小写十六进制。输入是去掉 integrity 后的整个对象：对象键递归按字典序排列、数组顺序不变、基础值按 JSON 编码；UTF-8 编码后计算 SHA-256。这用于检测缺失/误改，不是签名或来源认证。

1.0 备份可跨相同协议版本的应用恢复，appVersion 为来源提示；未知备份版本拒绝，未来升级须显式迁移，不做猜测。题库中的合法 1.0/1.1 内容继续支持。文件不包含 SQLite 文件路径或外部存储位置。

## 导出与恢复接口约定

导出必须在同一读取快照下核对所有表，先等待草稿落盘。恢复第一版只提供完整替换；不把不同设备主键直接混合。先校验、预览，再生成当前状态的持久安全副本，最后独立确认替换。

学习表删除/插入、自增序列和恢复提交标记必须位于同一原生连接事务。localStorage 与 SQLite 没有共同事务，因此使用持久偏好恢复日志：prepared 保存旧/目标偏好；SQLite 事务内变为 committed。异常或重启时，prepared 恢复旧偏好，committed 完成目标偏好，同步成功后清除日志。恢复同步完成前不得展示新旧混合的学习页面。内部日志与安全副本路径不写入公开备份。

正常失败应恢复原学习表和原偏好；中断重启按日志完成一致状态。真实设备的杀进程与覆盖安装验证需独立标记，不得用桌面 SQLite 测试替代。
