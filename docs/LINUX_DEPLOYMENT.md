# Linux 部署与后台运行（默认）

需要 Linux、Bash 和 Python 3.10+。应用及后台管理只使用 Python 标准库，不需要安装 pip/npm 依赖。将仓库放在固定的本机目录，运行账号需有 `data/` 写入权限。

## 日常运行

从任意目录调用脚本均可，脚本会自动定位项目目录。默认启动成功并通过健康检查后返回终端，服务使用独立会话、断开的标准输入和文件日志，退出 SSH 或关闭终端后继续运行。

```bash
bash start_server.sh                         # 正式后台服务，127.0.0.1:8000
bash deployment_status.sh                   # 正式、灰度、开发三种状态
bash restart_server.sh                      # 重启正式服务
bash stop_server.sh                         # 停止正式服务
bash deploy.sh migrate                      # 仅迁移数据库
bash start_server.sh --host 0.0.0.0 --port 8080
bash stop_server.sh
bash start_hot_server.sh                    # 开发热更新，同样后台运行
bash deploy.sh stop --env dev
```

自定义端口启动的服务在重启时应再次传入同样的 `--host` / `--port`。开发与正式服务默认共用 8000，不能同时启动。脚本使用进程启动时间核对 PID，避免误杀重用 PID 的其他程序；重复启动同一环境不会创建第二个实例。若端口被其他程序占用，启动会明确报错。

默认数据库为 `data/weekly_team.db`；日志与进程记录在 `data/deploy/runtime/{production,gray,dev}.{log,json}`。查看日志：

```bash
tail -f data/deploy/runtime/production.log
```

可设置 `TEAM_LOOP_PYTHON` 指定 Python 路径，`TEAM_LOOP_DATA_DIR` 指定本机数据目录，`TEAM_LOOP_DB_PATH` 指定正式数据库。灰度数据库始终独立位于数据目录下 `deploy/gray/weekly_team_gray.db`，不会沿用正式数据库路径。数据、日志、发布快照和备份均不得提交到 Git。

## HTTPS 与反向代理

正式模式默认要求 HTTPS 登录和写操作。Nginx 终止 TLS 后代理至 `127.0.0.1:8000`，发送 `Host`、`X-Forwarded-Proto`、`X-Forwarded-For`，启动正式服务时设置 `TEAM_LOOP_TRUST_PROXY=1`。不要将后台端口直接暴露到公网。已有 SSO 配置保持不变，回调使用正式 HTTPS 域名。

```bash
TEAM_LOOP_TRUST_PROXY=1 bash start_server.sh
```

本机开发用 `start_hot_server.sh`。隔离测试需要直接 HTTP 时可显式设置 `TEAM_LOOP_REQUIRE_HTTPS=0`，正式公网部署应保留默认 HTTPS 要求。

生成 Linux Nginx `conf.d` 配置（不覆盖或重启已运行的 Nginx）：

```bash
bash scripts/nginx_proxy.sh render --domain meeting.example.com --certificate /etc/ssl/team-loop/fullchain.pem --key /etc/ssl/team-loop/privkey.pem
sudo cp data/deploy/nginx/team-loop.conf /etc/nginx/conf.d/team-loop.conf
sudo bash scripts/nginx_proxy.sh test
sudo bash scripts/nginx_proxy.sh reload
```

证书与密钥必须由管理员在部署机器上提供；脚本只引用路径，不读取或生成密钥。

## 灰度、提升与回滚

```bash
bash deploy.sh migrate
bash deploy_gray.sh                          # 复制源代码和正式数据库到独立灰度环境，后台运行8001
python3 scripts/safety_feature_test.py --base-url http://127.0.0.1:8001 --database data/deploy/gray/weekly_team_gray.db
bash deploy.sh stop --env gray
# 完成灰度验证，确认正式用户停止关键写入后：
bash promote_production.sh
bash rollback_production.sh
```

灰度源代码在 `data/deploy/releases/` 的独立快照中，包含 `server.py`、`team_loop/` 和静态资源，不包含运行数据、Git 元数据或 `.env` 文件。SQLite 快照使用在线 Backup API 并校验 `quick_check`。再次执行灰度会替换灰度数据库，灰度写入不会自动写回正式库。

提升会先停止灰度与正式进程，保存正式数据库和旧发布位置，再把灰度数据库与发布快照切换为正式；新正式服务启动失败时自动恢复旧版本。提升前禁止存在 `mock` 预览账号。回滚恢复最近一次提升前的数据库与发布位置。代码已更新的目录若没有历史发布快照，回滚不能恢复该目录被外部修改的源文件，因此正式升级应通过灰度快照提升。

脚本不会自动提升或回滚，必须显式执行相应命令。提升时灰度数据库替换正式数据库，因此务必停止业务写入并完成验证。

## 开机自启与自动重启（systemd）

仓库提供 `config/systemd/team-loop.service` 示例，默认路径 `/opt/teamloop`、运行用户 `teamloop`。按实际安装位置和账号调整后复制到 `/etc/systemd/system/`，可使用 `/etc/teamloop.env` 管理环境变量。先停止脚本启动的服务，二者不要同时管理同一个端口。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now team-loop
sudo systemctl status team-loop
sudo journalctl -u team-loop -f
```

systemd 示例运行前台 Python 进程并由 systemd 保持后台运行、处理崩溃自动重启；日常 shell 脚本则管理独立后台进程。systemd 使用固定源码目录，如需用灰度发布快照，请同步调整服务的 `WorkingDirectory` 与 `ExecStart`；不要混用两套提升流程。

## 验证

```bash
python3 scripts/linux_service_smoke_test.py
python3 scripts/meeting_participants_smoke_test.py
node scripts/meeting_participants_test.mjs
```

Linux 服务测试只使用临时目录、随机端口及测试账号，覆盖后台启动、重复启动、重启、灰度隔离、提升、回滚和开发服务停止。测试不会操作真实部署数据库。

## Thank You 每周内容分析任务

默认每周一北京时间 09:00 更新 TOP3 关键词文字墙。先将 `config/systemd/team-loop-thanks-analysis.service` 和 `team-loop-thanks-analysis.timer` 放入 `/etc/systemd/system/`，按实际项目路径及运行账号调整。任务和 Web 服务必须使用同一个数据目录/数据库，在 `/etc/teamloop.env` 中配置一致的 `TEAM_LOOP_DATA_DIR` / `TEAM_LOOP_DB_PATH`。

```bash
# 手动运行一次（前台一次性任务，可用于验证）
bash run_thanks_analysis.sh
# 安装配置后启用每周后台定时任务
sudo systemctl daemon-reload
sudo systemctl enable --now team-loop-thanks-analysis.timer
sudo systemctl list-timers team-loop-thanks-analysis.timer
sudo journalctl -u team-loop-thanks-analysis.service
```

定时器使用 `Persistent=true`，机器在执行时间关机时会在恢复后补跑。需要每天更新时，先停用每周 timer，再安装并启用 `team-loop-thanks-analysis-daily.timer`，同样为北京时间 09:00；不要同时启用两种频率。脚本只分析本机感谢记录，不请求外部模型；缺少有效缓存时页面也能即时分析。跨组织榜单仍按接收者直属组织和发送者祖先关系计算。
