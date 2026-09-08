"""Exercise report dates, actual updates, deduplication and organization boundaries."""

import datetime as dt
import http.cookiejar
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener


def main():
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="team-loop-followup-") as directory:
        os.environ.update(TEAM_LOOP_DB_PATH=str(Path(directory) / "test.db"), TEAM_LOOP_DATA_DIR=directory,
                          TEAM_LOOP_BACKUP_DIR=str(Path(directory) / "backups"), TEAM_LOOP_ENV="gray")
        sys.path.insert(0, str(root))
        import server as app
        from team_loop.handlers.followup import working_days_since

        app.init_db()
        monday = dt.date.today() - dt.timedelta(days=dt.date.today().weekday() + 7)
        friday = monday + dt.timedelta(days=4)
        with app.connect() as conn:
            conn.execute("DELETE FROM morning_items")
            admin_id = conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()[0]
            other_id = conn.execute("SELECT id FROM users WHERE username='user'").fetchone()[0]
            mo_id = conn.execute("SELECT id FROM org_units WHERE slug='mo'").fetchone()[0]
            conn.execute("UPDATE users SET org_unit_id=? WHERE id=?", (mo_id, other_id))

            def item(day, title, status="doing", chain=None, version=1, active=1, owner=admin_id, blocker=""):
                stamp = f"{day.isoformat()}T08:00:00"
                cursor = conn.execute(
                    """INSERT INTO morning_items(owner_id,item_date,title,detail,status,priority,blocker,due_date,
                       root_id,carry_from_id,updated_by,created_at,updated_at,active,version)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (owner, day.isoformat(), title, f"{title} progress", status, "high", blocker,
                     friday.isoformat(), chain, chain, owner, stamp, stamp, active, version),
                )
                row_id = cursor.lastrowid
                if chain is None:
                    conn.execute("UPDATE morning_items SET root_id=? WHERE id=?", (row_id, row_id))
                return row_id

            old_root = item(monday, "inherited")
            item(friday, "inherited", chain=old_root)
            completed = item(monday, "completed")
            item(friday, "completed", status="done", chain=completed, version=2)
            item(monday - dt.timedelta(days=7), "old-completion", status="done")
            deleted = item(monday, "deleted")
            item(friday, "deleted", chain=deleted, active=0)
            item(friday, "other-team", owner=other_id)
            updated = item(monday, "manually-updated")
            item(friday, "manually-updated", chain=updated, version=2, blocker="awaiting parts")
            item(friday + dt.timedelta(days=3), "future-result", status="done", chain=updated, version=2)
            count_before = conn.execute("SELECT COUNT(*) FROM morning_items").fetchone()[0]

        server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

        def request(path, payload=None, expected=200, org="ess", client=opener):
            headers = {"X-Team-Org-Path": org, "Connection": "close", "Content-Type": "application/json"}
            data = None if payload is None else json.dumps(payload).encode()
            try:
                with client.open(Request(base + path, headers=headers, data=data), timeout=15) as response:
                    assert response.status == expected
                    return json.load(response)
            except HTTPError as error:
                assert error.code == expected, error.read().decode()
                return json.load(error)

        try:
            request("/api/login", {"username": "admin", "password": "admin123"})
            path = f"/api/morning-items/report?from={monday}&to={friday}"
            report = request(path)
            by_title = {row["title"]: row for row in report["items"]}
            assert set(by_title) == {"inherited", "completed", "manually-updated"}, by_title
            assert report["summary"]["completed"] == 1 and report["summary"]["active"] == 2
            assert by_title["inherited"]["period_updates"] == 1
            assert by_title["inherited"]["is_stale"] and by_title["inherited"]["idle_workdays"] == 4
            assert by_title["manually-updated"]["last_progress_date"] == friday.isoformat()
            assert not by_title["manually-updated"]["is_stale"]
            assert by_title["manually-updated"]["needs_attention"]
            assert not by_title["completed"]["is_overdue"] and not by_title["completed"]["is_stale"]
            assert not by_title["inherited"]["is_overdue"] and by_title["inherited"]["due_today"]
            assert [row["title"] for row in request(path, org="ess/mo")["items"]] == ["other-team"]
            request("/api/morning-items/report?from=invalid", expected=400)
            request(f"/api/morning-items/report?from={friday}&to={monday}", expected=400)
            request(f"/api/morning-items/report?from={monday - dt.timedelta(days=100)}&to={friday}", expected=400)
            request(f"/api/morning-items/report?from={dt.date.today()}&to={dt.date.today()+dt.timedelta(days=1)}", expected=400)
            request(path, expected=403, client=build_opener())
            with app.connect() as conn:
                assert conn.execute("SELECT COUNT(*) FROM morning_items").fetchone()[0] == count_before
            historical = request(f"/api/morning-items?date={friday}")
            historical_items = {row["title"]: row for row in historical["items"]}
            assert historical_items["inherited"]["is_stale"]
            assert not historical_items["manually-updated"]["is_stale"]
            assert working_days_since("2026-08-14", "2026-08-17") == 1
            assert working_days_since("2026-08-14", "2026-08-16") == 0
            print(json.dumps({"status": "ok", "chain_deduplication": True, "cutoff_state": True,
                              "manual_updates": True, "weekend_skipped": True, "organization_isolated": True,
                              "report_read_only": True, "invalid_range_rejected": True}))
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()


if __name__ == "__main__":
    main()
