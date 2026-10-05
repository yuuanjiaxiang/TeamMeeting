# 企业 SSO 登录流程

支持华为云 OneAccess / IDaaS，使用 OAuth2 / OIDC Authorization Code + PKCE S256。
Discovery 模式从 `{issuer}/.well-known/openid-configuration` 获取认证、Token 和 UserInfo 端点；Manual 模式手动配置三个地址。

## 配置

| 配置键 | 默认值 | 说明 |
| --- | --- | --- |
| `sso_enabled` | `0` | 企业 SSO 开关 |
| `sso_auto_login` | `1` | 未登录时自动发起 SSO |
| `sso_mode` | `discovery` | `discovery` 或 `manual` |
| `sso_profile` | `standard` | `standard` 或 `sicarrier`，后者必须使用 Manual 模式 |
| `sso_issuer_url` | 空 | Issuer，不包含 `.well-known` |
| `sso_authorization_url` | 空 | Manual 认证地址 |
| `sso_token_url` | 空 | Manual Token 地址 |
| `sso_userinfo_url` | 空 | Manual UserInfo 地址 |
| `sso_client_id` | 空 | 身份平台分配的 Client ID |
| `sso_client_secret` | 空 | 优先使用 `TEAM_LOOP_SSO_CLIENT_SECRET`；API 不回显 |
| `sso_redirect_uri` | 空 | 正式域名必须填写 `https://域名/api/sso/callback` |
| `sso_scopes` | `openid profile email` | OneAccess 需包含 `get_user_info` |
| `sso_username_claim` | `preferred_username` | 工号字段；OneAccess 使用 `userName` |
| `sso_display_name_claim` | `name` | 姓名字段 |
| `sso_group_claim` | `groups` | 群组字段，支持点分路径 |
| `sso_default_user_type` | `guest` | 自动建号固定使用访客只读权限 |
| `sso_auto_provision` | `1` | 是否允许自动建号 |

## 发起认证与回调

1. 浏览器访问 `/api/sso/login?return_to=...`。后端检查启用状态和配置，校验回调地址，生成 state、nonce、PKCE verifier。state 以摘要保存，10 分钟过期；`return_to` 只允许首页或组织路由及白名单模块。
2. 后端重定向到身份平台，携带 `response_type=code`、Client ID、回调、scope、state、nonce 和 S256 challenge。
3. 身份平台回调 `/api/sso/callback?code=...&state=...`。后端在数据库写事务内校验并消费 state，并发回调仅有一次可以继续。事务提交后才请求身份平台；Token 或 UserInfo 失败也不能复用 state。
4. 用授权码、原回调及 verifier 换取 access_token，再携带 Bearer Token 请求 UserInfo。Discovery 声明支持 `client_secret_basic` 时使用 Basic，否则在表单中发送 Client Secret。
5. 按字段配置及兜底字段映射工号、姓名、主体和群组。先按 `<issuer 或认证主机>|<subject>` 查企业身份，再按工号大小写不敏感匹配已有账号。用户名相同但工号不匹配时不关联；自动建号遇到用户名冲突返回错误，由管理员核对。
6. 停用账号拒绝登录，已绑定其他身份的账号拒绝关联。未匹配且允许自动建号时，在根组织创建 `user_type=guest`、`classification_pending=1` 的只读账号。
7. 群组只更新建议组织、群组快照和最后登录时间，不覆盖真实组织。生成 `weekly_session` Cookie，记录 `auth.sso_login` 审计，再跳回保存的站内目标或账号所属组织。

SSO HTTP 连接池按 Origin 隔离；跨 Origin 重定向和 Token POST 重定向拒绝，超时以网关错误报告。前端会话内只自动尝试一次，失败、主动退出、选择访客或系统账号后停止自动尝试；成功回调清除跳过标记。

## 验证

运行 `python scripts/sso_smoke_test.py`、`python scripts/sso_pool_smoke_test.py` 和 `python scripts/sso_security_test.py`。测试使用临时数据库及本地模拟身份平台，不修改运行中的业务数据库。

## Sicarrier 自研 OAuth2

Sicarrier（`heds.sicarrier.com/saaslogin1/oauth2`，Issuer 为 `uniportal.sicarrier.com`）不使用标准 OIDC 请求方式。请在系统管理中选择“手动 OAuth2 端点”和“Sicarrier 自研 OAuth2”，填写平台提供的完整三端点及 Client ID、Client Secret，设置：

- `sso_scopes=base.profile`
- `sso_username_claim=employeeNumber`
- `sso_display_name_claim=displayNameCn`
- `sso_group_claim=employeeType`
- `sso_redirect_uri=https://本系统域名/api/auth/oauth/callback`（须与平台登记地址完全一致；原 `/api/sso/callback` 也受支持）

兼容模式不发送 PKCE 参数；Token 请求使用表单 `client_secret`；UserInfo 使用 GET 查询参数 `access_token`、`scope`、`client_id`，不发送 Bearer 头。登录和管理员映射诊断共用同一调用逻辑。UserInfo 返回 `errorCode/errorDesc` 时显示平台业务错误，不再误报为工号映射错误。

账号只按工号大小写不敏感匹配，不用外部 subject 查找或绑定；已有工号账号的旧 subject 绑定在成功登录时清空。标准协议账号继续使用外部主体关联机制。兼容模式仍保留一次性 state、10 分钟过期、站内跳转白名单、TLS 校验及访客待分类规则。

UserInfo 查询串含 Token，所有 UserInfo 重定向均拒绝。应用错误提示隐藏 Token；部署代理和身份平台的访问日志也应屏蔽查询串。不要复制带 Token 的完整 URL。

运行 `python scripts/sso_smoke_test.py --profile sicarrier` 验证兼容模式及新回调路径。本地模拟测试不能代替企业平台实际联调。
