import os
import sys
import tempfile
from pathlib import Path
from forum_smoke_test import start_server, login, request_json


def main():
    with tempfile.TemporaryDirectory(prefix='meeting-participants-') as folder:
        os.environ.update(TEAM_LOOP_DB_PATH=str(Path(folder) / 'test.db'), TEAM_LOOP_DATA_DIR=folder,
                          TEAM_LOOP_BACKUP_DIR=str(Path(folder) / 'backups'), TEAM_LOOP_ENV='gray')
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        import server as app
        app.init_db()
        app.init_db()  # Migration must be repeatable.
        with app.connect() as conn:
            admin_id, org_id = conn.execute("SELECT id,org_unit_id FROM users WHERE username='admin'").fetchone()
            same_id = conn.execute("SELECT id FROM users WHERE org_unit_id=? AND active=1 AND id<>? LIMIT 1", (org_id,admin_id)).fetchone()[0]
            other_org = conn.execute("SELECT id FROM org_units WHERE id<>? LIMIT 1", (org_id,)).fetchone()[0]
            other_id = conn.execute("INSERT INTO users(username,display_name,role,salt,password_hash,created_at,user_type,org_unit_id) SELECT 'outside','其他团队','user',salt,password_hash,created_at,user_type,? FROM users WHERE id=?", (other_org,same_id)).lastrowid
        server, thread = start_server(app.Handler)
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            admin = login(base,'admin','admin123')
            payload = {'meeting_date':'2027-03-01','title':'指定参会人','participant_user_ids':[admin_id]}
            result = request_json(admin,base+'/api/meetings','POST',payload)
            mid = result['meeting_id']
            meeting = next(m for m in result['meetings'] if m['id']==mid)
            assert meeting['participant_user_ids'] == [admin_id]
            fetched = request_json(admin,base+'/api/meetings')
            assert next(m for m in fetched['meetings'] if m['id']==mid)['participant_user_ids']==[admin_id]
            request_json(admin,f'{base}/api/meetings/{mid}/attendance','POST',{'user_id':same_id,'status':'present'},400)
            request_json(admin,f'{base}/api/meetings/{mid}/attendance','POST',{'user_id':admin_id,'status':'present'})
            for ids in [[],[other_id],[999999],[True],['1'],None]:
                request_json(admin,base+'/api/meetings','POST',{**payload,'participant_user_ids':ids},400)
            with app.connect() as conn:
                assert conn.execute("SELECT COUNT(*) FROM meetings WHERE title='指定参会人'").fetchone()[0]==1
            legacy = request_json(admin,base+'/api/meetings','POST',{'title':'兼容会议'})
            assert next(m for m in legacy['meetings'] if m['id']==legacy['meeting_id'])['participant_user_ids'] is None
            request_json(admin,f"{base}/api/meetings/{legacy['meeting_id']}/attendance",'POST',{'user_id':same_id,'status':'present'})
            member = login(base,'user','user123')
            request_json(admin,f'{base}/api/meetings/{mid}/attendance','POST',{'user_id':admin_id,'status':'late','donation_amount':20,'donation_done':True})
            request_json(member,f'{base}/api/meetings/{mid}/attendance','POST',{'user_id':admin_id})
            with app.connect() as conn:
                money = conn.execute('SELECT donation_amount,donation_done,donation_required FROM meeting_attendance WHERE meeting_id=? AND user_id=?',(mid,admin_id)).fetchone()
                assert tuple(money)==(20,1,1)
            request_json(member,f'{base}/api/meetings/{mid}/attendance','POST',{'user_id':admin_id,'donation_amount':10},403)
            edited = request_json(admin,f'{base}/api/meetings/{mid}','PATCH',{'participant_user_ids':[same_id]})
            assert next(m for m in edited['meetings'] if m['id']==mid)['attendance']==[]
            request_json(member,f'{base}/api/meetings/{mid}/attendance','POST',{'user_id':admin_id},400)
            request_json(member,f'{base}/api/meetings/{mid}/attendance','POST',{'user_id':same_id})
            for ids in [[],[other_id],[True],None]:
                request_json(admin,f'{base}/api/meetings/{mid}','PATCH',{'participant_user_ids':ids},400)
            request_json(admin,f'{base}/api/meetings/{mid}','PATCH',{'status':'completed'})
            request_json(member,f'{base}/api/meetings/{mid}/attendance','POST',{'user_id':same_id},409)
            request_json(admin,f'{base}/api/meetings/{mid}','PATCH',{'participant_user_ids':[admin_id]},409)
            request_json(admin,f'{base}/api/meetings/{mid}','PATCH',{'status':'in_progress'})
            request_json(admin,f'{base}/api/meetings/{mid}','PATCH',{'participant_user_ids':[admin_id,same_id]})
            print('Meeting participants: persistence, scope, validation, attendance guard, legacy compatibility and migration passed')
        finally:
            server.shutdown();server.server_close();thread.join(5)


if __name__=='__main__':
    main()
