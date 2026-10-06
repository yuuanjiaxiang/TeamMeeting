"""Atomic, current-team calendar agenda scheduling."""
from ..permissions import *


class MeetingBatchHandlerMixin:
    def batch_meeting_agenda(self, actor):
        data = read_json(self)
        dates, items = data.get("dates"), data.get("items")
        if not isinstance(dates, list) or not 1 <= len(dates) <= 62:
            raise AppError(400, "请选择 1 至 62 个日期")
        if not isinstance(items, list) or not items or len(items) * len(dates) > 1000:
            raise AppError(400, "请选择议题，单批最多安排 1000 项")
        normalized, seen = [], set()
        try:
            for entry in dates:
                day = dt.date.fromisoformat(entry["date"]).isoformat()
                if day in seen:
                    raise ValueError()
                seen.add(day)
                normalized.append((day, int(entry["meeting_id"]) if entry.get("meeting_id") else None))
            options = {int(item["option_id"]): int(item["owner_id"]) if item.get("owner_id") else None for item in items}
        except (ValueError, TypeError, KeyError):
            raise AppError(400, "日期、会议或议题参数不正确")
        added = skipped = created = 0
        with connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            context = self.organization_context(conn, actor)
            org_id = context["selected"]["id"] if context["selected"] else actor["org_unit_id"]
            owner_where, owner_params = self.organization_user_filter(conn, "u", actor)
            owners = {row[0] for row in conn.execute(f"SELECT u.id FROM users u WHERE u.active=1 AND {owner_where}", owner_params)}
            presets = []
            for option_id, owner in options.items():
                option = conn.execute("SELECT o.*, t.name AS type_name FROM meeting_topic_options o JOIN meeting_topic_types t ON t.id=o.type_id WHERE o.id=? AND o.active=1 AND t.active=1 AND t.org_unit_id=?", (option_id, org_id)).fetchone()
                if not option or (owner is not None and owner not in owners):
                    raise AppError(400, "议题或责任人已失效，或不属于当前可操作团队")
                presets.append((option, owner or (option["owner_id"] if option["owner_id"] in owners else None)))
            for day, meeting_id in normalized:
                if meeting_id:
                    meeting = conn.execute("SELECT * FROM meetings WHERE id=? AND org_unit_id=? AND meeting_date=?", (meeting_id, org_id, day)).fetchone()
                    if not meeting or meeting["status"] in ("completed", "archived"):
                        raise AppError(409, f"{day} 的会议不可编辑，请重新选择")
                else:
                    # Repeated submissions reuse the draft instead of creating duplicates.
                    title = get_setting_value(conn, "meeting_default_title", "周例会")
                    existing = conn.execute("SELECT id FROM meetings WHERE org_unit_id=? AND meeting_date=? AND title=? AND status='draft' AND created_by=? ORDER BY id LIMIT 1", (org_id, day, title, actor["id"])).fetchone()
                    if existing:
                        meeting_id = existing["id"]
                    else:
                        meeting_id = conn.execute("INSERT INTO meetings(meeting_date,title,summary,status,created_by,org_unit_id,created_at) VALUES(?,?,'','draft',?,?,?)", (day, title, actor["id"], org_id, now_iso())).lastrowid
                        created += 1
                existing_ids = {row[0] for row in conn.execute("SELECT option_id FROM meeting_items WHERE meeting_id=? AND deleted_at IS NULL", (meeting_id,))}
                order = conn.execute("SELECT COALESCE(MAX(sort_order),0)+10 FROM meeting_items WHERE meeting_id=?", (meeting_id,)).fetchone()[0]
                for option, owner in presets:
                    if option["id"] in existing_ids:
                        skipped += 1
                        continue
                    conn.execute("""INSERT INTO meeting_items(meeting_id,section,title,detail,minutes,owner_id,status,created_by,created_at,type_id,option_id,sort_order,duration_minutes,expected_output,materials)
                        VALUES(?,?,?,?,'',?,'todo',?,?,?,?,?,?,?,?)""", (meeting_id, option["type_name"], option["title"], option["default_detail"] or "", owner, actor["id"], now_iso(), option["type_id"], option["id"], order, option["duration_minutes"] or 10, option["expected_output"] or "", option["materials"] or ""))
                    link_meeting_topic(conn, meeting_id, option["type_id"], actor["id"])
                    order += 10
                    added += 1
                write_audit(conn, actor, "meeting.batch_agenda", "meeting", meeting_id, "批量安排预设议题", {"date": day, "option_ids": list(options)}, self.client_address[0])
        return {"message": f"已安排 {len(normalized)} 天，新增 {created} 场会议、{added} 项议题，跳过 {skipped} 项重复议题", "added": added, "created": created, "skipped": skipped}
