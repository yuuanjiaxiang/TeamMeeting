#!/usr/bin/env python3
import argparse
import hashlib
import http.client
import json
import secrets
import sqlite3
from datetime import date, timedelta
from urllib.parse import urlparse


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120000).hex()


def cleanup_test_users(conn):
    user_ids = [row[0] for row in conn.execute("SELECT id FROM users WHERE username LIKE 'safety_%'").fetchall()]
    for user_id in user_ids:
        conn.execute("DELETE FROM audit_logs WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM morning_items WHERE owner_id=? OR updated_by=?", (user_id, user_id))
        conn.execute("DELETE FROM shifts WHERE user_id=? OR created_by=?", (user_id, user_id))
        conn.execute("DELETE FROM auth_sessions WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM members WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM users WHERE id=?", (user_id,))
    conn.execute("DELETE FROM login_attempts WHERE username LIKE 'safety_%'")
    conn.commit()


def main():
    parser = argparse.ArgumentParser(description="Verify Team Loop safety controls against a disposable/gray database.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8001")
    parser.add_argument("--database", required=True)
    args = parser.parse_args()

    suffix = secrets.token_hex(4)
    username = f"safety_{suffix}"
    password = f"Safety-{suffix}!"
    title = f"安全测试事项-{suffix}"
    shift_date = (date.today() + timedelta(days=45)).isoformat()
    salt = secrets.token_hex(16)
    user_id = None
    member_user_id = None
    temporary_type_key = None
    item_id = None
    shift_id = None

    base = urlparse(args.base_url)
    cookie = ""

    def request(method, path, payload=None, expected=(200,)):
        nonlocal cookie
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        connection = http.client.HTTPConnection(base.hostname, base.port or 80, timeout=10)
        headers = {"Content-Type": "application/json", "User-Agent": "TeamLoop-Safety-Test/1.0"}
        if cookie:
            headers["Cookie"] = cookie
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        status = response.status
        data = json.loads(response.read().decode("utf-8") or "{}")
        set_cookie = response.getheader("Set-Cookie") or ""
        if set_cookie.startswith("weekly_session="):
            cookie = set_cookie.split(";", 1)[0]
            if cookie == "weekly_session=":
                cookie = ""
        connection.close()
        if status not in expected:
            raise RuntimeError(f"{method} {path}: expected {expected}, got {status}: {data}")
        return status, data

    conn = sqlite3.connect(args.database)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        cleanup_test_users(conn)
        user_type = conn.execute(
            """
            SELECT key FROM user_types
            WHERE active=1 AND key<>'guest' AND COALESCE(include_in_morning, 1)=1
            ORDER BY sort_order LIMIT 1
            """
        ).fetchone()
        if not user_type:
            raise RuntimeError("No assignable user type exists in gray database")
        cursor = conn.execute(
            "INSERT INTO users(username,salt,password_hash,display_name,role,user_type,active,created_at) VALUES(?,?,?,?,?,?,1,datetime('now'))",
            (username, salt, password_hash(password, salt), "安全测试管理员", "admin", user_type["key"]),
        )
        user_id = cursor.lastrowid
        conn.commit()

        request("POST", "/api/login", {"username": username, "password": password})
        _, sessions = request("GET", "/api/sessions")
        assert len(sessions.get("sessions", [])) == 1 and sessions["sessions"][0]["current"]

        _, type_data = request("GET", "/api/user-types")
        selected_type = next(item for item in type_data["types"] if item["key"] == user_type["key"])
        _, impact = request(
            "POST",
            f"/api/user-types/{user_type['key']}/impact",
            {"permissions": selected_type["permissions"]},
        )
        assert impact["changed"] == [] and impact["affected_count"] >= 1

        _, created_type_data = request("POST", "/api/user-types", {
            "name": f"安全隔离类型-{suffix}",
            "description": "自动化验证业务参与名单",
            "copy_from": user_type["key"],
        })
        temporary_type = next(item for item in created_type_data["types"] if item["name"] == f"安全隔离类型-{suffix}")
        temporary_type_key = temporary_type["key"]
        member_username = f"safety_member_{suffix}"
        _, created_user_data = request("POST", "/api/users", {
            "username": member_username,
            "display_name": "安全名单成员",
            "password": password,
            "role": "user",
            "user_type": user_type["key"],
        })
        member_user = next(item for item in created_user_data["users"] if item["username"] == member_username)
        member_user_id = member_user["id"]
        request("PATCH", "/api/users/bulk-type", {
            "user_ids": [member_user_id],
            "user_type": temporary_type_key,
        })
        _, configured_type_data = request(
            "PATCH",
            f"/api/user-types/{temporary_type_key}/permissions",
            {
                "permissions": temporary_type["permissions"],
                "participation": {"members": False, "morning": False, "rules": False, "thanks": False},
                "name": temporary_type["name"],
                "description": temporary_type["description"],
                "expected_version": temporary_type["version"],
            },
        )
        configured_type = next(item for item in configured_type_data["types"] if item["key"] == temporary_type_key)
        assert not any(configured_type["participation"].values())
        _, users_data = request("GET", "/api/users")
        isolated_user = next(item for item in users_data["users"] if item["id"] == member_user_id)
        assert not any(isolated_user[f"eligible_{scope}"] for scope in ("members", "morning", "rules", "thanks"))
        _, members_data = request("GET", "/api/members")
        assert member_user_id not in {item["user_id"] for item in members_data["members"]}
        request("POST", "/api/morning-items", {
            "owner_id": member_user_id,
            "title": "不应进入早例会",
            "item_date": date.today().isoformat(),
        }, expected=(400,))
        request("POST", "/api/scores", {
            "user_id": member_user_id,
            "kind": "red",
            "points": 1,
            "reason": "不应进入红黑榜",
            "score_date": date.today().isoformat(),
        }, expected=(400,))
        _, thank_data = request("GET", f"/api/thank-you?from={date.today().isoformat()}&to={date.today().isoformat()}")
        assert member_user_id not in {item["id"] for item in thank_data["users"]}

        _, created = request("POST", "/api/morning-items", {
            "title": title,
            "item_date": date.today().isoformat(),
            "status": "doing",
            "priority": "normal",
        })
        item = next(item for item in created["items"] if item["title"] == title and item["owner_id"] == user_id)
        item_id = item["id"]
        _, updated = request("PATCH", f"/api/morning-items/{item_id}", {
            "detail": "首次更新",
            "expected_version": item["version"],
        })
        current = next(item for item in updated["items"] if item["id"] == item_id)
        request("PATCH", f"/api/morning-items/{item_id}", {
            "detail": "过期页面更新",
            "expected_version": item["version"],
        }, expected=(409,))

        _, machines = request("GET", "/api/machines")
        machine_id = machines["machines"][0]["id"]
        _, shifts = request("POST", "/api/shifts", {
            "machine_id": machine_id,
            "user_id": user_id,
            "shift_type": "day",
            "shift_start_date": shift_date,
            "shift_end_date": shift_date,
            "hours": 12,
        })
        shift = next(item for item in shifts["shifts"] if item["user_id"] == user_id and item["shift_date"] == shift_date)
        shift_id = shift["id"]
        request("POST", "/api/shifts", {
            "machine_id": machine_id,
            "user_id": user_id,
            "shift_type": "day",
            "shift_start_date": shift_date,
            "shift_end_date": shift_date,
            "hours": 12,
        }, expected=(409,))

        request("DELETE", f"/api/shifts/{shift_id}")
        shift_id = None
        request("DELETE", f"/api/morning-items/{item_id}", {"expected_version": current["version"]})
        item_id = None

        current_session = sessions["sessions"][0]["id"]
        _, revoked = request("DELETE", f"/api/sessions/{current_session}")
        assert revoked["current_revoked"] is True
        request("GET", "/api/sessions", expected=(401,))

        for _ in range(4):
            request("POST", "/api/login", {"username": username, "password": "wrong-password"}, expected=(401,))
        request("POST", "/api/login", {"username": username, "password": "wrong-password"}, expected=(429,))
        request("POST", "/api/login", {"username": username, "password": password}, expected=(429,))
        print("Safety feature test passed: sessions, lockout, permission impact, participation scopes, bulk user types, optimistic locking, shift conflicts")
    finally:
        if shift_id:
            conn.execute("DELETE FROM shifts WHERE id=?", (shift_id,))
        if item_id:
            conn.execute("DELETE FROM morning_items WHERE id=?", (item_id,))
        cleanup_test_users(conn)
        if temporary_type_key:
            conn.execute("DELETE FROM module_permissions WHERE user_type_key=?", (temporary_type_key,))
            conn.execute("DELETE FROM user_types WHERE key=?", (temporary_type_key,))
            conn.commit()
        conn.close()


if __name__ == "__main__":
    main()
