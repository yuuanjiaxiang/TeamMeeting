import base64
import http.cookiejar
import json
import os
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener


ROOT = Path(__file__).resolve().parents[1]
PIXEL_PNG = base64.b64encode(
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDAT\x08\xd7c\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d\x00\x00\x00\x00IEND\xaeB`\x82"
).decode("ascii")


def start_server(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def request_json(opener, url, method="GET", payload=None, expected=200, org_path=""):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Connection": "close", **({"Content-Type": "application/json"} if body is not None else {})}
    if org_path:
        headers["X-Team-Org-Path"] = org_path
    request = Request(
        url,
        data=body,
        headers=headers,
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


def request_bytes(opener, url, expected=200):
    request = Request(url, headers={"Connection": "close"})
    try:
        with opener.open(request, timeout=15) as response:
            status = response.status
            content_type = response.headers.get_content_type()
            cache_control = response.headers.get("Cache-Control", "")
            data = response.read()
    except HTTPError as exc:
        status = exc.code
        content_type = exc.headers.get_content_type()
        cache_control = exc.headers.get("Cache-Control", "")
        data = exc.read()
    if status != expected:
        raise RuntimeError(f"GET {url} returned {status}, expected {expected}: {data[:200]!r}")
    return content_type, cache_control, data


def login(base_url, username, password):
    opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    request_json(opener, f"{base_url}/api/login", "POST", {"username": username, "password": password})
    return opener


def main():
    with tempfile.TemporaryDirectory(prefix="team-loop-moments-") as temporary_directory:
        os.environ["TEAM_LOOP_DB_PATH"] = str(Path(temporary_directory) / "moments-smoke.db")
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

            request_json(guest, f"{base_url}/api/team-moments", expected=403)
            created = request_json(
                user,
                f"{base_url}/api/team-moments",
                "POST",
                {
                    "title": "TOPTB 稳定运行里程碑",
                    "story": "团队完成连续稳定运行验证，并沉淀交接标准。",
                    "category": "milestone",
                    "event_date": "2026-08-08",
                    "images": [
                        {"name": f"milestone-{index}.png", "data_url": f"data:image/png;base64,{PIXEL_PNG}"}
                        for index in range(1, 7)
                    ],
                },
            )
            moment = next((item for item in created.get("moments") or [] if item.get("title") == "TOPTB 稳定运行里程碑"), None)
            if not moment or len(moment.get("images") or []) != 6:
                raise RuntimeError(f"Team moment creation failed: {moment}")
            moment_id = moment["id"]
            image_url = moment["images"][0]["url"]
            if "v=" not in image_url:
                raise RuntimeError(f"Team-moment image URL is missing a cache version: {image_url}")
            content_type, cache_control, image_data = request_bytes(user, f"{base_url}{image_url}")
            if content_type != "image/png" or not image_data.startswith(b"\x89PNG"):
                raise RuntimeError("Protected team-moment image response is invalid")
            if "no-store" not in cache_control:
                raise RuntimeError(f"Protected team-moment image must not be cached: {cache_control}")

            child_created = request_json(
                admin,
                f"{base_url}/api/team-moments",
                "POST",
                {
                    "title": "MO 团队图片路径验证",
                    "story": "验证上层管理员浏览下层组织时，原生图片请求仍能通过组织校验。",
                    "category": "milestone",
                    "event_date": "2026-08-09",
                    "images": [{"name": "mo.png", "data_url": f"data:image/png;base64,{PIXEL_PNG}"}],
                },
                org_path="ess/mo",
            )
            child_moment = next(
                (item for item in child_created.get("moments") or [] if item.get("title") == "MO 团队图片路径验证"),
                None,
            )
            child_image_url = (child_moment.get("images") or [{}])[0].get("url") if child_moment else ""
            if "org=ess%2Fmo" not in child_image_url:
                raise RuntimeError(f"Child-team image URL is missing its validated organization path: {child_image_url}")
            child_type, _, child_data = request_bytes(admin, f"{base_url}{child_image_url}")
            if child_type != "image/png" or not child_data.startswith(b"\x89PNG"):
                raise RuntimeError("Parent administrator could not load the selected child-team image")

            request_bytes(guest, f"{base_url}{child_image_url}", expected=403)
            with app.connect() as conn:
                conn.execute("UPDATE module_permissions SET can_view=1 WHERE user_type_key='guest' AND module_key='moments'")
            guest_list = request_json(guest, f"{base_url}/api/team-moments", org_path="ess/mo")["moments"]
            assert any(item["id"] == child_moment["id"] for item in guest_list)
            request_bytes(guest, f"{base_url}{child_image_url}")
            request_bytes(guest, f"{base_url}{child_image_url.split('?')[0]}")
            request_bytes(guest, f"{base_url}{child_image_url.split('?')[0]}?org=ess", expected=404)
            with app.connect() as conn:
                conn.execute("UPDATE module_permissions SET can_view=0 WHERE user_type_key='guest' AND module_key='moments'")
            request_bytes(guest, f"{base_url}{child_image_url}", expected=403)

            updated = request_json(
                user,
                f"{base_url}/api/team-moments/{moment_id}",
                "PATCH",
                {"title": "TOPTB 稳定运行 30 天", "remove_image_ids": [moment["images"][0]["id"]], "new_images": []},
            )
            moment = next((item for item in updated.get("moments") or [] if item.get("id") == moment_id), None)
            if not moment or len(moment.get("images") or []) != 5 or moment.get("title") != "TOPTB 稳定运行 30 天":
                raise RuntimeError(f"Team moment update failed: {moment}")

            request_json(user, f"{base_url}/api/team-moments/{moment_id}", "DELETE")
            remaining = request_json(user, f"{base_url}/api/team-moments").get("moments") or []
            if any(item.get("id") == moment_id for item in remaining):
                raise RuntimeError("Deleted team moment leaked through listing")
            recycle = request_json(admin, f"{base_url}/api/recycle-bin").get("items") or []
            recycle_item = next((item for item in recycle if item.get("entity_type") == "team_moment" and item.get("entity_id") == moment_id), None)
            if not recycle_item:
                raise RuntimeError("Deleted team moment was not added to recycle bin")
            try:
                request_json(admin, f"{base_url}/api/recycle-bin/{recycle_item['id']}/restore", "POST", {})
            except ConnectionResetError:
                # Windows may reset a just-closed test socket after the restore commit.
                pass
            restored = request_json(user, f"{base_url}/api/team-moments").get("moments") or []
            if not any(item.get("id") == moment_id for item in restored):
                raise RuntimeError("Team moment restore failed")

            print(json.dumps({"status": "ok", "moment_id": moment_id, "six_images": True, "image_protected": True, "child_team_image": True, "recycle_restore": True}, ensure_ascii=False))
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()


if __name__ == "__main__":
    main()
