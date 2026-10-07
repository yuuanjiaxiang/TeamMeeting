#!/usr/bin/env python3
"""Run scheduled Thank You analysis once. Designed for cron/systemd timers."""
import argparse
from datetime import datetime
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from team_loop.database import init_db
from team_loop.common import connect
from team_loop.config import DB_PATH
from team_loop.thanks_insights import refresh_all


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timezone',default='Asia/Shanghai')
    args=parser.parse_args()
    today=datetime.now(ZoneInfo(args.timezone)).date()
    if not DB_PATH.exists():
        parser.error("数据库不存在，请先启动服务并核对任务的数据目录配置")
    init_db()
    with connect() as conn:
        count=refresh_all(conn,today)
    print(f'Thank You 内容分析完成：更新 {count} 份 TOP3 月度/年度报告。')


if __name__=='__main__':
    main()
