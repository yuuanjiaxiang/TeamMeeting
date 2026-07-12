# 数据库、备份与恢复

## 1. 数据文件

默认正式数据库：

```text
data/weekly_team.db
```

相关目录：

```text
data/backups/                         # 系统自动和手动备份
data/deploy/gray/weekly_team_gray.db  # 灰度数据库
data/deploy/backups/                  # 正式发布前快照
data/deploy/releases/                 # 代码发布快照
data/deploy/runtime/                  # 进程元数据和日志
```

这些内容均不应提交到 Git。

## 2. 表结构分组

### 用户与权限

| 表 | 用途 |
| --- | --- |
| `users` | 账号、姓名、角色、用户类型、密码哈希和启用状态 |
| `user_types` | 内部成员、合作方等可配置用户层级 |
| `module_permissions` | 用户类型对模块的查看、新增、修改、删除权限 |
| `members` | 与用户关联的成员画像、头像、标签、职责和排序 |

### 团队交流

| 表 | 用途 |
| --- | --- |
| `team_posts` | 团队对话主消息 |
| `team_post_replies` | 支持父子关系的楼中回复 |
| `team_post_reactions` | 主消息快捷回应 |
| `team_reply_reactions` | 回复快捷回应 |
| `member_posts` | 早期成员评论兼容数据 |

### 会议与早例会

| 表 | 用途 |
| --- | --- |
| `morning_items` | 每日事项、状态、优先级、风险、继承链和进展 |
| `meetings` | 会议日期、主题、摘要和阶段 |
| `meeting_items` | 议题、纪要、负责人、时间盒、会前材料和顺延来源 |
| `meeting_topic_types` | 议题类型和颜色 |
| `meeting_topic_options` | 周期预设议题和默认准备信息 |
| `meeting_topic_links` | 每场会议独立启用的议题类型 |
| `meeting_attendance` | 签到、乐捐金额和收款状态 |

### 业务看板

| 表 | 用途 |
| --- | --- |
| `red_black_rules` | 红黑榜细则 |
| `red_black_scores` | 个人红榜/黑榜积分事实 |
| `machines` | 机台档案 |
| `shifts` | 白班、夜班和工时 |
| `thank_you_votes` | Thank You 记录和事实依据 |
| `links` | 链接、标签、置顶、质量和访问量 |
| `link_categories` | 管理员维护的链接分类 |

### 系统治理

| 表 | 用途 |
| --- | --- |
| `system_settings` | 系统名称和业务参数 |
| `audit_logs` | 关键写操作审计 |
| `backups` | 备份文件及校验、恢复状态 |
| `recycle_bin` | 软删除记录索引 |
| `reminder_reads` | 用户提醒已读状态 |
| `schema_migrations` | 迁移兼容记录 |

## 3. 迁移机制

启动时 `init_db()` 会：

1. 创建不存在的表；
2. 通过 `ensure_column()` 增加缺少字段；
3. 执行幂等的数据兼容更新；
4. 写入默认配置、用户类型和示例基础数据（仅在对应数据为空时）。

验证迁移：

```powershell
python server.py --migrate-only
```

迁移代码必须允许重复执行。不要把 SQLite 数据库文件作为迁移载体提交到仓库。

## 4. 自动备份

系统启动和日常请求期间会检查当天是否已自动备份。相关设置：

- `backup_auto_enabled`：是否启用；
- `backup_retention_days`：自动备份保留天数，0 表示不自动清理。

备份使用 SQLite Backup API，而不是直接复制正在写入的数据库文件，因此可以获得一致性快照。

## 5. 备份校验

系统管理中的“校验”会在独立连接中运行 `PRAGMA quick_check`，并检查关键业务表是否存在。校验通过只表示文件结构可读取，不替代业务层恢复演练。

建议每月：

1. 创建最新手动备份；
2. 校验备份；
3. 在灰度或隔离目录恢复；
4. 登录并抽查用户、会议、早例会、排班和链接；
5. 记录演练时间和结果。

## 6. 一键恢复

管理员选择备份并确认恢复后，系统会：

1. 先校验目标备份；
2. 创建当前数据库的恢复前备份；
3. 使用 SQLite Backup API 覆盖当前数据库；
4. 重新执行 `init_db()`；
5. 记录恢复人、时间、结果和审计日志。

恢复会覆盖当前数据。执行前应停止或通知其他用户，恢复后所有人重新刷新页面并检查关键数据。

## 7. 手工快照

```powershell
python scripts\db_snapshot.py `
  --source data\weekly_team.db `
  --target D:\TeamLoopBackup\weekly_team_20260712.db
```

目标目录应与服务器磁盘分离。不要使用资源管理器直接复制正在频繁写入的 SQLite 文件作为唯一备份方式。

## 8. 数据安全

- 密码以加盐哈希保存，但数据库仍包含员工和业务信息；
- 限制 `data/` 目录的 Windows 文件权限；
- 不把数据库放在公开共享目录；
- 不在截图、Issue 或日志中暴露账号、事实依据和审计详情；
- 对外提供服务前必须增加 HTTPS、访问控制和安全加固。

