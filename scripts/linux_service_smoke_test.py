"""Exercise Linux scripts against temporary databases and ephemeral ports only."""
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
from urllib.request import build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0))
        return sock.getsockname()[1]


def main():
    with tempfile.TemporaryDirectory(prefix='linux-service-test-') as folder:
        data = Path(folder)
        values = os.environ.copy()
        values.update(TEAM_LOOP_DATA_DIR=folder, TEAM_LOOP_DB_PATH=str(data/'weekly_team.db'),
                      TEAM_LOOP_REQUIRE_HTTPS='0', TEAM_LOOP_PYTHON=sys.executable)
        production_port, gray_port, dev_port = free_port(), free_port(), free_port()
        def run(*args,expected=0):
            result = subprocess.run(['bash',str(ROOT/'deploy.sh'),*args],env=values,capture_output=True,text=True,timeout=30)
            assert result.returncode==expected,(args,result.stdout,result.stderr)
            return result.stdout
        opener = build_opener(ProxyHandler({}))
        def health(port):
            with opener.open(f'http://127.0.0.1:{port}/api/health',timeout=3) as response:
                return json.load(response)
        try:
            run('migrate')
            run('start','--port',str(production_port))
            assert health(production_port)['environment']=='production'
            run('start','--env','dev','--port',str(production_port),expected=1)
            assert health(production_port)['database']=='ok'
            stale=data/'deploy/runtime/dev.json'
            stale.write_text(json.dumps({'pid':os.getpid(),'stamp':'stale','port':dev_port}))
            run('stop','--env','dev')
            first = json.loads((data/'deploy/runtime/production.json').read_text())
            run('start','--port',str(production_port))
            assert json.loads((data/'deploy/runtime/production.json').read_text())['pid']==first['pid']
            run('restart','--port',str(production_port))
            assert health(production_port)['database']=='ok'
            run('gray','--port',str(gray_port))
            assert health(gray_port)['environment']=='gray'
            subprocess.run([sys.executable,str(ROOT/'scripts/safety_feature_test.py'),'--base-url',f'http://127.0.0.1:{gray_port}','--database',str(data/'deploy/gray/weekly_team_gray.db')],check=True,capture_output=True,text=True,timeout=60)
            gray_db=data/'deploy/gray/weekly_team_gray.db'
            with sqlite3.connect(gray_db) as conn:
                conn.execute("UPDATE users SET display_name='灰度测试' WHERE username='admin'")
            with sqlite3.connect(data/'weekly_team.db') as conn:
                assert conn.execute("SELECT display_name FROM users WHERE username='admin'").fetchone()[0]!='灰度测试'
            with sqlite3.connect(gray_db) as conn:
                conn.execute("INSERT INTO users(username,display_name,role,salt,password_hash,created_at,user_type,org_unit_id) SELECT 'mock-preview','[MOCK]','user',salt,password_hash,created_at,user_type,org_unit_id FROM users WHERE username='admin'")
            run('promote','--port',str(production_port),expected=1)
            assert health(production_port)['database']=='ok'
            with sqlite3.connect(gray_db) as conn:
                conn.execute("DELETE FROM users WHERE username='mock-preview'")
            run('promote','--port',str(production_port))
            assert health(production_port)['database']=='ok'
            with sqlite3.connect(data/'weekly_team.db') as conn:
                assert conn.execute("SELECT display_name FROM users WHERE username='admin'").fetchone()[0]=='灰度测试'
            run('rollback','--port',str(production_port))
            with sqlite3.connect(data/'weekly_team.db') as conn:
                assert conn.execute("SELECT display_name FROM users WHERE username='admin'").fetchone()[0]!='灰度测试'
            run('stop')
            run('start','--env','dev','--port',str(dev_port))
            assert health(dev_port)['environment']=='development'
            run('stop','--env','dev')
            assert '已停止' in run('status')
            print('Linux service: background start, idempotency, restart, gray isolation, promote, rollback and hot reload stop passed')
        finally:
            for env in ['production','gray','dev']:
                run('stop','--env',env)


if __name__=='__main__':
    main()
