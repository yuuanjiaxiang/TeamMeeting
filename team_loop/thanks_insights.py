"""Local, source-grounded keyword analysis for Thank You TOP3; no external service."""
import calendar
from collections import Counter
from datetime import date, datetime, timezone
import hashlib
import html
import json
import re

KEYWORDS = ('技术支持','现场支持','故障定位','问题解决','经验分享','知识分享','团队协作','项目推进','沟通协调','质量改进','交付保障','持续跟进','认真负责','细致耐心','响应及时','主动帮助','主动协助','排障','调试','复盘','培训','协调','沟通','协作','支持','跟进','交付','优化','自动化','测试','质量','耐心','专业','负责','效率','帮助','文档','分享','经验','机台','维修','供应商','风险','数据','代码')
STOP = {'thanks','thank','you','http','https','www','com'}


def ancestors(conn, org_id):
    units = {row['id']:row['parent_id'] for row in conn.execute('SELECT id,parent_id FROM org_units WHERE active=1')}
    result=[]
    while org_id in units and org_id not in result:
        result.append(org_id);org_id=units[org_id]
    return result


def reports(conn, org_id, start, end, persist=False):
    ids=ancestors(conn,org_id)
    if not ids:
        return []
    marks=','.join('?' for _ in ids)
    votes=[dict(row) for row in conn.execute(f'''SELECT v.id,v.receiver_id,v.evidence,v.week_start,
        receiver.display_name FROM thank_you_votes v
        JOIN users receiver ON receiver.id=v.receiver_id
        JOIN users giver ON giver.id=v.voter_id
        LEFT JOIN user_types t ON t.key=receiver.user_type
        WHERE v.week_start BETWEEN ? AND ? AND receiver.org_unit_id=?
          AND receiver.active=1 AND COALESCE(t.include_in_thanks,1)=1
          AND giver.org_unit_id IN ({marks}) ORDER BY v.id''',(start,end,org_id,*ids))]
    by_user={}
    for vote in votes:
        by_user.setdefault(vote['receiver_id'],[]).append(vote)
    top=sorted(by_user.items(),key=lambda pair:(-len(pair[1]),pair[1][0]['display_name'],pair[0]))[:3]
    output=[]
    if persist:
        conn.execute('DELETE FROM thank_you_insights WHERE org_unit_id=? AND period_from=? AND period_to=?',(org_id,start,end))
    for rank,(uid,rows) in enumerate(top,1):
        fingerprint=hashlib.sha256(json.dumps(rows,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
        cache=conn.execute('SELECT fingerprint,report_json FROM thank_you_insights WHERE org_unit_id=? AND period_from=? AND period_to=? AND receiver_id=?',(org_id,start,end,uid)).fetchone()
        if cache and cache['fingerprint']==fingerprint and not persist:
            report=json.loads(cache['report_json']);report['rank']=rank
        else:
            counts=Counter()
            for row in rows:
                text=re.sub(r'<(script|style)\b[^>]*>.*?</\1>', ' ', row['evidence'], flags=re.I | re.S)
                text=html.unescape(re.sub(r'<[^>]*>', ' ', text)).lower()
                words={word for word in KEYWORDS if word in text}
                words={word for word in words if not any(word!=other and word in other for other in words)}
                words.update(token for token in re.findall(r'\b[a-z][a-z0-9_+#.-]{1,23}\b',text) if token not in STOP)
                counts.update(words)
            wall=[{'text':word,'count':count} for word,count in sorted(counts.items(),key=lambda item:(-item[1],-len(item[0]),item[0]))[:18]]
            topics='、'.join(word['text'] for word in wall[:3])
            report={'receiver_id':uid,'display_name':rows[0]['display_name'],'rank':rank,'thanks':len(rows),
                    'period_from':start,'period_to':end,'words':wall,
                    'summary':f"收到 {len(rows)} 次感谢"+(f"，感谢内容主要涉及{topics}。" if topics else '，具体内容见原始感谢记录。'),
                    'examples':[row['evidence'][:240] for row in rows[-3:]],
                    'generated_at':datetime.now(timezone.utc).isoformat(),
                    'method':'根据原始感谢内容提炼关键词；字号按提及的感谢记录数变化。'}
        if persist:
            conn.execute('INSERT INTO thank_you_insights(org_unit_id,period_from,period_to,receiver_id,fingerprint,report_json,generated_at) VALUES(?,?,?,?,?,?,?)',(org_id,start,end,uid,fingerprint,json.dumps(report,ensure_ascii=False),report['generated_at']))
        output.append(report)
    return output


def refresh_all(conn, today=None):
    today=today or date.today()
    months={today.isoformat()[:7]}
    months.update(row[0][:7] for row in conn.execute('SELECT DISTINCT week_start FROM thank_you_votes') if re.fullmatch(r'\d{4}-\d{2}-\d{2}',row[0] or ''))
    periods=set()
    for month in months:
        try:
            value=date.fromisoformat(month+'-01')
        except ValueError:
            continue
        periods.add((value.isoformat(),f'{month}-{calendar.monthrange(value.year,value.month)[1]:02d}'))
        periods.add((f'{value.year}-01-01',f'{value.year}-12-31'))
    count=0
    for row in conn.execute('SELECT id FROM org_units WHERE active=1').fetchall():
        for start,end in sorted(periods):
            count+=len(reports(conn,row['id'],start,end,persist=True))
    return count
