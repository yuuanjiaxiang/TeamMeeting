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
| `users` | 账号、姓名、角色、用户类型、密码哈希、认证来源、企业身份标识和启用状态 |
| `org_units` | 可配置组织树、路由标识、可见范围、默认用户类型与 SSO 群组映射 |
| `user_types` | 管理员自定义的用户类型、版本号、四类业务参与开关，以及保留的 `guest` 访客模板 |
| `module_permissions` | 用户类型对模块的查看、新增、修改、删除权限 |
| `members` | 与用户关联的成员画像、头像、标签、职责和排序 |
| `auth_sessions` | 持久化登录会话、设备摘要、最后活动时间、到期和撤销状态 |
| `login_attempts` | 按账号和来源地址统计失败次数及临时锁定时间 |
| `sso_login_states` | OAuth2/OIDC 登录的一次性 state 摘要、nonce、PKCE verifier、回调地址和有效期 |

`users.user_type` 必须指向一个启用的、非访客用户类型。删除类型采用停用方式，且仅在没有有效用户引用时允许执行。`guest` 仅代表未登录访问范围，服务端会强制其所有写权限和业务参与开关为关闭。

`users.employee_id` 保存工号并使用不区分大小写的唯一索引，是 SSO 与用户管理的业务关联键。企业身份使用 `users.auth_source='oidc'` 或 `'oauth2'`，并以唯一的 `external_subject=<provider>|<sub>` 保存稳定身份；工号变化时仍可通过主体识别用户，但发生工号冲突会拒绝登录。`sso_login_states` 只保存短期登录事务，成功或过期后会被清理；Client Secret 存在 `system_settings` 或进程环境变量中，API 永不回显明文。

`users.org_unit_id` 指向账号所属组织。`org_units.parent_id` 构成树，兄弟节点的 `slug` 唯一，完整路由由祖先 slug 组合生成。`visibility_mode` 为 `all/subtree/unit`；`sso_groups` 保存 JSON 数组。`team_posts.org_unit_id` 和 `meetings.org_unit_id` 记录内容创建时的组织上下文：会议和公告可向后代组织只读透传，写入仍以原组织为准。其余以用户为主体的数据通过关联用户组织过滤。`thank_you_votes` 同时关联发送人和接收人，用于计算跨团队动态可见范围；排名归属始终取接收人组织。

`user_types.include_in_members/include_in_morning/include_in_rules/include_in_thanks` 控制当前名单展示与新业务数据写入，不删除历史事实。`user_types.version` 和 `morning_items.version` 用于乐观并发控制，更新语句必须同时匹配客户端读取到的版本号。

### 团队交流

| 表 | 用途 |
| --- | --- |
| `team_posts` | 团队讨论主题，包含分类、状态、标题、浏览量、置顶和软删除字段 |
| `team_post_replies` | 支持父子关系的楼中回复 |
| `team_post_reactions` | 主消息快捷回应 |
| `team_reply_reactions` | 回复快捷回应 |
| `member_posts` | 早期成员评论兼容数据 |

`team_posts.deleted_at` 与 `deleted_by` 用于主题软删除。回收站以 `team_post` 作为实体类型；恢复时只清空主题删除标记，彻底清除时由外键级联删除回复与回应。作者可以维护自己的主题，管理员承担公告、置顶和恢复治理职责。

### 会议与早例会

| 表 | 用途 |
| --- | --- |
| `morning_items` | 每日事项、状态、优先级、风险、继承链和进展 |
| `meetings` | 会议日期、开始时间、主题、摘要、创建人和阶段 |
| `meeting_items` | 议题、纪要、负责人、时间盒、会前材料和顺延来源 |
| `meeting_topic_types` | 管理员维护的一级议题分类和颜色 |
| `meeting_topic_options` | 隶属于一级分类的二级预设议题、周期和默认准备信息 |
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

`system_settings.red_black_show_black_points` 和 `red_black_show_black_details` 分别控制普通用户是否可见黑榜汇总及明细。它们只改变读取范围，不删除或改写历史积分事实。

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

- 密码以加盐哈希保存，会话令牌仅保存摘要；数据库仍包含员工和业务信息；
- 限制 `data/` 目录的 Windows 文件权限；
- 不把数据库放在公开共享目录；
- 不在截图、Issue 或日志中暴露账号、事实依据和审计详情；
- 对外提供服务前必须增加 HTTPS、访问控制和安全加固。
