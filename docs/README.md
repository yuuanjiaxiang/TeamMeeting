# Team Loop 文档导航

按使用角色选择文档：

| 读者 | 建议阅读顺序 |
| --- | --- |
| 普通成员 | [使用手册](USER_GUIDE.md) |
| 管理员 | [使用手册](USER_GUIDE.md) → [部署与运维](DEPLOYMENT.md) → [数据库与备份](DATABASE.md) |
| 新开发者 | [二次开发指南](DEVELOPMENT.md) → [API 参考](API.md) → [数据库与备份](DATABASE.md) |
| AI/Codex 开发者 | [Team Loop 维护 Skill](../skills/team-loop-maintainer/SKILL.md) |

## 快速判断

- 不知道某个功能怎么操作：查 [使用手册](USER_GUIDE.md)。
- 需要在另一台 Windows 电脑部署：查 [部署与运维](DEPLOYMENT.md)。
- 需要增加页面、接口或权限：查 [二次开发指南](DEVELOPMENT.md)。
- 需要调用接口或排查请求：查 [API 参考](API.md)。
- 需要备份、恢复或理解表结构：查 [数据库与备份](DATABASE.md)。
- 服务打不开、邮件唤起失败或页面没更新：查 [常见问题](TROUBLESHOOTING.md)。

文档以仓库当前 `main` 分支为准。功能变更时应同步更新相关文档。

## 安装项目 Skill

仓库内的 `skills/team-loop-maintainer` 可直接交给 Codex 读取，也可以复制到个人 Skill 目录：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills" | Out-Null
Copy-Item -Recurse -Force .\skills\team-loop-maintainer "$env:USERPROFILE\.codex\skills"
```

重启或刷新 Codex 后，通过 `$team-loop-maintainer` 调用。该 Skill 会要求开发者先读取项目文档、检查权限边界、执行灰度验证，并避免把业务数据库提交到 Git。
