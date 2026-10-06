export function agendaColor(item) {
  if (/^#[0-9a-f]{6}$/i.test(item.type_color || "")) return item.type_color;
  const colors = ["#2563eb", "#b45309", "#047857", "#be185d", "#7c3aed", "#0e7490"];
  return colors[Math.abs(Number(item.type_id || item.option_id || item.id || 0)) % colors.length];
}

export function createMeetingCalendarPlanner({ escapeHtml: e, scope, canCreate, openPicker }) {
  const selected = new Map();
  let currentScope = "";
  let installed = false;
  const el = (id) => document.getElementById(id);
  function sync() {
    const next = scope();
    if (next !== currentScope) { selected.clear(); currentScope = next; }
  }
  function renderSelection() {
    el("meetingBatchCount").textContent = `已选 ${selected.size} 天`;
    el("meetingBatchOpen").disabled = !selected.size;
    el("meetingBatchDates").innerHTML = [...selected.keys()].sort().map((date) => `<button type="button" data-unselect-meeting-date="${date}" aria-label="取消 ${date}">${date} ×</button>`).join("");
  }
  function render(meetings) {
    sync();
    el("meetingBatchToolbar").hidden = !canCreate();
    document.querySelectorAll("#meetingCalendar .meeting-day").forEach((cell) => {
      const date = cell.dataset.date;
      const candidates = meetings.filter((meeting) => meeting.meeting_date === date && !meeting.inherited && !["completed", "archived"].includes(meeting.status));
      cell._batchCandidates = candidates;
      if (selected.has(date) && !cell.classList.contains("other")) selected.set(date, candidates);
      if (canCreate()) cell.querySelector(".day-no").insertAdjacentHTML("beforeend", `<label class="meeting-date-check"><input type="checkbox" data-meeting-date="${date}" aria-label="选择 ${date}" ${selected.has(date) ? 'checked' : ''}></label>`);
    });
    renderSelection();
    if (installed) return;
    installed = true;
    el("meetingCalendar").addEventListener("click", (event) => {
      if (event.target.closest(".meeting-date-check")) event.stopPropagation();
    });
    el("meetingCalendar").addEventListener("change", (event) => {
      const input = event.target.closest("[data-meeting-date]");
      if (!input) return;
      if (input.checked && selected.size >= 62) { input.checked = false; return; }
      if (input.checked) selected.set(input.dataset.meetingDate, input.closest(".meeting-day")._batchCandidates || []);
      else selected.delete(input.dataset.meetingDate);
      renderSelection();
    });
    el("meetingBatchToolbar").addEventListener("click", (event) => {
      const remove = event.target.closest("[data-unselect-meeting-date]");
      if (remove) {
        selected.delete(remove.dataset.unselectMeetingDate);
        document.querySelectorAll("[data-meeting-date]").forEach((input) => { input.checked = selected.has(input.dataset.meetingDate); });
        renderSelection();
      }
    });
    el("meetingBatchOpen").addEventListener("click", () => {
      sync();
      if (!selected.size || !canCreate()) return;
      openPicker();
      el("meetingBatchTargets").hidden = false;
      el("meetingBatchTargets").innerHTML = [...selected].sort(([a], [b]) => a.localeCompare(b)).map(([date, meetings]) => `<label>${e(date)}<select data-batch-target-date="${date}" aria-label="${date} 目标会议">${meetings.map((meeting) => `<option value="${meeting.id}">${e(meeting.title)}${meeting.start_time ? ` ${e(meeting.start_time)}` : ''}</option>`).join('')}<option value="">新建会议</option></select></label>`).join('');
    });
  }
  return {
    render,
    dates() {
      sync();
      return [...el("meetingBatchTargets").querySelectorAll("[data-batch-target-date]")].filter((select) => selected.has(select.dataset.batchTargetDate)).map((select) => ({ date: select.dataset.batchTargetDate, meeting_id: select.value || null }));
    },
    clear() { selected.clear(); renderSelection(); },
  };
}
