"""Isolated large-history reads; never writes the configured production DB."""
import concurrent.futures
import gzip
import json
import os
import statistics
import sys
import tempfile
import threading
import time
from datetime import date
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix="team-performance-") as folder:
        os.environ.update(TEAM_LOOP_DB_PATH=str(Path(folder) / "test.db"), TEAM_LOOP_DATA_DIR=folder,
                          TEAM_LOOP_BACKUP_DIR=str(Path(folder) / "backups"), TEAM_LOOP_ENV="gray")
        sys.path.insert(0, str(ROOT))
        import server as app
        from team_loop.runtime_performance import MaintenanceGate
        app.init_db()
        app.init_db()
        with app.connect() as conn:
            user = conn.execute("SELECT id,org_unit_id FROM users WHERE username='admin'").fetchone()
            conn.executemany("INSERT INTO team_posts(user_id,org_unit_id,kind,title,content,created_at) VALUES(?,?,'comment',?,?,?)",
                             [(user['id'], user['org_unit_id'], f"History {i}", 'x' * 2000, '2026-01-01T12:00:00') for i in range(10000)])
        class Quiet(app.Handler):
            def log_message(self, *args):
                pass
        server = app.BoundedThreadingHTTPServer(('127.0.0.1', 0), Quiet, max_workers=64)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        base = f'http://127.0.0.1:{server.server_port}'
        headers = {'X-Team-Org-Path': 'ess', 'Connection': 'close'}
        def read(path, extra=None):
            with urlopen(Request(base + path, headers={**headers, **(extra or {})}), timeout=30) as response:
                return response.read(), response.headers
        try:
            payload = json.dumps({'username': 'admin', 'password': 'admin123'}).encode()
            with urlopen(Request(base + '/api/login', data=payload, headers={'Content-Type': 'application/json'})) as response:
                headers['Cookie'] = response.headers['Set-Cookie'].split(';')[0]
            raw, _ = read('/api/team-posts?paged=1&page_size=6')
            page = json.loads(raw)
            assert len(page['posts']) == 6 and page['pagination']['total'] >= 10000
            assert len(raw) < 12000 and all('replies' not in p for p in page['posts'])
            search = json.loads(read('/api/team-posts?paged=1&keyword=History%209999')[0])
            assert search['pagination']['total'] == 1
            post_id = page['posts'][0]['id']
            first = json.loads(read(f'/api/team-posts/{post_id}')[0])['post']
            second = json.loads(read(f'/api/team-posts/{post_id}?view=refresh')[0])['post']
            assert first['view_count'] == second['view_count']
            today = date.today().isoformat()
            month = json.loads(read(f'/api/morning-items/month?from={today[:7]}-01&to={today}')[0])
            assert len({item['id'] for item in month['monthItems']}) == len(month['monthItems'])
            assert all(item['owner_id'] == user['id'] for item in month['monthItems'])
            assert json.loads(read('/api/health')[0])['check'] == 'read'
            assert json.loads(read('/api/health?deep=1')[0])['check'] == 'integrity'
            compressed, meta = read('/app.js', {'Accept-Encoding': 'gzip'})
            plain, _ = read('/app.js', {'Accept-Encoding': 'gzip;q=0'})
            assert meta['Content-Encoding'] == 'gzip' and gzip.decompress(compressed) == plain
            try:
                read('/app.js', {'Accept-Encoding': 'gzip', 'If-None-Match': meta['ETag']})
                raise AssertionError('Expected 304')
            except HTTPError as exc:
                assert exc.code == 304
            def sample(i):
                start = time.perf_counter()
                read('/api/team-posts?paged=1&page_size=6' if i % 2 else '/api/health')
                return (time.perf_counter() - start) * 1000
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
                durations = list(pool.map(sample, range(100)))
            gate = MaintenanceGate()
            entered, release, done = threading.Event(), threading.Event(), threading.Event()
            def maintenance():
                entered.set()
                release.wait(2)
                done.set()
            assert gate.schedule(maintenance)
            assert entered.wait(1) and not gate.schedule(maintenance)
            release.set()
            assert done.wait(1)
            print(json.dumps({'status': 'ok', 'history_posts': 10000, 'page_bytes': len(raw),
                              'requests': 100, 'concurrent_clients': 20, 'median_ms': round(statistics.median(durations), 1),
                              'p95_ms': round(sorted(durations)[94], 1), 'gzip_ratio': round(len(compressed) / len(plain), 3)}))
        finally:
            server.shutdown()
            server.server_close()
            worker.join(5)


if __name__ == '__main__':
    main()
