"""Paged forum discovery; reply trees are fetched only for the selected topic."""
from ..permissions import *


class ForumReadsHandlerMixin:
    def team_post_page(self, query, user):
        try:
            page = max(1, int((query.get("page") or [1])[0]))
            size = min(50, max(1, int((query.get("page_size") or [12])[0])))
        except (TypeError, ValueError) as exc:
            raise AppError(400, "分页参数不正确") from exc
        keyword = str((query.get("keyword") or [""])[0]).strip()
        if len(keyword) > 80:
            raise AppError(400, "搜索关键词最多 80 字")
        category = (query.get("category") or ["all"])[0]
        sort = (query.get("sort") or ["recent"])[0]
        orders = {"recent": "COALESCE(p.updated_at,p.created_at) DESC", "popular": "reply_count DESC", "views": "p.view_count DESC"}
        with connect() as conn:
            conn.execute("BEGIN")
            context = self.organization_context(conn, user)
            org_where, params = self.organization_entity_filter(conn, "p.org_unit_id", user)
            inherited = context["inherited_ids"]
            if inherited:
                org_where = f"({org_where} OR (p.category='announcement' AND p.org_unit_id IN ({','.join('?' for _ in inherited)})))"
                params = [*params, *inherited]
            base = f"p.deleted_at IS NULL AND {org_where}"
            joins = "FROM team_posts p JOIN users u ON u.id=p.user_id LEFT JOIN org_units o ON o.id=p.org_unit_id"
            where = [base]
            filtered_params = list(params)
            if category != "all":
                if category not in TEAM_POST_CATEGORIES:
                    raise AppError(400, "讨论分类不正确")
                where.append("p.category=?")
                filtered_params.append(category)
            if query.get("mine") == ["1"]:
                where.append("p.user_id=?")
                filtered_params.append(user["id"] if user else -1)
            if keyword:
                where.append("(p.title LIKE ? OR p.content LIKE ? OR u.display_name LIKE ? OR u.username LIKE ?)")
                filtered_params.extend([f"%{keyword}%"] * 4)
            filtered = " AND ".join(where)
            total = conn.execute(f"SELECT COUNT(*) {joins} WHERE {filtered}", filtered_params).fetchone()[0]
            page = min(page, max(1, (total + size - 1) // size))
            reply_count = "(SELECT COUNT(*) FROM team_post_replies r WHERE r.post_id=p.id AND r.deleted_at IS NULL)"
            columns = f"""p.id, p.user_id, p.org_unit_id, p.title, p.category, p.status, p.pinned,
                p.view_count, p.created_at, p.updated_at, substr(p.content,1,160) AS content,
                u.display_name, u.username, o.name AS org_unit_name,
                {reply_count} AS reply_count,
                (SELECT r.created_at FROM team_post_replies r WHERE r.post_id=p.id AND r.deleted_at IS NULL ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS last_reply_at,
                (SELECT ru.display_name FROM team_post_replies r JOIN users ru ON ru.id=r.user_id WHERE r.post_id=p.id AND r.deleted_at IS NULL ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS last_reply_name"""
            rank = orders.get(sort, orders['recent']).replace("reply_count", reply_count)
            selected = conn.execute(
                f"SELECT p.id {joins} WHERE {filtered} ORDER BY p.pinned DESC,{rank},p.id DESC LIMIT ? OFFSET ?",
                [*filtered_params, size, (page - 1) * size],
            ).fetchall()
            ids = [row[0] for row in selected]
            posts = rows_to_list(conn.execute(
                f"SELECT {columns} {joins} WHERE p.id IN ({','.join('?' for _ in ids) or 'NULL'})", ids,
            ).fetchall())
            positions = {post_id: index for index, post_id in enumerate(ids)}
            posts.sort(key=lambda post: positions[post['id']])
            hot = rows_to_list(conn.execute(
                f"SELECT p.id,p.title,substr(p.content,1,80) AS content,p.view_count,{reply_count} AS reply_count {joins} WHERE {base} ORDER BY ({reply_count}*3+p.view_count) DESC,p.id DESC LIMIT 3",
                params,
            ).fetchall())
            active = rows_to_list(conn.execute(
                f"SELECT u.display_name,COUNT(*) AS topics {joins} WHERE {base} GROUP BY u.id ORDER BY topics DESC,u.id LIMIT 6",
                params,
            ).fetchall())
        for post in posts:
            post["inherited"] = post["org_unit_id"] not in context["visible_ids"]
            post["mine"] = bool(user and post["user_id"] == user["id"])
        return {"posts": posts, "pagination": {"page": page, "page_size": size, "total": total}, "hot": hot, "active": active}
