import argparse
import http.cookiejar
import json
import os
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener


ROOT = Path(__file__).resolve().parents[1]


def start_server(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def request_json(opener, url, method="GET", payload=None, expected=200):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={"Connection": "close", **({"Content-Type": "application/json"} if body is not None else {})},
        method=method,
    )
    try:
        with opener.open(request, timeout=15) as response:
            status = response.status
            data = json.load(response)
    except HTTPError as exc:
        status = exc.code
        data = json.loads(exc.read().decode("utf-8"))
    if status != expected:
        raise RuntimeError(f"{method} {url} returned {status}, expected {expected}: {data}")
    return data


def login(base_url, username, password):
    opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    request_json(opener, f"{base_url}/api/login", "POST", {"username": username, "password": password})
    return opener


def find_post(posts, title):
    return next((post for post in posts if post.get("title") == title), None)


def main():
    parser = argparse.ArgumentParser(description="Run an isolated team forum integration smoke test")
    parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="team-loop-forum-") as temporary_directory:
        os.environ["TEAM_LOOP_DB_PATH"] = str(Path(temporary_directory) / "forum-smoke.db")
        os.environ["TEAM_LOOP_DATA_DIR"] = temporary_directory
        os.environ["TEAM_LOOP_BACKUP_DIR"] = str(Path(temporary_directory) / "backups")
        os.environ["TEAM_LOOP_ENV"] = "gray"
        sys.path.insert(0, str(ROOT))
        import server as app

        app.init_db()
        server, thread = start_server(app.Handler)
        base_url = f"http://127.0.0.1:{server.server_port}"
        try:
            user = login(base_url, "user", "user123")
            admin = login(base_url, "admin", "admin123")
            guest = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

            created = request_json(
                user,
                f"{base_url}/api/team-posts",
                "POST",
                {"category": "field", "title": "TOPTB 温控异常讨论", "content": "夜班出现温控波动，请补充现场数据。"},
            )
            post = find_post(created.get("posts") or [], "TOPTB 温控异常讨论")
            if not post or post.get("category") != "field" or not post.get("mine"):
                raise RuntimeError(f"Forum topic creation failed: {post}")
            post_id = post["id"]

            request_json(user, f"{base_url}/api/team-posts/{post_id}", "PATCH", {"category": "announcement"}, 403)
            request_json(user, f"{base_url}/api/team-posts/{post_id}", "PATCH", {"pinned": True}, 403)
            updated = request_json(
                user,
                f"{base_url}/api/team-posts/{post_id}",
                "PATCH",
                {"title": "TOPTB 温控异常复盘", "content": "已补齐现场数据，继续确认波动根因。", "status": "resolved"},
            )
            post = find_post(updated.get("posts") or [], "TOPTB 温控异常复盘")
            if not post or post.get("status") != "resolved":
                raise RuntimeError("Forum topic editing failed")

            detail = request_json(guest, f"{base_url}/api/team-posts/{post_id}").get("post") or {}
            if int(detail.get("view_count") or 0) < 1:
                raise RuntimeError("Forum view counter was not updated")

            replied = request_json(
                user,
                f"{base_url}/api/team-posts/{post_id}/replies",
                "POST",
                {"content": "已上传夜班趋势截图。"},
            )
            post = find_post(replied.get("posts") or [], "TOPTB 温控异常复盘")
            root_reply = (post.get("replies") or [None])[0] if post else None
            if not root_reply:
                raise RuntimeError("Root forum reply was not created")

            nested = request_json(
                admin,
                f"{base_url}/api/team-posts/{post_id}/replies",
                "POST",
                {"parent_reply_id": root_reply["id"], "content": "收到，会议上同步结论。"},
            )
            nested_post = find_post(nested.get("posts") or [], "TOPTB 温控异常复盘")
            nested_replies = ((nested_post.get("replies") or [{}])[0].get("replies") or []) if nested_post else []
            if len(nested_replies) != 1:
                raise RuntimeError("Nested forum reply was not created")

            reacted = request_json(
                user,
                f"{base_url}/api/team-posts/{post_id}/reactions",
                "POST",
                {"reaction": "🚀"},
            )
            reacted_post = find_post(reacted.get("posts") or [], "TOPTB 温控异常复盘")
            if not any(item.get("reaction") == "🚀" and item.get("mine") for item in reacted_post.get("reactions") or []):
                raise RuntimeError("Forum Emoji reaction was not persisted")

            request_json(user, f"{base_url}/api/team-posts/{post_id}", "DELETE")
            request_json(guest, f"{base_url}/api/team-posts/{post_id}", expected=404)
            request_json(user, f"{base_url}/api/team-posts/{post_id}/reactions", "POST", {"reaction": "🚀"}, 404)
            request_json(user, f"{base_url}/api/team-replies/{root_reply['id']}/reactions", "POST", {"reaction": "🚀"}, 404)
            archive_query = urlencode({"keyword": "TOPTB 温控异常复盘", "type": "team_posts"})
            archived = request_json(user, f"{base_url}/api/archive/search?{archive_query}").get("results") or []
            if any(item.get("id") == post_id for item in archived):
                raise RuntimeError("Deleted forum topic leaked through archive search")
            recycle = request_json(admin, f"{base_url}/api/recycle-bin").get("items") or []
            recycle_item = next((item for item in recycle if item.get("entity_type") == "team_post" and item.get("entity_id") == post_id), None)
            if not recycle_item:
                raise RuntimeError("Deleted forum topic was not added to recycle bin")
            request_json(admin, f"{base_url}/api/recycle-bin/{recycle_item['id']}/restore", "POST", {})
            restored = request_json(guest, f"{base_url}/api/team-posts/{post_id}").get("post") or {}
            if restored.get("title") != "TOPTB 温控异常复盘" or int(restored.get("reply_count") or 0) != 2:
                raise RuntimeError(f"Forum topic restore failed: {restored}")

            print(json.dumps({"status": "ok", "post_id": post_id, "replies": restored["reply_count"], "emoji_reaction": True}, ensure_ascii=False))
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()


if __name__ == "__main__":
    main()
