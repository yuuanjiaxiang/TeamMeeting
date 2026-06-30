from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import argparse
import datetime as dt
import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import sqlite3
import uuid


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "weekly_team.db"
BACKUP_DIR = DATA_DIR / "backups"
SESSIONS = {}

DEFAULT_SETTINGS = [
    ("meeting_default_title", "默认会议标题", "周例会", "text", "创建会议和批量生成时使用的默认标题"),
    ("meeting_bulk_default_weeks", "批量生成周数", "4", "number", "会议沙盘批量生成默认覆盖的周数"),
    ("shift_default_hours", "默认班次小时", "12", "number", "新增排班时默认计入的工时"),
    ("thank_you_weekly_limit", "每周 Thank You 上限", "3", "number", "每位成员每周最多感谢的人数"),
    ("red_score_default_points", "红榜默认分值", "1", "number", "记录红榜积分时的默认分值"),
    ("black_score_default_points", "黑榜默认分值", "1", "number", "记录黑榜积分时的默认分值"),
    ("late_donation_label", "迟到乐捐说明", "迟到要乐捐", "text", "参会签到中迟到乐捐的口径说明"),
    ("backup_auto_enabled", "每日自动备份", "1", "boolean", "启用后系统每天自动生成一次数据库备份"),
    ("backup_retention_days", "备份保留天数", "30", "number", "自动清理超过该天数的备份，0 表示不清理"),
]

MONTHLY_RECURRENCE_VALUES = {"first", "second", "third", "fourth", "penultimate", "last"}


def now_iso():
    return dt.datetime.now().replace(microsecond=0).isoformat()


def today_iso():
    return dt.date.today().isoformat()


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


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def make_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return salt, hashed.hex()


