# Team Loop HTTP API

## 1. 通用约定

- 基础地址：`http://<host>:<port>`；
- 数据格式：除静态文件外均使用 JSON；
- 日期格式：`YYYY-MM-DD`；
- 时间格式：本地时间 ISO 8601；
- 登录后由浏览器 Cookie 维持会话；
- 错误响应：`{"error": "可读错误原因"}`；
- 未登录通常返回 401，无权限返回 403，资源不存在返回 404。

示例：

```javascript
const response = await fetch("/api/morning-items?date=2026-07-12", {
  credentials: "same-origin",
});
const data = await response.json();
if (!response.ok) throw new Error(data.error || "请求失败");
```

不要在 URL 查询参数中传递账号或密码。

## 2. 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/login` | 登录，正文包含 `username`、`password` |
| POST | `/api/logout` | 退出并清除当前会话 |
| GET | `/api/me` | 当前用户、权限、模块目录和公开设置 |
| PATCH | `/api/me/password` | 修改当前用户密码 |
| GET | `/api/health` | 服务、环境、版本和数据库健康状态 |

登录示例：

```json
{
  "username": "employee-id",
  "password": "current-password"
}
```

## 3. 用户、成员与权限

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/users` | 查询或创建用户 |
| PATCH/DELETE | `/api/users/{id}` | 修改或软删除用户 |
| GET | `/api/user-types` | 用户类型、模块和操作权限 |
| PATCH | `/api/user-types/{code}/permissions` | 更新某类用户权限 |
| GET/POST | `/api/members` | 查询成员或维护当前成员资料 |
| PATCH | `/api/members/{id}` | 更新成员资料 |
| PATCH | `/api/members/order` | 管理员调整成员卡片顺序 |

用户与成员是一一关联的业务实体。删除用户后历史记录保留，成员列表不再展示该用户。

## 4. 团队对话

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/team-posts` | 获取或发表团队消息 |
| POST | `/api/team-posts/{id}/replies` | 回复主消息或指定父回复 |
| POST | `/api/team-posts/{id}/reactions` | 对主消息添加/取消回应 |
| POST | `/api/team-replies/{id}/reactions` | 对楼中回复添加/取消回应 |
| DELETE | `/api/team-replies/{id}` | 删除自己的回复及子回复 |

服务端会校验消息和回复长度，不应依赖前端 `maxlength` 作为唯一限制。

## 5. 早例会与归档

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/morning-items` | 按日期查询或新增事项 |
| PATCH/DELETE | `/api/morning-items/{id}` | 更新或删除可编辑事项 |
| GET | `/api/morning-items/{id}/history` | 获取事项跨日进展 |
| GET | `/api/archive/years` | 获取可归档年份统计 |
| GET | `/api/archive/search` | 跨会议、对话和早例会搜索 |

历史日期只读。未完成事项由服务端按日继承，客户端不应自行复制。

## 6. 会议沙盘

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/meetings` | 查询或创建单场会议 |
| PATCH | `/api/meetings/{id}` | 更新会议信息或阶段 |
| POST | `/api/meetings/bulk-generate` | 根据预设周期批量生成 |
| PATCH | `/api/meetings/{id}/topics` | 设置本场会议主题 |
| POST | `/api/meetings/{id}/copy-agenda` | 沿用最近会议议题 |
| GET | `/api/meeting-topics` | 议题类型与预设选项 |
| POST/DELETE | `/api/meeting-topic-types[/{id}]` | 新增或停用议题类型 |
| POST | `/api/meeting-topic-options` | 新增预设议题 |
| PATCH/DELETE | `/api/meeting-topic-options/{id}` | 修改或停用预设议题 |
| POST | `/api/meetings/{id}/items` | 添加本场议题 |
| POST | `/api/meetings/{id}/items/reorder` | 提交完整议题 ID 顺序 |
| PATCH/DELETE | `/api/meeting-items/{id}` | 更新纪要或软删除议题 |
| POST | `/api/meeting-items/{id}/carry-forward` | 顺延到下一场可用会议 |
| POST | `/api/meetings/{id}/attendance` | 更新单人成员签到 |

会议阶段值：`draft`、`scheduled`、`in_progress`、`completed`、`archived`。后两种状态锁定议题和纪要。

议题常用字段：

```json
{
  "type_id": 1,
  "title": "TOPTB 温控复盘",
  "detail": "讨论背景",
  "owner_id": 3,
  "duration_minutes": 15,
  "expected_output": "确认处理方案",
  "materials": "趋势图和报警日志"
}
```

## 7. 排班、红黑榜和 Thank You

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/machines` | 查询或新增机台 |
| DELETE | `/api/machines/{id}` | 删除机台及其排班 |
| GET/POST | `/api/shifts` | 查询或批量新增排班 |
| DELETE | `/api/shifts/{id}` | 删除单条排班 |
| GET | `/api/dashboards/shifts` | 工时统计 |
| GET/POST | `/api/rules` | 红黑榜细则 |
| GET/POST | `/api/scores` | 积分明细 |
| PATCH | `/api/scores/{id}` | 管理员编辑当天积分 |
| GET | `/api/dashboards/red-black` | 月度、年度积分看板 |
| GET/POST | `/api/thank-you` | 查询或送出感谢 |
| PATCH/DELETE | `/api/thank-you/{id}` | 修改或删除允许操作的感谢 |
| GET | `/api/dashboards/thank-you` | 月度/年度 Thank You 排名 |

## 8. 链接、提醒和系统管理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/links` | 查询或归档链接 |
| PATCH/DELETE | `/api/links/{id}` | 修改或软删除链接 |
| GET/POST | `/api/link-categories` | 链接分类 |
| GET | `/api/reminders` | 当前用户提醒 |
| PATCH | `/api/reminders/read` | 标记提醒已读 |
| GET | `/api/recycle-bin` | 回收站 |
| POST | `/api/recycle-bin/{id}/restore` | 恢复软删除记录 |
| DELETE | `/api/recycle-bin/{id}` | 永久删除回收记录 |
| GET/PATCH | `/api/settings` | 查询或更新系统配置 |
| GET | `/api/audit-logs` | 审计日志 |
| GET/POST | `/api/backups` | 查询、下载信息或创建备份 |
| POST | `/api/backups/verify` | 校验备份完整性 |
| POST | `/api/backups/restore` | 恢复指定备份 |

## 9. 扩展 API 的检查项

新增接口时同时确认：

1. 路由是否映射到正确模块；
2. 服务端是否校验管理员、所有者或操作权限；
3. 输入类型、长度、枚举和日期是否合法；
4. SQL 是否使用参数绑定；
5. 写操作是否进入事务并记录审计日志；
6. 错误是否为用户可理解的中文；
7. 是否需要软删除、回收站和恢复能力；
8. 是否需要更新本文件及冒烟测试。

