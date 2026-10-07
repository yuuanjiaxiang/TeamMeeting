#!/usr/bin/env python3
"""Linux background service and isolated gray-release management (standard library)."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import time
from urllib.request import build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get('TEAM_LOOP_DATA_DIR', ROOT / 'data')).resolve()
RUNTIME = DATA / 'deploy' / 'runtime'
PRODUCTION_DB = Path(os.environ.get('TEAM_LOOP_DB_PATH', DATA / 'weekly_team.db')).resolve()


def read(path):
    return json.loads(path.read_text()) if path.exists() else {}


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temp.replace(path)


def process_stamp(pid):
    try:
        # Start ticks protect against recycled PIDs; zombie processes are stopped.
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return fields[19] if fields[0] != 'Z' else None
    except (OSError, IndexError):
        return None


def running(record):
    return bool(record.get('pid') and record.get('stamp') and process_stamp(record['pid']) == record['stamp'])


def state_path(env):
    return RUNTIME / f'{env}.json'


def snapshot(source, target):
    if not source.exists() or source.resolve() == target.resolve():
        raise RuntimeError('快照源数据库不存在或目标与源相同')
    target.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
        src.backup(dst)
        if dst.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('数据库快照校验失败')


def release_copy():
    folder = DATA / 'deploy' / 'releases' / f"gray-{time.time_ns()}"
    ignored = shutil.ignore_patterns('data', '.git', '.agents', '.codex', '.aws', '__pycache__', '*.pyc', 'work', '.env', '.env.*')
    def ignore(directory, names):
        return set(ignored(directory, names)) | {name for name in names if (Path(directory) / name).resolve() == DATA}
    shutil.copytree(ROOT, folder, ignore=ignore)
    return folder


def environment(env, release):
    values = os.environ.copy()
    db = DATA / 'deploy' / 'gray' / 'weekly_team_gray.db' if env == 'gray' else PRODUCTION_DB
    values.update(TEAM_LOOP_DATA_DIR=str(DATA), TEAM_LOOP_DB_PATH=str(db),
                  TEAM_LOOP_BACKUP_DIR=str(DATA / ('deploy/gray/backups' if env == 'gray' else 'backups')),
                  TEAM_LOOP_ENV='development' if env == 'dev' else env,
                  TEAM_LOOP_RELEASE=release.name)
    return values


def stop(env):
    path = state_path(env)
    record = read(path)
    if running(record):
        pid = record['pid']
        if os.getpgid(pid) != pid:
            raise RuntimeError('进程组身份不匹配，拒绝停止')
        os.killpg(pid, signal.SIGTERM)
        for _ in range(100):
            if not running(record):
                break
            time.sleep(.1)
        if running(record):
            raise RuntimeError('服务尚未退出，请检查日志；未强制终止')
    path.unlink(missing_ok=True)
    print(f'{env}: 已停止')


def start(env, args):
    path = state_path(env)
    existing = read(path)
    if running(existing):
        print(f"{env}: 已运行，PID {existing['pid']}，端口 {existing['port']}")
        return
    if env == 'gray':
        release = Path(read(RUNTIME / 'gray-release.json').get('path', ROOT))
    elif env == 'production':
        release = Path(read(RUNTIME / 'active-release.json').get('path', ROOT))
    else:
        release = ROOT
    port = args.port or (8001 if env == 'gray' else 8000)
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind((args.host, port))
    log = RUNTIME / f'{env}.log'
    command = [sys.executable, '-u', str(release / ('scripts/dev_server.py' if env == 'dev' else 'server.py')), '--host', args.host, '--port', str(port)]
    with log.open('ab') as output:
        proc = subprocess.Popen(command, cwd=release, env=environment(env, release), stdin=subprocess.DEVNULL,
                                stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    record = {'pid': proc.pid, 'stamp': process_stamp(proc.pid), 'port': port, 'host': args.host, 'path': str(release), 'log': str(log)}
    write(path, record)
    # Do not use the session HTTP proxy for a loopback health check.
    opener = build_opener(ProxyHandler({}))
    host = '127.0.0.1' if args.host == '0.0.0.0' else args.host
    for _ in range(100):
        if proc.poll() is not None:
            path.unlink(missing_ok=True)
            raise RuntimeError(f'启动失败，请查看 {log}')
        try:
            with opener.open(f'http://{host}:{port}/api/health', timeout=.5) as response:
                health = json.load(response)
                if health.get('database') == 'ok' and (env == 'dev' or health.get('release') == release.name):
                    print(f'{env}: 后台运行，PID {proc.pid}，端口 {port}，日志 {log}')
                    return
        except (OSError, ValueError):
            pass
        time.sleep(.1)
    stop(env)
    raise RuntimeError(f'启动健康检查超时，请查看 {log}')


def gray(args):
    if not PRODUCTION_DB.exists():
        raise RuntimeError('请先执行 migrate 或启动正式服务，创建正式数据库')
    stop('gray')
    release = release_copy()
    snapshot(PRODUCTION_DB, DATA / 'deploy' / 'gray' / 'weekly_team_gray.db')
    write(RUNTIME / 'gray-release.json', {'path': str(release)})
    start('gray', args)


def promote(args):
    gray_release = read(RUNTIME / 'gray-release.json')
    gray_db = DATA / 'deploy' / 'gray' / 'weekly_team_gray.db'
    if not gray_release or not gray_db.exists():
        raise RuntimeError('请先完成灰度部署与验证')
    with sqlite3.connect(gray_db) as conn:
        if conn.execute("SELECT COUNT(*) FROM users WHERE username LIKE 'mock%' AND active=1").fetchone()[0]:
            raise RuntimeError('灰度含 MOCK 预览账号，禁止提升为正式数据库')
    stop('gray')
    previous = read(RUNTIME / 'active-release.json') or {'path': str(ROOT)}
    stop('production')
    backup = DATA / 'deploy' / 'backups' / f'production-{time.time_ns()}.db'
    snapshot(PRODUCTION_DB, backup)
    write(RUNTIME / 'rollback.json', {'path': previous['path'], 'database': str(backup)})
    snapshot(gray_db, PRODUCTION_DB)
    write(RUNTIME / 'active-release.json', gray_release)
    try:
        start('production', args)
    except Exception:
        snapshot(backup, PRODUCTION_DB)
        write(RUNTIME / 'active-release.json', previous)
        start('production', args)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'restart', 'status', 'migrate', 'gray', 'promote', 'rollback'])
    parser.add_argument('--env', choices=['production', 'gray', 'dev'], default='production')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int)
    args = parser.parse_args()
    if sys.platform != 'linux':
        parser.error('该后台管理脚本适用于 Linux')
    if DATA == ROOT or DATA in ROOT.parents:
        parser.error('数据目录必须与项目源码目录分离')
    os.umask(0o077)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    with (RUNTIME / 'service.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.action == 'status':
            for env in ['production', 'gray', 'dev']:
                record = read(state_path(env))
                print(f"{env}: {'运行中' if running(record) else '已停止'}" + (f"，PID {record['pid']}，端口 {record['port']}" if running(record) else ''))
        elif args.action == 'migrate':
            subprocess.run([sys.executable, str(ROOT / 'server.py'), '--migrate-only'], env=environment(args.env, ROOT), check=True)
        elif args.action in ['start', 'stop', 'restart']:
            if args.action in ['stop', 'restart']:
                stop(args.env)
            if args.action in ['start', 'restart']:
                start(args.env, args)
        elif args.action == 'gray':
            gray(args)
        elif args.action == 'promote':
            promote(args)
        elif args.action == 'rollback':
            previous = read(RUNTIME / 'rollback.json')
            if not previous:
                raise RuntimeError('没有可回滚的正式发布')
            stop('production')
            snapshot(Path(previous['database']), PRODUCTION_DB)
            write(RUNTIME / 'active-release.json', {'path': previous['path']})
            start('production', args)


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'错误：{error}', file=sys.stderr)
        sys.exit(1)
