# Team Loop 二次开发指南

## 1. 技术栈与设计目标

Team Loop 是无构建步骤的单体应用：

- 后端：Python 标准库 `http.server`、`sqlite3`；
- 前端：原生 ES Module、HTML、CSS；
- 数据库：SQLite；
- 部署：Windows PowerShell 与批处理脚本；
- 第三方前端资源：放在 `static/vendor/`，运行时不依赖外网。

这种结构适合小团队低成本部署。二次开发应优先保持“无需 pip/npm 安装”和“单目录可发布”的特性。

## 2. 项目结构

```text
TeamMeeting/
├─ server.py                    # 数据模型、迁移、认证、权限、API、静态文件服务
├─ static/
│  ├─ index.html                # 页面骨架、表单、弹窗
│  ├─ app.js                    # 前端状态、渲染、接口调用、交互绑定
│  ├─ style.css                 # 基础样式、主题和响应式规则
│  └─ vendor/                   # 本地化第三方静态资源
├─ scripts/
│  ├─ dev_server.py             # 文件监视与开发热更新
│  ├─ smoke_test.py             # 部署后的只读冒烟测试
│  └─ db_snapshot.py            # SQLite 一致性快照
├─ deploy.ps1                   # 灰度、正式、回滚和状态管理
├─ start_*.bat / deploy_*.bat   # Windows 双击入口
├─ docs/                        # 用户、开发和运维文档
├─ skills/                      # 可分发的 Codex 项目 Skill
└─ data/                        # 数据库、备份、日志和发布快照，不进入 Git
```

## 3. 请求生命周期

1. 浏览器通过 `static/app.js` 的 `api()` 发起请求。
2. `server.py` 的 `Handler` 解析路径、方法和 JSON。
3. `route_module()` 将业务接口映射到模块权限。
4. 公开接口直接执行；受保护接口先读取会话并校验模块及操作权限。
5. 业务方法通过 `connect()` 访问 SQLite。
6. 写操作调用 `write_audit()` 记录审计日志。
7. 前端更新 `state` 并调用对应 `render*()` 函数重绘模块；页面重新获得焦点、重新显示或切换模块时会同步认证与最新数据。

接口统一返回 JSON。业务异常使用 `AppError(status, message)`，前端通过 Toast 展示 `error` 字段。

## 4. 前端组织方式

### 页面注册

新增一级模块时需要同步处理：

1. 在 `static/index.html` 增加 `<section id="module-key" class="page">`；
2. 在 `static/app.js` 的 `pages` 增加导航配置；
3. 为模块增加 `loadXxx()` 和 `renderXxx()`；
4. 在 `refreshPageData()` 的 loader 映射中注册；
5. 在 `server.py` 的 `MODULE_CATALOG`、初始类型权限和 `module_for_path()` 中注册；
6. 访客范围由数据库中的 `guest` 权限模板控制，不要另加前端硬编码白名单。

### 状态与刷新

全局数据存放在 `state`。切换页面时会重新调用模块 loader，以获取最新数据。写操作完成后优先只刷新受影响模块；跨模块数据同步时使用 `refreshAll()`。

公共时间筛选由 `setDefaultDates()` 初始化为当月首日至今天，不要在单独页面重复覆盖。排班日期范围分别使用 `selectedShiftDate` 和 `selectedShiftEndDate`；月历重绘不得把用户选择的结束日期强制重置为开始日期。

所有来自用户或接口的文本在插入 HTML 字符串前必须经过 `escapeHtml()`。日期统一使用 `YYYY-MM-DD`，显示时使用 `shortDate()` 或 `shortDateTime()`。

### 表单和弹窗

- 简单创建可以使用页面内表单；
- 修改、详情、长内容和确认删除使用弹窗；
- 绑定新表单时复用 `bindForm()` 或在统一的 `submit` 事件中处理；
- 动态生成的按钮使用事件委托，不要为每一行重复注册监听器；
- 所有按钮必须有明确的禁用、加载、成功或失败反馈。

### CSS

基础设计变量位于 `style.css` 顶部。新增样式应：

- 默认适配 Miro 主题，并检查其他主题的覆盖规则；
- 使用稳定的 grid/flex 约束，不依赖视口宽度缩放字体；
- 在 980px、720px 等已有断点检查布局；
- 长文本使用 `overflow-wrap: anywhere`；
- 表格或日历在窄屏提供滚动，不允许内容遮挡。

## 5. 后端开发约定

### 路由

路由集中在 `Handler` 的 API 分发区域。推荐形式：

```python
if path == "/api/example":
    if method == "GET":
        return {"items": self.list_examples()}
    if method == "POST":
        return self.create_example()
```

动态资源使用 `parts` 判断，并在转换 ID 前确认路径长度。对外错误使用清晰中文，不返回 SQL、文件路径或堆栈。

### 权限

权限不是仅隐藏按钮。每个写接口都必须在服务端调用以下一种校验：

