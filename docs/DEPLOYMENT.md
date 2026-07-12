# Windows 部署与运维

## 1. 环境要求

- Windows 10/11 或 Windows Server；
- Python 3.10+；
- 一个普通文件夹写入权限；
- 局域网访问时允许对应 TCP 端口入站。

项目运行不需要 pip、Node.js、数据库服务器或 IIS。

## 2. 首次部署

1. 将仓库放到固定目录，不要放在会自动清理的临时目录。
2. 确认命令行可以执行 `python --version`。
3. 双击 `start_server.bat`。
4. 浏览器访问 `http://127.0.0.1:8000/`。
5. 登录管理员账号后立即修改密码，并在系统管理中设置系统名称、团队名称和业务参数。

首次启动自动创建 `data/weekly_team.db`。部署目录必须允许运行账号写入 `data/`。

## 3. 局域网访问

正式服务默认监听 `0.0.0.0:8000`。在服务器电脑执行：

```powershell
ipconfig
```

找到当前局域网 IPv4 地址，其他设备访问：

```text
http://服务器IPv4:8000/
```

如果无法访问：

1. 先在服务器本机确认 `http://127.0.0.1:8000/` 可用；
2. 确认客户端和服务器处于可互访的网络；
3. 在 Windows 防火墙中允许 Python 或 TCP 8000 入站；
4. 确认没有其他程序占用端口。

不要把本系统直接暴露到公网。公网使用需要额外配置 HTTPS、反向代理、登录防护和安全审计。

## 4. 环境与端口

| 环境 | 默认端口 | 数据库 | 用途 |
| --- | --- | --- | --- |
| development | 8000 | `data/weekly_team.db` 或自定义路径 | 本地开发热更新 |
| gray | 8001 | `data/deploy/gray/weekly_team_gray.db` | 正式数据快照上的功能验证 |
| production | 8000 | `data/weekly_team.db` | 团队正式使用 |

生产和灰度服务都运行发布快照，不监听源代码变化。

## 5. 灰度发布

双击 `deploy_gray.bat`，或执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Action Gray
```

脚本会：

1. 复制当前代码到带版本号的发布目录；
2. 停止旧灰度进程；
3. 使用 SQLite Backup API 创建正式库一致性快照；
4. 在灰度库执行数据库迁移；
5. 启动 8001 服务；
6. 检查 `/api/health` 并执行只读冒烟测试。

灰度产生的测试数据不会同步回正式库。

## 6. 提升正式版本

确认灰度后双击 `promote_production.bat`，或执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Action Promote
```

提升前脚本会再次验证灰度、备份正式数据库，然后迁移正式库并切换正式服务。启动或冒烟测试失败时会自动尝试恢复。

## 7. 回滚与状态

```powershell
# 查看进程、端口和版本
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Action Status

# 回滚上一正式版本
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Action Rollback

# 停止灰度
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Action StopGray

# 停止正式
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Action StopProduction
```

运行元数据和日志位于 `data/deploy/runtime/`，发布快照位于 `data/deploy/releases/`，正式库回滚快照位于 `data/deploy/backups/`。

## 8. 环境变量

| 变量 | 说明 |
| --- | --- |
| `TEAM_LOOP_DATA_DIR` | 数据目录，默认 `<项目>/data` |
| `TEAM_LOOP_DB_PATH` | SQLite 数据库完整路径 |
| `TEAM_LOOP_BACKUP_DIR` | 备份目录 |
| `TEAM_LOOP_ENV` | `development`、`gray` 或 `production` |
| `TEAM_LOOP_RELEASE` | 健康接口显示的发布版本 |

自定义数据盘示例：

```powershell
$env:TEAM_LOOP_DATA_DIR = 'D:\TeamLoopData'
python server.py --host 0.0.0.0 --port 8000
```

使用自定义变量时，启动服务的 Windows 账号必须拥有目录读写权限。

## 9. 运维建议

- 每日确认自动备份状态，至少每月执行一次恢复校验；
- 发布前通知用户避免同时写入；
- 定期下载一份备份到另一块磁盘或受控文件服务器；
- 不通过聊天工具发送正式数据库；
- 服务器休眠会停止访问，正式电脑应关闭自动睡眠；
- 端口冲突时优先调整测试端口，不随意终止未知进程。

