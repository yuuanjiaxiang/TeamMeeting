from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen
import argparse
import base64
from contextlib import contextmanager
import datetime as dt
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import traceback
import uuid


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = Path(os.environ.get("TEAM_LOOP_DATA_DIR") or (ROOT / "data")).resolve()
DB_PATH = Path(os.environ.get("TEAM_LOOP_DB_PATH") or (DATA_DIR / "weekly_team.db")).resolve()
BACKUP_DIR = Path(os.environ.get("TEAM_LOOP_BACKUP_DIR") or (DATA_DIR / "backups")).resolve()
DEPLOY_ENV = (os.environ.get("TEAM_LOOP_ENV") or "development").strip().lower()
RELEASE_ID = (os.environ.get("TEAM_LOOP_RELEASE") or "local").strip()

DEFAULT_SETTINGS = [
    ("app_brand_name", "系统名称", "Team Loop", "text", "左侧顶部显示的系统名称"),
    ("app_team_name", "团队名称", "技术项目团队", "text", "左侧顶部显示的团队名称"),
    ("meeting_default_title", "默认会议标题", "周例会", "text", "创建会议和批量生成时使用的默认标题"),
    ("meeting_bulk_default_weeks", "批量生成周数", "4", "number", "会议沙盘批量生成默认覆盖的周数"),
    ("shift_default_hours", "默认班次小时", "12", "number", "新增排班时默认计入的工时"),
    ("shift_max_daily_hours", "单人每日最大工时", "24", "number", "新增排班时用于阻止同一成员当天工时超限"),
    ("thank_you_weekly_limit", "每周 Thank You 上限", "3", "number", "每位成员每周最多感谢的人数"),
    ("red_score_default_points", "红榜默认分值", "1", "number", "记录红榜积分时的默认分值"),
    ("black_score_default_points", "黑榜默认分值", "1", "number", "记录黑榜积分时的默认分值"),
    ("red_black_show_black_points", "显示黑榜积分", "1", "boolean", "是否向普通用户展示黑榜汇总积分"),
    ("red_black_show_black_details", "显示黑榜明细", "1", "boolean", "是否向普通用户展示黑榜积分明细"),
    ("late_donation_label", "迟到乐捐说明", "迟到要乐捐", "text", "参会签到中迟到乐捐的口径说明"),
    ("backup_auto_enabled", "每日自动备份", "1", "boolean", "启用后系统每天自动生成一次数据库备份"),
    ("backup_retention_days", "备份保留天数", "30", "number", "自动清理超过该天数的备份，0 表示不清理"),
    ("session_timeout_minutes", "登录有效时长（分钟）", "480", "number", "无操作超过该时长后需要重新登录"),
    ("login_max_attempts", "登录失败次数上限", "5", "number", "同一账号和地址连续失败达到上限后临时锁定"),
    ("login_lock_minutes", "登录锁定时长（分钟）", "15", "number", "触发失败次数上限后的临时锁定时间"),
    ("sso_enabled", "启用企业 SSO", "0", "boolean", "启用后登录页显示企业 SSO 入口"),
    ("sso_auto_login", "首页自动 SSO 登录", "1", "boolean", "未登录访问首页时自动跳转企业登录；失败后回退系统账号登录"),
    ("sso_mode", "OAuth2 配置方式", "discovery", "choice", "推荐使用 OIDC 自动发现；不支持 Discovery 时选择手动 OAuth2 端点"),
    ("sso_button_label", "SSO 按钮名称", "企业 SSO 登录", "text", "登录页统一身份入口的显示名称"),
    ("sso_issuer_url", "OIDC Issuer 地址", "", "text", "企业身份平台的 Issuer，不含 /.well-known/openid-configuration"),
    ("sso_authorization_url", "OAuth2 授权地址", "", "text", "手动模式必填，例如 https://sso.example.com/oauth2/authorize"),
    ("sso_token_url", "OAuth2 Token 地址", "", "text", "手动模式必填，例如 https://sso.example.com/oauth2/token"),
    ("sso_userinfo_url", "OAuth2 用户信息地址", "", "text", "手动模式必填，需返回工号与姓名字段"),
    ("sso_client_id", "OAuth2 Client ID", "", "text", "身份平台为 Team Loop 分配的 Client ID"),
    ("sso_client_secret", "OAuth2 Client Secret", "", "password", "建议通过 TEAM_LOOP_SSO_CLIENT_SECRET 环境变量提供；留空表示不修改"),
    ("sso_redirect_uri", "OAuth2 回调地址", "", "text", "正式部署必须填写，例如 https://team.example.com/api/sso/callback；本机可自动生成"),
    ("sso_scopes", "OAuth2 Scopes", "openid profile email", "text", "OIDC 通常使用 openid profile email；普通 OAuth2 按企业平台要求填写"),
    ("sso_username_claim", "SSO 工号字段", "preferred_username", "text", "用于关联用户管理工号的 UserInfo 字段，如 employee_id、employeeNumber 或 preferred_username"),
    ("sso_display_name_claim", "SSO 姓名字段", "name", "text", "用于显示姓名的 UserInfo 字段"),
    ("sso_default_user_type", "SSO 默认用户类型", "default", "text", "自动创建 SSO 用户时分配的用户类型"),
    ("sso_auto_provision", "自动创建 SSO 用户", "1", "boolean", "关闭后，仅已存在且账号字段匹配的用户可通过 SSO 登录"),
]

MONTHLY_RECURRENCE_VALUES = {"first", "second", "third", "fourth", "penultimate", "last"}
TEAM_REACTIONS = ["+1", "👍", "👏", "😊", "🎉", "收到", "辛苦了", "已跟进"]
TEAM_POST_CATEGORIES = {"general", "field", "retrospective", "roast", "announcement"}
TEAM_POST_STATUSES = {"open", "resolved"}

MODULE_CATALOG = [
    {"key": "members", "name": "团队成员", "description": "成员档案、职责画像和团队对话"},
    {"key": "dashboard", "name": "工作台", "description": "团队关键指标概览"},
    {"key": "archive", "name": "搜索归档", "description": "跨年度检索会议、对话和早例会事项"},
    {"key": "morning", "name": "早例会", "description": "按人追踪当日事项、风险和下一步"},
    {"key": "meetings", "name": "会议沙盘", "description": "周例会议题、纪要和签到"},
    {"key": "shifts", "name": "机台排班", "description": "白夜班排班和工时统计"},
    {"key": "rules", "name": "红黑榜", "description": "红黑榜细则和积分看板"},
    {"key": "thanks", "name": "Thank You", "description": "团队感谢墙和 Thank You 之星"},
    {"key": "links", "name": "常用链接", "description": "系统、文档和工具入口"},
]
MODULE_KEYS = {item["key"] for item in MODULE_CATALOG}
PERMISSION_ACTIONS = ("view", "create", "edit", "delete")
PARTICIPATION_SCOPES = {
    "members": ("include_in_members", "团队成员"),
    "morning": ("include_in_morning", "早例会跟踪"),
    "rules": ("include_in_rules", "红黑榜名单"),
    "thanks": ("include_in_thanks", "Thank You 名单"),
}
DEFAULT_USER_TYPE_KEY = "default"
GUEST_USER_TYPE_KEY = "guest"
LEGACY_GUEST_MODULES = {"members", "shifts", "rules", "thanks", "links"}
SYSTEM_USER_TYPES = [
    (DEFAULT_USER_TYPE_KEY, "默认用户类型", "管理员可修改名称和权限，也可以在迁移用户后删除。", 10, 0),
    (GUEST_USER_TYPE_KEY, "访客", "未登录用户使用的只读权限模板。", 9999, 1),
]
INITIAL_TYPE_OPERATIONS = {
    DEFAULT_USER_TYPE_KEY: {
        "members": (1, 1, 1, 1),
        "dashboard": (1, 0, 0, 0),
        "archive": (1, 0, 0, 0),
        "morning": (1, 1, 1, 1),
        "meetings": (1, 1, 1, 0),
        "shifts": (1, 0, 0, 0),
        "rules": (1, 0, 0, 0),
        "thanks": (1, 1, 1, 1),
        "links": (1, 1, 1, 1),
    },
    GUEST_USER_TYPE_KEY: {
        module: (1, 0, 0, 0) for module in LEGACY_GUEST_MODULES
    },
}
MORNING_STATUSES = {"todo", "doing", "risk", "done"}
MORNING_PRIORITIES = {"low", "normal", "high"}


def now_iso():
    return dt.datetime.now().replace(microsecond=0).isoformat()


def today_iso():
    return dt.date.today().isoformat()


def is_past_date(value):
    return dt.date.fromisoformat(value) < dt.date.today()


def week_start(value=None):
    if value:
        date = dt.date.fromisoformat(value)
    else:
        date = dt.date.today()
    return (date - dt.timedelta(days=date.weekday())).isoformat()


def date_range(start, end, max_days=62):
    start_date = dt.date.fromisoformat(start)
    end_date = dt.date.fromisoformat(end or start)
    if end_date < start_date:
        raise AppError(400, "结束日期不能早于开始日期")
    days = (end_date - start_date).days + 1
    if days > max_days:
        raise AppError(400, f"一次最多批量处理 {max_days} 天")
    return [(start_date + dt.timedelta(days=offset)).isoformat() for offset in range(days)]


def normalize_recurrence(data):
    rule = data.get("recurrence_rule") or ""
    recurrence_type = data.get("recurrence_type") or "weekly"
    recurrence_value = str(data.get("recurrence_value") or data.get("recurrence_weeks") or "1")
    if rule:
        if ":" in rule:
            recurrence_type, recurrence_value = rule.split(":", 1)
        else:
            recurrence_type, recurrence_value = "weekly", rule
    if recurrence_type == "monthly_week":
        if recurrence_value not in MONTHLY_RECURRENCE_VALUES:
            raise AppError(400, "月度生成规则不合法")
        return recurrence_type, recurrence_value, 1
    recurrence = max(1, min(4, int(recurrence_value or 1)))
    return "weekly", str(recurrence), recurrence


def monthly_week_position(date):
    current = dt.date.fromisoformat(date) if isinstance(date, str) else date
    same_weekday = []
    cursor = current.replace(day=1)
    while cursor.month == current.month:
        if cursor.weekday() == current.weekday():
            same_weekday.append(cursor)
        cursor += dt.timedelta(days=1)
    ordinal = same_weekday.index(current) + 1 if current in same_weekday else 0
    reverse = len(same_weekday) - ordinal + 1 if ordinal else 0
    return ordinal, reverse


def recurrence_matches(option, offset, meeting_date):
    recurrence_type = option.get("recurrence_type") or "weekly"
    recurrence_value = str(option.get("recurrence_value") or option.get("recurrence_weeks") or "1")
    if recurrence_type == "monthly_week":
        ordinal, reverse = monthly_week_position(meeting_date)
        return (
            (recurrence_value == "first" and ordinal == 1)
            or (recurrence_value == "second" and ordinal == 2)
            or (recurrence_value == "third" and ordinal == 3)
            or (recurrence_value == "fourth" and ordinal == 4)
            or (recurrence_value == "penultimate" and reverse == 2)
            or (recurrence_value == "last" and reverse == 1)
        )
    recurrence = max(1, min(4, int(option.get("recurrence_weeks") or recurrence_value or 1)))
    return offset % recurrence == 0


def link_meeting_topic(conn, meeting_id, type_id, created_by=None):
    if not type_id:
        return
    topic = conn.execute(
        "SELECT id, sort_order FROM meeting_topic_types WHERE id=? AND active=1",
        (type_id,),
    ).fetchone()
    if not topic:
        return
    conn.execute(
        """
        INSERT OR IGNORE INTO meeting_topic_links(
            meeting_id, type_id, sort_order, created_by, created_at
        ) VALUES(?,?,?,?,?)
        """,
        (meeting_id, topic["id"], topic["sort_order"] or 0, created_by, now_iso()),
    )


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def make_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return salt, hashed.hex()


def verify_password(password, salt, password_hash):
    _, hashed = make_hash(password, salt)
    return hmac.compare_digest(hashed, password_hash)


def token_digest(token):
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def parse_iso_datetime(value):
    try:
        return dt.datetime.fromisoformat(value) if value else None
    except (TypeError, ValueError):
        return None


def row_to_dict(row):
    return dict(row) if row else None


def rows_to_list(rows):
    return [dict(row) for row in rows]


def read_json(handler):
    length = int(handler.headers.get("Content-Length") or 0)
    if length == 0:
        return {}
    raw = handler.rfile.read(length).decode("utf-8")
    return json.loads(raw or "{}")


def parse_cookies(header):
    cookies = {}
    if not header:
        return cookies
    for part in header.split(";"):
        if "=" in part:
            key, value = part.strip().split("=", 1)
            cookies[key] = value
    return cookies