- `self.require_admin()`：仅管理员；
- 当前用户与资源所有者判断：只能修改自己的内容；
- 模块操作权限：由统一路由权限层处理。

新增模块时应同时定义 `view/create/edit/delete` 的初始权限。用户类型可由管理员动态创建、改名和删除，业务代码不得依赖类型名称或固定类型 key。`guest` 是保留的只读模板，不能分配给账号，也不能获得写权限。管理员切换用户视图只影响前端展示，服务端仍识别管理员账号，因此危险操作必须有显式确认。

模块权限和业务参与资格不是同一概念。团队成员、早例会、红黑榜和 Thank You 使用 `user_types` 上独立的 `include_in_*` 字段；查询当前名单和创建新事实时均需在服务端校验。调整参与资格不得删除历史事项、积分或感谢记录。

用户类型与早例会事项采用乐观并发控制。前端更新时传 `expected_version`；服务端使用 `WHERE version=?` 原子更新，冲突返回 409 并要求客户端刷新。批量排班也必须先完成整批冲突校验再写入，避免部分成功。

登录会话持久化在 SQLite 中，只保存令牌摘要。新增认证功能时同时考虑超时、撤销、密码修改后的其他设备退出、失败次数锁定和 401 后前端自动回到登录视图。

团队对话的完整 Emoji 选择器和中文数据都放在 `static/vendor/emoji-picker-element/` 与 `static/vendor/emoji-picker-element-data/`。部署环境不得依赖 CDN；修改选择器后应在断网或仅局域网条件下验证表情分类、搜索、发送和再次点击撤销。

会议创建遵循 `meetings.create` 操作权限，不应写死为管理员；一级议题分类和二级预设议题的维护仍是管理员能力。创建会议后通过 `/api/meetings/{id}/agenda-options` 批量加入预设议题并指定责任人。`meetings.start_time` 使用 `HH:MM`，为空表示未指定开始时间。

红黑榜黑榜可见性必须在服务端和前端同时执行。普通用户调用 `/api/scores` 或 `/api/dashboards/red-black` 时，服务端根据两个 `red_black_show_black_*` 配置裁剪结果；前端隐藏只用于管理员切换用户视图时保持一致体验，不能替代接口过滤。

### 数据写入

- 使用 SQL 参数绑定，禁止拼接用户输入；
- 多步写操作放在同一个 `with connect() as conn` 事务中；
- 删除历史业务数据优先软删除并进入回收站；
- 写操作应调用 `write_audit()`；
- 不在 API 中返回密码哈希、会话标识或完整敏感信息。

## 6. 数据库迁移

`init_db()` 每次启动都会执行，迁移必须幂等。

新增表使用 `CREATE TABLE IF NOT EXISTS`。为现有表增加字段使用：

```python
ensure_column(conn, "table_name", "column_name", "TEXT")
```

禁止在启动迁移中直接删除列、重建正式表或覆盖业务数据。需要数据转换时使用带条件的 `UPDATE`，确保重复执行不会改变已迁移数据。

修改数据库后至少验证：

```powershell
python server.py --migrate-only
python -m py_compile server.py
```

数据库详细说明见 [DATABASE.md](DATABASE.md)。

## 7. 本地开发

推荐运行：

```powershell
python scripts\dev_server.py --host 127.0.0.1 --port 8000
```

它会监视 `server.py`、`static/` 和 `previews/` 中的 Python、HTML、CSS、JavaScript 与 JSON 文件。保存后后端自动重启，开发页面会轮询健康接口并刷新。

不要让开发服务连接正式数据库进行破坏性测试。复杂数据迁移和写操作应在灰度数据库上验证。

## 8. 验证清单

每次提交前运行：

```powershell
python -m py_compile server.py scripts\dev_server.py scripts\db_snapshot.py scripts\smoke_test.py scripts\safety_feature_test.py
node --check static\app.js
git diff --check
```

功能验证至少覆盖：

- 管理员视图与用户视图；
- 至少两种自定义用户类型及不同操作权限；
- 批量调整账号类型，以及四类业务参与名单互相独立；
- 访客动态只读范围；
- 删除仍有用户的类型时必须被服务端阻止；
- 页面刷新与页面切换后的数据一致性；
- 桌面宽屏、窄屏和手机宽度；
- 写操作成功、失败、重复点击及空数据状态；
- 灰度迁移、健康检查和冒烟测试。

安全与并发改动还应在灰度执行：

```powershell
python scripts\safety_feature_test.py --base-url http://127.0.0.1:8001 --database data\deploy\gray\weekly_team_gray.db
```

## 9. 发布边界

开发完成后先执行灰度发布，在 8001 端口使用正式库快照验证。确认后再执行 `Promote`。不要把灰度数据库复制回正式数据库，也不要直接替换正在使用的 SQLite 文件。

完整流程见 [DEPLOYMENT.md](DEPLOYMENT.md)。
