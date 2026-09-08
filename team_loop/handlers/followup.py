"""Read-only project follow-up built from morning-item history."""

import datetime as dt

from ..common import AppError, connect, today_iso


def working_days_since(start, end):
    start = dt.date.fromisoformat(start)
    end = dt.date.fromisoformat(end)
    days = max(0, (end - start).days)
    weeks, remainder = divmod(days, 7)
    return weeks * 5 + sum((start.weekday() + offset) % 7 < 5 for offset in range(1, remainder + 1))


def tracking_flags(item, cutoff, last_update):
    days = working_days_since(last_update, cutoff)
    active = item["status"] != "done"
    due = item.get("due_date") or ""
    return {
        "last_progress_date": last_update,
        "idle_workdays": days,
        "needs_attention": active and (item["status"] == "risk" or bool((item.get("blocker") or "").strip())),
        "is_overdue": active and bool(due) and due < cutoff,
        "due_today": active and due == cutoff,
        "is_stale": active and days >= 3,
    }


class FollowupHandlerMixin:
    def annotate_morning_followup(self, conn, items, cutoff, org_where, org_params):
        # Carryover changes timestamps but is not a human progress update.
        updates = conn.execute(
            f"""
            SELECT COALESCE(i.root_id, i.id) AS chain_id,
                   MAX(CASE WHEN i.carry_from_id IS NULL OR i.version>1 OR i.updated_at<>i.created_at
                            THEN i.item_date END) AS last_progress_date,
                   MIN(i.item_date) AS first_date
            FROM morning_items i
            JOIN users owner ON owner.id=i.owner_id
            WHERE i.active=1 AND i.item_date<=? AND {org_where}
            GROUP BY COALESCE(i.root_id, i.id)
            """,
            [cutoff, *org_params],
        ).fetchall()
        dates = {row["chain_id"]: row["last_progress_date"] or row["first_date"] for row in updates}
        for item in items:
            last_update = dates.get(item.get("root_id") or item["id"], item["item_date"])
            item.update(tracking_flags(item, cutoff, last_update))

    def morning_progress_report(self, query, user):
        start = (query.get("from") or [today_iso()])[0]
        end = (query.get("to") or [today_iso()])[0]
        try:
            start_date = dt.date.fromisoformat(start)
            end_date = dt.date.fromisoformat(end)
        except (ValueError, TypeError):
            raise AppError(400, "请选择有效的开始和结束日期")
        if end_date < start_date or (end_date - start_date).days >= 93:
            raise AppError(400, "汇总范围需为 1 至 93 天，结束日期不能早于开始日期")
        if end_date > dt.date.today():
            raise AppError(400, "只能汇总截至今天的实际进展")
        start, end = start_date.isoformat(), end_date.isoformat()
        with connect() as conn:
            context = self.organization_context(conn, user)
            org_where, org_params = self.organization_current_user_filter(conn, "owner", user)
            # Rank before dropping deleted rows, so a deleted latest snapshot cannot revive older work.
            rows = conn.execute(
                f"""
                WITH history AS (
                    SELECT i.*, COALESCE(i.root_id, i.id) AS chain_id,
                           owner.display_name AS owner_name, owner.username AS owner_account,
                           owner.morning_sort_order,
                           CASE WHEN i.active=1 AND (i.carry_from_id IS NULL OR i.version>1 OR i.updated_at<>i.created_at)
                                THEN 1 ELSE 0 END AS manual_update
                    FROM morning_items i
                    JOIN users owner ON owner.id=i.owner_id AND owner.active=1
                    LEFT JOIN user_types t ON t.key=owner.user_type
                    WHERE i.item_date<=? AND COALESCE(t.include_in_morning, 1)=1 AND {org_where}
                ), ranked AS (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY chain_id ORDER BY item_date DESC, id DESC) AS position,
                           MIN(item_date) OVER (PARTITION BY chain_id) AS start_date,
                           MAX(CASE WHEN manual_update=1 THEN item_date END) OVER (PARTITION BY chain_id) AS last_progress_date,
                           SUM(CASE WHEN manual_update=1 AND item_date>=? THEN 1 ELSE 0 END)
                               OVER (PARTITION BY chain_id) AS period_updates
                    FROM history
                )
                SELECT * FROM ranked WHERE position=1 AND active=1
                  AND (status<>'done' OR COALESCE(last_progress_date, item_date)>=?)
                ORDER BY CASE WHEN morning_sort_order=0 THEN 2147483647 ELSE morning_sort_order END,
                         owner_name, owner_id, due_date, id
                """,
                [end, *org_params, start, start],
            ).fetchall()
        items = []
        for row in rows:
            item = {key: row[key] for key in (
                "id", "chain_id", "owner_id", "owner_name", "owner_account", "title", "detail", "status",
                "priority", "blocker", "due_date", "item_date", "start_date", "period_updates",
            )}
            item.update(tracking_flags(item, end, row["last_progress_date"] or row["item_date"]))
            items.append(item)
        return {
            "from": start, "to": end, "organization": context["selected"]["path"],
            "items": items,
            "summary": {
                "total": len(items),
                "completed": sum(item["status"] == "done" for item in items),
                "active": sum(item["status"] != "done" for item in items),
                "risk": sum(item["needs_attention"] for item in items),
                "overdue": sum(item["is_overdue"] for item in items),
                "stale": sum(item["is_stale"] for item in items),
                "members": len({item["owner_id"] for item in items}),
            },
        }
