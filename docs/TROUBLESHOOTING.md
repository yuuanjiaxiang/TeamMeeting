# 常见问题

## 页面打不开

先检查：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Action Status
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

如果 8000 被占用：

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen
```

不要直接结束不属于 Team Loop 的进程。开发时可临时改用其他端口。

## 局域网电脑或手机无法访问

- 确认服务器本机可以访问；
- 使用服务器局域网 IPv4，不要使用 `127.0.0.1`；
- 确认服务监听 `0.0.0.0`；
- 检查 Windows 防火墙和网络隔离；
- 某些公司 Wi-Fi 会禁止无线客户端访问有线局域网，需要网络管理员放通。

## 修改代码后页面没变化

- 开发模式确认使用 `start_hot_server.bat`；
- 正式/灰度环境不会读取工作区代码，必须重新执行 Gray 或 Promote；
- 浏览器执行强制刷新；
- 检查开发终端是否因语法错误反复重启；
- 运行 `node --check static\app.js` 和 `python -m py_compile server.py`。

## 灰度发布提示数据库被占用

最新部署脚本会先停止旧灰度进程再替换快照。若仍失败，执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Action StopGray
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Action Gray
```

并检查是否有外部 SQLite 工具打开 `weekly_team_gray.db`。

## 登录后页面权限不正确

1. 管理员检查用户所属“用户类型”；
2. 检查该类型的模块及查看/新增/修改/删除权限；
3. 用户退出后重新登录；
4. 管理员切换到用户视图进行复现；
5. 确认前端和后端都已注册新模块权限。

## Outlook 邮件没有套用模板

系统通过 `mailto:` 唤起默认邮件客户端，并将 HTML 纪要复制到剪贴板。新版 Outlook 对 `mailto:` 正文和 HTML 支持有限，因此推荐：

1. 点击“生成会议邮件”；
2. 等待 Outlook 新邮件窗口打开；
3. 在正文区域粘贴剪贴板内容；
4. 检查收件人和内容后手动发送。

如果不能唤起 Outlook，请在 Windows“默认应用”中为 MAILTO 协议选择 Outlook。

## 表情显示为方框或问号

快捷回应优先使用 `static/vendor/` 中的本地资源。检查静态资源是否完整、浏览器是否使用旧缓存，以及数据库中早期损坏文本是否本身已被保存为问号。已损坏的历史文本无法仅靠字体恢复。

## 备份恢复失败

- 先执行备份校验；
- 确认备份位于系统允许的备份目录；
- 确认运行账号对数据库和备份目录有写权限；
- 查看 `data/deploy/runtime/` 或启动终端日志；
- 不要在恢复期间用 SQLite 工具打开数据库。

## 数据误删

先到系统管理的回收站恢复。用户、链接、会议议题和团队回复等主要对象采用软删除。只有管理员执行“永久删除”后才不能从回收站恢复，此时需要从数据库备份恢复。

