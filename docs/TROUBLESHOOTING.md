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

## 企业 SSO 登录失败

- 登录页没有 SSO 按钮：自动发现模式检查 Issuer 与 Client ID；手动模式检查授权、Token、UserInfo 三个地址与 Client ID；
- 提示回调不一致：企业身份平台登记值必须与“OAuth2 回调地址”逐字一致；
- 提示无法连接身份平台：检查服务器 DNS、代理、防火墙、HTTPS 证书和系统时间；
- 登录后回到系统账号页：页面会在 SSO 失败后主动停止循环跳转，先查看页面错误提示和服务日志，修复后点击“企业 SSO 登录”重试；
- 提示工号缺失或关联冲突：核对“SSO 工号字段”和 UserInfo 返回值，并在“用户管理”确认工号唯一；
- 登录后提示默认类型无效：选择一个启用的非访客用户类型；
- 其他电脑可打开页面但不能 SSO：不要使用局域网 HTTP 地址作为正式回调，应通过 HTTPS 域名和反向代理访问；
- Windows 运行时出现 TLS/OpenSSL 错误：改用系统安装的 Python 3.10+ 启动，并确认 `python -c "import ssl; print(ssl.OPENSSL_VERSION)"` 正常。
4. 管理员切换到用户视图进行复现；
5. 确认前端和后端都已注册新模块权限。

## 下级团队看不到上级安排或看到了无关数据

- 只有会议和“团队公告”会从上级向下级透传，普通讨论、早例会、排班和积分不会透传；
- 确认当前侧栏团队路径正确，上级记录确实创建在祖先组织；
- 透传记录应显示“上级安排/上级团队”，并且下级只能查看；
- 跨团队 Thank You 只在发送方、接收方和共同上级显示，无关兄弟团队看不到；排名只归接收方；
- 修改组织范围后运行 `python scripts\organization_scope_smoke_test.py`，检查是否有自定义查询绕过统一组织过滤。

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

## 公共域名与 Nginx

- 域名无法访问：确认 DNS 已生效、公网入口存在、网关端口映射正确，并且 Windows 防火墙只放行 80/443；
- Nginx 返回 `502 Bad Gateway`：先在服务器本机打开 `http://127.0.0.1:8000/api/health`，再确认 Nginx `UpstreamPort` 与正式端口一致；
- Nginx 启动后立即退出：执行 `scripts\nginx_proxy.ps1 -Action Reload` 或直接运行 `nginx.exe -t`，查看 `logs/team-loop-error.log`；
- 浏览器提示证书不可信：必须使用与公共域名匹配的完整证书链，不能把自签名证书用于普通用户访问；
- SSO 回调后跳转失败：身份平台和系统配置中的回调必须完全等于 `https://域名/api/sso/callback`；
- 会话 IP 全是 `127.0.0.1`：确认 Team Loop 进程启动前设置了 `TEAM_LOOP_TRUST_PROXY=1`，并确认后端仅监听 `127.0.0.1`；
- 登录 Cookie 没有 `Secure`：检查 Nginx 是否发送 `X-Forwarded-Proto https`，以及 Team Loop 是否启用了可信代理；
- HTTPS 出现重定向循环：不要在其他上游代理中把 HTTPS 请求错误标记为 HTTP，检查每一层 `X-Forwarded-Proto`。