def ensure_column(conn, table, column, definition):
    columns = [row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def seed_meeting_topics(conn):
    count = conn.execute("SELECT COUNT(*) FROM meeting_topic_types").fetchone()[0]
    if count:
        return
    defaults = [
        ("进度同步", "#3370ff", ["本周完成", "下周计划", "里程碑风险"]),
        ("问题风险", "#f54a45", ["现场阻塞", "资源协调", "质量风险"]),
        ("技术复盘", "#00b578", ["故障案例", "经验沉淀", "标准优化"]),
        ("行动项", "#ff8f1f", ["待办分配", "截止确认", "关闭验收"]),
    ]
    for index, (name, color, options) in enumerate(defaults, start=1):
        cursor = conn.execute(
            "INSERT INTO meeting_topic_types(name, color, sort_order, active) VALUES(?,?,?,1)",
            (name, color, index),
        )
        type_id = cursor.lastrowid
        for option_index, title in enumerate(options, start=1):
            conn.execute(
                "INSERT INTO meeting_topic_options(type_id, title, default_detail, sort_order, active) VALUES(?,?,?,?,1)",
                (type_id, title, "", option_index),
            )


def seed_link_categories(conn):
    count = conn.execute("SELECT COUNT(*) FROM link_categories").fetchone()[0]
    if count:
        return
    for index, name in enumerate(["通用", "文档", "系统", "工具", "流程"], start=1):
        conn.execute(
            "INSERT INTO link_categories(name, sort_order, active, created_at) VALUES(?,?,1,?)",
            (name, index, now_iso()),
        )


def seed_system_settings(conn):
    for key, label, value, value_type, description in DEFAULT_SETTINGS:
        conn.execute(
            """
            INSERT OR IGNORE INTO system_settings(key, label, value, value_type, description, updated_at)
            VALUES(?,?,?,?,?,?)
            """,
            (key, label, value, value_type, description, now_iso()),
        )


def seed_user_types(conn):
    for key, name, description, sort_order, locked in SYSTEM_USER_TYPES:
        conn.execute(
            """
            INSERT OR IGNORE INTO user_types(key, name, description, sort_order, locked, active, created_at)
            VALUES(?,?,?,?,?,1,?)
            """,
            (key, name, description, sort_order, locked, now_iso()),
        )
        if key == GUEST_USER_TYPE_KEY:
            conn.execute(
                "UPDATE user_types SET name=?, description=?, sort_order=?, locked=1, active=1 WHERE key=?",
                (name, description, sort_order, key),
            )
    for type_key, modules in INITIAL_TYPE_OPERATIONS.items():
        for module_key, actions in modules.items():
            conn.execute(
                """
                INSERT OR IGNORE INTO module_permissions(
                    user_type_key, module_key, can_view, can_create, can_edit, can_delete, updated_at
                ) VALUES(?,?,?,?,?,?,?)
                """,
                (type_key, module_key, *actions, now_iso()),
            )


def migrate_dynamic_user_types(conn):
    migration_key = "dynamic_user_types_v1"
    if conn.execute("SELECT key FROM schema_migrations WHERE key=?", (migration_key,)).fetchone():
        return

    legacy_internal = conn.execute("SELECT key FROM user_types WHERE key='internal'").fetchone()
    if legacy_internal:
        conn.execute(
            """
            INSERT OR REPLACE INTO module_permissions(
                user_type_key, module_key, can_view, can_create, can_edit, can_delete, updated_at
            )
            SELECT ?, module_key, can_view, can_create, can_edit, can_delete, ?
            FROM module_permissions WHERE user_type_key='internal'
            """,
            (DEFAULT_USER_TYPE_KEY, now_iso()),
        )
        conn.execute("UPDATE users SET user_type=? WHERE user_type='internal'", (DEFAULT_USER_TYPE_KEY,))
        conn.execute("DELETE FROM module_permissions WHERE user_type_key='internal'")
        conn.execute("UPDATE user_types SET active=0, locked=0 WHERE key='internal'")

    legacy_partner = conn.execute("SELECT key FROM user_types WHERE key='partner'").fetchone()
    if legacy_partner:
        assigned = conn.execute("SELECT COUNT(*) FROM users WHERE user_type='partner' AND active=1").fetchone()[0]
        if assigned:
            conn.execute(
                "UPDATE user_types SET name='受限用户类型', description='由旧权限配置迁移，可自由改名和调整权限。', locked=0, active=1 WHERE key='partner'"
            )
        else:
            conn.execute("DELETE FROM module_permissions WHERE user_type_key='partner'")
            conn.execute("UPDATE user_types SET active=0, locked=0 WHERE key='partner'")

    conn.execute(
        "INSERT INTO schema_migrations(key, applied_at) VALUES(?,?)",
        (migration_key, now_iso()),
    )


def migrate_operation_permissions(conn):
    migration_key = "operation_permissions_v1"
    if conn.execute("SELECT key FROM schema_migrations WHERE key=?", (migration_key,)).fetchone():
        return
    conn.execute("UPDATE module_permissions SET can_create=0, can_edit=0, can_delete=0")
    for type_key, modules in INITIAL_TYPE_OPERATIONS.items():
        for module_key, actions in modules.items():
            conn.execute(
                """
                INSERT INTO module_permissions(
                    user_type_key, module_key, can_view, can_create, can_edit, can_delete, updated_at
                ) VALUES(?,?,?,?,?,?,?)
                ON CONFLICT(user_type_key, module_key) DO UPDATE SET
                    can_view=excluded.can_view,
                    can_create=excluded.can_create,
                    can_edit=excluded.can_edit,
                    can_delete=excluded.can_delete,
                    updated_at=excluded.updated_at
                """,
                (type_key, module_key, *actions, now_iso()),
            )
    conn.execute(
        "INSERT INTO schema_migrations(key, applied_at) VALUES(?,?)",
        (migration_key, now_iso()),
    )


def seed_morning_items(conn):
    count = conn.execute("SELECT COUNT(*) FROM morning_items").fetchone()[0]
    if count:
        return
    users = conn.execute("SELECT id, display_name FROM users WHERE active=1 ORDER BY id LIMIT 4").fetchall()
    if not users:
        return
    samples = [
        ("TOPTB 夜班遗留闭环", "确认温控波动截图，上午同步是否需要补充复盘材料。", "doing", "high", "温控趋势需要王工确认", today_iso()),
        ("质量复盘模板更新", "整理红黑榜引用标准，让周会纪要可以直接复用。", "todo", "normal", "", today_iso()),
        ("现场报修跟进", "核对机台 A 报修工单状态，确认维修窗口。", "risk", "high", "等待供应商回复备件时间", today_iso()),
        ("常用链接梳理", "把高频看板和 SOP 链接置顶并补充关键词。", "done", "low", "", today_iso()),
    ]
    for index, sample in enumerate(samples):
        user = users[index % len(users)]
        cursor = conn.execute(
            """
            INSERT INTO morning_items(owner_id, item_date, title, detail, status, priority, blocker, due_date, updated_by, created_at, updated_at, active)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,1)
            """,
            (user["id"], sample[5], sample[0], sample[1], sample[2], sample[3], sample[4], sample[5], user["id"], now_iso(), now_iso()),
        )
        conn.execute("UPDATE morning_items SET root_id=? WHERE id=?", (cursor.lastrowid, cursor.lastrowid))


def seed_morning_history_samples(conn):
    existing = conn.execute("SELECT COUNT(*) FROM morning_items WHERE title LIKE '样例-%'").fetchone()[0]
    if existing:
        return
    users = conn.execute("SELECT id, display_name FROM users WHERE active=1 ORDER BY id LIMIT 6").fetchall()
    if not users:
        return
    chains = [
        {
            "owner": 0,
            "title": "样例-TOPTB 温控波动复盘",
            "priority": "high",
            "entries": [
                ("2026-06-30", "risk", "夜班出现两次温控上探，先确认报警截图和点检记录。", "需要王工补充趋势截图", "2026-07-01"),
                ("2026-07-01", "doing", "已拿到报警截图，等待白班复核实际温区影响。", "复核结论未同步", "2026-07-02"),
                ("2026-07-02", "done", "复核完成，波动来自测试台切换，已写入复盘模板。", "", "2026-07-02"),
            ],
        },
        {
            "owner": 1,
            "title": "样例-机台 A 报警截图补齐",
            "priority": "normal",
            "entries": [
                ("2026-07-01", "todo", "需要补齐 3 张报警截图，作为红黑榜事实依据。", "", "2026-07-03"),
                ("2026-07-02", "risk", "截图缺少夜班 02:30 的一张，先联系夜班补发。", "夜班截图未找到", "2026-07-03"),
                ("2026-07-03", "doing", "已补到 2 张，剩余 1 张从监控导出。", "监控导出权限待确认", "2026-07-04"),
                ("2026-07-04", "doing", "继续跟进监控导出权限，今天下班前确认。", "权限审批未完成", "2026-07-04"),
            ],
        },
        {
            "owner": 2,
            "title": "样例-SOP 点检表更新",
            "priority": "normal",
            "entries": [
                ("2026-07-02", "todo", "把老化测试台点检步骤补进 SOP 标准库。", "", "2026-07-03"),
                ("2026-07-03", "done", "SOP 已更新，常用链接里已补充入口。", "", "2026-07-03"),
            ],
        },
        {
            "owner": 3,
            "title": "样例-夜班交接问题跟踪",
            "priority": "high",
            "entries": [
                ("2026-07-03", "risk", "夜班交接记录有两处描述不一致，影响异常归因。", "交接口径不一致", "2026-07-04"),
                ("2026-07-04", "risk", "早会需要统一交接口径，并确定后续记录模板。", "缺少统一模板", "2026-07-04"),
            ],
        },
        {
            "owner": 4,
            "title": "样例-供应商备件到货确认",
            "priority": "high",
            "entries": [
                ("2026-07-01", "risk", "机台 B 备用传感器缺货，供应商未给明确到货时间。", "供应商回复不明确", "2026-07-04"),
                ("2026-07-04", "risk", "今天必须确认到货日期，否则排班要规避机台 B 风险窗口。", "到货日期未锁定", "2026-07-04"),
            ],
        },
        {
            "owner": 5,
            "title": "样例-常用链接关键词补充",
            "priority": "low",
            "entries": [
                ("2026-07-04", "todo", "给高频看板和 SOP 链接补充适用范围关键词。", "", "2026-07-05"),
            ],
        },
    ]
    for chain in chains:
        root_id = None
        previous_id = None
        previous_date = None
        owner = users[chain["owner"] % len(users)]
        for item_date, status, detail, blocker, due_date in chain["entries"]:
            cursor = conn.execute(
                """
                INSERT INTO morning_items(
                    owner_id, item_date, title, detail, status, priority, blocker, due_date,
                    root_id, carry_from_id, carried_from_date, updated_by, created_at, updated_at, active
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
                """,
                (
                    owner["id"],
                    item_date,
                    chain["title"],
                    detail,
                    status,
                    chain["priority"],
                    blocker,
                    due_date,
                    root_id,
                    previous_id,
                    previous_date,
                    owner["id"],
                    f"{item_date}T08:30:00",
                    f"{item_date}T09:00:00",
                ),
            )
            if root_id is None:
                root_id = cursor.lastrowid
                conn.execute("UPDATE morning_items SET root_id=? WHERE id=?", (root_id, cursor.lastrowid))
            previous_id = cursor.lastrowid
            previous_date = item_date


def ensure_morning_carryover(conn, item_date):
    target_date = dt.date.fromisoformat(item_date)
    if target_date < dt.date.today():
        return 0
    source_items = rows_to_list(
        conn.execute(
            """
            SELECT i.*
            FROM morning_items i
            JOIN users owner ON owner.id=i.owner_id AND owner.active=1
            LEFT JOIN user_types owner_type ON owner_type.key=owner.user_type
            WHERE i.item_date < ?
              AND i.active=1
              AND i.status!='done'
              AND COALESCE(owner_type.include_in_morning, 1)=1
              AND NOT EXISTS (
                  SELECT 1
                  FROM morning_items newer
                  WHERE COALESCE(newer.root_id, newer.id)=COALESCE(i.root_id, i.id)
                    AND newer.item_date < ?
                    AND (
                        newer.item_date > i.item_date
                        OR (newer.item_date = i.item_date AND newer.id > i.id)
                    )
              )
            ORDER BY i.owner_id, i.id
            """,
            (item_date, item_date),
        ).fetchall()
    )
    carried_count = 0
    for item in source_items:
        root_id = item.get("root_id") or item["id"]
        exists = conn.execute(
            """
            SELECT id
            FROM morning_items
            WHERE item_date=? AND COALESCE(root_id, id)=?
            """,
            (item_date, root_id),
        ).fetchone()
        if exists:
            continue
        conn.execute(
            """
            INSERT INTO morning_items(
                owner_id, item_date, title, detail, status, priority, blocker, due_date,
                root_id, carry_from_id, carried_from_date, updated_by, created_at, updated_at, active
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
            """,
            (
                item["owner_id"],
                item_date,
                item["title"],
                item.get("detail") or "",
                item["status"],
                item.get("priority") or "normal",
                item.get("blocker") or "",
                item.get("due_date") or item_date,
                root_id,
                item["id"],
                item["item_date"],
                item.get("updated_by"),
                now_iso(),
                now_iso(),
            ),
        )
        carried_count += 1
    return carried_count


def get_setting_value(conn, key, default=None):
    row = conn.execute("SELECT value FROM system_settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def get_int_setting(conn, key, default, minimum=None, maximum=None):
    try:
        value = int(get_setting_value(conn, key, default))
    except (TypeError, ValueError):
        value = int(default)
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def get_float_setting(conn, key, default, minimum=None, maximum=None):
    try:
        value = float(get_setting_value(conn, key, default))
    except (TypeError, ValueError):
        value = float(default)
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def sso_setting(conn, key, default=""):
    env_key = f"TEAM_LOOP_{key.upper()}"
    env_value = os.environ.get(env_key)
    if env_value is not None:
        return env_value.strip()
    return str(get_setting_value(conn, key, default) or "").strip()


def sso_configuration(conn):
    enabled = sso_setting(conn, "sso_enabled", "0").lower() in ("1", "true", "yes", "on", "启用")
    mode = sso_setting(conn, "sso_mode", "discovery").lower()
    if mode not in ("discovery", "manual"):
        mode = "discovery"
    return {
        "enabled": enabled,
        "auto_login": sso_setting(conn, "sso_auto_login", "1").lower() in ("1", "true", "yes", "on", "启用"),
        "mode": mode,
        "button_label": sso_setting(conn, "sso_button_label", "企业 SSO 登录") or "企业 SSO 登录",
        "issuer_url": sso_setting(conn, "sso_issuer_url").rstrip("/"),
        "authorization_url": sso_setting(conn, "sso_authorization_url"),
        "token_url": sso_setting(conn, "sso_token_url"),
        "userinfo_url": sso_setting(conn, "sso_userinfo_url"),
        "client_id": sso_setting(conn, "sso_client_id"),
        "client_secret": sso_setting(conn, "sso_client_secret"),
        "redirect_uri": sso_setting(conn, "sso_redirect_uri"),
        "scopes": sso_setting(conn, "sso_scopes", "openid profile email") or "openid profile email",
        "username_claim": sso_setting(conn, "sso_username_claim", "preferred_username") or "preferred_username",
        "display_name_claim": sso_setting(conn, "sso_display_name_claim", "name") or "name",
        "default_user_type": sso_setting(conn, "sso_default_user_type", DEFAULT_USER_TYPE_KEY) or DEFAULT_USER_TYPE_KEY,
        "auto_provision": sso_setting(conn, "sso_auto_provision", "1").lower() in ("1", "true", "yes", "on", "启用"),
    }


def validate_sso_url(value, label):
    parsed = urlparse(value or "")
    local_hosts = {"127.0.0.1", "localhost", "::1"}
    if not parsed.hostname or parsed.scheme not in ("http", "https"):
        raise AppError(400, f"{label}不是合法的 HTTP 地址")
    if parsed.scheme != "https" and parsed.hostname.lower() not in local_hosts:
        raise AppError(400, f"{label}必须使用 HTTPS")
    if parsed.username or parsed.password:
        raise AppError(400, f"{label}不能包含账号或密码")
    return value


def fetch_json(url, method="GET", form=None, headers=None):
    validate_sso_url(url, "OIDC 服务地址")
    request_headers = {"Accept": "application/json", "User-Agent": "TeamLoop-OIDC/1.0", **(headers or {})}
    body = None
    if form is not None:
        body = urlencode(form).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
    request = Request(url, data=body, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=12) as response:
            payload = response.read(1024 * 1024 + 1)
    except HTTPError as exc:
        raise AppError(502, f"企业身份平台返回 HTTP {exc.code}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise AppError(502, "无法连接企业身份平台，请检查 SSO 地址和网络") from exc
    if len(payload) > 1024 * 1024:
        raise AppError(502, "企业身份平台响应过大")
    try:
        data = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AppError(502, "企业身份平台返回了无效数据") from exc
    if not isinstance(data, dict):
        raise AppError(502, "企业身份平台响应格式不正确")
    return data


def load_oidc_discovery(config):
    if config.get("mode") == "manual":
        endpoints = {
            "authorization_endpoint": config.get("authorization_url"),
            "token_endpoint": config.get("token_url"),
            "userinfo_endpoint": config.get("userinfo_url"),
        }
        for key, value in endpoints.items():
            if not value:
                raise AppError(400, "手动 OAuth2 模式必须填写授权、Token 和用户信息地址")
            validate_sso_url(value, key)
        endpoints["issuer"] = (config.get("issuer_url") or "").rstrip("/")
        endpoints["token_endpoint_auth_methods_supported"] = ["client_secret_post"]
        return endpoints
    issuer = validate_sso_url(config.get("issuer_url"), "OIDC Issuer 地址").rstrip("/")
    discovery = fetch_json(f"{issuer}/.well-known/openid-configuration")
    discovered_issuer = str(discovery.get("issuer") or "").rstrip("/")
    if discovered_issuer and discovered_issuer != issuer:
        raise AppError(502, "OIDC Discovery 返回的 Issuer 与系统配置不一致")
    for key in ("authorization_endpoint", "token_endpoint", "userinfo_endpoint"):
        if not discovery.get(key):
            raise AppError(502, f"OIDC Discovery 缺少 {key}")
        validate_sso_url(discovery[key], key)
    return discovery


def sso_configuration_ready(config):
    if not config.get("enabled") or not config.get("client_id"):
        return False
    if config.get("mode") == "manual":
        return all(config.get(key) for key in ("authorization_url", "token_url", "userinfo_url"))
    return bool(config.get("issuer_url"))


def base64url_digest(value):
    digest = hashlib.sha256(value.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def claim_value(claims, path):
    value = claims
    for part in str(path or "").split("."):
        if not part or not isinstance(value, dict):
            return ""
        value = value.get(part)
    if isinstance(value, (str, int)):
        return str(value).strip()
    return ""


def write_audit(conn, user, action, entity_type, entity_id=None, summary="", metadata=None, ip_address=""):
    user_id = user.get("id") if isinstance(user, dict) else user
    conn.execute(
        """
        INSERT INTO audit_logs(user_id, action, entity_type, entity_id, summary, metadata, ip_address, created_at)
        VALUES(?,?,?,?,?,?,?,?)
        """,
        (
            user_id,
            action,
            entity_type,
            entity_id,
            summary,
            json.dumps(metadata or {}, ensure_ascii=False),
            ip_address,
            now_iso(),
        ),
    )


def add_recycle_record(conn, entity_type, entity_id, title, user, payload=None):
    conn.execute(
        """
        INSERT INTO recycle_bin(entity_type, entity_id, title, payload, deleted_by, deleted_at, status)
        VALUES(?,?,?,?,?,?, 'deleted')
        """,
        (
            entity_type,
            entity_id,
            title or f"{entity_type} #{entity_id}",
            json.dumps(payload or {}, ensure_ascii=False),
            user["id"],
            now_iso(),
        ),
    )


def prune_old_backups(conn):
    retention_days = get_int_setting(conn, "backup_retention_days", 30, minimum=0, maximum=3650)
    if retention_days <= 0:
        return
    cutoff = dt.datetime.now() - dt.timedelta(days=retention_days)
    for row in conn.execute("SELECT id, filename, created_at FROM backups").fetchall():
        try:
            created_at = dt.datetime.fromisoformat(row["created_at"])
        except ValueError:
            continue
        if created_at >= cutoff:
            continue
        backup_path = BACKUP_DIR / row["filename"]
        if backup_path.exists():
            backup_path.unlink()
        conn.execute("DELETE FROM backups WHERE id=?", (row["id"],))


def create_database_backup(kind="manual", user_id=None):
    if not DB_PATH.exists():
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"weekly_team_{kind}_{stamp}.db"
    target = BACKUP_DIR / filename
    with sqlite3.connect(DB_PATH) as source, sqlite3.connect(target) as dest:
        source.backup(dest)
    size = target.stat().st_size
    with connect() as conn:
        cursor = conn.execute(
            "INSERT INTO backups(filename, size_bytes, kind, created_by, created_at) VALUES(?,?,?,?,?)",
            (filename, size, kind, user_id, now_iso()),
        )
        write_audit(
            conn,
            user_id,
            "backup.create",
            "backup",
            cursor.lastrowid,
            "自动备份已生成" if kind == "auto" else "手动备份已生成",
            {"filename": filename, "size_bytes": size, "kind": kind},
        )
        prune_old_backups(conn)
    return {"filename": filename, "size_bytes": size, "kind": kind}


def ensure_daily_backup():
    if not DB_PATH.exists():
        return
    with connect() as conn:
        enabled = get_setting_value(conn, "backup_auto_enabled", "1") != "0"
        if not enabled:
            return
        today_prefix = f"weekly_team_auto_{dt.datetime.now().strftime('%Y%m%d')}_"
        exists = conn.execute(
            "SELECT id FROM backups WHERE kind='auto' AND filename LIKE ? LIMIT 1",
            (f"{today_prefix}%",),
        ).fetchone()
    if exists:
        return
    if any(BACKUP_DIR.glob(f"{today_prefix}*.db")):
        return
    create_database_backup(kind="auto", user_id=None)


def default_member_title(role):
    return "管理员" if role == "admin" else "团队成员"


def sync_member_for_user(conn, user_id):
    user = conn.execute(
        "SELECT id, display_name, role, active FROM users WHERE id=?",
        (user_id,),
    ).fetchone()
    if not user:
        return
    members = conn.execute("SELECT id, title FROM members WHERE user_id=? ORDER BY id", (user_id,)).fetchall()
    if members:
        member = members[0]
        duplicate_ids = [row["id"] for row in members[1:]]
        if duplicate_ids:
            placeholders = ",".join("?" for _ in duplicate_ids)
            conn.execute(f"UPDATE members SET active=0 WHERE id IN ({placeholders})", duplicate_ids)
        title = member["title"] or default_member_title(user["role"])
        conn.execute(
            "UPDATE members SET name=?, title=?, active=? WHERE id=?",
            (user["display_name"], title, user["active"], member["id"]),
        )
        return
    conn.execute(
        "INSERT INTO members(user_id, name, avatar_url, title, responsibilities, tags, comment, created_at, active) VALUES(?,?,?,?,?,?,?,?,?)",
        (user["id"], user["display_name"], "", default_member_title(user["role"]), "", "[]", "", now_iso(), user["active"]),
    )


def sync_members_with_users(conn):
    for user in conn.execute("SELECT id FROM users").fetchall():
        sync_member_for_user(conn, user["id"])


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                employee_id TEXT,
                salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
                user_type TEXT NOT NULL DEFAULT 'default',
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_types (
                key TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                locked INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1,
                version INTEGER NOT NULL DEFAULT 1,
                include_in_members INTEGER NOT NULL DEFAULT 1,
                include_in_morning INTEGER NOT NULL DEFAULT 1,
                include_in_rules INTEGER NOT NULL DEFAULT 1,
                include_in_thanks INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS module_permissions (
                user_type_key TEXT NOT NULL REFERENCES user_types(key) ON DELETE CASCADE,
                module_key TEXT NOT NULL,
                can_view INTEGER NOT NULL DEFAULT 1,
                can_create INTEGER NOT NULL DEFAULT 1,
                can_edit INTEGER NOT NULL DEFAULT 1,
                can_delete INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(user_type_key, module_key)
            );

            CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                name TEXT NOT NULL,
                avatar_url TEXT,
                title TEXT,
                responsibilities TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                comment TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS member_posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                kind TEXT NOT NULL CHECK(kind IN ('comment', 'roast')),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS team_posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                kind TEXT NOT NULL CHECK(kind IN ('comment', 'roast')),
                title TEXT,
                category TEXT NOT NULL DEFAULT 'general',
                status TEXT NOT NULL DEFAULT 'open',
                pinned INTEGER NOT NULL DEFAULT 0,
                view_count INTEGER NOT NULL DEFAULT 0,
                content TEXT NOT NULL,
                updated_at TEXT,
                deleted_at TEXT,
                deleted_by INTEGER REFERENCES users(id),
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS team_post_replies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL REFERENCES team_posts(id) ON DELETE CASCADE,
                parent_reply_id INTEGER REFERENCES team_post_replies(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                content TEXT NOT NULL,
                deleted_at TEXT,
                deleted_by INTEGER REFERENCES users(id),
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS team_post_reactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL REFERENCES team_posts(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                reaction TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(post_id, user_id, reaction)
            );

            CREATE TABLE IF NOT EXISTS team_reply_reactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reply_id INTEGER NOT NULL REFERENCES team_post_replies(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                reaction TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(reply_id, user_id, reaction)
            );

            CREATE TABLE IF NOT EXISTS red_black_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                kind TEXT NOT NULL CHECK(kind IN ('red', 'black')),
                content TEXT NOT NULL,
                effective_from TEXT,
                effective_to TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS red_black_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                rule_id INTEGER REFERENCES red_black_rules(id) ON DELETE SET NULL,
                kind TEXT NOT NULL CHECK(kind IN ('red', 'black')),
                points INTEGER NOT NULL,
                reason TEXT NOT NULL,
                score_date TEXT NOT NULL,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS meetings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_date TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT,
                status TEXT NOT NULL DEFAULT 'open',
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS meeting_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
                section TEXT NOT NULL,
                title TEXT NOT NULL,
                detail TEXT,
                minutes TEXT,
                owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                status TEXT NOT NULL DEFAULT 'todo',
                due_date TEXT,
                created_by INTEGER NOT NULL REFERENCES users(id),
                deleted_at TEXT,
                deleted_by INTEGER REFERENCES users(id),
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS meeting_topic_types (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT '#3370ff',
                sort_order INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS meeting_topic_options (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type_id INTEGER NOT NULL REFERENCES meeting_topic_types(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                default_detail TEXT,
                owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                recurrence_weeks INTEGER NOT NULL DEFAULT 1,
                recurrence_type TEXT NOT NULL DEFAULT 'weekly',
                recurrence_value TEXT NOT NULL DEFAULT '1',
                sort_order INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS meeting_topic_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
                type_id INTEGER NOT NULL REFERENCES meeting_topic_types(id) ON DELETE CASCADE,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_by INTEGER REFERENCES users(id),
                created_at TEXT NOT NULL,
                UNIQUE(meeting_id, type_id)
            );

            CREATE TABLE IF NOT EXISTS meeting_attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                status TEXT NOT NULL CHECK(status IN ('present', 'leave', 'absent', 'late')),
                donation_required INTEGER NOT NULL DEFAULT 0,
                donation_amount REAL NOT NULL DEFAULT 0,
                donation_done INTEGER NOT NULL DEFAULT 0,
                note TEXT,
                updated_by INTEGER NOT NULL REFERENCES users(id),
                updated_at TEXT NOT NULL,
                UNIQUE(meeting_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '通用',
                description TEXT,
                pinned INTEGER NOT NULL DEFAULT 0,
                invalid INTEGER NOT NULL DEFAULT 0,
                click_count INTEGER NOT NULL DEFAULT 0,
                last_clicked_at TEXT,
                quality_note TEXT,
                machine_scope TEXT NOT NULL DEFAULT '[]',
                process_tags TEXT NOT NULL DEFAULT '[]',
                created_by INTEGER NOT NULL REFERENCES users(id),
                deleted_at TEXT,
                deleted_by INTEGER REFERENCES users(id),
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS recycle_bin (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL,
                entity_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                payload TEXT NOT NULL DEFAULT '{}',
                deleted_by INTEGER NOT NULL REFERENCES users(id),
                deleted_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'deleted',
                resolved_by INTEGER REFERENCES users(id),
                resolved_at TEXT
            );

            CREATE TABLE IF NOT EXISTS reminder_reads (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                reminder_key TEXT NOT NULL,
                read_at TEXT NOT NULL,
                PRIMARY KEY(user_id, reminder_key)
            );

            CREATE TABLE IF NOT EXISTS schema_migrations (
                key TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS link_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                sort_order INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS machines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT
            );

            CREATE TABLE IF NOT EXISTS shifts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                machine_id INTEGER NOT NULL REFERENCES machines(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                shift_type TEXT NOT NULL CHECK(shift_type IN ('day', 'night')),
                shift_date TEXT NOT NULL,
                hours REAL NOT NULL DEFAULT 12,
                note TEXT,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS auth_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_hash TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                ip_address TEXT,
                user_agent TEXT,
                created_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                revoked_at TEXT
            );

            CREATE TABLE IF NOT EXISTS login_attempts (
                username TEXT NOT NULL,
                ip_address TEXT NOT NULL,
                failed_count INTEGER NOT NULL DEFAULT 0,
                window_started_at TEXT NOT NULL,
                locked_until TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(username, ip_address)
            );

            CREATE TABLE IF NOT EXISTS sso_login_states (
                state_hash TEXT PRIMARY KEY,
                nonce TEXT NOT NULL,
                code_verifier TEXT NOT NULL,
                redirect_uri TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used_at TEXT
            );

            CREATE TABLE IF NOT EXISTS thank_you_votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                voter_id INTEGER NOT NULL REFERENCES users(id),
                receiver_id INTEGER NOT NULL REFERENCES users(id),
                week_start TEXT NOT NULL,
                evidence TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(voter_id, receiver_id, week_start)
            );

            CREATE TABLE IF NOT EXISTS morning_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id INTEGER NOT NULL REFERENCES users(id),
                item_date TEXT NOT NULL,
                title TEXT NOT NULL,
                detail TEXT,
                status TEXT NOT NULL DEFAULT 'todo',
                priority TEXT NOT NULL DEFAULT 'normal',
                blocker TEXT,
                due_date TEXT,
                root_id INTEGER,
                carry_from_id INTEGER REFERENCES morning_items(id),
                carried_from_date TEXT,
                updated_by INTEGER REFERENCES users(id),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                value TEXT NOT NULL,
                value_type TEXT NOT NULL DEFAULT 'text',
                description TEXT,
                updated_by INTEGER REFERENCES users(id),
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER REFERENCES users(id),
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id INTEGER,
                summary TEXT,
                metadata TEXT,
                ip_address TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS backups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL UNIQUE,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                kind TEXT NOT NULL CHECK(kind IN ('auto', 'manual')),
                created_by INTEGER REFERENCES users(id),
                created_at TEXT NOT NULL
            );
            """
        )
        ensure_column(conn, "users", "user_type", "TEXT NOT NULL DEFAULT 'default'")
        ensure_column(conn, "users", "auth_source", "TEXT NOT NULL DEFAULT 'local'")
        ensure_column(conn, "users", "external_subject", "TEXT")
        ensure_column(conn, "users", "employee_id", "TEXT")
        ensure_column(conn, "user_types", "version", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "user_types", "include_in_members", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "user_types", "include_in_morning", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "user_types", "include_in_rules", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "user_types", "include_in_thanks", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "members", "active", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "members", "sort_order", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "members", "skills", "TEXT NOT NULL DEFAULT '[]'")
        ensure_column(conn, "members", "machine_scope", "TEXT NOT NULL DEFAULT '[]'")
        ensure_column(conn, "members", "expertise", "TEXT")
        ensure_column(conn, "members", "backup_owner", "TEXT")
        ensure_column(conn, "members", "contact", "TEXT")
        ensure_column(conn, "module_permissions", "can_create", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "module_permissions", "can_edit", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "module_permissions", "can_delete", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "team_post_replies", "parent_reply_id", "INTEGER")
        ensure_column(conn, "team_post_replies", "deleted_at", "TEXT")
        ensure_column(conn, "team_post_replies", "deleted_by", "INTEGER")
        ensure_column(conn, "team_posts", "title", "TEXT")
        ensure_column(conn, "team_posts", "category", "TEXT NOT NULL DEFAULT 'general'")
        ensure_column(conn, "team_posts", "status", "TEXT NOT NULL DEFAULT 'open'")
        ensure_column(conn, "team_posts", "pinned", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "team_posts", "view_count", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "team_posts", "updated_at", "TEXT")
        ensure_column(conn, "team_posts", "deleted_at", "TEXT")
        ensure_column(conn, "team_posts", "deleted_by", "INTEGER")
        ensure_column(conn, "links", "pinned", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "links", "invalid", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "links", "click_count", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "links", "last_clicked_at", "TEXT")
        ensure_column(conn, "backups", "verify_status", "TEXT")
        ensure_column(conn, "backups", "verified_at", "TEXT")
        ensure_column(conn, "backups", "verify_message", "TEXT")
        ensure_column(conn, "backups", "restored_at", "TEXT")
        ensure_column(conn, "backups", "restored_by", "INTEGER")
        ensure_column(conn, "backups", "restore_message", "TEXT")
        ensure_column(conn, "links", "quality_note", "TEXT")
        ensure_column(conn, "links", "machine_scope", "TEXT NOT NULL DEFAULT '[]'")
        ensure_column(conn, "links", "process_tags", "TEXT NOT NULL DEFAULT '[]'")
        ensure_column(conn, "links", "deleted_at", "TEXT")
        ensure_column(conn, "links", "deleted_by", "INTEGER")
        ensure_column(conn, "meeting_items", "type_id", "INTEGER")
        ensure_column(conn, "meeting_items", "option_id", "INTEGER")
        ensure_column(conn, "meeting_items", "minutes", "TEXT")
        ensure_column(conn, "meeting_items", "open_issues", "TEXT")
        ensure_column(conn, "meeting_items", "next_steps", "TEXT")
        ensure_column(conn, "meeting_items", "deleted_at", "TEXT")
        ensure_column(conn, "meeting_items", "deleted_by", "INTEGER")
        ensure_column(conn, "meeting_items", "sort_order", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "meeting_items", "duration_minutes", "INTEGER NOT NULL DEFAULT 10")
        ensure_column(conn, "meeting_items", "expected_output", "TEXT")
        ensure_column(conn, "meeting_items", "materials", "TEXT")
        ensure_column(conn, "meeting_items", "carried_from_id", "INTEGER")
        ensure_column(conn, "meetings", "start_time", "TEXT")
        ensure_column(conn, "meeting_attendance", "donation_amount", "REAL NOT NULL DEFAULT 0")
        ensure_column(conn, "meeting_topic_options", "owner_id", "INTEGER")
        ensure_column(conn, "meeting_topic_options", "recurrence_weeks", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "meeting_topic_options", "recurrence_type", "TEXT NOT NULL DEFAULT 'weekly'")
        ensure_column(conn, "meeting_topic_options", "recurrence_value", "TEXT NOT NULL DEFAULT '1'")
        ensure_column(conn, "meeting_topic_options", "duration_minutes", "INTEGER NOT NULL DEFAULT 10")
        ensure_column(conn, "meeting_topic_options", "expected_output", "TEXT")
        ensure_column(conn, "meeting_topic_options", "materials", "TEXT")
        ensure_column(conn, "morning_items", "priority", "TEXT NOT NULL DEFAULT 'normal'")
        ensure_column(conn, "morning_items", "blocker", "TEXT")
        ensure_column(conn, "morning_items", "due_date", "TEXT")
        ensure_column(conn, "morning_items", "root_id", "INTEGER")
        ensure_column(conn, "morning_items", "carry_from_id", "INTEGER")
        ensure_column(conn, "morning_items", "carried_from_date", "TEXT")
        ensure_column(conn, "morning_items", "updated_by", "INTEGER")
        ensure_column(conn, "morning_items", "updated_at", "TEXT")
        ensure_column(conn, "morning_items", "version", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "morning_items", "active", "INTEGER NOT NULL DEFAULT 1")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active ON auth_sessions(user_id, revoked_at, expires_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash)")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_identity ON users(auth_source, external_subject) WHERE external_subject IS NOT NULL AND external_subject<>''")
        conn.execute("UPDATE users SET employee_id=username WHERE employee_id IS NULL OR trim(employee_id)=''")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id COLLATE NOCASE) WHERE employee_id IS NOT NULL AND trim(employee_id)<>''")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sso_states_expiry ON sso_login_states(expires_at, used_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_shifts_user_date ON shifts(user_id, shift_date)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_team_posts_activity ON team_posts(pinned, updated_at, created_at)")
        conn.execute("UPDATE team_posts SET title=substr(content, 1, 40) WHERE title IS NULL OR trim(title)=''")
        conn.execute("UPDATE team_posts SET category=CASE WHEN kind='roast' THEN 'roast' ELSE 'general' END WHERE category IS NULL OR trim(category)=''")
        conn.execute("UPDATE team_posts SET status='open' WHERE status IS NULL OR trim(status)=''")
        conn.execute("UPDATE team_posts SET updated_at=created_at WHERE updated_at IS NULL OR trim(updated_at)=''")
        conn.execute("UPDATE meeting_topic_options SET recurrence_type='weekly' WHERE recurrence_type IS NULL OR recurrence_type=''")
        conn.execute("UPDATE meeting_topic_options SET recurrence_value=CAST(COALESCE(recurrence_weeks, 1) AS TEXT) WHERE recurrence_value IS NULL OR recurrence_value=''")
        conn.execute("UPDATE meeting_topic_options SET recurrence_value=CAST(COALESCE(recurrence_weeks, 1) AS TEXT) WHERE recurrence_type='weekly'")
        conn.execute("UPDATE meetings SET status='scheduled' WHERE status='open' OR status IS NULL OR status=''")
        conn.execute("UPDATE meetings SET status='completed' WHERE status='closed'")
        conn.execute("UPDATE meeting_items SET sort_order=id WHERE sort_order IS NULL OR sort_order=0")
        conn.execute("UPDATE users SET user_type=? WHERE user_type IS NULL OR user_type=''", (DEFAULT_USER_TYPE_KEY,))
        conn.execute("UPDATE members SET sort_order=id WHERE sort_order IS NULL OR sort_order=0")
        conn.execute("UPDATE morning_items SET updated_at=created_at WHERE updated_at IS NULL OR updated_at=''")
        conn.execute("UPDATE morning_items SET root_id=id WHERE root_id IS NULL")
        seed_meeting_topics(conn)
        seed_link_categories(conn)
        seed_system_settings(conn)
        seed_user_types(conn)
        conn.execute(
            """
            UPDATE user_types
            SET include_in_members=0, include_in_morning=0, include_in_rules=0, include_in_thanks=0
            WHERE key=?
            """,
            (GUEST_USER_TYPE_KEY,),
        )
        migrate_dynamic_user_types(conn)
        migrate_operation_permissions(conn)
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if count == 0:
            admin_salt, admin_hash = make_hash("admin123")
            user_salt, user_hash = make_hash("user123")
            conn.execute(
                "INSERT INTO users(username, employee_id, salt, password_hash, display_name, role, user_type, created_at) VALUES(?,?,?,?,?,?,?,?)",
                ("admin", "admin", admin_salt, admin_hash, "管理员", "admin", DEFAULT_USER_TYPE_KEY, now_iso()),
            )
            conn.execute(
                "INSERT INTO users(username, employee_id, salt, password_hash, display_name, role, user_type, created_at) VALUES(?,?,?,?,?,?,?,?)",
                ("user", "user", user_salt, user_hash, "示例成员", "user", DEFAULT_USER_TYPE_KEY, now_iso()),
            )
            conn.execute(
                "INSERT INTO machines(name, description) VALUES(?, ?)",
                ("机台 A", "默认示例机台，可在管理员视图中维护"),
            )
            conn.execute(
                "INSERT INTO machines(name, description) VALUES(?, ?)",
                ("机台 B", "默认示例机台，可在管理员视图中维护"),
            )
            conn.execute(
                "INSERT INTO members(user_id, name, avatar_url, title, responsibilities, tags, comment, created_at) VALUES(?,?,?,?,?,?,?,?)",
                (1, "管理员", "", "项目负责人", "周例会组织、规则维护、资源协调", json.dumps(["统筹", "规则"], ensure_ascii=False), "负责让团队信息流动起来。", now_iso()),
            )
            conn.execute(
                "INSERT INTO members(user_id, name, avatar_url, title, responsibilities, tags, comment, created_at) VALUES(?,?,?,?,?,?,?,?)",
                (2, "示例成员", "", "技术成员", "问题跟进、现场支持、经验沉淀", json.dumps(["执行", "现场"], ensure_ascii=False), "一线问题的主要贡献者。", now_iso()),
            )
        seed_morning_items(conn)
        seed_morning_history_samples(conn)
        sync_members_with_users(conn)


class AppError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


class Handler(BaseHTTPRequestHandler):
    server_version = "WeeklyTeam/1.0"

    def do_GET(self):
        self.handle_request("GET")

    def do_POST(self):
        self.handle_request("POST")

    def do_PATCH(self):
        self.handle_request("PATCH")

    def do_DELETE(self):
        self.handle_request("DELETE")

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def handle_request(self, method):
        parsed = urlparse(self.path)
        try:
            if parsed.path.startswith("/api/") and DEPLOY_ENV != "gray":
                ensure_daily_backup()
            if parsed.path in ("/api/sso/login", "/api/sso/callback") and method == "GET":
                try:
                    if parsed.path == "/api/sso/login":
                        self.start_sso_login()
                    else:
                        self.complete_sso_login(parse_qs(parsed.query))
                except AppError as exc:
                    self.send_redirect(f"/?sso_error={quote(exc.message, safe='')}")
                except Exception:
                    traceback.print_exc()
                    message = "企业 SSO 登录处理失败，请联系管理员查看服务日志"
                    self.send_redirect(f"/?sso_error={quote(message, safe='')}")
                return
            if parsed.path == "/api/backups/download" and method == "GET":
                self.send_backup_file(parse_qs(parsed.query))
                return
            link_open = parsed.path.strip("/").split("/")
            if len(link_open) == 4 and link_open[:2] == ["api", "links"] and link_open[3] == "open" and method == "GET":
                self.send_link_redirect(int(link_open[2]))
                return
            if parsed.path.startswith("/api/"):
                result = self.route_api(method, parsed.path, parse_qs(parsed.query))
                self.send_json(result)
            else:
                self.serve_static(parsed.path)
        except AppError as exc:
            self.send_json({"error": exc.message}, exc.status)
        except json.JSONDecodeError:
            self.send_json({"error": "请求体不是合法 JSON"}, 400)
        except Exception as exc:
            self.send_json({"error": str(exc)}, 500)

    def send_json(self, data, status=200, headers=None):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(payload)

    def serve_static(self, path):
        if path in ("", "/"):
            file_path = STATIC_DIR / "index.html"
        else:
            safe = Path(path.lstrip("/"))
            file_path = (STATIC_DIR / safe).resolve()
            if STATIC_DIR.resolve() not in file_path.parents and file_path != STATIC_DIR.resolve():
                raise AppError(403, "禁止访问该路径")
        if not file_path.exists() or not file_path.is_file():
            raise AppError(404, "文件不存在")
        mime = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        content = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Connection", "close")
        self.close_connection = True
        self.end_headers()
        self.wfile.write(content)
        self.wfile.flush()

    def send_redirect(self, location, headers=None):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.close_connection = True
        self.end_headers()

    def send_link_redirect(self, link_id):
        user = self.current_user(required=False)
        self.require_module(user, "links")
        with connect() as conn:
            link = conn.execute("SELECT id, title, url, invalid FROM links WHERE id=? AND deleted_at IS NULL", (link_id,)).fetchone()
            if not link:
                raise AppError(404, "链接不存在")
            if link["invalid"]:
                raise AppError(410, "链接已标记失效，已阻止打开")
            conn.execute(
                "UPDATE links SET click_count=COALESCE(click_count, 0)+1, last_clicked_at=? WHERE id=?",
                (now_iso(), link_id),
            )
        self.send_response(302)
        self.send_header("Location", link["url"])
        self.send_header("Content-Length", "0")
        self.send_header("Connection", "close")
        self.close_connection = True
        self.end_headers()

    def send_backup_file(self, query):
        self.require_admin()
        filename = (query.get("file") or [""])[0]
        if not filename or "/" in filename or "\\" in filename or not filename.endswith(".db"):
            raise AppError(400, "备份文件名不合法")
        file_path = (BACKUP_DIR / filename).resolve()
        if BACKUP_DIR.resolve() not in file_path.parents or not file_path.exists():
            raise AppError(404, "备份文件不存在")
        content = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Connection", "close")
        self.close_connection = True
        self.end_headers()
        self.wfile.write(content)
        self.wfile.flush()

    def current_user(self, required=True):
        cookies = parse_cookies(self.headers.get("Cookie"))
        token = cookies.get("weekly_session")
        digest = token_digest(token)
        now = dt.datetime.now().replace(microsecond=0)
        with connect() as conn:
            session = conn.execute(
                """
                SELECT s.id, s.user_id, s.last_seen_at, s.expires_at
                FROM auth_sessions s
                WHERE s.token_hash=? AND s.revoked_at IS NULL
                """,
                (digest,),
            ).fetchone() if token else None
            if session and (parse_iso_datetime(session["expires_at"]) or now) <= now:
                conn.execute("UPDATE auth_sessions SET revoked_at=? WHERE id=?", (now_iso(), session["id"]))
                session = None
            user = None
            if session:
                user = conn.execute(
                    """
                    SELECT u.id, u.username, u.employee_id, u.display_name, u.role, u.user_type, u.auth_source,
                           t.name AS user_type_name,
                           COALESCE(t.include_in_members, 1) AS eligible_members,
                           COALESCE(t.include_in_morning, 1) AS eligible_morning,
                           COALESCE(t.include_in_rules, 1) AS eligible_rules,
                           COALESCE(t.include_in_thanks, 1) AS eligible_thanks,
                           u.active, u.created_at
                    FROM users u
                    LEFT JOIN user_types t ON t.key = u.user_type
                    WHERE u.id=? AND u.active=1
                    """,
                    (session["user_id"],),
                ).fetchone()
                if user:
                    self.current_session_id = session["id"]
                    last_seen = parse_iso_datetime(session["last_seen_at"])
                    if not last_seen or (now - last_seen).total_seconds() >= 60:
                        timeout = get_int_setting(conn, "session_timeout_minutes", 480, minimum=15, maximum=43200)
                        conn.execute(
                            "UPDATE auth_sessions SET last_seen_at=?, expires_at=? WHERE id=?",
                            (now.isoformat(), (now + dt.timedelta(minutes=timeout)).isoformat(), session["id"]),
                        )
                else:
                    conn.execute("UPDATE auth_sessions SET revoked_at=? WHERE id=?", (now_iso(), session["id"]))
        if not user:
            if required:
                raise AppError(401, "登录状态已失效，请重新登录")
            return None
        return dict(user)

    def require_admin(self):
        user = self.current_user()
        if user["role"] != "admin":
            raise AppError(403, "仅管理员可操作")
        return user

    def require_internal_user(self, user=None):
        return user or self.current_user()

    def is_public_read_api(self, method, path):
        return method == "GET" and self.module_for_path(path) in MODULE_KEYS

    def module_for_path(self, path):
        if path.startswith("/api/user-types") or path.startswith("/api/users"):
            return "users"
        if path.startswith("/api/members") or path.startswith("/api/team-posts"):
            return "members"
        if path.startswith("/api/archive"):
            return "archive"
        if path.startswith("/api/morning-items"):
            return "morning"
        if path.startswith("/api/rules") or path.startswith("/api/scores") or path.startswith("/api/dashboards/red-black"):
            return "rules"
        if path.startswith("/api/meetings") or path.startswith("/api/meeting-"):
            return "meetings"
        if path.startswith("/api/links") or path.startswith("/api/link-categories"):
            return "links"
        if path.startswith("/api/machines") or path.startswith("/api/shifts") or path.startswith("/api/dashboards/shifts"):
            return "shifts"
        if path.startswith("/api/thank-you") or path.startswith("/api/dashboards/thank-you"):
            return "thanks"
        if path.startswith("/api/settings") or path.startswith("/api/audit-logs") or path.startswith("/api/backups") or path.startswith("/api/recycle-bin"):
            return "system"
        if path.startswith("/api/team-replies"):
            return "members"
        return None

    def require_module(self, user, module_key, action="view"):
        if not module_key:
            return
        if not user and action != "view":
            raise AppError(401, "请先登录")
        if user and user.get("role") == "admin":
            return
        if module_key not in MODULE_KEYS:
            raise AppError(403, "当前账号无权访问该模块")
        action = action if action in PERMISSION_ACTIONS else "view"
        column = {
            "view": "can_view",
            "create": "can_create",
            "edit": "can_edit",
            "delete": "can_delete",
        }[action]
        with connect() as conn:
            row = conn.execute(
                f"""
                SELECT can_view, {column} AS allowed
                FROM module_permissions
                WHERE user_type_key=? AND module_key=?
                """,
                ((user.get("user_type") if user else GUEST_USER_TYPE_KEY) or DEFAULT_USER_TYPE_KEY, module_key),
            ).fetchone()
        if not row or not row["can_view"] or not row["allowed"]:
            if not user:
                raise AppError(403, "访客无权查看该模块")
            action_name = {"view": "查看", "create": "新增", "edit": "编辑", "delete": "删除"}[action]
            raise AppError(403, f"当前用户类型无权{action_name}该模块内容")

    def health(self):
        try:
            with connect() as conn:
                conn.execute("SELECT 1").fetchone()
                check = conn.execute("PRAGMA quick_check").fetchone()[0]
        except sqlite3.Error as exc:
            raise AppError(503, f"数据库检查失败：{exc}") from exc
        if check != "ok":
            raise AppError(503, f"数据库完整性检查失败：{check}")
        return {
            "status": "ok",
            "environment": DEPLOY_ENV,
            "release": RELEASE_ID,
            "database": "ok",
            "time": now_iso(),
        }

    def route_api(self, method, path, query):
        if path == "/api/health" and method == "GET":
            return self.health()
        if path == "/api/login" and method == "POST":
            return self.login()
        if path == "/api/logout" and method == "POST":
            return self.logout()
        if path == "/api/me" and method == "GET":
            user = self.current_user(required=False)
            return {"user": user, "permissions": permissions_for(user), "settings": self.public_settings()}
        if path == "/api/sessions" and method == "GET":
            return self.list_sessions(self.current_user())
        if len(path.strip("/").split("/")) == 3 and path.startswith("/api/sessions/") and method == "DELETE":
            return self.revoke_session(int(path.rsplit("/", 1)[1]), self.current_user())

        user = self.current_user(required=not self.is_public_read_api(method, path))
        parts = path.strip("/").split("/")
        action = {"GET": "view", "POST": "create", "PATCH": "edit", "DELETE": "delete"}.get(method, "view")
        self.require_module(user, self.module_for_path(path), action)

        if path == "/api/team-posts":
            if method == "POST":
                return self.create_team_post(user)
        if len(parts) == 4 and parts[:2] == ["api", "team-posts"] and parts[3] == "replies" and method == "POST":
            return self.create_team_post_reply(int(parts[2]), user)
        if len(parts) == 4 and parts[:2] == ["api", "team-posts"] and parts[3] == "reactions" and method == "POST":
            return self.toggle_team_post_reaction(int(parts[2]), user)
        if len(parts) == 4 and parts[:2] == ["api", "team-replies"] and parts[3] == "reactions" and method == "POST":
            return self.toggle_team_reply_reaction(int(parts[2]), user)
        if len(parts) == 3 and parts[:2] == ["api", "team-replies"] and method == "DELETE":
            return self.delete_team_post_reply(int(parts[2]), user)

        if path == "/api/me/password" and method == "PATCH":
            return self.change_own_password(user)

        if path == "/api/archive/years" and method == "GET":
            return self.archive_years(user)
        if path == "/api/archive/search" and method == "GET":
            return self.search_archive(user, query)

        if path == "/api/user-types":
            if method == "GET":
                return self.list_user_types()
            if method == "POST":
                return self.create_user_type()
        if len(parts) == 4 and parts[:2] == ["api", "user-types"] and parts[3] == "permissions" and method == "PATCH":
            return self.update_user_type_permissions(parts[2])
        if len(parts) == 4 and parts[:2] == ["api", "user-types"] and parts[3] == "impact" and method == "POST":
            return self.user_type_impact(parts[2])
        if len(parts) == 3 and parts[:2] == ["api", "user-types"] and method == "DELETE":
            return self.delete_user_type(parts[2])

        if path == "/api/users":
            if method == "GET":
                return {"users": self.list_users()}
            if method == "POST":
                return self.create_user()
        if path == "/api/users/bulk-type" and method == "PATCH":
            return self.bulk_update_user_type(user)
        if len(parts) == 3 and parts[:2] == ["api", "users"] and method == "PATCH":
            return self.update_user(int(parts[2]))
        if len(parts) == 3 and parts[:2] == ["api", "users"] and method == "DELETE":
            return self.delete_user(int(parts[2]), user)

        if path == "/api/members":
            if method == "GET":
                return {"members": self.list_members()}
            if method == "POST":
                return self.create_member()
        if path == "/api/members/order" and method == "PATCH":
            return self.update_member_order()
        if len(parts) == 3 and parts[:2] == ["api", "members"] and method == "PATCH":
            return self.update_member(int(parts[2]))
        if len(parts) == 4 and parts[:2] == ["api", "members"] and parts[3] == "posts" and method == "POST":
            return self.create_member_post(int(parts[2]), user)
        if path == "/api/team-posts":
            if method == "GET":
                return {"posts": self.list_team_posts(user)}
            if method == "POST":
                return self.create_team_post(user)
        if len(parts) == 3 and parts[:2] == ["api", "team-posts"]:
            if method == "GET":
                return self.get_team_post(int(parts[2]), user)
            if method == "PATCH":
                return self.update_team_post(int(parts[2]), user)
            if method == "DELETE":
                return self.delete_team_post(int(parts[2]), user)
        if len(parts) == 4 and parts[:2] == ["api", "team-posts"] and parts[3] == "replies" and method == "POST":
            return self.create_team_post_reply(int(parts[2]), user)
        if len(parts) == 4 and parts[:2] == ["api", "team-posts"] and parts[3] == "reactions" and method == "POST":
            return self.toggle_team_post_reaction(int(parts[2]), user)
        if len(parts) == 4 and parts[:2] == ["api", "team-replies"] and parts[3] == "reactions" and method == "POST":
            return self.toggle_team_reply_reaction(int(parts[2]), user)
        if len(parts) == 3 and parts[:2] == ["api", "team-replies"] and method == "DELETE":
            return self.delete_team_post_reply(int(parts[2]), user)

        if path == "/api/morning-items":
            if method == "GET":
                return self.list_morning_items(query)
            if method == "POST":
                return self.create_morning_item(user)
        if len(parts) == 4 and parts[:2] == ["api", "morning-items"] and parts[3] == "history" and method == "GET":
            return self.list_morning_item_history(int(parts[2]))
        if len(parts) == 3 and parts[:2] == ["api", "morning-items"] and method == "PATCH":
            return self.update_morning_item(int(parts[2]), user)
        if len(parts) == 3 and parts[:2] == ["api", "morning-items"] and method == "DELETE":
            return self.delete_morning_item(int(parts[2]), user)

        if path == "/api/rules":
            if method == "GET":
                return {"rules": self.list_rules(query)}
            if method == "POST":
                return self.create_rule()

        if path == "/api/scores":
            if method == "GET":
                return {"scores": self.list_scores(query)}
            if method == "POST":
                return self.create_score()
        if len(parts) == 3 and parts[:2] == ["api", "scores"] and method == "PATCH":
            return self.update_score(int(parts[2]))

        if path == "/api/dashboards/red-black" and method == "GET":
            return self.red_black_dashboard(query)

        if path == "/api/meetings":
            if method == "GET":
                return {"meetings": self.list_meetings(query)}
            if method == "POST":
                return self.create_meeting(user)
        if path == "/api/meetings/bulk-generate" and method == "POST":
            return self.bulk_generate_meetings()
        if len(parts) == 3 and parts[:2] == ["api", "meetings"] and method == "PATCH":
            return self.update_meeting(int(parts[2]))
        if len(parts) == 4 and parts[:2] == ["api", "meetings"] and parts[3] == "topics" and method == "PATCH":
            return self.update_meeting_topics(int(parts[2]))
        if len(parts) == 4 and parts[:2] == ["api", "meetings"] and parts[3] == "copy-agenda" and method == "POST":
            return self.copy_previous_meeting_agenda(int(parts[2]))
        if len(parts) == 4 and parts[:2] == ["api", "meetings"] and parts[3] == "agenda-options" and method == "POST":
            return self.add_meeting_preset_items(int(parts[2]))
        if path == "/api/meeting-topics":
            if method == "GET":
                return self.list_meeting_topics()
        if path == "/api/meeting-topic-types" and method == "POST":
            return self.create_meeting_topic_type()
        if len(parts) == 3 and parts[:2] == ["api", "meeting-topic-types"] and method == "DELETE":
            return self.delete_meeting_topic_type(int(parts[2]))
        if path == "/api/meeting-topic-options" and method == "POST":
            return self.create_meeting_topic_option()
        if len(parts) == 3 and parts[:2] == ["api", "meeting-topic-options"] and method == "PATCH":
            return self.update_meeting_topic_option(int(parts[2]))
        if len(parts) == 3 and parts[:2] == ["api", "meeting-topic-options"] and method == "DELETE":
            return self.delete_meeting_topic_option(int(parts[2]))
        if len(parts) == 4 and parts[:2] == ["api", "meetings"] and parts[3] == "items" and method == "POST":
            return self.create_meeting_item(int(parts[2]), user)
        if len(parts) == 5 and parts[:2] == ["api", "meetings"] and parts[3:] == ["items", "reorder"] and method == "POST":
            return self.reorder_meeting_items(int(parts[2]))
        if len(parts) == 4 and parts[:2] == ["api", "meetings"] and parts[3] == "attendance" and method == "POST":
            return self.upsert_attendance(int(parts[2]))
        if len(parts) == 3 and parts[:2] == ["api", "meeting-items"] and method == "PATCH":
            return self.update_meeting_item(int(parts[2]))
        if len(parts) == 3 and parts[:2] == ["api", "meeting-items"] and method == "DELETE":
            return self.delete_meeting_item(int(parts[2]), user)
        if len(parts) == 4 and parts[:2] == ["api", "meeting-items"] and parts[3] == "carry-forward" and method == "POST":
            return self.carry_forward_meeting_item(int(parts[2]))

        if path == "/api/links":
            if method == "GET":
                return {"links": self.list_links()}
            if method == "POST":
                return self.create_link()
        if len(parts) == 3 and parts[:2] == ["api", "links"]:
            if method == "PATCH":
                return self.update_link(int(parts[2]), user)
            if method == "DELETE":
                return self.delete_link(int(parts[2]), user)
        if path == "/api/link-categories":
            if method == "GET":
                return {"categories": self.list_link_categories()}
            if method == "POST":
                return self.create_link_category()

        if path == "/api/machines":
            if method == "GET":
                return {"machines": self.list_machines()}
            if method == "POST":
                return self.create_machine()
        if len(parts) == 3 and parts[:2] == ["api", "machines"] and method == "DELETE":
            return self.delete_machine(int(parts[2]))

        if path == "/api/shifts":
            if method == "GET":
                return {"shifts": self.list_shifts(query)}
            if method == "POST":
                return self.create_shift()
        if len(parts) == 3 and parts[:2] == ["api", "shifts"] and method == "DELETE":
            return self.delete_shift(int(parts[2]))
        if path == "/api/dashboards/shifts" and method == "GET":
            return self.shift_dashboard(query)

        if path == "/api/thank-you":
            if method == "GET":
                return {"votes": self.list_thank_you(query), "users": self.list_participating_users("thanks")}
            if method == "POST":
                return self.create_thank_you(user)
        if len(parts) == 3 and parts[:2] == ["api", "thank-you"]:
            if method == "PATCH":
                return self.update_thank_you(int(parts[2]), user)
            if method == "DELETE":
                return self.delete_thank_you(int(parts[2]), user)
        if path == "/api/dashboards/thank-you" and method == "GET":
            return self.thank_you_dashboard(query)

        if path == "/api/reminders" and method == "GET":
            return self.list_reminders(user)
        if path == "/api/reminders/read" and method == "PATCH":
            return self.mark_reminders_read(user)

        if path == "/api/recycle-bin" and method == "GET":
            return {"items": self.list_recycle_bin()}
        if len(parts) == 4 and parts[:2] == ["api", "recycle-bin"] and parts[3] == "restore" and method == "POST":
            return self.restore_recycle_item(int(parts[2]))
        if len(parts) == 3 and parts[:2] == ["api", "recycle-bin"] and method == "DELETE":
            return self.purge_recycle_item(int(parts[2]))

        if path == "/api/settings":
            if method == "GET":
                return {"settings": self.list_settings()}
            if method == "PATCH":
                return self.update_settings()

        if path == "/api/audit-logs" and method == "GET":
            return {"logs": self.list_audit_logs(query)}

        if path == "/api/backups":
            if method == "GET":
                return {"backups": self.list_backups()}
            if method == "POST":
                return self.create_manual_backup()
        if path == "/api/backups/verify" and method == "POST":
            return self.verify_backup()
        if path == "/api/backups/restore" and method == "POST":
            return self.restore_backup()

        raise AppError(404, "接口不存在")

    def sso_redirect_uri(self, config):
        configured = (config.get("redirect_uri") or "").strip()
        if configured:
            return validate_sso_url(configured, "OIDC 回调地址")
        host = (self.headers.get("Host") or "").strip().lower()
        if not re.fullmatch(r"(?:localhost|127\.0\.0\.1)(?::\d{1,5})?", host):
            raise AppError(400, "正式部署必须在系统配置中填写 OIDC 回调地址")
        return f"http://{host}/api/sso/callback"

    def issue_session(self, conn, user, action, summary, metadata=None, secure_cookie=False):
        user_data = dict(user)
        now = dt.datetime.now().replace(microsecond=0)
        timeout = get_int_setting(conn, "session_timeout_minutes", 480, minimum=15, maximum=43200)
        token = secrets.token_urlsafe(32)
        expires_at = now + dt.timedelta(minutes=timeout)
        cursor = conn.execute(
            """
            INSERT INTO auth_sessions(token_hash, user_id, ip_address, user_agent, created_at, last_seen_at, expires_at)
            VALUES(?,?,?,?,?,?,?)
            """,
            (
                token_digest(token), user_data["id"], self.client_address[0],
                (self.headers.get("User-Agent") or "")[:500], now.isoformat(), now.isoformat(), expires_at.isoformat(),
            ),
        )
        self.current_session_id = cursor.lastrowid
        conn.execute("DELETE FROM auth_sessions WHERE revoked_at IS NOT NULL AND revoked_at<?", ((now - dt.timedelta(days=30)).isoformat(),))
        safe_keys = (
            "id", "username", "employee_id", "display_name", "role", "user_type", "user_type_name",
            "eligible_members", "eligible_morning", "eligible_rules", "eligible_thanks",
            "active", "created_at", "auth_source",
        )
        safe_user = {key: user_data.get(key) for key in safe_keys if key in user_data}
        write_audit(conn, safe_user, action, "session", safe_user["id"], summary, metadata or {}, self.client_address[0])
        secure = "; Secure" if secure_cookie else ""
        cookie = f"weekly_session={token}; Path=/; Max-Age={timeout * 60}; HttpOnly; SameSite=Lax{secure}"
        return safe_user, cookie

    def start_sso_login(self):
        with connect() as conn:
            config = sso_configuration(conn)
            if not config["enabled"]:
                raise AppError(400, "企业 SSO 尚未启用")
            if not sso_configuration_ready(config):
                raise AppError(400, "企业 SSO 配置不完整，请联系管理员")
            redirect_uri = self.sso_redirect_uri(config)
            discovery = load_oidc_discovery(config)
            state = secrets.token_urlsafe(32)
            nonce = secrets.token_urlsafe(32)
            verifier = secrets.token_urlsafe(64)
            now = dt.datetime.now().replace(microsecond=0)
            conn.execute("DELETE FROM sso_login_states WHERE expires_at<? OR used_at IS NOT NULL", ((now - dt.timedelta(minutes=10)).isoformat(),))
            conn.execute(
                """
                INSERT INTO sso_login_states(state_hash, nonce, code_verifier, redirect_uri, created_at, expires_at)
                VALUES(?,?,?,?,?,?)
                """,
                (token_digest(state), nonce, verifier, redirect_uri, now.isoformat(), (now + dt.timedelta(minutes=10)).isoformat()),
            )
        parameters = {
            "response_type": "code",
            "client_id": config["client_id"],
            "redirect_uri": redirect_uri,
            "scope": config["scopes"],
            "state": state,
            "nonce": nonce,
            "code_challenge": base64url_digest(verifier),
            "code_challenge_method": "S256",
        }
        separator = "&" if "?" in discovery["authorization_endpoint"] else "?"
        self.send_redirect(f"{discovery['authorization_endpoint']}{separator}{urlencode(parameters)}")

    def complete_sso_login(self, query):
        provider_error = (query.get("error_description") or query.get("error") or [""])[0]
        if provider_error:
            raise AppError(401, f"企业身份平台拒绝登录：{str(provider_error)[:160]}")
        code = (query.get("code") or [""])[0]
        state = (query.get("state") or [""])[0]
        if not code or not state:
            raise AppError(400, "SSO 回调缺少授权码或状态参数")
        now = dt.datetime.now().replace(microsecond=0)
        with connect() as conn:
            config = sso_configuration(conn)
            row = conn.execute(
                "SELECT * FROM sso_login_states WHERE state_hash=? AND used_at IS NULL",
                (token_digest(state),),
            ).fetchone()
            if not row or (parse_iso_datetime(row["expires_at"]) or now) <= now:
                raise AppError(400, "SSO 登录请求已失效，请重新发起登录")
            conn.execute("UPDATE sso_login_states SET used_at=? WHERE state_hash=?", (now.isoformat(), token_digest(state)))
            redirect_uri = row["redirect_uri"]
            verifier = row["code_verifier"]
        if not sso_configuration_ready(config):
            raise AppError(400, "企业 SSO 配置已变更，请重新登录")
        discovery = load_oidc_discovery(config)
        token_form = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": config["client_id"],
            "code_verifier": verifier,
        }
        token_headers = {}
        if config["client_secret"]:
            supported = discovery.get("token_endpoint_auth_methods_supported") or []
            if "client_secret_basic" in supported:
                credentials = base64.b64encode(f"{config['client_id']}:{config['client_secret']}".encode("utf-8")).decode("ascii")
                token_headers["Authorization"] = f"Basic {credentials}"
            else:
                token_form["client_secret"] = config["client_secret"]
        tokens = fetch_json(discovery["token_endpoint"], method="POST", form=token_form, headers=token_headers)
        access_token = str(tokens.get("access_token") or "")
        if not access_token:
            raise AppError(502, "企业身份平台未返回访问令牌")
        claims = fetch_json(discovery["userinfo_endpoint"], headers={"Authorization": f"Bearer {access_token}"})
        employee_id = claim_value(claims, config["username_claim"])
        if not employee_id:
            for fallback in ("employee_id", "employeeNumber", "employee_no", "job_number", "preferred_username", "upn", "email"):
                employee_id = claim_value(claims, fallback)
                if employee_id:
                    break
        subject = claim_value(claims, "sub") or employee_id
        display_name = claim_value(claims, config["display_name_claim"]) or claim_value(claims, "name") or employee_id
        employee_id = employee_id.strip()[:120]
        username = employee_id
        display_name = display_name.strip()[:120]
        if not subject or not employee_id or not display_name or re.search(r"[\x00-\x1f\x7f]", employee_id):
            raise AppError(400, f"企业账号信息缺少工号字段 {config['username_claim']} 或姓名字段")
        provider_key = (config.get("issuer_url") or urlparse(discovery["authorization_endpoint"]).netloc).rstrip("/")
        identity = f"{provider_key}|{subject}"
        auth_source = "oauth2" if config.get("mode") == "manual" else "oidc"
        with connect() as conn:
            user = conn.execute(
                """
                SELECT u.*, t.name AS user_type_name,
                       COALESCE(t.include_in_members, 1) AS eligible_members,
                       COALESCE(t.include_in_morning, 1) AS eligible_morning,
                       COALESCE(t.include_in_rules, 1) AS eligible_rules,
                       COALESCE(t.include_in_thanks, 1) AS eligible_thanks
                FROM users u LEFT JOIN user_types t ON t.key=u.user_type
                WHERE u.auth_source IN ('oidc', 'oauth2') AND u.external_subject=?
                """,
                (identity,),
            ).fetchone()
            linked_existing = False
            created = False
            if not user:
                existing = conn.execute(
                    "SELECT * FROM users WHERE LOWER(employee_id)=LOWER(?) OR LOWER(username)=LOWER(?) ORDER BY CASE WHEN LOWER(employee_id)=LOWER(?) THEN 0 ELSE 1 END LIMIT 1",
                    (employee_id, employee_id, employee_id),
                ).fetchone()
                if existing:
                    if not existing["active"]:
                        raise AppError(403, "该企业账号对应的系统用户已停用")
                    if existing["external_subject"] and existing["external_subject"] != identity:
                        raise AppError(409, "该系统账号已绑定其他企业身份")
                    conn.execute(
                        "UPDATE users SET auth_source=?, external_subject=?, employee_id=? WHERE id=?",
                        (auth_source, identity, employee_id, existing["id"]),
                    )
                    linked_existing = True
                    user_id = existing["id"]
                else:
                    if not config["auto_provision"]:
                        raise AppError(403, "该企业账号尚未在系统中创建，请联系管理员")
                    user_type = conn.execute(
                        "SELECT key FROM user_types WHERE key=? AND key<>? AND active=1",
                        (config["default_user_type"], GUEST_USER_TYPE_KEY),
                    ).fetchone()
                    if not user_type:
                        raise AppError(400, "SSO 默认用户类型无效，请联系管理员")
                    salt, password_hash = make_hash(secrets.token_urlsafe(48))
                    cursor = conn.execute(
                        """
                        INSERT INTO users(username, employee_id, salt, password_hash, display_name, role, user_type, active, created_at, auth_source, external_subject)
                        VALUES(?,?,?,?,?,?,?,1,?,?,?)
                        """,
                        (username, employee_id, salt, password_hash, display_name, "user", user_type["key"], now_iso(), auth_source, identity),
                    )
                    user_id = cursor.lastrowid
                    sync_member_for_user(conn, user_id)
                    created = True
                user = conn.execute(
                    """
                    SELECT u.*, t.name AS user_type_name,
                           COALESCE(t.include_in_members, 1) AS eligible_members,
                           COALESCE(t.include_in_morning, 1) AS eligible_morning,
                           COALESCE(t.include_in_rules, 1) AS eligible_rules,
                           COALESCE(t.include_in_thanks, 1) AS eligible_thanks
                    FROM users u LEFT JOIN user_types t ON t.key=u.user_type
                    WHERE u.id=? AND u.active=1
                    """,
                    (user_id,),
                ).fetchone()
            elif str(user["employee_id"] or "").lower() != employee_id.lower():
                duplicate = conn.execute(
                    "SELECT id FROM users WHERE LOWER(employee_id)=LOWER(?) AND id<>?",
                    (employee_id, user["id"]),
                ).fetchone()
                if duplicate:
                    raise AppError(409, "该工号已关联其他系统用户，请联系管理员处理")
                conn.execute("UPDATE users SET employee_id=?, auth_source=? WHERE id=?", (employee_id, auth_source, user["id"]))
                user = dict(user)
                user["employee_id"] = employee_id
                user["auth_source"] = auth_source
            if not user or not user["active"]:
                raise AppError(403, "企业账号对应的系统用户不可用")
            safe_user, cookie = self.issue_session(
                conn,
                user,
                "auth.sso_login",
                "用户通过企业 SSO 登录",
                {"created": created, "linked_existing": linked_existing, "provider": provider_key, "employee_id": employee_id},
                secure_cookie=redirect_uri.startswith("https://"),
            )
        self.send_redirect("/?sso=success", {"Set-Cookie": cookie})

    def login(self):
        data = read_json(self)
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        ip_address = self.client_address[0]
        now = dt.datetime.now().replace(microsecond=0)
        with connect() as conn:
            max_attempts = get_int_setting(conn, "login_max_attempts", 5, minimum=3, maximum=20)
            lock_minutes = get_int_setting(conn, "login_lock_minutes", 15, minimum=1, maximum=1440)
            attempt = conn.execute(
                "SELECT * FROM login_attempts WHERE username=? AND ip_address=?",
                (username.lower(), ip_address),
            ).fetchone()
            locked_until = parse_iso_datetime(attempt["locked_until"]) if attempt else None
            if locked_until and locked_until > now:
                remaining = max(1, int((locked_until - now).total_seconds() / 60) + 1)
                raise AppError(429, f"登录失败次数过多，请 {remaining} 分钟后再试")
            user = conn.execute(
                """
                SELECT u.*, t.name AS user_type_name,
                       COALESCE(t.include_in_members, 1) AS eligible_members,
                       COALESCE(t.include_in_morning, 1) AS eligible_morning,
                       COALESCE(t.include_in_rules, 1) AS eligible_rules,
                       COALESCE(t.include_in_thanks, 1) AS eligible_thanks
                FROM users u
                LEFT JOIN user_types t ON t.key = u.user_type
                WHERE LOWER(u.username)=LOWER(?) AND u.active=1
                """,
                (username,),
            ).fetchone()
            if not user or not verify_password(password, user["salt"], user["password_hash"]):
                window_start = parse_iso_datetime(attempt["window_started_at"]) if attempt else None
                if not window_start or (now - window_start).total_seconds() > lock_minutes * 60:
                    failed_count = 1
                    window_start = now
                else:
                    failed_count = int(attempt["failed_count"] or 0) + 1
                next_lock = now + dt.timedelta(minutes=lock_minutes) if failed_count >= max_attempts else None
                conn.execute(
                    """
                    INSERT INTO login_attempts(username, ip_address, failed_count, window_started_at, locked_until, updated_at)
                    VALUES(?,?,?,?,?,?)
                    ON CONFLICT(username, ip_address) DO UPDATE SET
                        failed_count=excluded.failed_count,
                        window_started_at=excluded.window_started_at,
                        locked_until=excluded.locked_until,
                        updated_at=excluded.updated_at
                    """,
                    (username.lower(), ip_address, failed_count, window_start.isoformat(), next_lock.isoformat() if next_lock else None, now.isoformat()),
                )
                conn.commit()
                remaining = max(0, max_attempts - failed_count)
                if next_lock:
                    raise AppError(429, f"登录失败次数过多，账号已临时锁定 {lock_minutes} 分钟")
                raise AppError(401, f"账号或密码错误，还可尝试 {remaining} 次")
            conn.execute("DELETE FROM login_attempts WHERE username=? AND ip_address=?", (username.lower(), ip_address))
            timeout = get_int_setting(conn, "session_timeout_minutes", 480, minimum=15, maximum=43200)
            token = secrets.token_urlsafe(32)
            expires_at = now + dt.timedelta(minutes=timeout)
            cursor = conn.execute(
                """
                INSERT INTO auth_sessions(token_hash, user_id, ip_address, user_agent, created_at, last_seen_at, expires_at)
                VALUES(?,?,?,?,?,?,?)
                """,
                (token_digest(token), user["id"], ip_address, (self.headers.get("User-Agent") or "")[:500], now.isoformat(), now.isoformat(), expires_at.isoformat()),
            )
            self.current_session_id = cursor.lastrowid
            conn.execute("DELETE FROM auth_sessions WHERE revoked_at IS NOT NULL AND revoked_at<?", ((now - dt.timedelta(days=30)).isoformat(),))
            safe_user = {
                key: user[key]
                for key in (
                    "id", "username", "employee_id", "display_name", "role", "user_type", "user_type_name",
                    "eligible_members", "eligible_morning", "eligible_rules", "eligible_thanks",
                    "active", "created_at", "auth_source",
                )
            }
            write_audit(conn, safe_user, "auth.login", "session", safe_user["id"], "用户登录", {}, self.client_address[0])
        return {
            "user": safe_user,
            "permissions": permissions_for(safe_user),
            "message": "登录成功",
            "_headers": {"Set-Cookie": f"weekly_session={token}; Path=/; Max-Age={timeout * 60}; HttpOnly; SameSite=Strict"},
        }

    def logout(self):
        cookies = parse_cookies(self.headers.get("Cookie"))
        token = cookies.get("weekly_session")
        if token:
            with connect() as conn:
                conn.execute("UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL", (now_iso(), token_digest(token)))
        return {
            "message": "已退出",
            "_headers": {"Set-Cookie": "weekly_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"},
        }

    def list_sessions(self, user):
        now = now_iso()
        with connect() as conn:
            conn.execute("UPDATE auth_sessions SET revoked_at=? WHERE revoked_at IS NULL AND expires_at<=?", (now, now))
            sessions = rows_to_list(conn.execute(
                """
                SELECT id, ip_address, user_agent, created_at, last_seen_at, expires_at
                FROM auth_sessions
                WHERE user_id=? AND revoked_at IS NULL AND expires_at>?
                ORDER BY last_seen_at DESC
                """,
                (user["id"], now),
            ).fetchall())
        current_id = getattr(self, "current_session_id", None)
        for session in sessions:
            session["current"] = session["id"] == current_id
            agent = session.get("user_agent") or "未知设备"
            if "Mobile" in agent or "Android" in agent or "iPhone" in agent:
                session["device"] = "手机浏览器"
            elif "Windows" in agent:
                session["device"] = "Windows 浏览器"
            elif "Macintosh" in agent:
                session["device"] = "Mac 浏览器"
            else:
                session["device"] = "浏览器会话"
        return {"sessions": sessions}

    def revoke_session(self, session_id, user):
        with connect() as conn:
            session = conn.execute(
                "SELECT id, user_id, revoked_at FROM auth_sessions WHERE id=?",
                (session_id,),
            ).fetchone()
            if not session or session["user_id"] != user["id"]:
                raise AppError(404, "会话不存在")
            conn.execute("UPDATE auth_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL", (now_iso(), session_id))
            write_audit(conn, user, "auth.session_revoke", "session", session_id, "用户撤销了登录会话", {}, self.client_address[0])
        current = session_id == getattr(self, "current_session_id", None)
        result = {"message": "会话已退出", "current_revoked": current}
        if current:
            result["_headers"] = {"Set-Cookie": "weekly_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"}
        return result

    def change_own_password(self, user):
        data = read_json(self)
        old_password = data.get("old_password") or ""
        new_password = data.get("new_password") or ""
        confirm_password = data.get("confirm_password") or ""
        if not old_password:
            raise AppError(400, "请输入当前密码")
        if len(new_password) < 6:
            raise AppError(400, "新密码至少 6 位")
        if new_password != confirm_password:
            raise AppError(400, "两次输入的新密码不一致")
        with connect() as conn:
            row = conn.execute(
                "SELECT id, salt, password_hash FROM users WHERE id=? AND active=1",
                (user["id"],),
            ).fetchone()
            if not row:
                raise AppError(404, "当前用户不存在")
            if not verify_password(old_password, row["salt"], row["password_hash"]):
                raise AppError(400, "当前密码不正确")
            salt, password_hash = make_hash(new_password)
            conn.execute(
                "UPDATE users SET salt=?, password_hash=? WHERE id=?",
                (salt, password_hash, user["id"]),
            )
            conn.execute(
                "UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL",
                (now_iso(), user["id"], getattr(self, "current_session_id", -1)),
            )
            write_audit(conn, user, "user.password", "user", user["id"], "用户修改了自己的密码", {}, self.client_address[0])
        return {"message": "密码已更新，其他设备已退出登录"}

    def send_json(self, data, status=200, headers=None):
        headers = headers or {}
        extra = data.pop("_headers", {}) if isinstance(data, dict) else {}
        headers.update(extra)
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "close")
        self.close_connection = True
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(payload)
        self.wfile.flush()

    def list_user_types(self):
        self.require_admin()
        with connect() as conn:
            types = rows_to_list(
                conn.execute(
                    """
                    SELECT t.*, COUNT(CASE WHEN u.active=1 THEN 1 END) AS user_count
                    FROM user_types t
                    LEFT JOIN users u ON u.user_type=t.key
                    WHERE t.active=1
                    GROUP BY t.key
                    ORDER BY CASE WHEN t.key=? THEN 1 ELSE 0 END, t.sort_order, t.key
                    """,
                    (GUEST_USER_TYPE_KEY,),
                ).fetchall()
            )
            permissions = rows_to_list(
                conn.execute(
                    """
                    SELECT user_type_key, module_key, can_view, can_create, can_edit, can_delete
                    FROM module_permissions
                    """
                ).fetchall()
            )
        permission_map = {}
        for permission in permissions:
            permission_map.setdefault(permission["user_type_key"], {})[permission["module_key"]] = {
                "view": bool(permission["can_view"]),
                "create": bool(permission["can_create"]),
                "edit": bool(permission["can_edit"]),
                "delete": bool(permission["can_delete"]),
            }
        for user_type in types:
            user_type["is_guest"] = user_type["key"] == GUEST_USER_TYPE_KEY
            user_type["participation"] = {
                scope: bool(user_type[column])
                for scope, (column, _) in PARTICIPATION_SCOPES.items()
            }
            user_type["permissions"] = permission_map.get(user_type["key"], {})
            user_type["modules"] = sorted(
                module for module, actions in user_type["permissions"].items() if actions.get("view")
            )
            with connect() as conn:
                user_type["assigned_users"] = [row["display_name"] for row in conn.execute(
                    "SELECT display_name FROM users WHERE user_type=? AND active=1 ORDER BY display_name LIMIT 8",
                    (user_type["key"],),
                ).fetchall()]
        return {"types": types, "modules": MODULE_CATALOG}

    def normalize_user_type_participation(self, type_key, raw_participation, current=None):
        current = current or {}
        raw_participation = raw_participation if isinstance(raw_participation, dict) else {}
        normalized = {}
        for scope, (column, _) in PARTICIPATION_SCOPES.items():
            value = raw_participation.get(scope, current.get(column, True))
            normalized[scope] = False if type_key == GUEST_USER_TYPE_KEY else bool(value)
        return normalized

    def normalize_user_type_permissions(self, type_key, raw_permissions):
        if not isinstance(raw_permissions, dict):
            raise AppError(400, "操作权限格式不正确")
        normalized = {}
        for module in MODULE_KEYS:
            actions = raw_permissions.get(module) or {}
            if not isinstance(actions, dict):
                actions = {}
            values = {action: bool(actions.get(action)) for action in PERMISSION_ACTIONS}
            if values["create"] or values["edit"] or values["delete"]:
                values["view"] = True
            if type_key == GUEST_USER_TYPE_KEY:
                values["create"] = False
                values["edit"] = False
                values["delete"] = False
            normalized[module] = values
        if type_key == GUEST_USER_TYPE_KEY:
            normalized["dashboard"] = {action: False for action in PERMISSION_ACTIONS}
            if not any(actions["view"] for actions in normalized.values()):
                raise AppError(400, "访客至少需要保留一个可查看模块")
        return normalized

    def user_type_impact(self, type_key):
        self.require_admin()
        data = read_json(self)
        normalized = self.normalize_user_type_permissions(type_key, data.get("permissions") or {})
        with connect() as conn:
            user_type = conn.execute("SELECT * FROM user_types WHERE key=? AND active=1", (type_key,)).fetchone()
            if not user_type:
                raise AppError(404, "用户类型不存在")
            existing = {
                row["module_key"]: {action: bool(row[f"can_{action}"]) for action in PERMISSION_ACTIONS}
                for row in conn.execute("SELECT * FROM module_permissions WHERE user_type_key=?", (type_key,)).fetchall()
            }
            users = [row["display_name"] for row in conn.execute(
                "SELECT display_name FROM users WHERE user_type=? AND active=1 ORDER BY display_name",
                (type_key,),
            ).fetchall()]
        changed = []
        for module in MODULE_CATALOG:
            before = existing.get(module["key"], {action: False for action in PERMISSION_ACTIONS})
            after = normalized[module["key"]]
            for action in PERMISSION_ACTIONS:
                if before.get(action) != after.get(action):
                    changed.append({
                        "module": module["key"],
                        "module_name": module["name"],
                        "action": action,
                        "enabled": after[action],
                    })
        participation = self.normalize_user_type_participation(
            type_key,
            data.get("participation"),
            dict(user_type),
        )
        participation_changed = []
        for scope, (column, label) in PARTICIPATION_SCOPES.items():
            before = bool(user_type[column])
            after = participation[scope]
            if before != after:
                participation_changed.append({"scope": scope, "name": label, "enabled": after})
        return {
            "user_type": type_key,
            "version": user_type["version"],
            "affected_count": len(users),
            "affected_users": users[:12],
            "changed": changed,
            "participation_changed": participation_changed,
        }

    def create_user_type(self):
        admin = self.require_admin()
        data = read_json(self)
        name = str(data.get("name") or "").strip()
        description = str(data.get("description") or "").strip()
        copy_from = str(data.get("copy_from") or "").strip()
        if not name:
            raise AppError(400, "用户类型名称不能为空")
        if len(name) > 30:
            raise AppError(400, "用户类型名称最多 30 个字符")
        if len(description) > 200:
            raise AppError(400, "用户类型说明最多 200 个字符")
        type_key = f"type_{uuid.uuid4().hex[:10]}"
        with connect() as conn:
            duplicate = conn.execute(
                "SELECT key FROM user_types WHERE active=1 AND lower(name)=lower(?)",
                (name,),
            ).fetchone()
            if duplicate:
                raise AppError(400, "用户类型名称已存在")
            sort_order = conn.execute(
                "SELECT COALESCE(MAX(sort_order), 0) + 10 FROM user_types WHERE key<>?",
                (GUEST_USER_TYPE_KEY,),
            ).fetchone()[0]
            source_type = None
            source_permissions = {}
            if copy_from:
                source = conn.execute(
                    "SELECT * FROM user_types WHERE key=? AND active=1",
                    (copy_from,),
                ).fetchone()
                if not source:
                    raise AppError(400, "复制来源用户类型不存在")
                source_type = source
                source_permissions = {
                    row["module_key"]: row
                    for row in conn.execute(
                        "SELECT * FROM module_permissions WHERE user_type_key=?",
                        (copy_from,),
                    ).fetchall()
                }
            participation_values = [
                int(bool(source_type[column])) if source_type else 1
                for column, _ in PARTICIPATION_SCOPES.values()
            ]
            conn.execute(
                """
                INSERT INTO user_types(
                    key, name, description, sort_order, locked, active,
                    include_in_members, include_in_morning, include_in_rules, include_in_thanks,
                    created_at
                ) VALUES(?,?,?,?,0,1,?,?,?,?,?)
                """,
                (type_key, name, description, sort_order, *participation_values, now_iso()),
            )
            for module_key in MODULE_KEYS:
                source = source_permissions.get(module_key)
                actions = (
                    int(source["can_view"]),
                    int(source["can_create"]),
                    int(source["can_edit"]),
                    int(source["can_delete"]),
                ) if source else (0, 0, 0, 0)
                conn.execute(
                    """
                    INSERT INTO module_permissions(
                        user_type_key, module_key, can_view, can_create, can_edit, can_delete, updated_at
                    ) VALUES(?,?,?,?,?,?,?)
                    """,
                    (type_key, module_key, *actions, now_iso()),
                )
            write_audit(conn, admin, "user_type.create", "user_type", None, "用户类型已创建", {"user_type": type_key, "name": name, "copy_from": copy_from}, self.client_address[0])
        return {"message": "用户类型已创建", **self.list_user_types()}

    def update_user_type_permissions(self, type_key):
        admin = self.require_admin()
        data = read_json(self)
        raw_permissions = data.get("permissions")
        if raw_permissions is None:
            modules = data.get("modules") or []
            if not isinstance(modules, list):
                raise AppError(400, "模块权限格式不正确")
            raw_permissions = {
                module: {action: True for action in PERMISSION_ACTIONS}
                for module in modules if module in MODULE_KEYS
            }
        normalized = self.normalize_user_type_permissions(type_key, raw_permissions)
        expected_version = data.get("expected_version")
        with connect() as conn:
            user_type = conn.execute(
                "SELECT * FROM user_types WHERE key=? AND active=1",
                (type_key,),
            ).fetchone()
            if not user_type:
                raise AppError(404, "用户类型不存在")
            if expected_version is not None and int(expected_version) != int(user_type["version"]):
                raise AppError(409, "该用户类型刚刚被其他管理员修改，请刷新后核对最新权限")
            if type_key != GUEST_USER_TYPE_KEY:
                name = str(data.get("name") or user_type["name"] or "").strip()
                description = str(data.get("description", user_type["description"] or "") or "").strip()
                if not name:
                    raise AppError(400, "用户类型名称不能为空")
                if len(name) > 30 or len(description) > 200:
                    raise AppError(400, "用户类型名称或说明过长")
                duplicate = conn.execute(
                    "SELECT key FROM user_types WHERE active=1 AND lower(name)=lower(?) AND key<>?",
                    (name, type_key),
                ).fetchone()
                if duplicate:
                    raise AppError(400, "用户类型名称已存在")
            participation = self.normalize_user_type_participation(
                type_key,
                data.get("participation"),
                dict(user_type),
            )
            updated = conn.execute(
                """
                UPDATE user_types
                SET name=?, description=?, include_in_members=?, include_in_morning=?,
                    include_in_rules=?, include_in_thanks=?, version=version+1
                WHERE key=? AND version=?
                """,
                (
                    name if type_key != GUEST_USER_TYPE_KEY else user_type["name"],
                    description if type_key != GUEST_USER_TYPE_KEY else user_type["description"],
                    int(participation["members"]),
                    int(participation["morning"]),
                    int(participation["rules"]),
                    int(participation["thanks"]),
                    type_key,
                    user_type["version"],
                ),
            )
            if updated.rowcount != 1:
                raise AppError(409, "该用户类型刚刚被其他管理员修改，请刷新后重试")
            conn.execute("DELETE FROM module_permissions WHERE user_type_key=?", (type_key,))
            for module, actions in normalized.items():
                conn.execute(
                    """
                    INSERT INTO module_permissions(
                        user_type_key, module_key, can_view, can_create, can_edit, can_delete, updated_at
                    ) VALUES(?,?,?,?,?,?,?)
                    """,
                    (
                        type_key,
                        module,
                        int(actions["view"]),
                        int(actions["create"]),
                        int(actions["edit"]),
                        int(actions["delete"]),
                        now_iso(),
                    ),
                )
            write_audit(
                conn,
                admin,
                "user_type.permissions",
                "user_type",
                None,
                "用户类型权限与参与范围已更新",
                {"user_type": type_key, "permissions": normalized, "participation": participation},
                self.client_address[0],
            )
        return {"message": "用户类型权限已更新", **self.list_user_types(), "permissions": permissions_for(admin)}

    def delete_user_type(self, type_key):
        admin = self.require_admin()
        if type_key == GUEST_USER_TYPE_KEY:
            raise AppError(400, "访客权限模板不能删除")
        with connect() as conn:
            user_type = conn.execute(
                "SELECT key, name, locked FROM user_types WHERE key=? AND active=1",
                (type_key,),
            ).fetchone()
            if not user_type:
                raise AppError(404, "用户类型不存在")
            users = conn.execute(
                "SELECT display_name FROM users WHERE user_type=? AND active=1 ORDER BY id LIMIT 4",
                (type_key,),
            ).fetchall()
            if users:
                names = "、".join(row["display_name"] for row in users)
                raise AppError(400, f"该类型仍有用户：{names}。请先将这些用户调整到其他类型")
            remaining = conn.execute(
                "SELECT COUNT(*) FROM user_types WHERE active=1 AND key NOT IN (?,?)",
                (type_key, GUEST_USER_TYPE_KEY),
            ).fetchone()[0]
            if remaining == 0:
                raise AppError(400, "至少保留一个可分配的用户类型，请先新增替代类型")
            conn.execute("DELETE FROM module_permissions WHERE user_type_key=?", (type_key,))
            conn.execute("UPDATE user_types SET active=0, locked=0 WHERE key=?", (type_key,))
            write_audit(conn, admin, "user_type.delete", "user_type", None, "用户类型已删除", {"user_type": type_key, "name": user_type["name"]}, self.client_address[0])
        return {"message": "用户类型已删除", **self.list_user_types()}

    def list_users(self):
        self.require_admin()
        with connect() as conn:
            return rows_to_list(
                conn.execute(
                    """
                    SELECT u.id, u.username, u.employee_id, u.display_name, u.role, u.user_type, u.auth_source,
                           COALESCE(t.name, u.user_type) AS user_type_name,
                           COALESCE(t.include_in_members, 1) AS eligible_members,
                           COALESCE(t.include_in_morning, 1) AS eligible_morning,
                           COALESCE(t.include_in_rules, 1) AS eligible_rules,
                           COALESCE(t.include_in_thanks, 1) AS eligible_thanks,
                           u.active, u.created_at
                    FROM users u
                    LEFT JOIN user_types t ON t.key = u.user_type
                    WHERE u.active=1
                    ORDER BY u.id
                    """
                ).fetchall()
            )

    def list_participating_users(self, scope):
        if scope not in PARTICIPATION_SCOPES:
            raise AppError(400, "参与范围不正确")
        column = PARTICIPATION_SCOPES[scope][0]
        with connect() as conn:
            return rows_to_list(
                conn.execute(
                    f"""
                    SELECT u.id, u.username, u.display_name, u.user_type,
                           COALESCE(t.name, u.user_type) AS user_type_name
                    FROM users u
                    LEFT JOIN user_types t ON t.key=u.user_type
                    WHERE u.active=1 AND COALESCE(t.{column}, 1)=1
                    ORDER BY t.sort_order, u.display_name
                    """
                ).fetchall()
            )

    def bulk_update_user_type(self, admin):
        self.require_admin()
        data = read_json(self)
        raw_user_ids = data.get("user_ids") or []
        if not isinstance(raw_user_ids, list):
            raise AppError(400, "批量用户列表格式不正确")
        user_ids = []
        for raw_id in raw_user_ids:
            try:
                user_id = int(raw_id)
            except (TypeError, ValueError):
                continue
            if user_id not in user_ids:
                user_ids.append(user_id)
        if not user_ids:
            raise AppError(400, "请至少选择一个账号")
        if len(user_ids) > 200:
            raise AppError(400, "单次最多调整 200 个账号")
        user_type = str(data.get("user_type") or "").strip()
        if not user_type or user_type == GUEST_USER_TYPE_KEY:
            raise AppError(400, "请选择可分配的用户类型")
        placeholders = ",".join("?" for _ in user_ids)
        with connect() as conn:
            target_type = conn.execute(
                "SELECT key, name FROM user_types WHERE key=? AND active=1",
                (user_type,),
            ).fetchone()
            if not target_type:
                raise AppError(404, "目标用户类型不存在")
            users = rows_to_list(
                conn.execute(
                    f"SELECT id, display_name FROM users WHERE active=1 AND id IN ({placeholders})",
                    user_ids,
                ).fetchall()
            )
            if len(users) != len(user_ids):
                raise AppError(400, "部分账号不存在或已停用，请刷新后重试")
            conn.execute(
                f"UPDATE users SET user_type=? WHERE active=1 AND id IN ({placeholders})",
                [user_type, *user_ids],
            )
            for user_id in user_ids:
                sync_member_for_user(conn, user_id)
            write_audit(
                conn,
                admin,
                "user.bulk_type",
                "user",
                None,
                "批量调整用户类型",
                {
                    "user_ids": user_ids,
                    "user_names": [item["display_name"] for item in users],
                    "user_type": user_type,
                    "user_type_name": target_type["name"],
                },
                self.client_address[0],
            )
        return {"message": f"已调整 {len(user_ids)} 个账号", "users": self.list_users()}

    def create_user(self):
        admin = self.require_admin()
        data = read_json(self)
        username = str(data.get("username") or "").strip()
        employee_id = str(data.get("employee_id") or username).strip()
        display_name = str(data.get("display_name") or username).strip()
        role = data.get("role") or "user"
        user_type = str(data.get("user_type") or "").strip()
        if not username or not employee_id or not display_name:
            raise AppError(400, "账号、工号和姓名不能为空")
        if role not in ("admin", "user"):
            raise AppError(400, "账号授权方式不正确")
        if not user_type or user_type == GUEST_USER_TYPE_KEY:
            raise AppError(400, "新增用户时必须指定有效用户类型")
        salt, password_hash = make_hash(data.get("password") or "123456")
        with connect() as conn:
            if not conn.execute("SELECT key FROM user_types WHERE key=? AND active=1", (user_type,)).fetchone():
                raise AppError(400, "用户类型不存在，请先创建用户类型")
            if conn.execute("SELECT id FROM users WHERE LOWER(employee_id)=LOWER(?)", (employee_id,)).fetchone():
                raise AppError(400, "工号已关联其他用户")
            cursor = conn.execute(
                "INSERT INTO users(username, employee_id, salt, password_hash, display_name, role, user_type, active, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (username, employee_id, salt, password_hash, display_name, role, user_type, 1, now_iso()),
            )
            sync_member_for_user(conn, cursor.lastrowid)
            write_audit(conn, admin, "user.create", "user", cursor.lastrowid, "用户已创建", {"username": username, "role": role, "user_type": user_type}, self.client_address[0])
        return {"message": "用户已创建", "users": self.list_users()}

    def update_user(self, user_id):
        admin = self.require_admin()
        data = read_json(self)
        fields = []
        values = []
        if "username" in data:
            username = (data.get("username") or "").strip()
            if not username:
                raise AppError(400, "账号不能为空")
            fields.append("username=?")
            values.append(username)
        if "employee_id" in data:
            employee_id = (data.get("employee_id") or "").strip()
            if not employee_id:
                raise AppError(400, "工号不能为空")
            fields.append("employee_id=?")
            values.append(employee_id)
        for key in ("display_name", "role", "active", "user_type"):
            if key in data:
                fields.append(f"{key}=?")
                values.append(data[key])
        if data.get("password"):
            salt, password_hash = make_hash(data["password"])
            fields.extend(["salt=?", "password_hash=?"])
            values.extend([salt, password_hash])
        if not fields:
            raise AppError(400, "没有可更新字段")
        values.append(user_id)
        with connect() as conn:
            if "username" in data:
                duplicate = conn.execute(
                    "SELECT id FROM users WHERE username=? AND id<>?",
                    ((data.get("username") or "").strip(), user_id),
                ).fetchone()
                if duplicate:
                    raise AppError(400, "账号已存在")
            if "employee_id" in data:
                duplicate = conn.execute(
                    "SELECT id FROM users WHERE LOWER(employee_id)=LOWER(?) AND id<>?",
                    ((data.get("employee_id") or "").strip(), user_id),
                ).fetchone()
                if duplicate:
                    raise AppError(400, "工号已关联其他用户")
            if "role" in data and data.get("role") not in ("admin", "user"):
                raise AppError(400, "账号授权方式不正确")
            if "user_type" in data:
                if data.get("user_type") == GUEST_USER_TYPE_KEY or not conn.execute("SELECT key FROM user_types WHERE key=? AND active=1", (data.get("user_type"),)).fetchone():
                    raise AppError(400, "用户类型不存在")
            conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id=?", values)
            sync_member_for_user(conn, user_id)
            write_audit(conn, admin, "user.update", "user", user_id, "用户已更新", {"fields": list(data.keys())}, self.client_address[0])
        return {"message": "用户已更新", "users": self.list_users()}

    def delete_user(self, user_id, current_user):
        self.require_admin()
        if user_id == current_user["id"]:
            raise AppError(400, "不能删除当前登录账号")
        with connect() as conn:
            user = conn.execute("SELECT id, username, display_name, active FROM users WHERE id=?", (user_id,)).fetchone()
            if not user:
                raise AppError(404, "用户不存在")
            if user["active"] == 0:
                return {"message": "用户已删除", "users": self.list_users()}
            add_recycle_record(
                conn,
                "user",
                user_id,
                user["display_name"] or user["username"],
                current_user,
                {"username": user["username"]},
            )
            conn.execute("UPDATE users SET active=0 WHERE id=?", (user_id,))
            conn.execute("UPDATE members SET active=0 WHERE user_id=?", (user_id,))
            conn.execute("UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL", (now_iso(), user_id))
            write_audit(conn, current_user, "user.delete", "user", user_id, "用户已删除", {}, self.client_address[0])
        return {"message": "用户已删除", "users": self.list_users()}

    def list_members(self):
        with connect() as conn:
            members = rows_to_list(
                conn.execute(
                    """
                    SELECT m.*, u.display_name AS linked_user, u.username AS account
                    FROM members m
                    JOIN users u ON u.id = m.user_id
                    LEFT JOIN user_types t ON t.key=u.user_type
                    WHERE m.active=1 AND u.active=1 AND COALESCE(t.include_in_members, 1)=1
                    ORDER BY CASE WHEN m.sort_order=0 THEN m.id ELSE m.sort_order END, m.id
                    """
                ).fetchall()
            )
            posts = rows_to_list(
                conn.execute(
                    """
                    SELECT p.*, u.display_name
                    FROM member_posts p
                    JOIN users u ON u.id = p.user_id
                    ORDER BY p.created_at DESC
                    """
                ).fetchall()
            )
        post_map = {}
        for post in posts:
            post_map.setdefault(post["member_id"], []).append(post)
        for member in members:
            member["tags"] = json.loads(member["tags"] or "[]")
            member["skills"] = json.loads(member["skills"] or "[]")
            member["machine_scope"] = json.loads(member["machine_scope"] or "[]")
            member["posts"] = post_map.get(member["id"], [])
        return members

    def update_member_order(self):
        admin = self.require_admin()
        data = read_json(self)
        member_ids = data.get("member_ids") or []
        if not isinstance(member_ids, list):
            raise AppError(400, "成员排序格式不正确")
        try:
            member_ids = [int(member_id) for member_id in member_ids]
        except (TypeError, ValueError):
            raise AppError(400, "成员排序包含无效成员")
        if len(member_ids) != len(set(member_ids)):
            raise AppError(400, "成员排序不能包含重复成员")
        with connect() as conn:
            active_ids = {
                row["id"]
                for row in conn.execute("SELECT id FROM members WHERE active=1").fetchall()
            }
            if set(member_ids) != active_ids:
                raise AppError(400, "成员排序列表与当前成员不一致，请刷新后重试")
            for index, member_id in enumerate(member_ids, start=1):
                conn.execute("UPDATE members SET sort_order=? WHERE id=?", (index, member_id))
            write_audit(
                conn,
                admin,
                "member.order",
                "member",
                None,
                "团队成员卡片顺序已更新",
                {"member_ids": member_ids},
                self.client_address[0],
            )
        return {"message": "成员顺序已更新", "members": self.list_members()}

    def create_member(self):
        self.require_admin()
        data = read_json(self)
        tags = data.get("tags") or []
        if isinstance(tags, str):
            tags = [item.strip() for item in tags.split(",") if item.strip()]
        with connect() as conn:
            conn.execute(
                "INSERT INTO members(user_id, name, avatar_url, title, responsibilities, tags, comment, created_at) VALUES(?,?,?,?,?,?,?,?)",
                (data.get("user_id") or None, data.get("name"), data.get("avatar_url") or "", data.get("title") or "", data.get("responsibilities") or "", json.dumps(tags, ensure_ascii=False), data.get("comment") or "", now_iso()),
            )
        return {"message": "成员档案已创建", "members": self.list_members()}

    def update_member(self, member_id):
        user = self.current_user()
        data = read_json(self)
        with connect() as conn:
            member = conn.execute("SELECT * FROM members WHERE id=?", (member_id,)).fetchone()
            if not member:
                raise AppError(404, "成员不存在")
            if user["role"] != "admin" and member["user_id"] != user["id"]:
                raise AppError(403, "无权修改该成员档案")
            fields = []
            values = []
            allowed = ("name", "avatar_url", "title", "responsibilities", "comment", "user_id", "expertise", "backup_owner", "contact")
            for key in allowed:
                if key in data:
                    fields.append(f"{key}=?")
                    values.append(data[key] or None if key == "user_id" else data[key])
            for json_key in ("tags", "skills", "machine_scope"):
                if json_key in data:
                    items = data.get(json_key) or []
                    if isinstance(items, str):
                        items = [item.strip() for item in items.split(",") if item.strip()]
                    fields.append(f"{json_key}=?")
                    values.append(json.dumps(items, ensure_ascii=False))
            if not fields:
                raise AppError(400, "没有可更新字段")
            values.append(member_id)
            conn.execute(f"UPDATE members SET {', '.join(fields)} WHERE id=?", values)
            if member["user_id"] and "name" in data:
                conn.execute("UPDATE users SET display_name=? WHERE id=?", (data["name"], member["user_id"]))
            write_audit(conn, user, "member.update", "member", member_id, "成员画像已更新", {"fields": list(data.keys())}, self.client_address[0])
        return {"message": "成员档案已更新", "members": self.list_members()}

    def create_member_post(self, member_id, user):
        data = read_json(self)
        kind = data.get("kind") if data.get("kind") in ("comment", "roast") else "comment"
        content = (data.get("content") or "").strip()
        if not content:
            raise AppError(400, "内容不能为空")
        with connect() as conn:
            conn.execute(
                "INSERT INTO member_posts(member_id, user_id, kind, content, created_at) VALUES(?,?,?,?,?)",
                (member_id, user["id"], kind, content, now_iso()),
            )
        return {"message": "已发布", "members": self.list_members()}

    def list_team_posts(self, user=None):
        with connect() as conn:
            posts = rows_to_list(
                conn.execute(
                    """
                    SELECT p.*, u.display_name, u.username
                    FROM team_posts p
                    JOIN users u ON u.id = p.user_id
                    WHERE p.deleted_at IS NULL
                    ORDER BY p.pinned DESC, COALESCE(p.updated_at, p.created_at) DESC, p.id DESC
                    """
                ).fetchall()
            )
            if not posts:
                return []
            post_ids = [post["id"] for post in posts]
            placeholders = ",".join("?" for _ in post_ids)
            replies = rows_to_list(
                conn.execute(
                    f"""
                    SELECT r.*, u.display_name
                    FROM team_post_replies r
                    JOIN users u ON u.id = r.user_id
                    WHERE r.post_id IN ({placeholders}) AND r.deleted_at IS NULL
                    ORDER BY r.created_at ASC, r.id ASC
                    """,
                    post_ids,
                ).fetchall()
            )
            reaction_params = [user["id"] if user else -1, *post_ids]
            reactions = rows_to_list(
                conn.execute(
                    f"""
                    SELECT post_id, reaction, COUNT(*) AS count,
                           SUM(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS mine
                    FROM team_post_reactions
                    WHERE post_id IN ({placeholders})
                    GROUP BY post_id, reaction
                    """,
                    reaction_params,
                ).fetchall()
            )
            reply_ids = [reply["id"] for reply in replies]
            reply_reactions = []
            if reply_ids:
                reply_placeholders = ",".join("?" for _ in reply_ids)
                reply_reactions = rows_to_list(
                    conn.execute(
                        f"""
                        SELECT reply_id, reaction, COUNT(*) AS count,
                               SUM(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS mine
                        FROM team_reply_reactions
                        WHERE reply_id IN ({reply_placeholders})
                        GROUP BY reply_id, reaction
                        """,
                        [user["id"] if user else -1, *reply_ids],
                    ).fetchall()
                )
        reaction_rank = {reaction: index for index, reaction in enumerate(TEAM_REACTIONS)}
        reaction_map = {}
        for reaction in reactions:
            reaction_map.setdefault(reaction["post_id"], []).append({
                "reaction": reaction["reaction"],
                "count": reaction["count"],
                "mine": bool(reaction["mine"]),
            })
        reply_reaction_map = {}
        for reaction in reply_reactions:
            reply_reaction_map.setdefault(reaction["reply_id"], []).append({
                "reaction": reaction["reaction"],
                "count": reaction["count"],
                "mine": bool(reaction["mine"]),
            })
        reply_lookup = {}
        root_replies = {}
        reply_count_map = {}
        latest_reply_map = {}
        for reply in replies:
            reply["reactions"] = sorted(
                reply_reaction_map.get(reply["id"], []),
                key=lambda item: (reaction_rank.get(item["reaction"], 99), -int(item["count"] or 0), item["reaction"]),
            )
            reply["replies"] = []
            reply["mine"] = bool(user and reply["user_id"] == user["id"])
            reply_lookup[reply["id"]] = reply
            reply_count_map[reply["post_id"]] = reply_count_map.get(reply["post_id"], 0) + 1
            latest_reply_map[reply["post_id"]] = reply
        for reply in replies:
            parent = reply_lookup.get(reply.get("parent_reply_id"))
            if parent and parent["post_id"] == reply["post_id"]:
                parent["replies"].append(reply)
            else:
                root_replies.setdefault(reply["post_id"], []).append(reply)
        for post in posts:
            post["replies"] = root_replies.get(post["id"], [])
            post["mine"] = bool(user and post["user_id"] == user["id"])
            post["reply_count"] = reply_count_map.get(post["id"], 0)
            latest_reply = latest_reply_map.get(post["id"])
            post["last_reply_at"] = latest_reply.get("created_at") if latest_reply else None
            post["last_reply_name"] = latest_reply.get("display_name") if latest_reply else None
            post["reactions"] = sorted(
                reaction_map.get(post["id"], []),
                key=lambda item: (reaction_rank.get(item["reaction"], 99), -int(item["count"] or 0), item["reaction"]),
            )
        return posts

    def get_team_post(self, post_id, user=None):
        with connect() as conn:
            post = conn.execute("SELECT id FROM team_posts WHERE id=? AND deleted_at IS NULL", (post_id,)).fetchone()
            if not post:
                raise AppError(404, "讨论主题不存在")
            conn.execute("UPDATE team_posts SET view_count=view_count+1 WHERE id=?", (post_id,))
        result = next((item for item in self.list_team_posts(user) if item["id"] == post_id), None)
        if not result:
            raise AppError(404, "讨论主题不存在")
        return {"post": result}

    def create_team_post(self, user):
        data = read_json(self)
        category = str(data.get("category") or "general").strip()
        if category not in TEAM_POST_CATEGORIES:
            raise AppError(400, "讨论分类不正确")
        if category == "announcement" and user.get("role") != "admin":
            raise AppError(403, "仅管理员可发布团队公告")
        kind = "roast" if category == "roast" else "comment"
        title = (data.get("title") or "").strip()
        content = (data.get("content") or "").strip()
        if not title:
            title = content[:40]
        if not title:
            raise AppError(400, "主题标题不能为空")
        if len(title) > 80:
            raise AppError(400, "主题标题最多 80 字")
        if not content:
            raise AppError(400, "内容不能为空")
        if len(content) > 2000:
            raise AppError(400, "讨论内容最多 2000 字")
        created_at = now_iso()
        with connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO team_posts(user_id, kind, title, category, status, pinned, view_count, content, updated_at, created_at)
                VALUES(?,?,?,?, 'open', 0, 0, ?, ?, ?)
                """,
                (user["id"], kind, title, category, content, created_at, created_at),
            )
            write_audit(conn, user, "team_post.create", "team_post", cursor.lastrowid, "团队讨论主题已发布", {"title": title, "category": category}, self.client_address[0])
        return {"message": "已发布", "posts": self.list_team_posts(user)}

    def update_team_post(self, post_id, user):
        data = read_json(self)
        with connect() as conn:
            post = conn.execute("SELECT * FROM team_posts WHERE id=? AND deleted_at IS NULL", (post_id,)).fetchone()
            if not post:
                raise AppError(404, "讨论主题不存在")
            is_admin = user.get("role") == "admin"
            is_owner = post["user_id"] == user["id"]
            if not is_admin and not is_owner:
                raise AppError(403, "只能修改自己发布的主题")
            fields = []
            values = []
            if "title" in data:
                title = str(data.get("title") or "").strip()
                if not title or len(title) > 80:
                    raise AppError(400, "主题标题需为 1 至 80 字")
                fields.append("title=?")
                values.append(title)
            if "content" in data:
                content = str(data.get("content") or "").strip()
                if not content or len(content) > 2000:
                    raise AppError(400, "讨论内容需为 1 至 2000 字")
                fields.append("content=?")
                values.append(content)
            if "category" in data:
                category = str(data.get("category") or "").strip()
                if category not in TEAM_POST_CATEGORIES:
                    raise AppError(400, "讨论分类不正确")
                if category == "announcement" and not is_admin:
                    raise AppError(403, "仅管理员可发布团队公告")
                fields.extend(["category=?", "kind=?"])
                values.extend([category, "roast" if category == "roast" else "comment"])
            if "status" in data:
                status = str(data.get("status") or "").strip()
                if status not in TEAM_POST_STATUSES:
                    raise AppError(400, "讨论状态不正确")
                fields.append("status=?")
                values.append(status)
            if "pinned" in data:
                if not is_admin:
                    raise AppError(403, "仅管理员可置顶主题")
                fields.append("pinned=?")
                values.append(1 if data.get("pinned") else 0)
            if not fields:
                raise AppError(400, "没有可更新字段")
            fields.append("updated_at=?")
            values.append(now_iso())
            values.append(post_id)
            conn.execute(f"UPDATE team_posts SET {', '.join(fields)} WHERE id=?", values)
            write_audit(conn, user, "team_post.update", "team_post", post_id, "团队讨论主题已更新", {"fields": list(data.keys())}, self.client_address[0])
        return {"message": "主题已更新", "posts": self.list_team_posts(user)}

    def delete_team_post(self, post_id, user):
        with connect() as conn:
            post = conn.execute(
                "SELECT id, user_id, title, deleted_at FROM team_posts WHERE id=?",
                (post_id,),
            ).fetchone()
            if not post:
                raise AppError(404, "讨论主题不存在")
            if post["user_id"] != user["id"] and user.get("role") != "admin":
                raise AppError(403, "只能删除自己发布的主题")
            if post["deleted_at"]:
                raise AppError(400, "讨论主题已经在回收站中")
            conn.execute(
                "UPDATE team_posts SET deleted_at=?, deleted_by=? WHERE id=?",
                (now_iso(), user["id"], post_id),
            )
            add_recycle_record(
                conn,
                "team_post",
                post_id,
                (post["title"] or "团队讨论")[:60],
                user,
                {},
            )
            write_audit(
                conn,
                user,
                "team_post.delete",
                "team_post",
                post_id,
                "团队讨论主题已删除",
                {},
                self.client_address[0],
            )
        return {"message": "讨论主题已移入回收站", "posts": self.list_team_posts(user)}

    def create_team_post_reply(self, post_id, user):
        data = read_json(self)
        content = (data.get("content") or "").strip()
        if not content:
            raise AppError(400, "回复内容不能为空")
        if len(content) > 200:
            raise AppError(400, "回复最多 200 字")
        parent_reply_id = data.get("parent_reply_id") or None
        if parent_reply_id is not None:
            try:
                parent_reply_id = int(parent_reply_id)
            except (TypeError, ValueError):
                raise AppError(400, "回复层级不正确")
        with connect() as conn:
            post = conn.execute("SELECT id FROM team_posts WHERE id=? AND deleted_at IS NULL", (post_id,)).fetchone()
            if not post:
                raise AppError(404, "对话不存在")
            if parent_reply_id is not None:
                parent = conn.execute(
                    "SELECT id FROM team_post_replies WHERE id=? AND post_id=? AND deleted_at IS NULL",
                    (parent_reply_id, post_id),
                ).fetchone()
                if not parent:
                    raise AppError(404, "被回复的内容不存在")
            conn.execute(
                "INSERT INTO team_post_replies(post_id, parent_reply_id, user_id, content, created_at) VALUES(?,?,?,?,?)",
                (post_id, parent_reply_id, user["id"], content, now_iso()),
            )
            conn.execute("UPDATE team_posts SET updated_at=? WHERE id=?", (now_iso(), post_id))
            write_audit(conn, user, "team_reply.create", "team_post", post_id, "团队讨论新增回复", {"parent_reply_id": parent_reply_id}, self.client_address[0])
        return {"message": "已回复", "posts": self.list_team_posts(user)}

    def toggle_team_post_reaction(self, post_id, user):
        data = read_json(self)
        reaction = str(data.get("reaction") or "+1").strip()
        if not reaction or len(reaction) > 24 or any(ord(char) < 32 for char in reaction):
            raise AppError(400, "回应内容不支持")
        with connect() as conn:
            post = conn.execute("SELECT id FROM team_posts WHERE id=? AND deleted_at IS NULL", (post_id,)).fetchone()
            if not post:
                raise AppError(404, "对话不存在")
            existing = conn.execute(
                "SELECT id FROM team_post_reactions WHERE post_id=? AND user_id=? AND reaction=?",
                (post_id, user["id"], reaction),
            ).fetchone()
            if existing:
                conn.execute("DELETE FROM team_post_reactions WHERE id=?", (existing["id"],))
            else:
                conn.execute(
                    "INSERT INTO team_post_reactions(post_id, user_id, reaction, created_at) VALUES(?,?,?,?)",
                    (post_id, user["id"], reaction, now_iso()),
                )
        return {"message": "已更新回应", "posts": self.list_team_posts(user)}

    def toggle_team_reply_reaction(self, reply_id, user):
        data = read_json(self)
        reaction = str(data.get("reaction") or "+1").strip()
        if not reaction or len(reaction) > 24 or any(ord(char) < 32 for char in reaction):
            raise AppError(400, "回应内容不支持")
        with connect() as conn:
            reply = conn.execute(
                """
                SELECT r.id
                FROM team_post_replies r
                JOIN team_posts p ON p.id = r.post_id
                WHERE r.id=? AND r.deleted_at IS NULL AND p.deleted_at IS NULL
                """,
                (reply_id,),
            ).fetchone()
            if not reply:
                raise AppError(404, "回复不存在")
            existing = conn.execute(
                "SELECT id FROM team_reply_reactions WHERE reply_id=? AND user_id=? AND reaction=?",
                (reply_id, user["id"], reaction),
            ).fetchone()
            if existing:
                conn.execute("DELETE FROM team_reply_reactions WHERE id=?", (existing["id"],))
            else:
                conn.execute(
                    "INSERT INTO team_reply_reactions(reply_id, user_id, reaction, created_at) VALUES(?,?,?,?)",
                    (reply_id, user["id"], reaction, now_iso()),
                )
        return {"message": "已更新回应", "posts": self.list_team_posts(user)}

    def delete_team_post_reply(self, reply_id, user):
        with connect() as conn:
            reply = conn.execute(
                "SELECT id, user_id, content, deleted_at FROM team_post_replies WHERE id=?",
                (reply_id,),
            ).fetchone()
            if not reply:
                raise AppError(404, "回复不存在")
            if reply["user_id"] != user["id"] and user.get("role") != "admin":
                raise AppError(403, "只能删除自己的回复")
            if reply["deleted_at"]:
                raise AppError(400, "回复已经在回收站中")
            descendant_ids = [
                row["id"]
                for row in conn.execute(
                    """
                    WITH RECURSIVE descendants(id) AS (
                        SELECT id FROM team_post_replies WHERE id=?
                        UNION ALL
                        SELECT child.id
                        FROM team_post_replies child
                        JOIN descendants parent ON child.parent_reply_id=parent.id
                    )
                    SELECT id FROM descendants
                    """,
                    (reply_id,),
                ).fetchall()
            ]
            placeholders = ",".join("?" for _ in descendant_ids)
            deleted_at = now_iso()
            conn.execute(
                f"UPDATE team_post_replies SET deleted_at=?, deleted_by=? WHERE id IN ({placeholders})",
                [deleted_at, user["id"], *descendant_ids],
            )
            add_recycle_record(
                conn,
                "team_reply",
                reply_id,
                (reply["content"] or "团队回复")[:60],
                user,
                {"reply_ids": descendant_ids},
            )
            write_audit(
                conn,
                user,
                "team_reply.delete",
                "team_post_reply",
                reply_id,
                "团队对话回复已删除",
                {"deleted_count": len(descendant_ids)},
                self.client_address[0],
            )
        return {"message": "回复已移入回收站", "posts": self.list_team_posts(user)}

    def list_morning_items(self, query):
        item_date = (query.get("date") or [today_iso()])[0] or today_iso()
        try:
            dt.date.fromisoformat(item_date)
        except ValueError:
            raise AppError(400, "日期格式不正确")
        with connect() as conn:
            carried_count = ensure_morning_carryover(conn, item_date)
            items = rows_to_list(
                conn.execute(
                    """
                    SELECT i.*, owner.display_name AS owner_name, owner.username AS owner_account,
                           updater.display_name AS updated_by_name,
                           COALESCE(root.item_date, i.item_date) AS start_date
                    FROM morning_items i
                    JOIN users owner ON owner.id = i.owner_id
                    LEFT JOIN user_types owner_type ON owner_type.key=owner.user_type
                    LEFT JOIN users updater ON updater.id = i.updated_by
                    LEFT JOIN morning_items root ON root.id = COALESCE(i.root_id, i.id)
                    WHERE i.active=1 AND i.item_date=? AND COALESCE(owner_type.include_in_morning, 1)=1
                    ORDER BY owner.display_name, CASE i.status WHEN 'risk' THEN 0 WHEN 'doing' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END, i.updated_at DESC
                    """,
                    (item_date,),
                ).fetchall()
            )
            for item in items:
                start_date = item.get("start_date") or item["item_date"]
                try:
                    item["duration_days"] = (dt.date.fromisoformat(item["item_date"]) - dt.date.fromisoformat(start_date)).days + 1
                except ValueError:
                    item["duration_days"] = 1
            users = rows_to_list(
                conn.execute(
                    """
                    SELECT u.id, u.username, u.display_name, u.user_type, COALESCE(t.name, u.user_type) AS user_type_name
                    FROM users u
                    LEFT JOIN user_types t ON t.key = u.user_type
                    WHERE u.active=1 AND COALESCE(t.include_in_morning, 1)=1
                    ORDER BY t.sort_order, u.id
                    """
                ).fetchall()
            )
        return {
            "date": item_date,
            "today": today_iso(),
            "read_only": is_past_date(item_date),
            "carried_count": carried_count,
            "items": items,
            "users": users,
        }

    def list_morning_item_history(self, item_id):
        with connect() as conn:
            current = conn.execute(
                """
                SELECT i.*, owner.display_name AS owner_name, owner.username AS owner_account,
                       updater.display_name AS updated_by_name,
                       COALESCE(root.item_date, i.item_date) AS start_date
                FROM morning_items i
                JOIN users owner ON owner.id = i.owner_id
                LEFT JOIN users updater ON updater.id = i.updated_by
                LEFT JOIN morning_items root ON root.id = COALESCE(i.root_id, i.id)
                WHERE i.id=? AND i.active=1
                """,
                (item_id,),
            ).fetchone()
            if not current:
                raise AppError(404, "早例会事项不存在")
            current_item = dict(current)
            chain_id = current_item.get("root_id") or current_item["id"]
            history = rows_to_list(
                conn.execute(
                    """
                    SELECT i.*, owner.display_name AS owner_name, owner.username AS owner_account,
                           updater.display_name AS updated_by_name,
                           COALESCE(root.item_date, i.item_date) AS start_date
                    FROM morning_items i
                    JOIN users owner ON owner.id = i.owner_id
                    LEFT JOIN users updater ON updater.id = i.updated_by
                    LEFT JOIN morning_items root ON root.id = COALESCE(i.root_id, i.id)
                    WHERE i.active=1 AND COALESCE(i.root_id, i.id)=?
                    ORDER BY i.item_date ASC, i.id ASC
                    """,
                    (chain_id,),
                ).fetchall()
            )
        start_date = current_item.get("start_date") or current_item["item_date"]
        try:
            current_item["duration_days"] = (dt.date.fromisoformat(current_item["item_date"]) - dt.date.fromisoformat(start_date)).days + 1
        except ValueError:
            current_item["duration_days"] = 1

        visible_history = []
        for row in history:
            has_manual_update = not row.get("carry_from_id") or (
                row.get("updated_at") and row.get("created_at") and row["updated_at"] != row["created_at"]
            )
            if not has_manual_update:
                continue
            row_start = row.get("start_date") or row["item_date"]
            try:
                row["duration_days"] = (dt.date.fromisoformat(row["item_date"]) - dt.date.fromisoformat(row_start)).days + 1
            except ValueError:
                row["duration_days"] = 1
            visible_history.append(row)
        return {"item": current_item, "history": visible_history}

    def create_morning_item(self, user):
        data = read_json(self)
        title = (data.get("title") or "").strip()
        if not title:
            raise AppError(400, "事项标题不能为空")
        owner_id = int(data.get("owner_id") or user["id"])
        if user["role"] != "admin" and owner_id != user["id"]:
            raise AppError(403, "只能登记自己的早例会事项")
        status = data.get("status") if data.get("status") in MORNING_STATUSES else "todo"
        priority = data.get("priority") if data.get("priority") in MORNING_PRIORITIES else "normal"
        item_date = data.get("item_date") or today_iso()
        try:
            dt.date.fromisoformat(item_date)
        except ValueError:
            raise AppError(400, "日期格式不正确")
        if is_past_date(item_date):
            raise AppError(400, "已结束日期不能新增早例会事项")
        due_date = data.get("due_date") or item_date
        with connect() as conn:
            owner = conn.execute(
                """
                SELECT u.id
                FROM users u
                LEFT JOIN user_types t ON t.key=u.user_type
                WHERE u.id=? AND u.active=1 AND COALESCE(t.include_in_morning, 1)=1
                """,
                (owner_id,),
            ).fetchone()
            if not owner:
                raise AppError(400, "该账号未纳入早例会跟踪名单")
            cursor = conn.execute(
                """
                INSERT INTO morning_items(owner_id, item_date, title, detail, status, priority, blocker, due_date, updated_by, created_at, updated_at, active)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,1)
                """,
                (owner_id, item_date, title, data.get("detail") or "", status, priority, data.get("blocker") or "", due_date, user["id"], now_iso(), now_iso()),
            )
            conn.execute("UPDATE morning_items SET root_id=? WHERE id=?", (cursor.lastrowid, cursor.lastrowid))
            write_audit(conn, user, "morning.create", "morning_item", cursor.lastrowid, "早例会事项已创建", {"owner_id": owner_id, "item_date": item_date}, self.client_address[0])
        return {"message": "早例会事项已创建", **self.list_morning_items({"date": [item_date]})}

    def update_morning_item(self, item_id, user):
        data = read_json(self)
        fields = []
        values = []
        if "title" in data and not (data.get("title") or "").strip():
            raise AppError(400, "事项标题不能为空")
        for date_key in ("item_date", "due_date"):
            if data.get(date_key):
                try:
                    dt.date.fromisoformat(data[date_key])
                except ValueError:
                    raise AppError(400, "日期格式不正确")
                if date_key == "item_date" and is_past_date(data[date_key]):
                    raise AppError(400, "已结束日期不能修改")
        for key in ("title", "detail", "blocker", "due_date", "item_date"):
            if key in data:
                fields.append(f"{key}=?")
                values.append((data.get(key) or "").strip() if key == "title" else data.get(key) or "")
        if "status" in data:
            if data["status"] not in MORNING_STATUSES:
                raise AppError(400, "事项状态不正确")
            fields.append("status=?")
            values.append(data["status"])
        if "priority" in data:
            if data["priority"] not in MORNING_PRIORITIES:
                raise AppError(400, "优先级不正确")
            fields.append("priority=?")
            values.append(data["priority"])
        if "owner_id" in data and user["role"] == "admin":
            fields.append("owner_id=?")
            values.append(int(data["owner_id"]))
        if not fields:
            raise AppError(400, "没有可更新字段")
        expected_version = data.get("expected_version")
        fields.extend(["updated_by=?", "updated_at=?", "version=version+1"])
        values.extend([user["id"], now_iso()])
        with connect() as conn:
            item = conn.execute("SELECT * FROM morning_items WHERE id=? AND active=1", (item_id,)).fetchone()
            if not item:
                raise AppError(404, "早例会事项不存在")
            if is_past_date(item["item_date"]):
                raise AppError(400, "已结束日期不能修改")
            if user["role"] != "admin" and item["owner_id"] != user["id"]:
                raise AppError(403, "只能更新自己的早例会事项")
            if "owner_id" in data and user["role"] == "admin":
                eligible_owner = conn.execute(
                    """
                    SELECT u.id FROM users u
                    LEFT JOIN user_types t ON t.key=u.user_type
                    WHERE u.id=? AND u.active=1 AND COALESCE(t.include_in_morning, 1)=1
                    """,
                    (int(data["owner_id"]),),
                ).fetchone()
                if not eligible_owner:
                    raise AppError(400, "该账号未纳入早例会跟踪名单")
            if expected_version is not None and int(expected_version) != int(item["version"]):
                raise AppError(409, "该事项已被其他人更新，请刷新后查看最新进展再修改")
            updated = conn.execute(
                f"UPDATE morning_items SET {', '.join(fields)} WHERE id=? AND version=?",
                [*values, item_id, item["version"]],
            )
            if updated.rowcount != 1:
                raise AppError(409, "该事项已被其他人更新，请刷新后重试")
            write_audit(conn, user, "morning.update", "morning_item", item_id, "早例会事项已更新", {"fields": list(data.keys())}, self.client_address[0])
            date_row = conn.execute("SELECT item_date FROM morning_items WHERE id=?", (item_id,)).fetchone()
        return {"message": "早例会事项已更新", **self.list_morning_items({"date": [date_row["item_date"]]})}

    def delete_morning_item(self, item_id, user):
        data = read_json(self)
        expected_version = data.get("expected_version")
        with connect() as conn:
            item = conn.execute("SELECT * FROM morning_items WHERE id=? AND active=1", (item_id,)).fetchone()
            if not item:
                raise AppError(404, "早例会事项不存在")
            if is_past_date(item["item_date"]):
                raise AppError(400, "已结束日期不能删除")
            if user["role"] != "admin" and item["owner_id"] != user["id"]:
                raise AppError(403, "只能删除自己的早例会事项")
            if expected_version is not None and int(expected_version) != int(item["version"]):
                raise AppError(409, "该事项已被其他人更新，请刷新后确认后再删除")
            chain_id = item["root_id"] or item["id"]
            updated_at = now_iso()
            cursor = conn.execute(
                """
                UPDATE morning_items
                SET active=0, updated_by=?, updated_at=?, version=version+1
                WHERE active=1
                  AND item_date>=?
                  AND COALESCE(root_id, id)=?
                """,
                (user["id"], updated_at, item["item_date"], chain_id),
            )
            write_audit(
                conn,
                user,
                "morning.delete",
                "morning_item",
                item_id,
                "早例会事项已删除",
                {"item_date": item["item_date"], "chain_id": chain_id, "affected": cursor.rowcount},
                self.client_address[0],
            )
        return {"message": "早例会事项已删除", **self.list_morning_items({"date": [item["item_date"]]})}

    def list_rules(self, query):
        clauses = ["1=1"]
        params = []
        if query.get("kind"):
            clauses.append("kind=?")
            params.append(query["kind"][0])
        with connect() as conn:
            return rows_to_list(conn.execute(f"SELECT * FROM red_black_rules WHERE {' AND '.join(clauses)} ORDER BY created_at DESC", params).fetchall())

    def create_rule(self):
        admin = self.require_admin()
        data = read_json(self)
        content = (data.get("content") or "").strip()
        if not content:
            raise AppError(400, "规则内容不能为空")
        title = (data.get("title") or content[:24] or "红黑榜规则").strip()
        kind = data.get("kind") if data.get("kind") in ("red", "black") else "red"
        with connect() as conn:
            cursor = conn.execute(
                "INSERT INTO red_black_rules(title, kind, content, effective_from, effective_to, active, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)",
                (title, kind, content, None, None, 1, admin["id"], now_iso()),
            )
            write_audit(conn, admin, "rule.create", "red_black_rule", cursor.lastrowid, "红黑榜规则已发布", {"kind": kind}, self.client_address[0])
        return {"message": "规则已发布", "rules": self.list_rules({})}

    def list_scores(self, query):
        where, params = date_filter(query, "s.score_date")
        user = self.current_user(required=False)
        with connect() as conn:
            show_black_details = bool(user and user.get("role") == "admin") or get_setting_value(
                conn, "red_black_show_black_details", "1"
            ) == "1"
            clauses = [where]
            if query.get("user_id") and query["user_id"][0]:
                try:
                    user_id = int(query["user_id"][0])
                except (TypeError, ValueError):
                    raise AppError(400, "成员参数不正确")
                clauses.append("s.user_id=?")
                params.append(user_id)
            if not show_black_details:
                clauses.append("s.kind='red'")
            return rows_to_list(
                conn.execute(
                    f"""
                    SELECT s.*, u.display_name, r.title AS rule_title
                    FROM red_black_scores s
                    JOIN users u ON u.id = s.user_id
                    LEFT JOIN red_black_rules r ON r.id = s.rule_id
                    WHERE {' AND '.join(clauses)}
                    ORDER BY s.score_date DESC, s.created_at DESC
                    """,
                    params,
                ).fetchall()
            )

    def create_score(self):
        admin = self.require_admin()
        data = read_json(self)
        points = abs(int(data.get("points") or 0))
        if data.get("kind") == "black":
            points = -points
        with connect() as conn:
            eligible = conn.execute(
                """
                SELECT u.id
                FROM users u
                LEFT JOIN user_types t ON t.key=u.user_type
                WHERE u.id=? AND u.active=1 AND COALESCE(t.include_in_rules, 1)=1
                """,
                (data.get("user_id"),),
            ).fetchone()
            if not eligible:
                raise AppError(400, "该账号未纳入红黑榜名单")
            cursor = conn.execute(
                "INSERT INTO red_black_scores(user_id, rule_id, kind, points, reason, score_date, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)",
                (data.get("user_id"), data.get("rule_id") or None, data.get("kind"), points, data.get("reason") or "", data.get("score_date") or today_iso(), admin["id"], now_iso()),
            )
            write_audit(conn, admin, "score.create", "red_black_score", cursor.lastrowid, "红黑榜积分已记录", {"user_id": data.get("user_id"), "points": points}, self.client_address[0])
        return {"message": "积分已记录", "scores": self.list_scores({})}

    def update_score(self, score_id):
        admin = self.require_admin()
        data = read_json(self)
        with connect() as conn:
            score = conn.execute("SELECT * FROM red_black_scores WHERE id=?", (score_id,)).fetchone()
            if not score:
                raise AppError(404, "积分记录不存在")
            if score["score_date"] != today_iso():
                raise AppError(400, "仅允许编辑当天积分明细")
            kind = data.get("kind") if data.get("kind") in ("red", "black") else score["kind"]
            points = abs(int(data.get("points") or abs(int(score["points"] or 0))))
            if kind == "black":
                points = -points
            score_date = data.get("score_date") or score["score_date"]
            if score_date != today_iso():
                raise AppError(400, "积分日期只能保持当天")
            user_id = int(data.get("user_id") or score["user_id"])
            if not conn.execute(
                """
                SELECT u.id FROM users u
                LEFT JOIN user_types t ON t.key=u.user_type
                WHERE u.id=? AND u.active=1 AND COALESCE(t.include_in_rules, 1)=1
                """,
                (user_id,),
            ).fetchone():
                raise AppError(400, "该账号未纳入红黑榜名单")
            rule_id = data.get("rule_id") or None
            if rule_id:
                rule = conn.execute("SELECT id, kind FROM red_black_rules WHERE id=? AND active=1", (rule_id,)).fetchone()
                if not rule:
                    raise AppError(404, "规则不存在")
                kind = rule["kind"]
                if kind == "black":
                    points = -abs(points)
                else:
                    points = abs(points)
            conn.execute(
                """
                UPDATE red_black_scores
                SET user_id=?, rule_id=?, kind=?, points=?, reason=?, score_date=?
                WHERE id=?
                """,
                (user_id, rule_id, kind, points, data.get("reason") or "", score_date, score_id),
            )
            write_audit(conn, admin, "score.update", "red_black_score", score_id, "红黑榜积分已更新", {"fields": list(data.keys())}, self.client_address[0])
        return {"message": "积分已更新", "scores": self.list_scores({"from": [today_iso()], "to": [today_iso()]})}

    def red_black_dashboard(self, query):
        where, params = date_filter(query, "s.score_date")
        user = self.current_user(required=False)
        with connect() as conn:
            show_black_points = bool(user and user.get("role") == "admin") or get_setting_value(
                conn, "red_black_show_black_points", "1"
            ) == "1"
            users = rows_to_list(
                conn.execute(
                    """
                    SELECT u.id, u.display_name FROM users u
                    LEFT JOIN user_types t ON t.key=u.user_type
                    WHERE u.active=1 AND COALESCE(t.include_in_rules, 1)=1
                    ORDER BY u.display_name
                    """
                ).fetchall()
            )
            totals = rows_to_list(
                conn.execute(
                    f"""
                    SELECT u.id, u.display_name,
                           SUM(CASE WHEN s.kind='red' THEN ABS(s.points) ELSE 0 END) AS red_points,
                           SUM(CASE WHEN s.kind='black' THEN ABS(s.points) ELSE 0 END) AS black_points
                    FROM users u
                    LEFT JOIN user_types t ON t.key=u.user_type
                    LEFT JOIN red_black_scores s ON s.user_id = u.id AND {where}
                    WHERE u.active=1 AND COALESCE(t.include_in_rules, 1)=1
                    GROUP BY u.id
                    ORDER BY red_points DESC, black_points ASC, u.display_name
                    """,
                    params,
                ).fetchall()
            )
            timeline = rows_to_list(
                conn.execute(
                    f"""
                    SELECT s.score_date,
                           SUM(CASE WHEN s.kind='red' THEN ABS(s.points) ELSE 0 END) AS red_points,
                           SUM(CASE WHEN s.kind='black' THEN ABS(s.points) ELSE 0 END) AS black_points
                    FROM red_black_scores s
                    WHERE {where}
                    GROUP BY s.score_date
                    ORDER BY s.score_date
                    """,
                    params,
                ).fetchall()
            )
            monthly_rows = rows_to_list(
                conn.execute(
                    f"""
                    SELECT s.user_id,
                           strftime('%m', s.score_date) AS month,
                           SUM(CASE WHEN s.kind='red' THEN ABS(s.points) ELSE 0 END) AS red_points,
                           SUM(CASE WHEN s.kind='black' THEN ABS(s.points) ELSE 0 END) AS black_points
                    FROM red_black_scores s
                    WHERE {where}
                    GROUP BY s.user_id, strftime('%m', s.score_date)
                    """,
                    params,
                ).fetchall()
            )
        annual_map = {
            user["id"]: {
                "id": user["id"],
                "display_name": user["display_name"],
                "months": {str(month): {"red": 0, "black": 0} for month in range(1, 13)},
                "total_red": 0,
                "total_black": 0,
            }
            for user in users
        }
        for row in monthly_rows:
            user_id = row["user_id"]
            if user_id not in annual_map:
                continue
            month = str(int(row["month"] or 0)) if row.get("month") else ""
            if month in annual_map[user_id]["months"]:
                red_points = int(row["red_points"] or 0)
                black_points = int(row["black_points"] or 0)
                annual_map[user_id]["months"][month] = {"red": red_points, "black": black_points}
                annual_map[user_id]["total_red"] += red_points
                annual_map[user_id]["total_black"] += black_points
        annual = sorted(
            annual_map.values(),
            key=lambda item: (-int(item["total_red"] or 0), int(item["total_black"] or 0), item["display_name"]),
        )
        if not show_black_points:
            for item in totals:
                item["black_points"] = 0
            for item in timeline:
                item["black_points"] = 0
            for item in annual:
                item["total_black"] = 0
                for month in item["months"].values():
                    month["black"] = 0
            totals.sort(key=lambda item: (-int(item["red_points"] or 0), item["display_name"]))
            annual.sort(key=lambda item: (-int(item["total_red"] or 0), item["display_name"]))
        return {
            "totals": totals,
            "timeline": timeline,
            "annual": annual,
            "show_black_points": show_black_points,
        }

    def list_meetings(self, query):
        where, params = date_filter(query, "m.meeting_date")
        with connect() as conn:
            meetings = rows_to_list(
                conn.execute(
                    f"""
                    SELECT m.*, u.display_name AS creator
                    FROM meetings m
                    JOIN users u ON u.id = m.created_by
                    WHERE {where}
                    ORDER BY m.meeting_date DESC
                    """,
                    params,
                ).fetchall()
            )
            items = rows_to_list(
                conn.execute(
                    """
                    SELECT i.*, u.display_name AS owner_name,
                           c.display_name AS created_by_name,
                           t.name AS type_name, t.color AS type_color,
                           o.title AS option_title
                    FROM meeting_items i
                    LEFT JOIN users u ON u.id = i.owner_id
                    LEFT JOIN users c ON c.id = i.created_by
                    LEFT JOIN meeting_topic_types t ON t.id = i.type_id
                    LEFT JOIN meeting_topic_options o ON o.id = i.option_id
                    WHERE i.deleted_at IS NULL
                    ORDER BY i.meeting_id, i.sort_order, i.created_at
                    """
                ).fetchall()
            )
            attendance = rows_to_list(
                conn.execute(
                    """
                    SELECT a.*, u.display_name
                    FROM meeting_attendance a
                    JOIN users u ON u.id = a.user_id
                    ORDER BY u.display_name
                    """
                ).fetchall()
            )
            topic_links = rows_to_list(
                conn.execute(
                    """
                    SELECT l.meeting_id, t.id, t.name, t.color, t.sort_order
                    FROM meeting_topic_links l
                    JOIN meeting_topic_types t ON t.id = l.type_id
                    WHERE t.active=1
                    ORDER BY l.sort_order, t.sort_order, t.id
                    """
                ).fetchall()
            )
        item_map = {}
        for item in items:
            item_map.setdefault(item["meeting_id"], []).append(item)
        attendance_map = {}
        for record in attendance:
            attendance_map.setdefault(record["meeting_id"], []).append(record)
        topic_map = {}
        for topic in topic_links:
            topic_map.setdefault(topic["meeting_id"], []).append({
                "id": topic["id"],
                "name": topic["name"],
                "color": topic["color"],
                "sort_order": topic["sort_order"],
            })
        for meeting in meetings:
            meeting_items = item_map.get(meeting["id"], [])
            meeting_topics = topic_map.get(meeting["id"], [])
            seen_topics = {topic["id"] for topic in meeting_topics}
            for item in meeting_items:
                if item.get("type_id") and item["type_id"] not in seen_topics:
                    meeting_topics.append({
                        "id": item["type_id"],
                        "name": item.get("type_name") or item.get("section") or "议题",
                        "color": item.get("type_color") or "#3370ff",
                        "sort_order": 999,
                    })
                    seen_topics.add(item["type_id"])
            meeting["items"] = meeting_items
            meeting["attendance"] = attendance_map.get(meeting["id"], [])
            meeting["topic_types"] = meeting_topics
            meeting["topic_type_ids"] = [topic["id"] for topic in meeting_topics]
        return meetings

    def create_meeting(self, user):
        data = read_json(self)
        start_time = str(data.get("start_time") or "").strip()
        if start_time and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", start_time):
            raise AppError(400, "会议开始时间格式不正确")
        with connect() as conn:
            default_title = get_setting_value(conn, "meeting_default_title", "周例会")
            cursor = conn.execute(
                "INSERT INTO meetings(meeting_date, start_time, title, summary, status, created_by, created_at) VALUES(?,?,?,?,?,?,?)",
                (data.get("meeting_date") or today_iso(), start_time or None, data.get("title") or default_title, data.get("summary") or "", "draft", user["id"], now_iso()),
            )
            meeting_id = cursor.lastrowid
            for topic_id in data.get("topic_type_ids") or []:
                link_meeting_topic(conn, meeting_id, topic_id, user["id"])
            write_audit(conn, user, "meeting.create", "meeting", meeting_id, "会议已创建", {"meeting_date": data.get("meeting_date") or today_iso()}, self.client_address[0])
        return {"message": "会议已创建", "meeting_id": meeting_id, "meetings": self.list_meetings({})}

    def update_meeting(self, meeting_id):
        admin = self.require_admin()
        data = read_json(self)
        allowed_statuses = {"draft", "scheduled", "in_progress", "completed", "archived"}
        fields = []
        values = []
        for key in ("meeting_date", "start_time", "title", "summary"):
            if key in data:
                value = str(data.get(key) or "").strip()
                if key in ("meeting_date", "title") and not value:
                    raise AppError(400, "会议日期和标题不能为空")
                if key == "start_time" and value and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
                    raise AppError(400, "会议开始时间格式不正确")
                fields.append(f"{key}=?")
                values.append(value or None if key == "start_time" else value)
        if "status" in data:
            status = str(data.get("status") or "").strip()
            if status not in allowed_statuses:
                raise AppError(400, "会议状态不正确")
            fields.append("status=?")
            values.append(status)
        if not fields:
            raise AppError(400, "没有可更新字段")
        values.append(meeting_id)
        with connect() as conn:
            meeting = conn.execute("SELECT id, status FROM meetings WHERE id=?", (meeting_id,)).fetchone()
            if not meeting:
                raise AppError(404, "会议不存在")
            conn.execute(f"UPDATE meetings SET {', '.join(fields)} WHERE id=?", values)
            write_audit(conn, admin, "meeting.update", "meeting", meeting_id, "会议状态或信息已更新", {"fields": list(data.keys())}, self.client_address[0])
        return {"message": "会议已更新", "meetings": self.list_meetings({})}

    def copy_previous_meeting_agenda(self, meeting_id):
        admin = self.require_admin()
        with connect() as conn:
            meeting = conn.execute("SELECT * FROM meetings WHERE id=?", (meeting_id,)).fetchone()
            if not meeting:
                raise AppError(404, "会议不存在")
            if meeting["status"] in ("completed", "archived"):
                raise AppError(400, "已结束会议不能调整议题")
            previous = conn.execute(
                "SELECT id FROM meetings WHERE meeting_date<? AND title=? ORDER BY meeting_date DESC, id DESC LIMIT 1",
                (meeting["meeting_date"], meeting["title"]),
            ).fetchone()
            if not previous:
                previous = conn.execute(
                    "SELECT id FROM meetings WHERE meeting_date<? ORDER BY meeting_date DESC, id DESC LIMIT 1",
                    (meeting["meeting_date"],),
                ).fetchone()
            if not previous:
                raise AppError(400, "没有可沿用的历史会议")
            source_items = conn.execute(
                "SELECT * FROM meeting_items WHERE meeting_id=? AND deleted_at IS NULL ORDER BY sort_order, id",
                (previous["id"],),
            ).fetchall()
            existing_titles = {
                row["title"] for row in conn.execute(
                    "SELECT title FROM meeting_items WHERE meeting_id=? AND deleted_at IS NULL", (meeting_id,)
                ).fetchall()
            }
            copied = 0
            for item in source_items:
                if item["title"] in existing_titles:
                    continue
                conn.execute(
                    """
                    INSERT INTO meeting_items(
                        meeting_id, section, title, detail, minutes, owner_id, status, due_date,
                        created_by, created_at, type_id, option_id, sort_order, duration_minutes,
                        expected_output, materials, carried_from_id
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        meeting_id, item["section"], item["title"], item["detail"] or "", "",
                        item["owner_id"], "todo", None, admin["id"], now_iso(), item["type_id"],
                        item["option_id"], item["sort_order"], item["duration_minutes"] or 10,
                        item["expected_output"] or "", item["materials"] or "", item["id"],
                    ),
                )
                link_meeting_topic(conn, meeting_id, item["type_id"], admin["id"])
                copied += 1
            write_audit(conn, admin, "meeting.copy_agenda", "meeting", meeting_id, "已沿用上场会议议题", {"source_meeting_id": previous["id"], "copied": copied}, self.client_address[0])
        return {"message": f"已沿用 {copied} 个议题", "meetings": self.list_meetings({})}

    def update_meeting_topics(self, meeting_id):
        admin = self.require_admin()
        data = read_json(self)
        topic_ids = data.get("topic_type_ids") or []
        if isinstance(topic_ids, str):
            topic_ids = [item.strip() for item in topic_ids.split(",") if item.strip()]
        normalized = []
        for topic_id in topic_ids:
            try:
                value = int(topic_id)
            except (TypeError, ValueError):
                continue
            if value not in normalized:
                normalized.append(value)
        with connect() as conn:
            meeting = conn.execute("SELECT id, status FROM meetings WHERE id=?", (meeting_id,)).fetchone()
            if not meeting:
                raise AppError(404, "会议不存在")
            if meeting["status"] in ("completed", "archived"):
                raise AppError(400, "已结束会议不能调整主题，请先重新开启")
            active = {
                row["id"]
                for row in conn.execute(
                    "SELECT id FROM meeting_topic_types WHERE active=1 AND id IN ({})".format(",".join("?" for _ in normalized) or "NULL"),
                    normalized,
                ).fetchall()
            } if normalized else set()
            conn.execute("DELETE FROM meeting_topic_links WHERE meeting_id=?", (meeting_id,))
            for index, topic_id in enumerate(normalized):
                if topic_id not in active:
                    continue
                conn.execute(
                    """
                    INSERT OR IGNORE INTO meeting_topic_links(
                        meeting_id, type_id, sort_order, created_by, created_at
                    ) VALUES(?,?,?,?,?)
                    """,
                    (meeting_id, topic_id, index, admin["id"], now_iso()),
                )
            write_audit(conn, admin, "meeting.topics_update", "meeting", meeting_id, "会议主题已更新", {"topic_type_ids": normalized}, self.client_address[0])
        return {"message": "会议主题已更新", "meetings": self.list_meetings({})}

    def bulk_generate_meetings(self):
        admin = self.require_admin()
        data = read_json(self)
        start = week_start(data.get("start_date") or today_iso())
        summary = (data.get("summary") or "按预设议题自动生成").strip()
        start_date = dt.date.fromisoformat(start)
        created_meetings = 0
        created_items = 0
        with connect() as conn:
            default_weeks = get_int_setting(conn, "meeting_bulk_default_weeks", 4, minimum=1, maximum=52)
            weeks = max(1, min(52, int(data.get("weeks") or default_weeks)))
            title = (data.get("title") or get_setting_value(conn, "meeting_default_title", "周例会")).strip()
            start_time = str(data.get("start_time") or "").strip()
            if start_time and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", start_time):
                raise AppError(400, "会议开始时间格式不正确")
            options = rows_to_list(
                conn.execute(
                    """
                    SELECT o.*, t.name AS type_name
                    FROM meeting_topic_options o
                    JOIN meeting_topic_types t ON t.id = o.type_id
                    WHERE o.active=1 AND t.active=1
                    ORDER BY o.sort_order, o.id
                    """
                ).fetchall()
            )
            if not options:
                raise AppError(400, "请先维护预设议题")
            for offset in range(weeks):
                meeting_date = (start_date + dt.timedelta(weeks=offset)).isoformat()
                meeting = conn.execute(
                    "SELECT id FROM meetings WHERE meeting_date=? ORDER BY id LIMIT 1",
                    (meeting_date,),
                ).fetchone()
                if meeting:
                    meeting_id = meeting["id"]
                else:
                    cursor = conn.execute(
                        "INSERT INTO meetings(meeting_date, start_time, title, summary, status, created_by, created_at) VALUES(?,?,?,?,?,?,?)",
                        (meeting_date, start_time or None, title, summary, "scheduled", admin["id"], now_iso()),
                    )
                    meeting_id = cursor.lastrowid
                    created_meetings += 1
                for option in options:
                    if not recurrence_matches(option, offset, meeting_date):
                        continue
                    exists = conn.execute(
                        "SELECT id FROM meeting_items WHERE meeting_id=? AND option_id=?",
                        (meeting_id, option["id"]),
                    ).fetchone()
                    if exists:
                        continue
                    conn.execute(
                        """
                        INSERT INTO meeting_items(
                            meeting_id, section, title, detail, minutes, owner_id, status,
                            due_date, created_by, created_at, type_id, option_id, sort_order,
                            duration_minutes, expected_output, materials
                        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                        """,
                        (
                            meeting_id,
                            option["type_name"],
                            option["title"],
                            option["default_detail"] or "",
                            "",
                            option["owner_id"],
                            "todo",
                            None,
                            admin["id"],
                            now_iso(),
                            option["type_id"],
                            option["id"],
                            option["sort_order"] or 0,
                            option["duration_minutes"] or 10,
                            option["expected_output"] or "",
                            option["materials"] or "",
                        ),
                    )
                    link_meeting_topic(conn, meeting_id, option["type_id"], admin["id"])
                    created_items += 1
            write_audit(conn, admin, "meeting.bulk_generate", "meeting", None, "周例会已批量生成", {"weeks": weeks, "created_meetings": created_meetings, "created_items": created_items}, self.client_address[0])
        return {
            "message": f"已生成 {created_meetings} 场会议、{created_items} 个议题",
            "meetings": self.list_meetings({}),
        }

    def list_meeting_topics(self):
        with connect() as conn:
            types = rows_to_list(
                conn.execute(
                    "SELECT * FROM meeting_topic_types WHERE active=1 ORDER BY sort_order, id"
                ).fetchall()
            )
            options = rows_to_list(
                conn.execute(
                    """
                    SELECT o.*, u.display_name AS owner_name
                    FROM meeting_topic_options o
                    LEFT JOIN users u ON u.id = o.owner_id
                    WHERE o.active=1
                    ORDER BY o.sort_order, o.id
                    """
                ).fetchall()
            )
        option_map = {}
        for option in options:
            option_map.setdefault(option["type_id"], []).append(option)
        for topic_type in types:
            topic_type["options"] = option_map.get(topic_type["id"], [])
        return {"types": types}

    def create_meeting_topic_type(self):
        self.require_admin()
        data = read_json(self)
        with connect() as conn:
            cursor = conn.execute(
                "INSERT INTO meeting_topic_types(name, color, sort_order, active) VALUES(?,?,?,1)",
                (data.get("name"), data.get("color") or "#3370ff", int(data.get("sort_order") or 0)),
            )
            write_audit(conn, self.current_user(), "meeting_topic_type.create", "meeting_topic_type", cursor.lastrowid, "议题类型已创建", {"name": data.get("name")}, self.client_address[0])
        return {"message": "议题类型已创建", **self.list_meeting_topics()}

    def delete_meeting_topic_type(self, type_id):
        admin = self.require_admin()
        with connect() as conn:
            topic_type = conn.execute("SELECT id, name FROM meeting_topic_types WHERE id=? AND active=1", (type_id,)).fetchone()
            if not topic_type:
                raise AppError(404, "议题类型不存在")
            conn.execute("UPDATE meeting_topic_types SET active=0 WHERE id=?", (type_id,))
            conn.execute("UPDATE meeting_topic_options SET active=0 WHERE type_id=?", (type_id,))
            write_audit(conn, admin, "meeting_topic_type.delete", "meeting_topic_type", type_id, "议题类型已删除", {"name": topic_type["name"]}, self.client_address[0])
        return {"message": "议题类型已删除", **self.list_meeting_topics()}

    def create_meeting_topic_option(self):
        self.require_admin()
        data = read_json(self)
        recurrence_type, recurrence_value, recurrence_weeks = normalize_recurrence(data)
        with connect() as conn:
            cursor = conn.execute(
                "INSERT INTO meeting_topic_options(type_id, title, default_detail, owner_id, recurrence_weeks, recurrence_type, recurrence_value, sort_order, active, duration_minutes, expected_output, materials) VALUES(?,?,?,?,?,?,?,?,1,?,?,?)",
                (data.get("type_id"), data.get("title"), data.get("default_detail") or "", data.get("owner_id") or None, recurrence_weeks, recurrence_type, recurrence_value, int(data.get("sort_order") or 0), max(1, min(180, int(data.get("duration_minutes") or 10))), data.get("expected_output") or "", data.get("materials") or ""),
            )
            write_audit(conn, self.current_user(), "meeting_topic_option.create", "meeting_topic_option", cursor.lastrowid, "预设议题已创建", {"title": data.get("title"), "recurrence_type": recurrence_type, "recurrence_value": recurrence_value}, self.client_address[0])
        return {"message": "议题选项已创建", **self.list_meeting_topics()}

    def update_meeting_topic_option(self, option_id):
        admin = self.require_admin()
        data = read_json(self)
        fields = []
        values = []
        for key in ("type_id", "title", "default_detail", "owner_id", "sort_order", "active", "duration_minutes", "expected_output", "materials"):
            if key in data:
                fields.append(f"{key}=?")
                value = data[key] or None if key == "owner_id" else data[key]
                if key == "duration_minutes":
                    value = max(1, min(180, int(value or 10)))
                values.append(value)
        if any(key in data for key in ("recurrence_rule", "recurrence_type", "recurrence_value", "recurrence_weeks")):
            recurrence_type, recurrence_value, recurrence_weeks = normalize_recurrence(data)
            fields.extend(["recurrence_weeks=?", "recurrence_type=?", "recurrence_value=?"])
            values.extend([recurrence_weeks, recurrence_type, recurrence_value])
        if not fields:
            raise AppError(400, "没有可更新字段")
        values.append(option_id)
        with connect() as conn:
            conn.execute(f"UPDATE meeting_topic_options SET {', '.join(fields)} WHERE id=?", values)
            write_audit(conn, admin, "meeting_topic_option.update", "meeting_topic_option", option_id, "预设议题已更新", {"fields": list(data.keys())}, self.client_address[0])
        return {"message": "预设议题已更新", **self.list_meeting_topics()}

    def delete_meeting_topic_option(self, option_id):
        admin = self.require_admin()
        with connect() as conn:
            conn.execute("UPDATE meeting_topic_options SET active=0 WHERE id=?", (option_id,))
            write_audit(conn, admin, "meeting_topic_option.delete", "meeting_topic_option", option_id, "预设议题已删除", {}, self.client_address[0])
        return {"message": "预设议题已删除", **self.list_meeting_topics()}

    def create_meeting_item(self, meeting_id, user):
        data = read_json(self)
        type_id = data.get("type_id") or None
        option_id = data.get("option_id") or None
        section = data.get("section") or "议题"
        title = data.get("title")
        detail = data.get("detail") or ""
        if option_id and user["role"] != "admin":
            raise AppError(403, "普通成员只能添加自定义议题")
        with connect() as conn:
            if option_id:
                option = conn.execute(
                    """
                    SELECT o.*, t.name AS type_name
                    FROM meeting_topic_options o
                    JOIN meeting_topic_types t ON t.id = o.type_id
                    WHERE o.id=?
                    """,
                    (option_id,),
                ).fetchone()
                if option:
                    type_id = option["type_id"]
                    section = option["type_name"]
                    title = title or option["title"]
                    detail = detail or option["default_detail"] or ""
                    if not data.get("owner_id"):
                        data["owner_id"] = option["owner_id"]
                    if not data.get("duration_minutes"):
                        data["duration_minutes"] = option["duration_minutes"] or 10
                    if not data.get("expected_output"):
                        data["expected_output"] = option["expected_output"] or ""
                    if not data.get("materials"):
                        data["materials"] = option["materials"] or ""
            elif type_id:
                topic_type = conn.execute("SELECT name FROM meeting_topic_types WHERE id=?", (type_id,)).fetchone()
                if topic_type:
                    section = topic_type["name"]
            if not title:
                raise AppError(400, "议题标题不能为空")
            meeting = conn.execute("SELECT status FROM meetings WHERE id=?", (meeting_id,)).fetchone()
            if not meeting:
                raise AppError(404, "会议不存在")
            if meeting["status"] in ("completed", "archived"):
                raise AppError(400, "已结束会议不能新增议题，请先重新开启")
            next_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 10 FROM meeting_items WHERE meeting_id=?", (meeting_id,)).fetchone()[0]
            cursor = conn.execute(
                "INSERT INTO meeting_items(meeting_id, section, title, detail, minutes, owner_id, status, due_date, created_by, created_at, type_id, option_id, sort_order, duration_minutes, expected_output, materials) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (meeting_id, section, title, detail, data.get("minutes") or "", data.get("owner_id") or None, data.get("status") or "todo", data.get("due_date") or None, user["id"], now_iso(), type_id, option_id, next_order, max(1, min(180, int(data.get("duration_minutes") or 10))), data.get("expected_output") or "", data.get("materials") or ""),
            )
            link_meeting_topic(conn, meeting_id, type_id, user["id"])
            write_audit(conn, user, "meeting_item.create", "meeting_item", cursor.lastrowid, "会议议题已添加", {"meeting_id": meeting_id, "title": title}, self.client_address[0])
        return {"message": "议题已添加", "meetings": self.list_meetings({})}

    def add_meeting_preset_items(self, meeting_id):
        actor = self.current_user()
        data = read_json(self)
        requested = data.get("items") or []
        if not isinstance(requested, list) or not requested:
            raise AppError(400, "请至少勾选一个预设议题")
        if len(requested) > 100:
            raise AppError(400, "单次最多添加 100 个预设议题")

        normalized = []
        seen = set()
        for item in requested:
            if not isinstance(item, dict):
                continue
            try:
                option_id = int(item.get("option_id"))
            except (TypeError, ValueError):
                continue
            if option_id in seen:
                continue
            owner_id = item.get("owner_id") or None
            if owner_id is not None:
                try:
                    owner_id = int(owner_id)
                except (TypeError, ValueError):
                    raise AppError(400, "责任人数据不正确")
            normalized.append({"option_id": option_id, "owner_id": owner_id})
            seen.add(option_id)
        if not normalized:
            raise AppError(400, "没有可添加的预设议题")

        with connect() as conn:
            meeting = conn.execute("SELECT id, status FROM meetings WHERE id=?", (meeting_id,)).fetchone()
            if not meeting:
                raise AppError(404, "会议不存在")
            if meeting["status"] in ("completed", "archived"):
                raise AppError(400, "已结束会议不能新增议题，请先重新开启")

            existing = {
                row["option_id"]
                for row in conn.execute(
                    "SELECT option_id FROM meeting_items WHERE meeting_id=? AND option_id IS NOT NULL AND deleted_at IS NULL",
                    (meeting_id,),
                ).fetchall()
            }
            valid_owners = {
                row["id"]
                for row in conn.execute("SELECT id FROM users WHERE active=1").fetchall()
            }
            next_order = conn.execute(
                "SELECT COALESCE(MAX(sort_order), 0) + 10 FROM meeting_items WHERE meeting_id=?",
                (meeting_id,),
            ).fetchone()[0]
            added = 0
            skipped = 0
            for requested_item in normalized:
                if requested_item["option_id"] in existing:
                    skipped += 1
                    continue
                option = conn.execute(
                    """
                    SELECT o.*, t.name AS type_name
                    FROM meeting_topic_options o
                    JOIN meeting_topic_types t ON t.id=o.type_id
                    WHERE o.id=? AND o.active=1 AND t.active=1
                    """,
                    (requested_item["option_id"],),
                ).fetchone()
                if not option:
                    skipped += 1
                    continue
                owner_id = requested_item["owner_id"] or option["owner_id"]
                if owner_id is not None and owner_id not in valid_owners:
                    raise AppError(400, f"议题“{option['title']}”的责任人不可用")
                conn.execute(
                    """
                    INSERT INTO meeting_items(
                        meeting_id, section, title, detail, minutes, owner_id, status,
                        due_date, created_by, created_at, type_id, option_id, sort_order,
                        duration_minutes, expected_output, materials
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        meeting_id, option["type_name"], option["title"], option["default_detail"] or "", "",
                        owner_id, "todo", None, actor["id"], now_iso(), option["type_id"], option["id"],
                        next_order, option["duration_minutes"] or 10, option["expected_output"] or "",
                        option["materials"] or "",
                    ),
                )
                link_meeting_topic(conn, meeting_id, option["type_id"], actor["id"])
                existing.add(option["id"])
                next_order += 10
                added += 1
            if not added and skipped:
                raise AppError(409, "所选议题已加入本场会议，请刷新后重新选择")
            write_audit(
                conn, actor, "meeting.agenda_options_add", "meeting", meeting_id,
                "批量加入预设议题", {"added": added, "skipped": skipped}, self.client_address[0],
            )
        message = f"已加入 {added} 个议题"
        if skipped:
            message += f"，跳过 {skipped} 个重复或失效议题"
        return {"message": message, "meetings": self.list_meetings({})}

    def update_meeting_item(self, item_id):
        user = self.current_user()
        data = read_json(self)
        fields = []
        values = []
        for key in ("minutes", "detail", "open_issues", "next_steps", "status", "owner_id", "due_date", "duration_minutes", "expected_output", "materials", "sort_order"):
            if key in data:
                fields.append(f"{key}=?")
                value = data[key] or None if key in ("owner_id", "due_date") else data[key]
                if key == "duration_minutes":
                    value = max(1, min(180, int(value or 10)))
                values.append(value)
        if not fields:
            raise AppError(400, "没有可更新字段")
        values.append(item_id)
        with connect() as conn:
            item = conn.execute("SELECT i.id, m.status AS meeting_status FROM meeting_items i JOIN meetings m ON m.id=i.meeting_id WHERE i.id=? AND i.deleted_at IS NULL", (item_id,)).fetchone()
            if not item:
                raise AppError(404, "议题不存在")
            if item["meeting_status"] in ("completed", "archived"):
                raise AppError(400, "已结束会议内容已锁定，请先重新开启")
            conn.execute(f"UPDATE meeting_items SET {', '.join(fields)} WHERE id=?", values)
            write_audit(conn, user, "meeting_item.update", "meeting_item", item_id, "会议议题/纪要已更新", {"fields": list(data.keys())}, self.client_address[0])
        return {"message": "会议纪要已保存", "meetings": self.list_meetings({})}

    def reorder_meeting_items(self, meeting_id):
        user = self.current_user()
        data = read_json(self)
        item_ids = data.get("item_ids") or []
        try:
            item_ids = [int(item_id) for item_id in item_ids]
        except (TypeError, ValueError):
            raise AppError(400, "议题排序数据不正确")
        if not item_ids:
            raise AppError(400, "没有可排序的议题")
        with connect() as conn:
            meeting = conn.execute("SELECT status FROM meetings WHERE id=?", (meeting_id,)).fetchone()
            if not meeting:
                raise AppError(404, "会议不存在")
            if meeting["status"] in ("completed", "archived"):
                raise AppError(400, "已结束会议内容已锁定")
            valid_ids = {
                row["id"] for row in conn.execute(
                    "SELECT id FROM meeting_items WHERE meeting_id=? AND deleted_at IS NULL", (meeting_id,)
                ).fetchall()
            }
            if set(item_ids) != valid_ids:
                raise AppError(400, "议题排序列表不完整，请刷新后重试")
            for index, item_id in enumerate(item_ids):
                conn.execute("UPDATE meeting_items SET sort_order=? WHERE id=?", ((index + 1) * 10, item_id))
            write_audit(conn, user, "meeting_items.reorder", "meeting", meeting_id, "会议议题顺序已调整", {"item_ids": item_ids}, self.client_address[0])
        return {"message": "议题顺序已保存", "meetings": self.list_meetings({})}

    def carry_forward_meeting_item(self, item_id):
        user = self.current_user()
        with connect() as conn:
            item = conn.execute(
                "SELECT i.*, m.meeting_date, m.title AS meeting_title FROM meeting_items i JOIN meetings m ON m.id=i.meeting_id WHERE i.id=? AND i.deleted_at IS NULL",
                (item_id,),
            ).fetchone()
            if not item:
                raise AppError(404, "议题不存在")
            next_meeting = conn.execute(
                "SELECT id FROM meetings WHERE meeting_date>? AND status NOT IN ('completed','archived') ORDER BY meeting_date, id LIMIT 1",
                (item["meeting_date"],),
            ).fetchone()
            if not next_meeting:
                raise AppError(400, "暂无下一场可承接的会议，请先创建会议")
            existing = conn.execute(
                "SELECT id FROM meeting_items WHERE meeting_id=? AND (carried_from_id=? OR title=?) AND deleted_at IS NULL",
                (next_meeting["id"], item_id, item["title"]),
            ).fetchone()
            if existing:
                raise AppError(400, "该议题已经顺延到下一场会议")
            next_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 10 FROM meeting_items WHERE meeting_id=?", (next_meeting["id"],)).fetchone()[0]
            cursor = conn.execute(
                """
                INSERT INTO meeting_items(
                    meeting_id, section, title, detail, minutes, owner_id, status, due_date,
                    created_by, created_at, type_id, option_id, sort_order, duration_minutes,
                    expected_output, materials, carried_from_id
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    next_meeting["id"], item["section"], item["title"], item["detail"] or "", "",
                    item["owner_id"], "todo", item["due_date"], user["id"], now_iso(), item["type_id"],
                    item["option_id"], next_order, item["duration_minutes"] or 10,
                    item["expected_output"] or "", item["materials"] or "", item_id,
                ),
            )
            link_meeting_topic(conn, next_meeting["id"], item["type_id"], user["id"])
            write_audit(conn, user, "meeting_item.carry_forward", "meeting_item", cursor.lastrowid, "议题已顺延到下一场会议", {"source_item_id": item_id, "target_meeting_id": next_meeting["id"]}, self.client_address[0])
        return {"message": "议题已顺延到下一场会议", "meetings": self.list_meetings({})}

    def delete_meeting_item(self, item_id, user):
        with connect() as conn:
            item = conn.execute(
                "SELECT i.id, i.title, i.deleted_at, m.status AS meeting_status FROM meeting_items i JOIN meetings m ON m.id=i.meeting_id WHERE i.id=?",
                (item_id,),
            ).fetchone()
            if not item:
                raise AppError(404, "议题不存在")
            if item["deleted_at"]:
                raise AppError(400, "议题已经在回收站中")
            if item["meeting_status"] in ("completed", "archived"):
                raise AppError(400, "已结束会议内容已锁定，请先重新开启")
            conn.execute(
                "UPDATE meeting_items SET deleted_at=?, deleted_by=? WHERE id=?",
                (now_iso(), user["id"], item_id),
            )
            add_recycle_record(conn, "meeting_item", item_id, item["title"], user)
            write_audit(
                conn,
                user,
                "meeting_item.delete",
                "meeting_item",
                item_id,
                "会议议题已移入回收站",
                {},
                self.client_address[0],
            )
        return {"message": "会议议题已移入回收站", "meetings": self.list_meetings({})}

    def upsert_attendance(self, meeting_id):
        admin = self.require_admin()
        data = read_json(self)
        status = data.get("status") or "present"
        if status not in ("present", "leave", "absent", "late"):
            raise AppError(400, "参会状态不正确")
        donation_required = 1 if status in ("late", "absent") else 0
        try:
            donation_amount = max(0, float(data.get("donation_amount") or 0)) if donation_required else 0
        except (TypeError, ValueError):
            raise AppError(400, "乐捐金额不正确")
        donation_done = 1 if donation_required and data.get("donation_done") else 0
        with connect() as conn:
            conn.execute(
                """
                INSERT INTO meeting_attendance(meeting_id, user_id, status, donation_required, donation_amount, donation_done, note, updated_by, updated_at)
                VALUES(?,?,?,?,?,?,?,?,?)
                ON CONFLICT(meeting_id, user_id) DO UPDATE SET
                    status=excluded.status,
                    donation_required=excluded.donation_required,
                    donation_amount=excluded.donation_amount,
                    donation_done=excluded.donation_done,
                    note=excluded.note,
                    updated_by=excluded.updated_by,
                    updated_at=excluded.updated_at
                """,
                (meeting_id, data.get("user_id"), status, donation_required, donation_amount, donation_done, data.get("note") or "", admin["id"], now_iso()),
            )
            write_audit(conn, admin, "attendance.upsert", "meeting_attendance", meeting_id, "参会状态已更新", {"meeting_id": meeting_id, "user_id": data.get("user_id"), "status": status, "donation_amount": donation_amount}, self.client_address[0])
        return {"message": "参会状态已更新", "meetings": self.list_meetings({})}

    def list_links(self):
        with connect() as conn:
            links = rows_to_list(
                conn.execute(
                    """
                    SELECT l.*, u.display_name AS creator
                    FROM links l
                    LEFT JOIN users u ON u.id = l.created_by
                    WHERE l.deleted_at IS NULL
                    ORDER BY l.invalid ASC, l.pinned DESC, COALESCE(l.click_count, 0) DESC, COALESCE(l.last_clicked_at, '') DESC, l.title
                    """
                ).fetchall()
            )
        for link in links:
            for key in ("machine_scope", "process_tags"):
                try:
                    link[key] = json.loads(link.get(key) or "[]")
                except json.JSONDecodeError:
                    link[key] = []
        return links

    def create_link(self):
        user = self.current_user()
        data = read_json(self)
        title = (data.get("title") or "").strip()
        url = (data.get("url") or "").strip()
        if not title or not url:
            raise AppError(400, "链接名称和地址不能为空")
        machine_scope = data.get("machine_scope") or []
        process_tags = data.get("process_tags") or []
        if isinstance(machine_scope, str):
            machine_scope = [item.strip() for item in machine_scope.split(",") if item.strip()]
        if isinstance(process_tags, str):
            process_tags = [item.strip() for item in process_tags.split(",") if item.strip()]
        with connect() as conn:
            category = data.get("category")
            if not category:
                first = conn.execute("SELECT name FROM link_categories WHERE active=1 ORDER BY sort_order, id LIMIT 1").fetchone()
                category = first["name"] if first else "通用"
            cursor = conn.execute(
                """
                INSERT INTO links(
                    title, url, category, description, machine_scope, process_tags,
                    pinned, invalid, quality_note, created_by, created_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    title,
                    url,
                    category,
                    data.get("description") or "",
                    json.dumps(machine_scope, ensure_ascii=False),
                    json.dumps(process_tags, ensure_ascii=False),
                    0,
                    0,
                    "",
                    user["id"],
                    now_iso(),
                ),
            )
            write_audit(conn, user, "link.create", "link", cursor.lastrowid, "常用链接已归档", {"title": title, "category": category}, self.client_address[0])
        return {"message": "链接已归档", "links": self.list_links()}

    def normalize_link_items(self, items):
        if isinstance(items, str):
            items = items.replace("，", ",").split(",")
        if not isinstance(items, list):
            return []
        return [str(item).strip() for item in items if str(item).strip()]

    def update_link(self, link_id, user):
        operator = self.require_internal_user(user)
        data = read_json(self)
        fields = []
        values = []
        if operator.get("role") != "admin" and any(key in data for key in ("pinned", "invalid", "quality_note")):
            raise AppError(403, "链接置顶、失效和质量状态仅管理员可维护")
        for key in ("pinned", "invalid"):
            if key in data:
                fields.append(f"{key}=?")
                values.append(1 if data.get(key) in (1, "1", True, "true", "on", "yes", "置顶", "失效") else 0)
        for key in ("title", "url", "quality_note", "description", "category"):
            if key in data:
                value = str(data.get(key) or "").strip()
                if key in ("title", "url") and not value:
                    raise AppError(400, "链接名称和地址不能为空")
                fields.append(f"{key}=?")
                values.append(value)
        for key in ("machine_scope", "process_tags"):
            if key in data:
                items = self.normalize_link_items(data.get(key) or [])
                fields.append(f"{key}=?")
                values.append(json.dumps(items, ensure_ascii=False))
        if not fields:
            raise AppError(400, "没有可更新字段")
        values.append(link_id)
        with connect() as conn:
            link = conn.execute("SELECT id, title FROM links WHERE id=? AND deleted_at IS NULL", (link_id,)).fetchone()
            if not link:
                raise AppError(404, "链接不存在")
            conn.execute(f"UPDATE links SET {', '.join(fields)} WHERE id=?", values)
            write_audit(
                conn,
                operator,
                "link.update",
                "link",
                link_id,
                "常用链接已更新",
                {"title": link["title"], "fields": list(data.keys())},
                self.client_address[0],
            )
        return {"message": "链接已更新", "links": self.list_links()}

    def delete_link(self, link_id, user):
        operator = self.require_internal_user(user)
        with connect() as conn:
            link = conn.execute("SELECT id, title, url, deleted_at FROM links WHERE id=?", (link_id,)).fetchone()
            if not link:
                raise AppError(404, "链接不存在")
            if link["deleted_at"]:
                raise AppError(400, "链接已经在回收站中")
            conn.execute(
                "UPDATE links SET deleted_at=?, deleted_by=? WHERE id=?",
                (now_iso(), operator["id"], link_id),
            )
            add_recycle_record(
                conn,
                "link",
                link_id,
                link["title"],
                operator,
                {"url": link["url"]},
            )
            write_audit(
                conn,
                operator,
                "link.delete",
                "link",
                link_id,
                "常用链接已删除",
                {"title": link["title"]},
                self.client_address[0],
            )
        return {"message": "链接已移入回收站", "links": self.list_links()}

    def list_link_categories(self):
        with connect() as conn:
            return rows_to_list(
                conn.execute(
                    "SELECT * FROM link_categories WHERE active=1 ORDER BY sort_order, id"
                ).fetchall()
            )

    def create_link_category(self):
        self.require_admin()
        data = read_json(self)
        name = (data.get("name") or "").strip()
        if not name:
            raise AppError(400, "分类名称不能为空")
        with connect() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO link_categories(name, sort_order, active, created_at) VALUES(?,?,1,?)",
                (name, int(data.get("sort_order") or 0), now_iso()),
            )
            conn.execute("UPDATE link_categories SET active=1 WHERE name=?", (name,))
            row = conn.execute("SELECT id FROM link_categories WHERE name=?", (name,)).fetchone()
            write_audit(conn, self.current_user(), "link_category.upsert", "link_category", row["id"] if row else None, "链接分类已保存", {"name": name}, self.client_address[0])
        return {"message": "链接分类已保存", "categories": self.list_link_categories()}

    def list_machines(self):
        with connect() as conn:
            return rows_to_list(conn.execute("SELECT * FROM machines ORDER BY name").fetchall())

    def create_machine(self):
        admin = self.require_admin()
        data = read_json(self)
        with connect() as conn:
            cursor = conn.execute("INSERT INTO machines(name, description) VALUES(?,?)", (data.get("name"), data.get("description") or ""))
            write_audit(conn, admin, "machine.create", "machine", cursor.lastrowid, "机台已创建", {"name": data.get("name")}, self.client_address[0])
        return {"message": "机台已创建", "machines": self.list_machines()}

    def delete_machine(self, machine_id):
        admin = self.require_admin()
        with connect() as conn:
            machine = conn.execute("SELECT * FROM machines WHERE id=?", (machine_id,)).fetchone()
            if not machine:
                raise AppError(404, "机台不存在")
            shift_count = conn.execute("SELECT COUNT(*) AS count FROM shifts WHERE machine_id=?", (machine_id,)).fetchone()["count"]
            conn.execute("DELETE FROM shifts WHERE machine_id=?", (machine_id,))
            conn.execute("DELETE FROM machines WHERE id=?", (machine_id,))
            write_audit(
                conn,
                admin,
                "machine.delete",
                "machine",
                machine_id,
                "机台已删除",
                {"name": machine["name"], "deleted_shifts": shift_count},
                self.client_address[0],
            )
        return {"message": "机台已删除", "machines": self.list_machines()}

    def list_shifts(self, query):
        where, params = date_filter(query, "s.shift_date")
        with connect() as conn:
            return rows_to_list(
                conn.execute(
                    f"""
                    SELECT s.*, u.display_name, m.name AS machine_name
                    FROM shifts s
                    JOIN users u ON u.id = s.user_id
                    JOIN machines m ON m.id = s.machine_id
                    WHERE {where}
                    ORDER BY s.shift_date DESC, m.name, s.shift_type
                    """,
                    params,
                ).fetchall()
            )

    def create_shift(self):
        admin = self.require_admin()
        data = read_json(self)
        dates = data.get("shift_dates")
        if isinstance(dates, str):
            dates = [item.strip() for item in dates.replace("\n", ",").split(",") if item.strip()]
        if not dates:
            start = data.get("shift_start_date") or data.get("shift_date") or today_iso()
            end = data.get("shift_end_date") or start
            dates = date_range(start, end)
        dates = list(dict.fromkeys(dates))
        machine_id = int(data.get("machine_id") or 0)
        user_id = int(data.get("user_id") or 0)
        shift_type = data.get("shift_type")
        if shift_type not in ("day", "night"):
            raise AppError(400, "班次类型不正确")
        with connect() as conn:
            default_hours = get_float_setting(conn, "shift_default_hours", 12, minimum=0.5, maximum=24)
            max_daily_hours = get_float_setting(conn, "shift_max_daily_hours", 24, minimum=1, maximum=48)
            hours = float(data.get("hours") or default_hours)
            if hours <= 0 or hours > 24:
                raise AppError(400, "单条排班工时需要在 0 到 24 小时之间")
            machine = conn.execute("SELECT id, name FROM machines WHERE id=?", (machine_id,)).fetchone()
            member = conn.execute("SELECT id, display_name FROM users WHERE id=? AND active=1", (user_id,)).fetchone()
            if not machine or not member:
                raise AppError(404, "机台或排班成员不存在")
            conflicts = []
            for shift_date in dates:
                try:
                    dt.date.fromisoformat(shift_date)
                except ValueError:
                    raise AppError(400, f"排班日期格式不正确：{shift_date}")
                duplicate = conn.execute(
                    """
                    SELECT id FROM shifts
                    WHERE machine_id=? AND user_id=? AND shift_type=? AND shift_date=?
                    """,
                    (machine_id, user_id, shift_type, shift_date),
                ).fetchone()
                daily_hours = conn.execute(
                    "SELECT COALESCE(SUM(hours), 0) FROM shifts WHERE user_id=? AND shift_date=?",
                    (user_id, shift_date),
                ).fetchone()[0]
                if duplicate:
                    conflicts.append(f"{shift_date} 已有相同机台、成员和班次")
                elif float(daily_hours or 0) + hours > max_daily_hours:
                    conflicts.append(f"{shift_date} 累计 {float(daily_hours or 0) + hours:g} 小时，超过上限 {max_daily_hours:g} 小时")
            if conflicts:
                detail = "；".join(conflicts[:6])
                if len(conflicts) > 6:
                    detail += f"；另有 {len(conflicts) - 6} 天冲突"
                raise AppError(409, f"排班未保存：{detail}")
            created_ids = []
            for shift_date in dates:
                cursor = conn.execute(
                    "INSERT INTO shifts(machine_id, user_id, shift_type, shift_date, hours, note, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)",
                    (machine_id, user_id, shift_type, shift_date, hours, data.get("note") or "", admin["id"], now_iso()),
                )
                created_ids.append(cursor.lastrowid)
            write_audit(conn, admin, "shift.create", "shift", created_ids[0] if len(created_ids) == 1 else None, "排班已保存", {"dates": dates, "count": len(created_ids), "user_id": user_id}, self.client_address[0])
        return {"message": "排班已保存", "shifts": self.list_shifts({})}

    def delete_shift(self, shift_id):
        admin = self.require_admin()
        with connect() as conn:
            shift = conn.execute("SELECT * FROM shifts WHERE id=?", (shift_id,)).fetchone()
            if not shift:
                raise AppError(404, "排班不存在")
            conn.execute("DELETE FROM shifts WHERE id=?", (shift_id,))
            write_audit(conn, admin, "shift.delete", "shift", shift_id, "排班已删除", {"shift_date": shift["shift_date"], "user_id": shift["user_id"]}, self.client_address[0])
        return {"message": "排班已删除", "shifts": self.list_shifts({})}

    def shift_dashboard(self, query):
        where, params = date_filter(query, "s.shift_date")
        with connect() as conn:
            by_user = rows_to_list(
                conn.execute(
                    f"""
                    SELECT u.id, u.display_name, SUM(s.hours) AS hours, COUNT(*) AS shift_count
                    FROM shifts s
                    JOIN users u ON u.id = s.user_id
                    WHERE {where}
                    GROUP BY u.id
                    ORDER BY hours DESC
                    """,
                    params,
                ).fetchall()
            )
            by_machine = rows_to_list(
                conn.execute(
                    f"""
                    SELECT m.name AS machine_name, SUM(s.hours) AS hours, COUNT(*) AS shift_count
                    FROM shifts s
                    JOIN machines m ON m.id = s.machine_id
                    WHERE {where}
                    GROUP BY m.id
                    ORDER BY m.name
                    """,
                    params,
                ).fetchall()
            )
        return {"by_user": by_user, "by_machine": by_machine}

    def list_thank_you(self, query):
        where, params = date_filter(query, "v.week_start")
        with connect() as conn:
            return rows_to_list(
                conn.execute(
                    f"""
                    SELECT v.*, giver.display_name AS voter_name, receiver.display_name AS receiver_name
                    FROM thank_you_votes v
                    JOIN users giver ON giver.id = v.voter_id
                    JOIN users receiver ON receiver.id = v.receiver_id
                    WHERE {where}
                    ORDER BY v.week_start DESC, v.created_at DESC
                    """,
                    params,
                ).fetchall()
            )

    def create_thank_you(self, user):
        data = read_json(self)
        raw_receiver_ids = data.get("receiver_ids")
        if raw_receiver_ids is None:
            raw_receiver_ids = [data.get("receiver_id")]
        if not isinstance(raw_receiver_ids, list):
            raw_receiver_ids = [raw_receiver_ids]
        receiver_ids = []
        for raw_id in raw_receiver_ids:
            try:
                receiver_id = int(raw_id)
            except (TypeError, ValueError):
                continue
            if receiver_id not in receiver_ids:
                receiver_ids.append(receiver_id)
        if not receiver_ids:
            raise AppError(400, "请选择感谢对象")
        if user["id"] in receiver_ids:
            raise AppError(400, "不能给自己点赞")
        start = week_start(data.get("week_start") or today_iso())
        evidence = (data.get("evidence") or "").strip()
        if len(evidence) < 5:
            raise AppError(400, "请写下具体事实依据")
        with connect() as conn:
            weekly_limit = get_int_setting(conn, "thank_you_weekly_limit", 3, minimum=1, maximum=20)
            count = conn.execute("SELECT COUNT(*) FROM thank_you_votes WHERE voter_id=? AND week_start=?", (user["id"], start)).fetchone()[0]
            remaining = weekly_limit - count
            if remaining <= 0 or len(receiver_ids) > remaining:
                raise AppError(400, f"本周最多点赞 {weekly_limit} 人，当前还可感谢 {max(remaining, 0)} 人")
            placeholders = ",".join("?" for _ in receiver_ids)
            active_receivers = rows_to_list(
                conn.execute(
                    f"""
                    SELECT u.id, u.display_name FROM users u
                    LEFT JOIN user_types t ON t.key=u.user_type
                    WHERE u.active=1 AND COALESCE(t.include_in_thanks, 1)=1
                      AND u.id IN ({placeholders})
                    """,
                    receiver_ids,
                ).fetchall()
            )
            active_receiver_ids = {row["id"] for row in active_receivers}
            if len(active_receiver_ids) != len(receiver_ids):
                raise AppError(400, "感谢对象不存在或已停用")
            existing = rows_to_list(
                conn.execute(
                    f"""
                    SELECT v.receiver_id, u.display_name
                    FROM thank_you_votes v
                    JOIN users u ON u.id = v.receiver_id
                    WHERE v.voter_id=? AND v.week_start=? AND v.receiver_id IN ({placeholders})
                    """,
                    [user["id"], start, *receiver_ids],
                ).fetchall()
            )
            if existing:
                names = "、".join(row["display_name"] for row in existing)
                raise AppError(400, f"本周已经感谢过：{names}")
            created_at = now_iso()
            for receiver_id in receiver_ids:
                conn.execute(
                    "INSERT INTO thank_you_votes(voter_id, receiver_id, week_start, evidence, created_at) VALUES(?,?,?,?,?)",
                    (user["id"], receiver_id, start, evidence, created_at),
                )
            write_audit(conn, user, "thank_you.create", "thank_you", None, "Thank You 已送达", {"receiver_ids": receiver_ids, "week_start": start}, self.client_address[0])
        return {"message": "Thank You 已送达", "votes": self.list_thank_you({"from": [start], "to": [start]})}

    def can_manage_thank_vote(self, vote, user):
        if user["role"] == "admin":
            return True
        return vote["voter_id"] == user["id"] and str(vote["created_at"] or "")[:10] == today_iso()

    def update_thank_you(self, vote_id, user):
        data = read_json(self)
        evidence = (data.get("evidence") or "").strip()
        if len(evidence) < 5:
            raise AppError(400, "请写下具体事实依据")
        with connect() as conn:
            vote = conn.execute("SELECT * FROM thank_you_votes WHERE id=?", (vote_id,)).fetchone()
            if not vote:
                raise AppError(404, "感谢记录不存在")
            if not self.can_manage_thank_vote(vote, user):
                raise AppError(403, "仅可编辑当天自己送出的感谢")
            conn.execute("UPDATE thank_you_votes SET evidence=? WHERE id=?", (evidence, vote_id))
            write_audit(conn, user, "thank_you.update", "thank_you", vote_id, "Thank You 记录已更新", {"week_start": vote["week_start"]}, self.client_address[0])
        return {"message": "感谢记录已更新"}

    def delete_thank_you(self, vote_id, user):
        with connect() as conn:
            vote = conn.execute(
                """
                SELECT v.*, giver.display_name AS voter_name, receiver.display_name AS receiver_name
                FROM thank_you_votes v
                JOIN users giver ON giver.id = v.voter_id
                JOIN users receiver ON receiver.id = v.receiver_id
                WHERE v.id=?
                """,
                (vote_id,),
            ).fetchone()
            if not vote:
                raise AppError(404, "感谢记录不存在")
            if not self.can_manage_thank_vote(vote, user):
                raise AppError(403, "仅可删除当天自己送出的感谢")
            conn.execute("DELETE FROM thank_you_votes WHERE id=?", (vote_id,))
            write_audit(
                conn,
                user,
                "thank_you.delete",
                "thank_you",
                vote_id,
                "Thank You 记录已删除",
                {
                    "voter_id": vote["voter_id"],
                    "receiver_id": vote["receiver_id"],
                    "week_start": vote["week_start"],
                    "voter_name": vote["voter_name"],
                    "receiver_name": vote["receiver_name"],
                },
                self.client_address[0],
            )
        return {"message": "感谢记录已删除"}

    def thank_you_dashboard(self, query):
        where, params = date_filter(query, "v.week_start")
        with connect() as conn:
            stars = rows_to_list(
                conn.execute(
                    f"""
                    SELECT receiver.id, receiver.display_name, COUNT(*) AS thanks
                    FROM thank_you_votes v
                    JOIN users receiver ON receiver.id = v.receiver_id
                    LEFT JOIN user_types t ON t.key=receiver.user_type
                    WHERE {where} AND receiver.active=1 AND COALESCE(t.include_in_thanks, 1)=1
                    GROUP BY receiver.id
                    ORDER BY thanks DESC, receiver.display_name
                    """,
                    params,
                ).fetchall()
            )
            weekly = rows_to_list(
                conn.execute(
                    f"""
                    SELECT v.week_start, COUNT(*) AS thanks
                    FROM thank_you_votes v
                    JOIN users receiver ON receiver.id=v.receiver_id
                    LEFT JOIN user_types t ON t.key=receiver.user_type
                    WHERE {where} AND receiver.active=1 AND COALESCE(t.include_in_thanks, 1)=1
                    GROUP BY v.week_start
                    ORDER BY v.week_start
                    """,
                    params,
                ).fetchall()
            )
        return {"stars": stars, "weekly": weekly}

    def list_reminders(self, user):
        if not user:
            raise AppError(401, "请先登录")
        today = dt.date.today()
        soon = (today + dt.timedelta(days=3)).isoformat()
        today_value = today.isoformat()
        with connect() as conn:
            reminders = []
            morning_rows = rows_to_list(
                conn.execute(
                    """
                    SELECT id, title, status, priority, blocker, due_date, item_date, updated_at
                    FROM morning_items
                    WHERE owner_id=? AND active=1 AND status!='done'
                      AND item_date=?
                      AND (status='risk' OR priority='high' OR (due_date IS NOT NULL AND due_date<=?))
                    ORDER BY CASE WHEN status='risk' THEN 0 ELSE 1 END, due_date, id
                    """,
                    (user["id"], today_value, soon),
                ).fetchall()
            )
            for item in morning_rows:
                overdue = bool(item.get("due_date") and item["due_date"] < today_value)
                reminders.append({
                    "key": f"morning:{item['id']}:{item.get('updated_at') or ''}",
                    "type": "morning",
                    "level": "danger" if overdue or item["status"] == "risk" else "warning",
                    "title": item["title"],
                    "detail": item.get("blocker") or (f"截止 {item['due_date']}" if item.get("due_date") else "高优先级事项待推进"),
                    "date": item.get("due_date") or item["item_date"],
                    "page": "morning",
                })
            meeting_rows = rows_to_list(
                conn.execute(
                    """
                    SELECT i.id, i.title, i.status, i.due_date, m.meeting_date, m.title AS meeting_title
                    FROM meeting_items i
                    JOIN meetings m ON m.id=i.meeting_id
                    WHERE i.owner_id=? AND i.deleted_at IS NULL AND i.status!='done'
                      AND (
                        (i.due_date IS NOT NULL AND i.due_date<=?)
                        OR (m.meeting_date>=? AND m.meeting_date<=?)
                      )
                    ORDER BY COALESCE(i.due_date, m.meeting_date), i.id
                    """,
                    (user["id"], soon, today_value, soon),
                ).fetchall()
            )
            for item in meeting_rows:
                due_date = item.get("due_date") or item["meeting_date"]
                overdue = bool(item.get("due_date") and item["due_date"] < today_value)
                reminders.append({
                    "key": f"meeting-item:{item['id']}:{item.get('due_date') or ''}:{item['status']}",
                    "type": "meeting",
                    "level": "danger" if overdue else "info",
                    "title": item["title"],
                    "detail": f"{item['meeting_title']} · {'已逾期' if overdue else '行动项待处理'}",
                    "date": due_date,
                    "page": "meetings",
                })
            shift_rows = rows_to_list(
                conn.execute(
                    """
                    SELECT s.id, s.shift_date, s.shift_type, m.name AS machine_name
                    FROM shifts s
                    JOIN machines m ON m.id=s.machine_id
                    WHERE s.user_id=? AND s.shift_date>=? AND s.shift_date<=?
                    ORDER BY s.shift_date, s.shift_type
                    """,
                    (user["id"], today_value, soon),
                ).fetchall()
            )
            for shift in shift_rows:
                shift_name = "白班" if shift["shift_type"] == "day" else "夜班"
                reminders.append({
                    "key": f"shift:{shift['id']}:{shift['shift_date']}:{shift['shift_type']}",
                    "type": "shift",
                    "level": "info",
                    "title": f"{shift['machine_name']} · {shift_name}",
                    "detail": "近期排班，请提前确认交接安排",
                    "date": shift["shift_date"],
                    "page": "shifts",
                })
            read_keys = {
                row["reminder_key"]
                for row in conn.execute(
                    "SELECT reminder_key FROM reminder_reads WHERE user_id=?",
                    (user["id"],),
                ).fetchall()
            }
        allowed_pages = set(permissions_for(user).get("modules") or [])
        reminders = [item for item in reminders if item.get("page") in allowed_pages]
        level_order = {"danger": 0, "warning": 1, "info": 2}
        reminders.sort(key=lambda item: (level_order.get(item["level"], 9), item.get("date") or "", item["title"]))
        for reminder in reminders:
            reminder["read"] = reminder["key"] in read_keys
        return {
            "items": reminders,
            "unread": sum(1 for reminder in reminders if not reminder["read"]),
        }

    def mark_reminders_read(self, user):
        if not user:
            raise AppError(401, "请先登录")
        data = read_json(self)
        keys = data.get("keys") or []
        if data.get("all"):
            keys = [item["key"] for item in self.list_reminders(user)["items"]]
        if isinstance(keys, str):
            keys = [keys]
        if not isinstance(keys, list):
            raise AppError(400, "提醒标识格式不正确")
        keys = [str(key)[:240] for key in keys if str(key).strip()]
        with connect() as conn:
            for key in keys:
                conn.execute(
                    """
                    INSERT INTO reminder_reads(user_id, reminder_key, read_at)
                    VALUES(?,?,?)
                    ON CONFLICT(user_id, reminder_key) DO UPDATE SET read_at=excluded.read_at
                    """,
                    (user["id"], key, now_iso()),
                )
        return self.list_reminders(user)

    def list_recycle_bin(self):
        self.require_admin()
        with connect() as conn:
            items = rows_to_list(
                conn.execute(
                    """
                    SELECT r.*, u.display_name AS deleted_by_name
                    FROM recycle_bin r
                    LEFT JOIN users u ON u.id=r.deleted_by
                    WHERE r.status='deleted'
                    ORDER BY r.deleted_at DESC, r.id DESC
                    """
                ).fetchall()
            )
        labels = {
            "user": "用户",
            "link": "常用链接",
            "team_post": "讨论主题",
            "team_reply": "团队回复",
            "meeting_item": "会议议题",
        }
        for item in items:
            item["entity_label"] = labels.get(item["entity_type"], item["entity_type"])
            try:
                item["payload"] = json.loads(item.get("payload") or "{}")
            except json.JSONDecodeError:
                item["payload"] = {}
            item["can_purge"] = item["entity_type"] != "user"
        return items

    def restore_recycle_item(self, recycle_id):
        admin = self.require_admin()
        with connect() as conn:
            item = conn.execute(
                "SELECT * FROM recycle_bin WHERE id=? AND status='deleted'",
                (recycle_id,),
            ).fetchone()
            if not item:
                raise AppError(404, "回收站记录不存在")
            payload = json.loads(item["payload"] or "{}")
            entity_type = item["entity_type"]
            if entity_type == "link":
                conn.execute("UPDATE links SET deleted_at=NULL, deleted_by=NULL WHERE id=?", (item["entity_id"],))
            elif entity_type == "meeting_item":
                conn.execute("UPDATE meeting_items SET deleted_at=NULL, deleted_by=NULL WHERE id=?", (item["entity_id"],))
            elif entity_type == "team_post":
                conn.execute("UPDATE team_posts SET deleted_at=NULL, deleted_by=NULL WHERE id=?", (item["entity_id"],))
            elif entity_type == "team_reply":
                reply_ids = [int(value) for value in payload.get("reply_ids") or [item["entity_id"]]]
                placeholders = ",".join("?" for _ in reply_ids)
                conn.execute(
                    f"UPDATE team_post_replies SET deleted_at=NULL, deleted_by=NULL WHERE id IN ({placeholders})",
                    reply_ids,
                )
            elif entity_type == "user":
                conn.execute("UPDATE users SET active=1 WHERE id=?", (item["entity_id"],))
                conn.execute("UPDATE members SET active=1 WHERE user_id=?", (item["entity_id"],))
            else:
                raise AppError(400, "该类型暂不支持恢复")
            conn.execute(
                "UPDATE recycle_bin SET status='restored', resolved_by=?, resolved_at=? WHERE id=?",
                (admin["id"], now_iso(), recycle_id),
            )
            write_audit(conn, admin, "recycle.restore", entity_type, item["entity_id"], "回收站内容已恢复", {"recycle_id": recycle_id}, self.client_address[0])
        return {"message": "内容已恢复", "items": self.list_recycle_bin()}

    def purge_recycle_item(self, recycle_id):
        admin = self.require_admin()
        with connect() as conn:
            item = conn.execute(
                "SELECT * FROM recycle_bin WHERE id=? AND status='deleted'",
                (recycle_id,),
            ).fetchone()
            if not item:
                raise AppError(404, "回收站记录不存在")
            if item["entity_type"] == "user":
                raise AppError(400, "用户历史记录需要保留，只能停用或恢复账号")
            payload = json.loads(item["payload"] or "{}")
            if item["entity_type"] == "link":
                conn.execute("DELETE FROM links WHERE id=?", (item["entity_id"],))
            elif item["entity_type"] == "meeting_item":
                conn.execute("DELETE FROM meeting_items WHERE id=?", (item["entity_id"],))
            elif item["entity_type"] == "team_post":
                conn.execute("DELETE FROM team_posts WHERE id=?", (item["entity_id"],))
            elif item["entity_type"] == "team_reply":
                reply_ids = [int(value) for value in payload.get("reply_ids") or [item["entity_id"]]]
                placeholders = ",".join("?" for _ in reply_ids)
                conn.execute(f"DELETE FROM team_reply_reactions WHERE reply_id IN ({placeholders})", reply_ids)
                conn.execute(f"DELETE FROM team_post_replies WHERE id IN ({placeholders})", reply_ids)
            else:
                raise AppError(400, "该类型暂不支持彻底删除")
            conn.execute(
                "UPDATE recycle_bin SET status='purged', resolved_by=?, resolved_at=? WHERE id=?",
                (admin["id"], now_iso(), recycle_id),
            )
            write_audit(conn, admin, "recycle.purge", item["entity_type"], item["entity_id"], "回收站内容已彻底删除", {"recycle_id": recycle_id}, self.client_address[0])
        return {"message": "内容已彻底删除", "items": self.list_recycle_bin()}

    def can_view_module(self, user, module_key):
        try:
            self.require_module(user, module_key, "view")
            return True
        except AppError:
            return False

    def archive_years(self, user):
        sources = [
            ("meetings", "会议", "meetings", "meeting_date", "1=1"),
            ("meeting_items", "会议议题", "meeting_items", "created_at", "deleted_at IS NULL"),
            ("team_posts", "团队讨论", "team_posts", "created_at", "deleted_at IS NULL"),
            ("team_replies", "团队回复", "team_post_replies", "created_at", "deleted_at IS NULL AND post_id IN (SELECT id FROM team_posts WHERE deleted_at IS NULL)"),
            ("morning", "早例会事项", "morning_items", "item_date", "active=1"),
        ]
        allowed = {
            "meetings": self.can_view_module(user, "meetings"),
            "meeting_items": self.can_view_module(user, "meetings"),
            "team_posts": self.can_view_module(user, "members"),
            "team_replies": self.can_view_module(user, "members"),
            "morning": self.can_view_module(user, "morning"),
        }
        year_map = {}
        with connect() as conn:
            for key, label, table, date_col, where in sources:
                if not allowed.get(key):
                    continue
                rows = conn.execute(
                    f"""
                    SELECT substr({date_col}, 1, 4) AS year, COUNT(*) AS count
                    FROM {table}
                    WHERE {where} AND {date_col} IS NOT NULL AND length({date_col}) >= 4
                    GROUP BY substr({date_col}, 1, 4)
                    """
                ).fetchall()
                for row in rows:
                    year = row["year"]
                    if not year or not str(year).isdigit():
                        continue
                    bucket = year_map.setdefault(year, {"year": year, "total": 0, "types": {}})
                    bucket["types"][key] = {"label": label, "count": row["count"]}
                    bucket["total"] += int(row["count"] or 0)
        return {"years": sorted(year_map.values(), key=lambda item: item["year"], reverse=True)}

    def search_archive(self, user, query):
        keyword = (query.get("keyword") or [""])[0].strip()
        year = (query.get("year") or [""])[0].strip()
        type_filter = (query.get("type") or ["all"])[0].strip() or "all"
        limit = min(80, max(10, int((query.get("limit") or ["40"])[0] or 40)))
        if len(keyword) > 80:
            raise AppError(400, "搜索关键词最多 80 个字符")
        if year and (not year.isdigit() or len(year) != 4):
            raise AppError(400, "年份格式不正确")
        allowed_types = {"all", "meetings", "meeting_items", "team_posts", "team_replies", "morning"}
        if type_filter not in allowed_types:
            type_filter = "all"
        like = f"%{keyword}%"
        results = []

        def wants(item_type):
            return type_filter == "all" or type_filter == item_type

        def in_year(column):
            return f" AND substr({column}, 1, 4)=?" if year else ""

        def add_result(item_type, label, item_id, title, body, item_date, owner="", module=""):
            text = " ".join([str(title or ""), str(body or ""), str(owner or "")]).strip()
            if keyword and keyword.lower() not in text.lower():
                return
            results.append({
                "type": item_type,
                "type_label": label,
                "id": item_id,
                "title": title or label,
                "body": (body or "")[:500],
                "date": item_date or "",
                "owner": owner or "",
                "module": module,
            })

        with connect() as conn:
            if wants("meetings") and self.can_view_module(user, "meetings"):
                params = []
                where = "1=1"
                if keyword:
                    where += " AND (m.title LIKE ? OR COALESCE(m.summary, '') LIKE ?)"
                    params.extend([like, like])
                if year:
                    where += in_year("m.meeting_date")
                    params.append(year)
                rows = rows_to_list(conn.execute(
                    f"""
                    SELECT m.id, m.title, m.summary, m.meeting_date, u.display_name AS owner
                    FROM meetings m
                    LEFT JOIN users u ON u.id = m.created_by
                    WHERE {where}
                    ORDER BY m.meeting_date DESC, m.id DESC
                    LIMIT ?
                    """,
                    [*params, limit],
                ).fetchall())
                for row in rows:
                    add_result("meetings", "会议", row["id"], row["title"], row.get("summary"), row["meeting_date"], row.get("owner"), "meetings")

            if wants("meeting_items") and self.can_view_module(user, "meetings"):
                params = []
                where = "i.deleted_at IS NULL"
                if keyword:
                    where += " AND (i.title LIKE ? OR COALESCE(i.detail, '') LIKE ? OR COALESCE(i.minutes, '') LIKE ? OR COALESCE(i.open_issues, '') LIKE ? OR COALESCE(i.next_steps, '') LIKE ?)"
                    params.extend([like, like, like, like, like])
                if year:
                    where += in_year("m.meeting_date")
                    params.append(year)
                rows = rows_to_list(conn.execute(
                    f"""
                    SELECT i.id, i.title, i.detail, i.minutes, i.open_issues, i.next_steps, m.meeting_date, COALESCE(u.display_name, '') AS owner
                    FROM meeting_items i
                    JOIN meetings m ON m.id = i.meeting_id
                    LEFT JOIN users u ON u.id = i.owner_id
                    WHERE {where}
                    ORDER BY m.meeting_date DESC, i.id DESC
                    LIMIT ?
                    """,
                    [*params, limit],
                ).fetchall())
                for row in rows:
                    body = "；".join(filter(None, [row.get("detail"), row.get("minutes"), row.get("open_issues"), row.get("next_steps")]))
                    add_result("meeting_items", "会议议题", row["id"], row["title"], body, row["meeting_date"], row.get("owner"), "meetings")

            if wants("team_posts") and self.can_view_module(user, "members"):
                params = []
                where = "p.deleted_at IS NULL"
                if keyword:
                    where += " AND (COALESCE(p.title, '') LIKE ? OR p.content LIKE ? OR COALESCE(p.category, '') LIKE ? OR u.display_name LIKE ?)"
                    params.extend([like, like, like, like])
                if year:
                    where += in_year("p.created_at")
                    params.append(year)
                rows = rows_to_list(conn.execute(
                    f"""
                    SELECT p.id, p.kind, p.category, p.title, p.content, p.created_at, u.display_name AS owner
                    FROM team_posts p
                    JOIN users u ON u.id = p.user_id
                    WHERE {where}
                    ORDER BY p.created_at DESC, p.id DESC
                    LIMIT ?
                    """,
                    [*params, limit],
                ).fetchall())
                for row in rows:
                    add_result("team_posts", "团队讨论", row["id"], row.get("title") or row.get("category") or "讨论主题", row["content"], row["created_at"], row.get("owner"), "members")

            if wants("team_replies") and self.can_view_module(user, "members"):
                params = []
                where = "r.deleted_at IS NULL AND p.deleted_at IS NULL"
                if keyword:
                    where += " AND (r.content LIKE ? OR u.display_name LIKE ?)"
                    params.extend([like, like])
                if year:
                    where += in_year("r.created_at")
                    params.append(year)
                rows = rows_to_list(conn.execute(
                    f"""
                    SELECT r.id, r.content, r.created_at, u.display_name AS owner
                    FROM team_post_replies r
                    JOIN team_posts p ON p.id = r.post_id
                    JOIN users u ON u.id = r.user_id
                    WHERE {where}
                    ORDER BY r.created_at DESC, r.id DESC
                    LIMIT ?
                    """,
                    [*params, limit],
                ).fetchall())
                for row in rows:
                    add_result("team_replies", "团队回复", row["id"], "回复", row["content"], row["created_at"], row.get("owner"), "members")

            if wants("morning") and self.can_view_module(user, "morning"):
                params = []
                where = "i.active=1"
                if keyword:
                    where += " AND (i.title LIKE ? OR COALESCE(i.detail, '') LIKE ? OR COALESCE(i.blocker, '') LIKE ? OR u.display_name LIKE ?)"
                    params.extend([like, like, like, like])
                if year:
                    where += in_year("i.item_date")
                    params.append(year)
                rows = rows_to_list(conn.execute(
                    f"""
                    SELECT i.id, i.title, i.detail, i.blocker, i.item_date, u.display_name AS owner
                    FROM morning_items i
                    JOIN users u ON u.id = i.owner_id
                    WHERE {where}
                    ORDER BY i.item_date DESC, i.id DESC
                    LIMIT ?
                    """,
                    [*params, limit],
                ).fetchall())
                for row in rows:
                    body = "；".join(filter(None, [row.get("detail"), row.get("blocker")]))
                    add_result("morning", "早例会事项", row["id"], row["title"], body, row["item_date"], row.get("owner"), "morning")

        results.sort(key=lambda item: (item.get("date") or "", item.get("id") or 0), reverse=True)
        return {"results": results[:limit], "keyword": keyword, "year": year, "type": type_filter}

    def backup_path_from_payload(self):
        data = read_json(self)
        filename = (data.get("filename") or "").strip()
        if not filename or "/" in filename or "\\" in filename or not filename.endswith(".db"):
            raise AppError(400, "备份文件名不合法")
        file_path = (BACKUP_DIR / filename).resolve()
        if BACKUP_DIR.resolve() not in file_path.parents or not file_path.exists():
            raise AppError(404, "备份文件不存在")
        return filename, file_path

    def inspect_backup_file(self, file_path):
        required_tables = ["users", "members", "meetings", "meeting_items", "team_posts", "morning_items", "backups"]
        try:
            with sqlite3.connect(file_path) as conn:
                conn.row_factory = sqlite3.Row
                quick_check = conn.execute("PRAGMA quick_check").fetchone()[0]
                if quick_check != "ok":
                    return False, f"完整性检查失败：{quick_check}", {}
                tables = {
                    row["name"]
                    for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
                }
                missing = [table for table in required_tables if table not in tables]
                if missing:
                    return False, f"缺少关键表：{', '.join(missing)}", {}
                counts = {
                    table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                    for table in required_tables
                }
                return True, "备份可正常打开，关键表完整", counts
        except sqlite3.Error as exc:
            return False, f"备份无法读取：{exc}", {}

    def update_backup_check_result(self, filename, ok, message, extra=None):
        file_path = BACKUP_DIR / filename
        size = file_path.stat().st_size if file_path.exists() else 0
        with connect() as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO backups(filename, size_bytes, kind, created_at)
                VALUES(?,?,?,?)
                """,
                (filename, size, "manual", now_iso()),
            )
            conn.execute(
                """
                UPDATE backups
                SET verify_status=?, verified_at=?, verify_message=?
                WHERE filename=?
                """,
                ("ok" if ok else "failed", now_iso(), message, filename),
            )

    def verify_backup(self):
        admin = self.require_admin()
        filename, file_path = self.backup_path_from_payload()
        ok, message, counts = self.inspect_backup_file(file_path)
        self.update_backup_check_result(filename, ok, message, counts)
        with connect() as conn:
            write_audit(
                conn,
                admin,
                "backup.verify",
                "backup",
                None,
                "备份校验通过" if ok else "备份校验失败",
                {"filename": filename, "message": message, "counts": counts},
                self.client_address[0],
            )
        return {"ok": ok, "message": message, "counts": counts, "backups": self.list_backups()}

    def restore_backup(self):
        admin = self.require_admin()
        filename, file_path = self.backup_path_from_payload()
        ok, message, counts = self.inspect_backup_file(file_path)
        self.update_backup_check_result(filename, ok, message, counts)
        if not ok:
            raise AppError(400, f"备份校验未通过，已取消恢复：{message}")
        pre_restore = create_database_backup(kind="manual", user_id=admin["id"])
        try:
            with sqlite3.connect(file_path) as source, sqlite3.connect(DB_PATH) as dest:
                source.backup(dest)
            init_db()
            restore_message = f"已恢复到备份 {filename}；恢复前备份：{pre_restore['filename'] if pre_restore else '未生成'}"
            with connect() as conn:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO backups(filename, size_bytes, kind, created_at, verify_status, verified_at, verify_message)
                    VALUES(?,?,?,?,?,?,?)
                    """,
                    (filename, file_path.stat().st_size, "manual", now_iso(), "ok", now_iso(), message),
                )
                conn.execute(
                    """
                    UPDATE backups
                    SET restored_at=?, restored_by=?, restore_message=?
                    WHERE filename=?
                    """,
                    (now_iso(), admin["id"], restore_message, filename),
                )
                write_audit(
                    conn,
                    admin,
                    "backup.restore",
                    "backup",
                    None,
                    "数据库已按指定备份恢复",
                    {"filename": filename, "pre_restore": pre_restore, "counts": counts},
                    self.client_address[0],
                )
        except Exception as exc:
            with connect() as conn:
                conn.execute(
                    "UPDATE backups SET restore_message=? WHERE filename=?",
                    (f"恢复失败：{exc}", filename),
                )
                write_audit(
                    conn,
                    admin,
                    "backup.restore_failed",
                    "backup",
                    None,
                    "数据库恢复失败",
                    {"filename": filename, "error": str(exc), "pre_restore": pre_restore},
                    self.client_address[0],
                )
            raise AppError(500, f"恢复失败：{exc}") from exc
        return {"message": restore_message, "backups": self.list_backups(), "pre_restore": pre_restore}

    def list_settings(self):
        self.require_admin()
        with connect() as conn:
            settings = rows_to_list(
                conn.execute(
                    """
                    SELECT s.*, u.display_name AS updated_by_name
                    FROM system_settings s
                    LEFT JOIN users u ON u.id = s.updated_by
                    ORDER BY s.key
                    """
                ).fetchall()
            )
            for setting in settings:
                if setting["value_type"] != "password":
                    continue
                setting["configured"] = bool(sso_setting(conn, setting["key"]))
                setting["value"] = ""
            return settings

    def public_settings(self):
        keys = (
            "app_brand_name",
            "app_team_name",
            "red_black_show_black_points",
            "red_black_show_black_details",
            "sso_enabled",
            "sso_auto_login",
            "sso_button_label",
        )
        placeholders = ",".join("?" for _ in keys)
        with connect() as conn:
            rows = rows_to_list(
                conn.execute(
                    f"SELECT key, value FROM system_settings WHERE key IN ({placeholders})",
                    keys,
                ).fetchall()
            )
            config = sso_configuration(conn)
        values = {key: value for key, _, value, _, _ in DEFAULT_SETTINGS if key in keys}
        values.update({row["key"]: row["value"] for row in rows})
        values["sso_enabled"] = "1" if config["enabled"] else "0"
        values["sso_auto_login"] = "1" if config["auto_login"] else "0"
        values["sso_button_label"] = config["button_label"]
        values["sso_ready"] = "1" if sso_configuration_ready(config) else "0"
        return values

    def update_settings(self):
        admin = self.require_admin()
        data = read_json(self)
        settings = data.get("settings") if isinstance(data.get("settings"), dict) else data
        if not isinstance(settings, dict) or not settings:
            raise AppError(400, "没有可更新配置")
        allowed = {key for key, *_ in DEFAULT_SETTINGS}
        with connect() as conn:
            for key, value in settings.items():
                if key not in allowed:
                    continue
                row = conn.execute("SELECT value_type FROM system_settings WHERE key=?", (key,)).fetchone()
                if not row:
                    continue
                normalized = str(value).strip()
                if row["value_type"] == "password" and not normalized:
                    continue
                if row["value_type"] == "number":
                    try:
                        normalized = str(max(0, int(float(normalized))))
                    except ValueError:
                        raise AppError(400, f"{key} 必须是数字")
                if row["value_type"] == "boolean":
                    normalized = "1" if normalized in ("1", "true", "on", "yes", "启用") else "0"
                if key in ("sso_issuer_url", "sso_redirect_uri", "sso_authorization_url", "sso_token_url", "sso_userinfo_url") and normalized:
                    labels = {
                        "sso_issuer_url": "OIDC Issuer",
                        "sso_redirect_uri": "OIDC 回调地址",
                        "sso_authorization_url": "OAuth2 授权地址",
                        "sso_token_url": "OAuth2 Token 地址",
                        "sso_userinfo_url": "OAuth2 用户信息地址",
                    }
                    validate_sso_url(normalized, labels[key])
                if key == "sso_mode" and normalized not in ("discovery", "manual"):
                    raise AppError(400, "OAuth2 配置方式不正确")
                if key == "sso_default_user_type" and normalized:
                    user_type = conn.execute(
                        "SELECT key FROM user_types WHERE key=? AND key<>? AND active=1",
                        (normalized, GUEST_USER_TYPE_KEY),
                    ).fetchone()
                    if not user_type:
                        raise AppError(400, "SSO 默认用户类型必须是有效的非访客类型")
                conn.execute(
                    "UPDATE system_settings SET value=?, updated_by=?, updated_at=? WHERE key=?",
                    (normalized, admin["id"], now_iso(), key),
                )
            config = sso_configuration(conn)
            if config["enabled"]:
                if not sso_configuration_ready(config):
                    if config["mode"] == "manual":
                        raise AppError(400, "启用企业 SSO 前必须填写 Client ID 以及三个 OAuth2 服务地址")
                    raise AppError(400, "启用企业 SSO 前必须填写 OIDC Issuer 和 Client ID")
                if config["mode"] == "manual":
                    for key, label in (("authorization_url", "OAuth2 授权地址"), ("token_url", "OAuth2 Token 地址"), ("userinfo_url", "OAuth2 用户信息地址")):
                        validate_sso_url(config[key], label)
                else:
                    validate_sso_url(config["issuer_url"], "OIDC Issuer")
                if config["redirect_uri"]:
                    validate_sso_url(config["redirect_uri"], "OIDC 回调地址")
                if config["auto_provision"]:
                    default_type = conn.execute(
                        "SELECT key FROM user_types WHERE key=? AND key<>? AND active=1",
                        (config["default_user_type"], GUEST_USER_TYPE_KEY),
                    ).fetchone()
                    if not default_type:
                        raise AppError(400, "启用 SSO 自动建号前必须选择有效的默认用户类型")
            write_audit(
                conn,
                admin,
                "settings.update",
                "system_settings",
                None,
                "系统配置已更新",
                {"keys": list(settings.keys())},
                self.client_address[0],
            )
        return {"message": "系统配置已更新", "settings": self.list_settings()}

    def list_audit_logs(self, query):
        self.require_admin()
        limit = 100
        if query.get("limit"):
            try:
                limit = max(20, min(500, int(query["limit"][0])))
            except ValueError:
                limit = 100
        with connect() as conn:
            logs = rows_to_list(
                conn.execute(
                    """
                    SELECT l.*, u.display_name AS actor
                    FROM audit_logs l
                    LEFT JOIN users u ON u.id = l.user_id
                    ORDER BY l.created_at DESC, l.id DESC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
            )
        for log in logs:
            try:
                log["metadata"] = json.loads(log.get("metadata") or "{}")
            except json.JSONDecodeError:
                log["metadata"] = {}
        return logs

    def list_backups(self):
        self.require_admin()
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        with connect() as conn:
            rows = rows_to_list(
                conn.execute(
                    """
                    SELECT b.*, u.display_name AS creator
                    FROM backups b
                    LEFT JOIN users u ON u.id = b.created_by
                    ORDER BY b.created_at DESC, b.id DESC
                    """
                ).fetchall()
            )
        known = {row["filename"] for row in rows}
        for file_path in sorted(BACKUP_DIR.glob("*.db"), reverse=True):
            if file_path.name not in known:
                rows.append(
                    {
                        "id": None,
                        "filename": file_path.name,
                        "size_bytes": file_path.stat().st_size,
                        "kind": "manual",
                        "creator": "",
                        "created_at": dt.datetime.fromtimestamp(file_path.stat().st_mtime).replace(microsecond=0).isoformat(),
                        "verify_status": "",
                        "verified_at": "",
                        "verify_message": "",
                        "restored_at": "",
                        "restore_message": "",
                    }
                )
        return rows

    def create_manual_backup(self):
        admin = self.require_admin()
        backup = create_database_backup(kind="manual", user_id=admin["id"])
        if not backup:
            raise AppError(500, "备份失败")
        return {"message": "备份已创建", "backup": backup, "backups": self.list_backups()}


def permissions_for(user):
    is_admin = bool(user and user.get("role") == "admin")
    if is_admin:
        operations = {
            module: {action: True for action in PERMISSION_ACTIONS}
            for module in MODULE_KEYS
        }
    elif not user:
        with connect() as conn:
            rows = rows_to_list(
                conn.execute(
                    """
                    SELECT module_key, can_view
                    FROM module_permissions
                    WHERE user_type_key=?
                    ORDER BY module_key
                    """,
                    (GUEST_USER_TYPE_KEY,),
                ).fetchall()
            )
        operations = {
            row["module_key"]: {
                "view": bool(row["can_view"]),
                "create": False,
                "edit": False,
                "delete": False,
            }
            for row in rows
        }
    else:
        with connect() as conn:
            rows = rows_to_list(
                conn.execute(
                    """
                    SELECT module_key, can_view, can_create, can_edit, can_delete
                    FROM module_permissions
                    WHERE user_type_key=?
                    ORDER BY module_key
                    """,
                    (user.get("user_type") or DEFAULT_USER_TYPE_KEY,),
                ).fetchall()
            )
        operations = {
            row["module_key"]: {
                "view": bool(row["can_view"]),
                "create": bool(row["can_create"]),
                "edit": bool(row["can_edit"]),
                "delete": bool(row["can_delete"]),
            }
            for row in rows
        }
    modules = sorted(module for module, actions in operations.items() if actions.get("view"))
    return {
        "isAdmin": is_admin,
        "userType": user.get("user_type") if user else GUEST_USER_TYPE_KEY,
        "modules": modules,
        "operations": operations,
        "canManageUsers": is_admin,
        "canPublishRules": is_admin,
        "canRecordScores": is_admin,
        "canManageLinks": is_admin,
        "canManageSchedule": is_admin,
        "canManageMembers": is_admin,
        "canManageMeetingTopics": is_admin,
        "canManageAttendance": is_admin,
        "canManageSystem": is_admin,
        "canCreateMeeting": bool(user),
        "canPostThankYou": bool(user),
    }


def date_filter(query, column):
    clauses = ["1=1"]
    params = []
    if query.get("from") and query["from"][0]:
        clauses.append(f"{column} >= ?")
        params.append(query["from"][0])
    if query.get("to") and query["to"][0]:
        clauses.append(f"{column} <= ?")
        params.append(query["to"][0])
    return " AND ".join(clauses), params


def main():
    parser = argparse.ArgumentParser(description="周例会团队协作 Web 项目")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址，局域网访问可用 0.0.0.0")
    parser.add_argument("--port", default=8000, type=int, help="监听端口")
    parser.add_argument("--migrate-only", action="store_true", help="Only initialize and migrate the database")
    args = parser.parse_args()
    init_db()
    if args.migrate_only:
        print(f"Database migration completed: {DB_PATH}")
        return
    if DEPLOY_ENV != "gray":
        ensure_daily_backup()
    os.chdir(ROOT)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Team Loop 已启动：http://{args.host}:{args.port}")
    print(f"运行环境：{DEPLOY_ENV}；发布版本：{RELEASE_ID}；数据库：{DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
