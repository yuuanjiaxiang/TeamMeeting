# 项目跟进功能与远端合并说明

## 功能边界

这一版复用早例会已有事项，没有另建项目、任务或权限体系，也不增加数据库表。主要解决开会前找不到重点、跨日记录难以整理成周报、刷新丢失正在填写内容的问题。

| 入口 | 行为 |
| --- | --- |
| 早例会顶部统计 | 点击全部、未完成、风险、逾期、今日到期、待跟进筛选事项 |
| 人员事项清单 | 关键词、负责人、优先级和状态组合筛选；显示命中数量 |
| 成员导航 | 查找姓名或账号，跳转当前筛选中可见的成员；桌面预留右侧空间 |
| 进展汇总 | 本周、上周、本月或自定义日期；弹窗滚动、复制、下载 Markdown |
| 清单编辑 | 同一标签页内保留未保存输入；提醒版本冲突；可放弃草稿 |

“待跟进”的阈值是 3 个周一至周五工作日，没有接入法定节假日表；自动跨日继承不算人工更新。完成项不会再次被归入待处理风险或逾期。

汇总按根事项合并每日记录，展示截止日仍未完成的事项和期间完成的事项；不按跨日行数虚增事项数量。最多查询 93 天，但会保留更早开始、截至结束日仍未完成的事项。按当前层级有效且参与早例会的成员过滤，不自动汇总上下级，也不恢复历史组织归属或已删除的事项。每日快照内的多次修改无法还原为逐次编辑审计。汇总仅读取数据库，不发送邮件、不创建或更新事项。

草稿只覆盖人员清单中已存在事项的编辑，保留在当前标签页内存，不保存到服务器或浏览器持久存储。刷新整个页面或关闭标签页仍可能丢失草稿，因此离开前需保存。切换账号/团队会清空草稿，避免跨用户展示。新事项登记仍需点击新增完成提交。

## 二次开发位置

新增文件：

- `team_loop/handlers/followup.py`：工作日计算、跟进标志、只读汇总。
- `static/morning-followup.js`：筛选、草稿、弹窗、导出；通过工厂注入原有页面依赖。
- `static/morning-followup.css`：局部样式，不改全局主题。
- `scripts/morning_followup_smoke_test.py`：临时数据库集成测试。

共享文件的业务接入点：

- `team_loop/handler.py`：组合 `FollowupHandlerMixin`。
- `team_loop/handlers/request.py`：注册 `GET /api/morning-items/report`，放在动态 ID 路由前。
- `team_loop/handlers/collaboration.py`：`list_morning_items()` 批量补充只读跟进标志。
- `static/index.html`：加载样式，早例会筛选控件、导航搜索和汇总弹窗。
- `static/app.js`：加载工厂，早例会渲染和轮询接入，保存/删除后清理相应草稿。

## 远端 SSO 适配的保护

本次项目跟进改动不修改 `team_loop/handlers/accounts.py`、`team_loop/sso_http.py`、`team_loop/config.py` 或 `team_loop/handlers/system.py`，也不修改 SSO 前端登录、回调、自动建号和配置函数。开始任务时工作区已有其他未提交改动，不能把整个工作区差异都视作本功能的改动。

合并到已有远端适配时：

1. 先在远端把当地修改保存为独立提交或备份，并记录当前可正常登录的版本；数据库使用部署脚本生成一致性备份。
2. 在测试分支引入本功能新增文件，逐块合并上面的共享业务接入点。不要复制整个 `app.js`、`request.py` 或认证文件覆盖远端版本。
3. 如果远端已重构 Handler 结构，只注册等价的业务 Mixin 和路由；保持原先 SSO 的三端点、请求参数、UserInfo 映射、回调和会话处理逻辑。
4. 更新使用手册、API、开发文档和维护 skill；进入灰度验证后再按现有流程正式发布。不要用本地预览数据库替换正式数据库。
5. 灰度上检查原有本地账号和真实企业 SSO 登录，再验证早例会、汇总和组织切换。本地模拟 SSO 测试通过不代表已经验证远端身份平台。

## 验证

```powershell
python -m compileall -q server.py team_loop scripts
python scripts\morning_followup_smoke_test.py
python scripts\morning_retention_smoke_test.py
python scripts\organization_scope_smoke_test.py
python scripts\concurrency_smoke_test.py
node --check static\morning-followup.js
node --check static\app.js
git diff --check
```

界面检查包括：无数据、组合筛选、过滤隐藏再恢复草稿、手动刷新草稿、多人修改版本冲突、反复打开汇总、非法日期、复制/下载、弹窗内容滚动，以及 1440/1024/768/390 像素布局。测试只能使用隔离数据库；真实身份平台的回归需在远端完成。