def verify_password(password, salt, password_hash):
    _, hashed = make_hash(password, salt)
    return hmac.compare_digest(hashed, password_hash)


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
    DATA_DIR.mkdir(exist_ok=True)
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
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
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
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
                recurrence_weeks INTEGER NOT NULL DEFAULT 1,
                recurrence_type TEXT NOT NULL DEFAULT 'weekly',
                recurrence_value TEXT NOT NULL DEFAULT '1',
                sort_order INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS meeting_attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                status TEXT NOT NULL CHECK(status IN ('present', 'leave', 'absent', 'late')),
                donation_required INTEGER NOT NULL DEFAULT 0,
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
                created_at TEXT NOT NULL
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

            CREATE TABLE IF NOT EXISTS thank_you_votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                voter_id INTEGER NOT NULL REFERENCES users(id),
                receiver_id INTEGER NOT NULL REFERENCES users(id),
                week_start TEXT NOT NULL,
                evidence TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(voter_id, receiver_id, week_start)
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
        ensure_column(conn, "members", "active", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "members", "skills", "TEXT NOT NULL DEFAULT '[]'")
        ensure_column(conn, "members", "machine_scope", "TEXT NOT NULL DEFAULT '[]'")
        ensure_column(conn, "members", "expertise", "TEXT")
        ensure_column(conn, "members", "backup_owner", "TEXT")
        ensure_column(conn, "members", "contact", "TEXT")
        ensure_column(conn, "links", "pinned", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "links", "invalid", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "links", "click_count", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "links", "last_clicked_at", "TEXT")
        ensure_column(conn, "links", "quality_note", "TEXT")
        ensure_column(conn, "links", "machine_scope", "TEXT NOT NULL DEFAULT '[]'")
        ensure_column(conn, "links", "process_tags", "TEXT NOT NULL DEFAULT '[]'")
        ensure_column(conn, "meeting_items", "type_id", "INTEGER")
        ensure_column(conn, "meeting_items", "option_id", "INTEGER")
        ensure_column(conn, "meeting_items", "minutes", "TEXT")
        ensure_column(conn, "meeting_topic_options", "recurrence_weeks", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "meeting_topic_options", "recurrence_type", "TEXT NOT NULL DEFAULT 'weekly'")
        ensure_column(conn, "meeting_topic_options", "recurrence_value", "TEXT NOT NULL DEFAULT '1'")
        conn.execute("UPDATE meeting_topic_options SET recurrence_type='weekly' WHERE recurrence_type IS NULL OR recurrence_type=''")
        conn.execute("UPDATE meeting_topic_options SET recurrence_value=CAST(COALESCE(recurrence_weeks, 1) AS TEXT) WHERE recurrence_value IS NULL OR recurrence_value=''")
        conn.execute("UPDATE meeting_topic_options SET recurrence_value=CAST(COALESCE(recurrence_weeks, 1) AS TEXT) WHERE recurrence_type='weekly'")
        seed_meeting_topics(conn)
        seed_link_categories(conn)
        seed_system_settings(conn)
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if count == 0:
            admin_salt, admin_hash = make_hash("admin123")
            user_salt, user_hash = make_hash("user123")
            conn.execute(
                "INSERT INTO users(username, salt, password_hash, display_name, role, created_at) VALUES(?,?,?,?,?,?)",
                ("admin", admin_salt, admin_hash, "管理员", "admin", now_iso()),
            )
            conn.execute(
                "INSERT INTO users(username, salt, password_hash, display_name, role, created_at) VALUES(?,?,?,?,?,?)",
                ("user", user_salt, user_hash, "普通成员", "user", now_iso()),
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
                (2, "普通成员", "", "技术成员", "问题跟进、现场支持、经验沉淀", json.dumps(["执行", "现场"], ensure_ascii=False), "一线问题的主要贡献者。", now_iso()),
            )
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
            if parsed.path.startswith("/api/"):
                ensure_daily_backup()
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
        self.send_header("Connection", "close")
        self.close_connection = True
        self.end_headers()
        self.wfile.write(content)
        self.wfile.flush()

    def send_link_redirect(self, link_id):
        self.current_user(required=False)
        with connect() as conn:
            link = conn.execute("SELECT id, title, url, invalid FROM links WHERE id=?", (link_id,)).fetchone()
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
        user_id = SESSIONS.get(token)
        if not user_id:
            if required:
                raise AppError(401, "请先登录")
            return None
        with connect() as conn:
            user = conn.execute("SELECT id, username, display_name, role, active, created_at FROM users WHERE id=? AND active=1", (user_id,)).fetchone()
        if not user:
            if token in SESSIONS:
                del SESSIONS[token]
            if required:
                raise AppError(401, "登录状态已失效")
            return None
        return dict(user)

    def require_admin(self):
        user = self.current_user()
        if user["role"] != "admin":
            raise AppError(403, "仅管理员可操作")
        return user

    def is_public_read_api(self, method, path):
        if method != "GET":
            return False
        return path in {
            "/api/members",
            "/api/team-posts",
            "/api/rules",
            "/api/scores",
            "/api/dashboards/red-black",
            "/api/machines",
            "/api/shifts",
            "/api/dashboards/shifts",
            "/api/thank-you",
            "/api/dashboards/thank-you",
            "/api/links",
            "/api/link-categories",
        }

    def route_api(self, method, path, query):
        if path == "/api/login" and method == "POST":
            return self.login()
        if path == "/api/logout" and method == "POST":
            return self.logout()
        if path == "/api/me" and method == "GET":
            user = self.current_user(required=False)
            return {"user": user, "permissions": permissions_for(user)}

        user = self.current_user(required=not self.is_public_read_api(method, path))
        parts = path.strip("/").split("/")

        if path == "/api/users":
            if method == "GET":
                return {"users": self.list_users()}
            if method == "POST":
                return self.create_user()
        if len(parts) == 3 and parts[:2] == ["api", "users"] and method == "PATCH":
            return self.update_user(int(parts[2]))
        if len(parts) == 3 and parts[:2] == ["api", "users"] and method == "DELETE":
            return self.delete_user(int(parts[2]), user)

        if path == "/api/members":
            if method == "GET":
                return {"members": self.list_members()}
            if method == "POST":
                return self.create_member()
        if len(parts) == 3 and parts[:2] == ["api", "members"] and method == "PATCH":
            return self.update_member(int(parts[2]))
        if len(parts) == 4 and parts[:2] == ["api", "members"] and parts[3] == "posts" and method == "POST":
            return self.create_member_post(int(parts[2]), user)
        if path == "/api/team-posts":
            if method == "GET":
                return {"posts": self.list_team_posts()}
            if method == "POST":
                return self.create_team_post(user)

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

        if path == "/api/dashboards/red-black" and method == "GET":
            return self.red_black_dashboard(query)

        if path == "/api/meetings":
            if method == "GET":
                return {"meetings": self.list_meetings(query)}
            if method == "POST":
                return self.create_meeting(user)
        if path == "/api/meetings/bulk-generate" and method == "POST":
            return self.bulk_generate_meetings()
        if path == "/api/meeting-topics":
            if method == "GET":
                return self.list_meeting_topics()
        if path == "/api/meeting-topic-types" and method == "POST":
            return self.create_meeting_topic_type()
        if path == "/api/meeting-topic-options" and method == "POST":
            return self.create_meeting_topic_option()
        if len(parts) == 3 and parts[:2] == ["api", "meeting-topic-options"] and method == "PATCH":
            return self.update_meeting_topic_option(int(parts[2]))
        if len(parts) == 3 and parts[:2] == ["api", "meeting-topic-options"] and method == "DELETE":
            return self.delete_meeting_topic_option(int(parts[2]))
        if len(parts) == 4 and parts[:2] == ["api", "meetings"] and parts[3] == "items" and method == "POST":
            return self.create_meeting_item(int(parts[2]), user)
        if len(parts) == 4 and parts[:2] == ["api", "meetings"] and parts[3] == "attendance" and method == "POST":
            return self.upsert_attendance(int(parts[2]))
        if len(parts) == 3 and parts[:2] == ["api", "meeting-items"] and method == "PATCH":
            return self.update_meeting_item(int(parts[2]))

        if path == "/api/links":
            if method == "GET":
                return {"links": self.list_links()}
            if method == "POST":
                return self.create_link()
        if len(parts) == 3 and parts[:2] == ["api", "links"] and method == "PATCH":
            return self.update_link_quality(int(parts[2]))
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
                return {"votes": self.list_thank_you(query)}
            if method == "POST":
                return self.create_thank_you(user)
        if path == "/api/dashboards/thank-you" and method == "GET":
            return self.thank_you_dashboard(query)

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

        raise AppError(404, "接口不存在")

    def login(self):
        data = read_json(self)
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        with connect() as conn:
            user = conn.execute("SELECT * FROM users WHERE username=? AND active=1", (username,)).fetchone()
        if not user or not verify_password(password, user["salt"], user["password_hash"]):
            raise AppError(401, "账号或密码错误")
        token = secrets.token_urlsafe(32)
        SESSIONS[token] = user["id"]
        safe_user = {key: user[key] for key in ("id", "username", "display_name", "role", "active", "created_at")}
        with connect() as conn:
            write_audit(conn, safe_user, "auth.login", "session", safe_user["id"], "用户登录", {}, self.client_address[0])
        return {
            "user": safe_user,
            "permissions": permissions_for(safe_user),
            "message": "登录成功",
            "_headers": {"Set-Cookie": f"weekly_session={token}; Path=/; HttpOnly; SameSite=Lax"},
        }

    def logout(self):
        cookies = parse_cookies(self.headers.get("Cookie"))
        token = cookies.get("weekly_session")
        if token in SESSIONS:
            del SESSIONS[token]
        return {
            "message": "已退出",
            "_headers": {"Set-Cookie": "weekly_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"},
        }

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

    def list_users(self):
        self.require_admin()
        with connect() as conn:
            return rows_to_list(conn.execute("SELECT id, username, display_name, role, active, created_at FROM users WHERE active=1 ORDER BY id").fetchall())

    def create_user(self):
        admin = self.require_admin()
        data = read_json(self)
        salt, password_hash = make_hash(data.get("password") or "123456")
        with connect() as conn:
            cursor = conn.execute(
                "INSERT INTO users(username, salt, password_hash, display_name, role, active, created_at) VALUES(?,?,?,?,?,?,?)",
                ((data.get("username") or "").strip(), salt, password_hash, data.get("display_name") or data.get("username"), data.get("role") or "user", 1, now_iso()),
            )
            sync_member_for_user(conn, cursor.lastrowid)
            write_audit(conn, admin, "user.create", "user", cursor.lastrowid, "用户已创建", {"username": data.get("username"), "role": data.get("role") or "user"}, self.client_address[0])
        return {"message": "用户已创建", "users": self.list_users()}

    def update_user(self, user_id):
        admin = self.require_admin()
        data = read_json(self)
        fields = []
        values = []
        for key in ("display_name", "role", "active"):
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
            conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id=?", values)
            sync_member_for_user(conn, user_id)
            write_audit(conn, admin, "user.update", "user", user_id, "用户已更新", {"fields": list(data.keys())}, self.client_address[0])
        return {"message": "用户已更新", "users": self.list_users()}

    def delete_user(self, user_id, current_user):
        self.require_admin()
        if user_id == current_user["id"]:
            raise AppError(400, "不能删除当前登录账号")
        with connect() as conn:
            user = conn.execute("SELECT id, active FROM users WHERE id=?", (user_id,)).fetchone()
            if not user:
                raise AppError(404, "用户不存在")
            if user["active"] == 0:
                return {"message": "用户已删除", "users": self.list_users()}
            conn.execute("UPDATE users SET active=0 WHERE id=?", (user_id,))
            conn.execute("UPDATE members SET active=0 WHERE user_id=?", (user_id,))
            write_audit(conn, current_user, "user.delete", "user", user_id, "用户已删除", {}, self.client_address[0])
        for token, session_user_id in list(SESSIONS.items()):
            if session_user_id == user_id:
                del SESSIONS[token]
        return {"message": "用户已删除", "users": self.list_users()}

    def list_members(self):
        with connect() as conn:
            members = rows_to_list(
                conn.execute(
                    """
                    SELECT m.*, u.display_name AS linked_user
                    FROM members m
                    JOIN users u ON u.id = m.user_id
                    WHERE m.active=1 AND u.active=1
                    ORDER BY m.id
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

    def list_team_posts(self):
        with connect() as conn:
            return rows_to_list(
                conn.execute(
                    """
                    SELECT p.*, u.display_name
                    FROM team_posts p
                    JOIN users u ON u.id = p.user_id
                    ORDER BY p.created_at ASC, p.id ASC
                    """
                ).fetchall()
            )

    def create_team_post(self, user):
        data = read_json(self)
        kind = data.get("kind") if data.get("kind") in ("comment", "roast") else "comment"
        content = (data.get("content") or "").strip()
        if not content:
            raise AppError(400, "内容不能为空")
        with connect() as conn:
            conn.execute(
                "INSERT INTO team_posts(user_id, kind, content, created_at) VALUES(?,?,?,?)",
                (user["id"], kind, content, now_iso()),
            )
        return {"message": "已发布", "posts": self.list_team_posts()}

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
        with connect() as conn:
            return rows_to_list(
                conn.execute(
                    f"""
                    SELECT s.*, u.display_name, r.title AS rule_title
                    FROM red_black_scores s
                    JOIN users u ON u.id = s.user_id
                    LEFT JOIN red_black_rules r ON r.id = s.rule_id
                    WHERE {where}
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
            cursor = conn.execute(
                "INSERT INTO red_black_scores(user_id, rule_id, kind, points, reason, score_date, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)",
                (data.get("user_id"), data.get("rule_id") or None, data.get("kind"), points, data.get("reason") or "", data.get("score_date") or today_iso(), admin["id"], now_iso()),
            )
            write_audit(conn, admin, "score.create", "red_black_score", cursor.lastrowid, "红黑榜积分已记录", {"user_id": data.get("user_id"), "points": points}, self.client_address[0])
        return {"message": "积分已记录", "scores": self.list_scores({})}

    def red_black_dashboard(self, query):
        where, params = date_filter(query, "s.score_date")
        with connect() as conn:
            totals = rows_to_list(
                conn.execute(
                    f"""
                    SELECT u.id, u.display_name, COALESCE(SUM(s.points), 0) AS total,
                           SUM(CASE WHEN s.kind='red' THEN s.points ELSE 0 END) AS red_points,
                           SUM(CASE WHEN s.kind='black' THEN s.points ELSE 0 END) AS black_points
                    FROM users u
                    LEFT JOIN red_black_scores s ON s.user_id = u.id AND {where}
                    WHERE u.active=1
                    GROUP BY u.id
                    ORDER BY total DESC
                    """,
                    params,
                ).fetchall()
            )
            timeline = rows_to_list(
                conn.execute(
                    f"""
                    SELECT s.score_date, SUM(s.points) AS total
                    FROM red_black_scores s
                    WHERE {where}
                    GROUP BY s.score_date
                    ORDER BY s.score_date
                    """,
                    params,
                ).fetchall()
            )
        return {"totals": totals, "timeline": timeline}

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
                    ORDER BY i.created_at
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
        item_map = {}
        for item in items:
            item_map.setdefault(item["meeting_id"], []).append(item)
        attendance_map = {}
        for record in attendance:
            attendance_map.setdefault(record["meeting_id"], []).append(record)
        for meeting in meetings:
            meeting["items"] = item_map.get(meeting["id"], [])
            meeting["attendance"] = attendance_map.get(meeting["id"], [])
        return meetings

    def create_meeting(self, user):
        self.require_admin()
        data = read_json(self)
        with connect() as conn:
            default_title = get_setting_value(conn, "meeting_default_title", "周例会")
            cursor = conn.execute(
                "INSERT INTO meetings(meeting_date, title, summary, status, created_by, created_at) VALUES(?,?,?,?,?,?)",
                (data.get("meeting_date") or today_iso(), data.get("title") or default_title, data.get("summary") or "", "open", user["id"], now_iso()),
            )
            write_audit(conn, user, "meeting.create", "meeting", cursor.lastrowid, "会议已创建", {"meeting_date": data.get("meeting_date") or today_iso()}, self.client_address[0])
        return {"message": "会议已创建", "meetings": self.list_meetings({})}

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
                        "INSERT INTO meetings(meeting_date, title, summary, status, created_by, created_at) VALUES(?,?,?,?,?,?)",
                        (meeting_date, title, summary, "open", admin["id"], now_iso()),
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
                            due_date, created_by, created_at, type_id, option_id
                        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                        """,
                        (
                            meeting_id,
                            option["type_name"],
                            option["title"],
                            option["default_detail"] or "",
                            "",
                            None,
                            "todo",
                            None,
                            admin["id"],
                            now_iso(),
                            option["type_id"],
                            option["id"],
                        ),
                    )
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
                    "SELECT * FROM meeting_topic_options WHERE active=1 ORDER BY sort_order, id"
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

    def create_meeting_topic_option(self):
        self.require_admin()
        data = read_json(self)
        recurrence_type, recurrence_value, recurrence_weeks = normalize_recurrence(data)
        with connect() as conn:
            cursor = conn.execute(
                "INSERT INTO meeting_topic_options(type_id, title, default_detail, recurrence_weeks, recurrence_type, recurrence_value, sort_order, active) VALUES(?,?,?,?,?,?,?,1)",
                (data.get("type_id"), data.get("title"), data.get("default_detail") or "", recurrence_weeks, recurrence_type, recurrence_value, int(data.get("sort_order") or 0)),
            )
            write_audit(conn, self.current_user(), "meeting_topic_option.create", "meeting_topic_option", cursor.lastrowid, "预设议题已创建", {"title": data.get("title"), "recurrence_type": recurrence_type, "recurrence_value": recurrence_value}, self.client_address[0])
        return {"message": "议题选项已创建", **self.list_meeting_topics()}

    def update_meeting_topic_option(self, option_id):
        admin = self.require_admin()
        data = read_json(self)
        fields = []
        values = []
        for key in ("type_id", "title", "default_detail", "sort_order", "active"):
            if key in data:
                fields.append(f"{key}=?")
                values.append(data[key])
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
            elif type_id:
                topic_type = conn.execute("SELECT name FROM meeting_topic_types WHERE id=?", (type_id,)).fetchone()
                if topic_type:
                    section = topic_type["name"]
            if not title:
                raise AppError(400, "议题标题不能为空")
            cursor = conn.execute(
                "INSERT INTO meeting_items(meeting_id, section, title, detail, minutes, owner_id, status, due_date, created_by, created_at, type_id, option_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (meeting_id, section, title, detail, data.get("minutes") or "", data.get("owner_id") or None, data.get("status") or "todo", data.get("due_date") or None, user["id"], now_iso(), type_id, option_id),
            )
            write_audit(conn, user, "meeting_item.create", "meeting_item", cursor.lastrowid, "会议议题已添加", {"meeting_id": meeting_id, "title": title}, self.client_address[0])
        return {"message": "议题已添加", "meetings": self.list_meetings({})}

    def update_meeting_item(self, item_id):
        user = self.current_user()
        data = read_json(self)
        fields = []
        values = []
        for key in ("minutes", "detail", "status", "owner_id", "due_date"):
            if key in data:
                fields.append(f"{key}=?")
                values.append(data[key] or None if key in ("owner_id", "due_date") else data[key])
        if not fields:
            raise AppError(400, "没有可更新字段")
        values.append(item_id)
        with connect() as conn:
            item = conn.execute("SELECT id FROM meeting_items WHERE id=?", (item_id,)).fetchone()
            if not item:
                raise AppError(404, "议题不存在")
            conn.execute(f"UPDATE meeting_items SET {', '.join(fields)} WHERE id=?", values)
            write_audit(conn, user, "meeting_item.update", "meeting_item", item_id, "会议议题/纪要已更新", {"fields": list(data.keys())}, self.client_address[0])
        return {"message": "会议纪要已保存", "meetings": self.list_meetings({})}

    def upsert_attendance(self, meeting_id):
        admin = self.require_admin()
        data = read_json(self)
        status = data.get("status") or "present"
        donation_required = 1 if status == "late" or data.get("donation_required") else 0
        donation_done = 1 if data.get("donation_done") else 0
        with connect() as conn:
            conn.execute(
                """
                INSERT INTO meeting_attendance(meeting_id, user_id, status, donation_required, donation_done, note, updated_by, updated_at)
                VALUES(?,?,?,?,?,?,?,?)
                ON CONFLICT(meeting_id, user_id) DO UPDATE SET
                    status=excluded.status,
                    donation_required=excluded.donation_required,
                    donation_done=excluded.donation_done,
                    note=excluded.note,
                    updated_by=excluded.updated_by,
                    updated_at=excluded.updated_at
                """,
                (meeting_id, data.get("user_id"), status, donation_required, donation_done, data.get("note") or "", admin["id"], now_iso()),
            )
            write_audit(conn, admin, "attendance.upsert", "meeting_attendance", meeting_id, "参会状态已更新", {"meeting_id": meeting_id, "user_id": data.get("user_id"), "status": status}, self.client_address[0])
        return {"message": "参会状态已更新", "meetings": self.list_meetings({})}

    def list_links(self):
        with connect() as conn:
            links = rows_to_list(
                conn.execute(
                    """
                    SELECT l.*, u.display_name AS creator
                    FROM links l
                    LEFT JOIN users u ON u.id = l.created_by
                    ORDER BY l.invalid ASC, l.pinned DESC, l.category, l.title
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

    def update_link_quality(self, link_id):
        admin = self.require_admin()
        data = read_json(self)
        fields = []
        values = []
        for key in ("pinned", "invalid"):
            if key in data:
                fields.append(f"{key}=?")
                values.append(1 if data.get(key) in (1, "1", True, "true", "on", "yes", "置顶", "失效") else 0)
        for key in ("quality_note", "description", "category"):
            if key in data:
                fields.append(f"{key}=?")
                values.append(data.get(key) or "")
        for key in ("machine_scope", "process_tags"):
            if key in data:
                items = data.get(key) or []
                if isinstance(items, str):
                    items = [item.strip() for item in items.split(",") if item.strip()]
                fields.append(f"{key}=?")
                values.append(json.dumps(items, ensure_ascii=False))
        if not fields:
            raise AppError(400, "没有可更新字段")
        values.append(link_id)
        with connect() as conn:
            link = conn.execute("SELECT id, title FROM links WHERE id=?", (link_id,)).fetchone()
            if not link:
                raise AppError(404, "链接不存在")
            conn.execute(f"UPDATE links SET {', '.join(fields)} WHERE id=?", values)
            write_audit(
                conn,
                admin,
                "link.quality_update",
                "link",
                link_id,
                "链接质量信息已更新",
                {"title": link["title"], "fields": list(data.keys())},
                self.client_address[0],
            )
        return {"message": "链接质量已更新", "links": self.list_links()}

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
        with connect() as conn:
            default_hours = get_float_setting(conn, "shift_default_hours", 12, minimum=0.5, maximum=24)
            created_ids = []
            for shift_date in dates:
                cursor = conn.execute(
                    "INSERT INTO shifts(machine_id, user_id, shift_type, shift_date, hours, note, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)",
                    (data.get("machine_id"), data.get("user_id"), data.get("shift_type"), shift_date, float(data.get("hours") or default_hours), data.get("note") or "", admin["id"], now_iso()),
                )
                created_ids.append(cursor.lastrowid)
            write_audit(conn, admin, "shift.create", "shift", created_ids[0] if len(created_ids) == 1 else None, "排班已保存", {"dates": dates, "count": len(created_ids), "user_id": data.get("user_id")}, self.client_address[0])
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
                    SELECT u.display_name, SUM(s.hours) AS hours, COUNT(*) AS shift_count
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
        receiver_id = int(data.get("receiver_id"))
        if receiver_id == user["id"]:
            raise AppError(400, "不能给自己点赞")
        start = week_start(data.get("week_start") or today_iso())
        evidence = (data.get("evidence") or "").strip()
        if len(evidence) < 5:
            raise AppError(400, "请写下具体事实依据")
        with connect() as conn:
            weekly_limit = get_int_setting(conn, "thank_you_weekly_limit", 3, minimum=1, maximum=20)
            count = conn.execute("SELECT COUNT(*) FROM thank_you_votes WHERE voter_id=? AND week_start=?", (user["id"], start)).fetchone()[0]
            if count >= weekly_limit:
                raise AppError(400, f"本周最多点赞 {weekly_limit} 人")
            conn.execute(
                "INSERT INTO thank_you_votes(voter_id, receiver_id, week_start, evidence, created_at) VALUES(?,?,?,?,?)",
                (user["id"], receiver_id, start, evidence, now_iso()),
            )
            write_audit(conn, user, "thank_you.create", "thank_you", receiver_id, "Thank You 已送达", {"receiver_id": receiver_id, "week_start": start}, self.client_address[0])
        return {"message": "Thank You 已送达", "votes": self.list_thank_you({"from": [start], "to": [start]})}

    def thank_you_dashboard(self, query):
        where, params = date_filter(query, "v.week_start")
        with connect() as conn:
            stars = rows_to_list(
                conn.execute(
                    f"""
                    SELECT receiver.display_name, COUNT(*) AS thanks
                    FROM thank_you_votes v
                    JOIN users receiver ON receiver.id = v.receiver_id
                    WHERE {where}
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
                    WHERE {where}
                    GROUP BY v.week_start
                    ORDER BY v.week_start
                    """,
                    params,
                ).fetchall()
            )
        return {"stars": stars, "weekly": weekly}

    def list_settings(self):
        self.require_admin()
        with connect() as conn:
            return rows_to_list(
                conn.execute(
                    """
                    SELECT s.*, u.display_name AS updated_by_name
                    FROM system_settings s
                    LEFT JOIN users u ON u.id = s.updated_by
                    ORDER BY s.key
                    """
                ).fetchall()
            )

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
                if row["value_type"] == "number":
                    try:
                        normalized = str(max(0, int(float(normalized))))
                    except ValueError:
                        raise AppError(400, f"{key} 必须是数字")
                if row["value_type"] == "boolean":
                    normalized = "1" if normalized in ("1", "true", "on", "yes", "启用") else "0"
                conn.execute(
                    "UPDATE system_settings SET value=?, updated_by=?, updated_at=? WHERE key=?",
                    (normalized, admin["id"], now_iso(), key),
                )
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
    return {
        "isAdmin": is_admin,
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
    args = parser.parse_args()
    init_db()
    ensure_daily_backup()
    os.chdir(ROOT)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"周例会 Web 已启动: http://{args.host}:{args.port}")
    print("默认账号：admin/admin123，user/user123")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
