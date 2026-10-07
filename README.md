# Team Loop

Team Loop 是面向技术项目团队的轻量协作与周例会系统。后端使用模块化 Python 标准库服务和 SQLite，前端使用原生 HTML/CSS/JavaScript，默认在 Linux 服务器后台运行，也兼容 Windows 单机或局域网部署。

## 主要能力

- 可配置多级组织树、层级独立路由、上级安排向下透传、跨团队协作可见范围与 SSO 群组自动归属
- 团队成员拖动排序、用户类型、模块操作权限、独立业务参与名单与批量账号管理
- 个人工作台和跨日继承的早例会事项，已完成事项保留至下一个工作日回顾；管理员可只读切换查看下级成员工作台
- 悬浮式早例会成员导航、脑图式树形/并行流程模板、成员自主沉淀模板与依赖进度跟踪
- 早例会风险/逾期/待跟进筛选、未保存输入保护、按周或自定义时间生成项目进展汇总并导出 Markdown
- 会议沙盘、团队独立的两级预设议题、下级责任人协调、开始时间、弹窗签到、纪要与可选 Thank You 邮件模板
- 团队独立机台档案、白夜班月历排班、批量排班和工时统计
- 红黑榜细则、月度/年度积分看板、个人历史与黑榜可见性控制
- Thank You 感谢统计、TOP3 小心心关键词文字墙、每周定时内容分析，多人感谢与月度/年度排名，候选人支持可访问下级，排名按当前层级接收者统计
- 工作台统计详情弹窗与[组织数据口径说明](docs/DASHBOARD_SCOPE.md)，区分本级、下级可见和上级继承
- 常用链接归档、搜索、标签、质量和访问量管理
- 论坛式团队讨论区：主题分类、搜索排序、楼中回复、快捷回应、本地完整 Emoji、作者编辑删除与回收恢复
- 全局搜索、年度归档、审计日志、备份校验与恢复
- 灰度发布、正式发布和数据库回滚
- 引导式企业 OAuth2/OIDC SSO 配置（授权码 + PKCE）、华为云 OneAccess 工号关联、连接池、自动建号、建议团队与管理员确认；未分类账号仅有访客只读权限
- Nginx HTTPS 反向代理、公共域名接入、可信代理真实 IP，以及生产登录和写操作的 HTTPS 强制校验

## 五分钟启动

1. 安装 Python 3.10+，将仓库放在固定目录。
2. 在 Linux 执行 `bash start_server.sh`，服务自动后台运行；关闭终端后仍继续运行。
3. 执行 `bash deployment_status.sh` 查看状态，`bash stop_server.sh` 停止，`bash restart_server.sh` 重启。
4. 正式服务默认监听 `127.0.0.1:8000`，通过 Nginx HTTPS 反向代理访问；启动后修改默认管理员密码。

详见 [Linux 部署与后台运行](docs/LINUX_DEPLOYMENT.md)。开发测试可执行 `bash start_hot_server.sh`，同样后台运行；Windows 继续使用 `.bat` / `deploy.ps1`。

项目不依赖 pip 或 npm 安装。首次启动自动创建并迁移 `data/weekly_team.db`，日志与 PID 元数据在 `data/deploy/runtime/`。可通过 `TEAM_LOOP_PYTHON=/path/to/python3` 指定解释器。

后端默认启用 SQLite WAL、15 秒写锁等待和最多 64 个活动请求线程，按约 100 人同时在线的读多写少场景设计。数据库必须放在服务器本地磁盘，不能放在 SMB/NAS 共享目录。

## 文档入口

- [文档导航](docs/README.md)
- [使用手册](docs/USER_GUIDE.md)
- [Linux 部署与后台运行（默认）](docs/LINUX_DEPLOYMENT.md)
- [Windows 部署与运维（兼容）](docs/DEPLOYMENT.md)
- [二次开发指南](docs/DEVELOPMENT.md)
- [项目跟进功能与远端合并说明](docs/PROJECT_FOLLOWUP.md)
- [HTTP API 参考](docs/API.md)
- [企业 SSO 配置与登录流程](docs/SSO_LOGIN_FLOW.md)
- [数据库与备份](docs/DATABASE.md)
- [常见问题](docs/TROUBLESHOOTING.md)
- [本地业务知识库与 AI 问答接入](docs/KNOWLEDGE_BASE.md)
- [Team Loop 维护 Skill](skills/team-loop-maintainer/SKILL.md)

## 常用命令

```bash
# 默认 Linux 后台服务
bash start_server.sh
bash deployment_status.sh
bash restart_server.sh
bash stop_server.sh

# 开发热更新后台服务（先停止占用同端口的正式服务）
bash start_hot_server.sh
bash deploy.sh stop --env dev

# 迁移 / 灰度 / 正式提升 / 回滚
bash deploy.sh migrate
bash deploy_gray.sh
bash promote_production.sh
bash rollback_production.sh
```

正式环境默认使用 8000 端口，灰度环境默认使用 8001 端口。灰度数据库是正式数据库的一致性快照，灰度操作不会写回正式数据库。

公共域名部署默认使用 Linux Nginx 配置和 `scripts/nginx_proxy.sh`。正式服务监听 `127.0.0.1:8000`，由 Nginx 对外开放 80/443；命令、证书和后台服务配置见 [Linux 部署与后台运行](docs/LINUX_DEPLOYMENT.md)。Windows 的 PowerShell 脚本继续保留。

## 数据安全

业务数据库、备份、发布快照和运行日志都位于 `data/`，并由 `.gitignore` 排除。不要把真实数据库、导出的审计记录或包含员工信息的截图提交到 GitHub。
