const titles = { scores: "红黑榜明细", thanks: "收到的 Thank You", shifts: "排班明细", morning: "早例会事项" };
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function renderDashboardDetailRows(kind, rows) {
  if (!rows.length) return '<p class="empty">当前范围内暂无可见明细。</p>';
  const statuses = { todo: "待处理", doing: "进行中", risk: "有风险", done: "已完成" };
  return rows.map((row) => {
    let title, meta, body, tone = "";
    if (kind === "scores") {
      tone = row.kind === "red" ? "detail-red" : "detail-black";
      title = `${row.kind === "red" ? "红榜" : "黑榜"} · ${row.points == null ? "积分已隐藏" : `${Math.abs(Number(row.points))} 分`}`;
      meta = row.score_date;
      body = [row.rule_title, row.evidence].filter(Boolean).join("\n");
    } else if (kind === "thanks") {
      title = `${row.giver_name}的感谢`;
      meta = `所属周 ${row.week_start} · ${row.created_at || ""}`;
      body = row.evidence;
    } else if (kind === "shifts") {
      title = `${row.machine_name || "机台"} · ${row.shift_type === "night" ? "夜班" : "白班"} · ${Number(row.hours)} 小时`;
      meta = row.shift_date;
      body = row.note;
    } else {
      title = row.title;
      meta = `${statuses[row.status] || row.status} · ${row.item_date}${row.due_date ? ` · 到期 ${row.due_date}` : ""}`;
      body = [row.detail, row.blocker ? `风险：${row.blocker}` : ""].filter(Boolean).join("\n");
    }
    return `<article><h3 class="${tone}">${escape(title)}</h3><small>${escape(meta)}</small>${body ? `<p>${escape(body)}</p>` : ""}</article>`;
  }).join("");
}

export function createDashboardDetails(isCurrent) {
  let snapshot = null;
  let dialog;
  const buttons = () => document.querySelectorAll("[data-dashboard-detail]");
  function clear() {
    snapshot = null;
    dialog?.close();
    if (dialog) dialog.querySelector(".dashboard-details-list").replaceChildren();
    buttons().forEach((button) => { button.disabled = true; });
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dashboard-detail]");
    if (!button || !snapshot) return;
    if (!isCurrent(snapshot.context)) { clear(); return; }
    const kind = button.dataset.dashboardDetail;
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "dashboardDetailsDialog";
      dialog.setAttribute("aria-labelledby", "dashboardDetailsTitle");
      dialog.innerHTML = '<header><div><h2 id="dashboardDetailsTitle"></h2><p></p></div><button type="button" class="detail-close" aria-label="关闭详情" title="关闭">×</button></header><div class="dashboard-details-list" tabindex="0"></div>';
      document.body.append(dialog);
      dialog.querySelector("button").addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", (e) => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
    }
    const data = snapshot[kind];
    dialog.querySelector("h2").textContent = `${snapshot.owner} · ${titles[kind]}`;
    dialog.querySelector("header p").textContent = `${data.period}\n${data.summary}${data.note ? `\n${data.note}` : ""}`;
    dialog.querySelector(".dashboard-details-list").innerHTML = renderDashboardDetailRows(kind, data.rows);
    dialog.showModal();
    dialog.querySelector(".dashboard-details-list").scrollTop = 0;
  });
  return {
    clear,
    update(value) {
      snapshot = value;
      buttons().forEach((button) => {
        const data = value[button.dataset.dashboardDetail];
        button.disabled = !data?.available;
        button.title = data?.available ? "查看详情" : "暂无访问权限或加载失败，请刷新重试";
      });
    },
  };
}
