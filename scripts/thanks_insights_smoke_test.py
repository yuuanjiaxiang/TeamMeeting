import os
import sys
import tempfile
from pathlib import Path
from forum_smoke_test import start_server, login, request_json


def main():
    with tempfile.TemporaryDirectory(prefix='thanks-insights-') as folder:
        os.environ.update(TEAM_LOOP_DB_PATH=str(Path(folder)/'test.db'),TEAM_LOOP_DATA_DIR=folder,
                          TEAM_LOOP_BACKUP_DIR=str(Path(folder)/'backups'),TEAM_LOOP_ENV='gray')
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
        import server as app
        from team_loop.thanks_insights import refresh_all, reports, KEYWORDS
        app.init_db();app.init_db()
        with app.connect() as conn:
            admin_id,org=conn.execute("SELECT id,org_unit_id FROM users WHERE username='admin'").fetchone()
            others=[]
            for i in range(4):
                uid=conn.execute("INSERT INTO users(username,display_name,role,salt,password_hash,created_at,user_type,org_unit_id) SELECT ?,?,'user',salt,password_hash,created_at,user_type,org_unit_id FROM users WHERE id=?",(f'insight{i}',f'感谢成员{i}',admin_id)).lastrowid
                others.append(uid)
                for week in range(4-i):
                    conn.execute('INSERT INTO thank_you_votes(voter_id,receiver_id,week_start,evidence,created_at) VALUES(?,?,?,?,?)',(admin_id,uid,f'2026-10-{1+7*week:02d}','感谢专业技术支持、故障定位与问题解决。<script>bad()</script>',app.now_iso()))
            other_org=conn.execute('SELECT id FROM org_units WHERE id<>? LIMIT 1',(org,)).fetchone()[0]
            outside=conn.execute("INSERT INTO users(username,display_name,role,salt,password_hash,created_at,user_type,org_unit_id) SELECT 'outside','外部成员','user',salt,password_hash,created_at,user_type,? FROM users WHERE id=?",(other_org,admin_id)).lastrowid
            conn.execute('INSERT INTO thank_you_votes(voter_id,receiver_id,week_start,evidence,created_at) VALUES(?,?,?,?,?)',(outside,others[0],'2026-10-30','不应出现的兄弟团队内容',app.now_iso()))
            first=reports(conn,org,'2026-10-01','2026-10-31')
            assert len(first)==3 and first[0]['thanks']==4
            assert any(word['text']=='技术支持' for word in first[0]['words'])
            assert all('兄弟' not in quote for report in first for quote in report['examples'])
            refresh_all(conn)
            cached=reports(conn,org,'2026-10-01','2026-10-31')
            assert cached[0]['thanks']==4
            conn.execute("UPDATE thank_you_votes SET evidence='感谢耐心培训分享经验' WHERE receiver_id=? AND voter_id=? AND week_start='2026-10-01'",(others[0],admin_id))
            changed=reports(conn,org,'2026-10-01','2026-10-31')
            assert any(word['text']=='培训' for word in changed[0]['words'])
            rich_text = '、'.join(dict.fromkeys(KEYWORDS))
            conn.execute("UPDATE thank_you_votes SET evidence=? WHERE receiver_id=? AND voter_id=? AND week_start='2026-10-01'",(rich_text,others[0],admin_id))
            richer = reports(conn,org,'2026-10-01','2026-10-31')[0]
            assert 40 <= len(richer['words']) <= 60
            source = rich_text + '感谢专业技术支持、故障定位与问题解决。'
            assert all(word['text'] in source for word in richer['words'])
            # A cached report from the previous extractor must be regenerated.
            refresh_all(conn)
            conn.execute("UPDATE thank_you_insights SET fingerprint='previous-analysis-version',report_json='{}'")
            assert reports(conn,org,'2026-10-01','2026-10-31')[0]['words'] == richer['words']
        server,thread=start_server(app.Handler);base=f'http://127.0.0.1:{server.server_port}'
        try:
            admin=login(base,'admin','admin123')
            query=f'/api/thank-you/insights?from=2026-10-01&to=2026-10-31&receiver_id={others[0]}'
            response=request_json(admin,base+query)
            assert response['reports'][0]['thanks']==4
            request_json(admin,base+query.replace(f'receiver_id={others[0]}',f'receiver_id={others[3]}'),expected=404)
            request_json(admin,base+'/api/thank-you/insights?from=bad',expected=400)
            import subprocess
            subprocess.run([sys.executable,str(Path(__file__).parent/'thanks_analysis.py')],check=True)
            print('Thank You insights: TOP3, scope, evidence keywords, cache invalidation, validation and scheduled run passed')
        finally:
            server.shutdown();server.server_close();thread.join(5)


if __name__=='__main__':
    main()
