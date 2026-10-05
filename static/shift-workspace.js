export function groupShiftRows(shifts, { keyword = "", type = "" } = {}) {
  const groups = new Map();
  const search = keyword.trim().toLocaleLowerCase();
  for (const shift of shifts) {
    if (type && shift.shift_type !== type) continue;
    if (search && ![shift.machine_name, shift.display_name, shift.note].join(" ").toLocaleLowerCase().includes(search)) continue;
    if (!groups.has(shift.shift_date)) groups.set(shift.shift_date, []);
    groups.get(shift.shift_date).push(shift);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => [date,
    [...rows].sort((a, b) => (a.shift_type === "night") - (b.shift_type === "night") || String(a.machine_name).localeCompare(String(b.machine_name), "zh-CN"))]);
}

export function createShiftWorkspace({ getShifts, escapeHtml, canDelete }) {
  let view = "calendar";
  let keyword = "";
  let type = "";
  let installed = false;
  const el = (id) => document.getElementById(id);
  function render() {
    if (!el("shiftWorkspaceTools")) return;
    if (!installed) {
      installed = true;
      el("shiftWorkspaceTools").addEventListener("click", (event) => {
        const button = event.target.closest("[data-shift-view]");
        if (button) { view = button.dataset.shiftView; render(); }
      });
      el("shiftListSearch").addEventListener("input", (event) => { keyword = event.target.value; render(); });
      el("shiftListType").addEventListener("change", (event) => { type = event.target.value; render(); });
    }
    el("shiftCalendar").hidden = view !== "calendar";
    el("shiftAgenda").hidden = view !== "agenda";
    el("shiftAgendaFilters").hidden = view !== "agenda";
    el("shiftWorkspaceTools").querySelectorAll("[data-shift-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.shiftView === view)));
    const shifts = getShifts();
    const groups = groupShiftRows(shifts, { keyword, type });
    el("shiftMonthSummary").textContent = `${shifts.length} 条排班 · 白班 ${shifts.filter((row) => row.shift_type !== "night").length} · 夜班 ${shifts.filter((row) => row.shift_type === "night").length}`;
    el("shiftAgenda").innerHTML = groups.map(([date, rows]) => `<section class="shift-agenda-day"><h3>${escapeHtml(date)} <small>${rows.length} 条</small></h3>
      <table><thead><tr><th>班次</th><th>机台</th><th>人员</th><th>工时 / 备注</th>${canDelete() ? '<th>操作</th>' : ''}</tr></thead><tbody>${rows.map((row) => `<tr>
        <td><span class="shift-agenda-type ${row.shift_type === "night" ? "night" : "day"}">${row.shift_type === "night" ? "夜班" : "白班"}</span></td>
        <td>${escapeHtml(row.machine_name || "未指定")}</td><td>${escapeHtml(row.display_name || "未指定")}</td>
        <td>${Number(row.hours || 0)} 小时${row.note ? `<br>${escapeHtml(row.note)}` : ""}</td>
        ${canDelete() ? `<td><button type="button" class="shift-delete-btn shift-agenda-delete" data-shift-id="${Number(row.id)}" title="删除排班">删除</button></td>` : ""}</tr>`).join("")}</tbody></table></section>`).join("") || '<p class="empty-note">暂无匹配排班</p>';
  }
  return { render };
}
