import { buildMinutesDocument, meetingOverview, plannedAgendaTime, isSystemThanks } from "./meeting-minutes.js";

export function createMeetingWorkspace({ state, api, escapeHtml: e, toast, organizationPath, canOperate, isAdminView,
  meetingIsLocked, statusMeta, normalizeStatus, renderAttendanceSummary, renderAttendanceDashboard,
  renderCustomTopicForm, copyMinutes, openMailDraft, mondayOf, refreshSelection }) {
  const $ = (selector) => document.querySelector(selector);
  let selectedKey = "";
  let scope = "";
  let panel = "agenda";
  let agendaFilter = "all";
  let includeThanks = false;
  let documentData = null;
  let previewSequence = 0;
  const contextKey = (meeting) => `${state.user?.id || "guest"}:${organizationPath()}:${meeting?.id || ""}`;
  const current = () => state.meetings.find((meeting) => Number(meeting.id) === Number(state.selectedMeetingId));

  function syncScope() {
    const next = `${state.user?.id || "guest"}:${organizationPath()}`;
    if (next === scope) return;
    scope = next;
    for (const id of ["meetingSearch", "meetingStatusFilter"]) if ($(`#${id}`)) $(`#${id}`).value = "";
    selectedKey = "";
    documentData = null;
    previewSequence += 1;
    for (const id of ["meetingCustomAgendaModal", "meetingManagementModal"]) if ($(`#${id}`)?.open) $(`#${id}`).close();
  }

  function matchesMeeting(meeting) {
    const search = ($("#meetingSearch")?.value || "").trim().toLocaleLowerCase();
    const status = $("#meetingStatusFilter")?.value || "";
    return (!status || normalizeStatus(meeting.status) === status)
      && (!search || [meeting.title, meeting.summary, meeting.creator, ...(meeting.items || []).map((item) => item.title)].join(" ").toLocaleLowerCase().includes(search));
  }

  function renderList(meetings, range) {
    syncScope();
    $("#meetingListTitle").textContent = range.label === "本周" ? "本周会议" : "月度会议";
    $("#meetingListHint").textContent = `${range.from} 至 ${range.to} · ${meetings.length} 场`;
    document.querySelectorAll("[data-meeting-list-scope]").forEach((button) => {
      const active = button.dataset.meetingListScope === state.meetingListScope;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $("#meetingList").innerHTML = meetings.map((meeting) => {
      const s = meetingOverview(meeting);
      const status = statusMeta[normalizeStatus(meeting.status)];
      const active = Number(meeting.id) === Number(state.selectedMeetingId);
      return `<button type="button" class="meeting-select-btn mw-meeting-row ${active ? "active" : ""}" data-meeting-id="${meeting.id}" aria-pressed="${active}">
        <span class="mw-list-date">${e(meeting.meeting_date.slice(5).replace("-", "/"))} <span>${e(meeting.start_time || "时间待定")}</span><em class="mw-state ${status[2]}">${status[0]}</em></span>
        <strong>${e(meeting.title)}</strong>
        <small>${s.total} 个议题 · 纪要 ${s.recorded}/${s.manual}${meeting.inherited ? ` · 上级 ${e(meeting.org_unit_name || "")}` : ""}</small>
        <span class="mw-list-progress" aria-hidden="true"><i style="width:${s.manual ? s.recorded / s.manual * 100 : 0}%"></i></span>
      </button>`;
    }).join("") || '<p class="mw-empty">当前条件下没有会议</p>';
  }

  function renderAgendaItem(item, meeting) {
    const index = meeting.items.indexOf(item);
    const locked = meetingIsLocked(meeting) || meeting.inherited;
    const editable = !locked && canOperate("meetings", "edit");
    const recorded = Boolean(item.minutes?.trim());
    return `<article class="mw-agenda-item meeting-agenda-item" data-meeting-item-id="${item.id}" draggable="${editable}">
      <div class="mw-agenda-index"><strong>${String(index + 1).padStart(2, "0")}</strong><small>${e(plannedAgendaTime(meeting, index))}</small>${editable ? '<span class="agenda-drag-handle" aria-hidden="true" title="拖动调整议题顺序">⋮⋮</span>' : ""}</div>
      <div class="mw-agenda-body">
        <div class="mw-agenda-heading"><h3>${e(item.title)}</h3><span class="mw-record-state ${recorded ? "is-recorded" : ""}">${isSystemThanks(item) ? "系统汇总" : recorded ? "已记录" : "待记录"}</span></div>
        <p class="mw-agenda-meta">${e(item.type_name || item.section || "议题")} · ${e(item.owner_name || "未指定负责人")} · ${Number(item.duration_minutes || 10)} 分钟${item.due_date ? ` · 截止 ${e(item.due_date)}` : ""}${item.carried_from_id ? " · 上场顺延" : ""}</p>
        <p class="mw-agenda-excerpt">${e(item.minutes || item.expected_output || item.detail || "暂无议题说明")}</p>
        <div class="mw-agenda-bottom">
          <details class="mw-agenda-details"><summary>展开内容</summary>
            ${[["背景", item.detail], ["期望产出", item.expected_output], ["会前材料", item.materials], ["结论", item.minutes], ["风险 / 待确认", item.open_issues], ["下一步", item.next_steps]].filter(([, value]) => value).map(([label, value]) => `<div><strong>${label}</strong><p>${e(value)}</p></div>`).join("") || '<p class="mw-muted">暂无补充内容</p>'}
          </details>
          <div class="mw-item-actions">
            ${editable ? `<button class="secondary meeting-minute-btn" type="button" data-item-id="${item.id}">${isSystemThanks(item) ? "议题设置" : recorded ? "编辑纪要" : "记录结论"}</button>
            <button class="secondary mw-order-button" type="button" data-mw-order="up" data-item-id="${item.id}" aria-label="上移议题" title="上移议题" ${index === 0 ? "disabled" : ""}>↑</button>
            <button class="secondary mw-order-button" type="button" data-mw-order="down" data-item-id="${item.id}" aria-label="下移议题" title="下移议题" ${index === meeting.items.length - 1 ? "disabled" : ""}>↓</button>` : ""}
            ${!locked && (canOperate("meetings", "edit") || canOperate("meetings", "delete")) ? `<details class="mw-item-menu"><summary aria-label="更多议题操作" title="更多议题操作">···</summary><div>
              ${editable ? `<button class="secondary meeting-carry-btn" type="button" data-item-id="${item.id}">顺延至下场</button>` : ""}
              ${canOperate("meetings", "delete") ? `<button class="danger meeting-item-delete-btn" type="button" data-item-id="${item.id}" data-item-title="${e(item.title)}">删除议题</button>` : ""}
            </div></details>` : ""}
          </div>
        </div>
      </div>
    </article>`;
  }

  function renderDetail(meeting) {
    syncScope();
    const key = contextKey(meeting);
    if (selectedKey !== key) {
      selectedKey = key;
      panel = meeting && meetingIsLocked(meeting) ? "minutes" : "agenda";
      agendaFilter = "all";
      includeThanks = false;
    }
    documentData = null;
    previewSequence += 1;
    const target = $("#meetingDetail");
    if (!meeting) {
      target.innerHTML = '<div class="mw-empty-detail"><h2>暂无选中的会议</h2><p>本月暂无会议时，可切换月份查看历史记录。</p></div>';
      return;
    }
    const s = meetingOverview(meeting);
    const status = statusMeta[normalizeStatus(meeting.status)];
    const locked = meetingIsLocked(meeting) || meeting.inherited;
    const editable = !locked && canOperate("meetings", "create");
    target.innerHTML = `<header class="mw-detail-header">
      <div class="mw-detail-meta"><span>${e(meeting.meeting_date)} ${e(meeting.start_time || "时间待定")}</span><span class="mw-state ${status[2]}">${status[0]}</span>${meeting.inherited ? `<span>上级安排 · ${e(meeting.org_unit_name || "")}</span>` : ""}</div>
      <h2>${e(meeting.title)}</h2>
      ${meeting.summary ? `<p class="mw-meeting-summary">${e(meeting.summary)}</p>` : ""}
      <div class="mw-header-bottom"><span class="mw-muted">召集人 ${e(meeting.creator || "未记录")}</span><div class="mw-header-actions">
        ${editable ? `<button class="secondary meeting-agenda-picker-btn" type="button" data-meeting-id="${meeting.id}">添加预设议题</button><button class="secondary" type="button" data-mw-custom>自定义议题</button>` : ""}
        <button class="secondary meeting-attendance-btn" type="button" data-meeting-id="${meeting.id}">${isAdminView() && !locked ? "签到" : "查看签到"}</button>
      </div></div>
      ${isAdminView() && !meeting.inherited ? `<div class="mw-lifecycle" aria-label="会议阶段">${Object.entries(statusMeta).map(([value, meta]) => `<button type="button" data-meeting-id="${meeting.id}" data-meeting-status="${value}" aria-pressed="${normalizeStatus(meeting.status) === value}">${meta[0]}</button>`).join("")}${!locked ? `<button type="button" class="meeting-copy-agenda-btn" data-meeting-id="${meeting.id}">沿用上场议题</button>` : ""}</div>` : ""}
    </header>
    <div class="mw-overview"><span><strong>${s.total}</strong> 议题</span><span><strong>${s.duration}</strong> 预计分钟</span><span><strong>${s.recorded}/${s.manual}</strong> 纪要已记录</span><span class="${s.unassigned ? "mw-warning" : ""}"><strong>${s.unassigned}</strong> 待分配负责人</span></div>
    <div class="mw-tabs" role="tablist" aria-label="会议内容">${[["agenda", "议程"], ["minutes", "会议纪要"], ["attendance", "参会情况"]].map(([value, label]) => `<button type="button" role="tab" id="mw-tab-${value}" data-mw-tab="${value}" aria-controls="mw-panel" aria-selected="${panel === value}" tabindex="${panel === value ? 0 : -1}">${label}</button>`).join("")}</div>
    <div id="mw-panel" role="tabpanel" aria-labelledby="mw-tab-${panel}">
    ${panel === "agenda" ? `<div class="mw-agenda-toolbar"><div class="mw-filter-segments" role="group" aria-label="议程筛选">${[["all", "全部"], ["missing", "待记录"], ["unassigned", "未分配"]].map(([value, label]) => `<button type="button" data-mw-filter="${value}" aria-pressed="${agendaFilter === value}">${label}</button>`).join("")}</div><small>${meeting.start_time ? "时间为预计议程顺序" : "尚未设置开始时间"}</small></div>
      <div class="meeting-agenda-list" data-meeting-agenda-list="${meeting.id}">${meeting.items.filter((item) => agendaFilter === "all" || (agendaFilter === "unassigned" ? !item.owner_id : !isSystemThanks(item) && !item.minutes?.trim())).map((item) => renderAgendaItem(item, meeting)).join("") || '<p class="mw-empty">暂无符合条件的议题</p>'}</div>` : ""}
    ${panel === "minutes" ? `<div class="mw-document-toolbar"><label><input id="mwIncludeThanks" type="checkbox" ${includeThanks ? "checked" : ""} ${!canOperate("thanks", "view") ? "disabled" : ""}>附带本周 Thank You</label><div>
      <button class="secondary" type="button" data-mw-export="copy" disabled>复制纪要</button>
      <select id="mwDownloadFormat" aria-label="纪要下载格式"><option value="html">HTML 文档</option><option value="md">Markdown</option></select><button class="secondary" type="button" data-mw-export="download" disabled>下载</button>
      <button type="button" data-mw-export="email" disabled>生成邮件</button></div></div>
      <p id="mwDocumentState" role="status"></p><div id="mwDocumentPreview" class="mw-document-paper"></div>` : ""}
    ${panel === "attendance" ? `<section class="mw-attendance">${renderAttendanceSummary(meeting)}<div class="mw-attendance-people">${state.meetingUsers.map((user) => {
      const record = (meeting.attendance || []).find((row) => Number(row.user_id) === Number(user.id));
      return `<div><span>${e(user.display_name)}</span><span class="mw-attendance-state ${record?.status || ""}">${({ present: "出席", late: "迟到", leave: "请假", absent: "缺席" })[record?.status] || "未签到"}</span></div>`;
    }).join("") || '<p class="mw-empty">当前团队暂无参会成员</p>'}</div><details class="mw-month-attendance"><summary>本月参会统计</summary>${renderAttendanceDashboard(state.meetings)}</details></section>` : ""}
    </div>`;
    if (panel === "minutes") loadPreview(meeting);
  }

  async function loadPreview(meeting) {
    const sequence = ++previewSequence;
    const key = contextKey(meeting);
    documentData = null;
    $("#mwDocumentState").textContent = "正在整理纪要…";
    $("#mwDocumentPreview").replaceChildren();
    document.querySelectorAll("[data-mw-export]").forEach((button) => button.disabled = true);
    try {
      let thankData = null;
      if (includeThanks) {
        const start = mondayOf(meeting.meeting_date);
        const votes = await api(`/api/thank-you?from=${start}&to=${start}`);
        const stars = await api(`/api/dashboards/thank-you?from=${start}&to=${start}`);
        thankData = { votes: votes.votes, stars: stars.stars };
      }
      if (sequence !== previewSequence || contextKey(current()) !== key || panel !== "minutes") return;
      documentData = buildMinutesDocument(meeting, thankData);
      $("#mwDocumentState").textContent = meetingIsLocked(meeting) ? "已结束会议 · 只读纪要" : "会议进行前或进行中 · 纪要草稿";
      $("#mwDocumentPreview").innerHTML = documentData.html;
      document.querySelectorAll("[data-mw-export]").forEach((button) => button.disabled = false);
    } catch (error) {
      if (sequence === previewSequence && $("#mwDocumentState")) $("#mwDocumentState").textContent = `读取 Thank You 失败：${error.message}。可取消勾选后重试。`;
    }
  }

  async function exportDocument(action, button) {
    if (!documentData) return;
    const content = documentData;
    const key = selectedKey;
    button.disabled = true;
    try {
      if (action === "copy" || action === "email") {
        const result = await copyMinutes(content.html, content.text);
        if (!result.ok) throw new Error(`复制失败：${result.reason}。可下载文档。`);
        if (key !== selectedKey) return;
        if (action === "email") {
          const opened = openMailDraft(content.subject);
          if (!opened.ok) throw new Error(`无法唤起邮件客户端：${opened.reason}`);
          toast("纪要已复制，已尝试打开邮件客户端，请在邮件正文粘贴");
        } else toast(result.method.startsWith("text") ? "已复制纯文本纪要" : "已复制排版后的会议纪要");
      } else {
        const format = $("#mwDownloadFormat").value;
        const body = format === "html" ? `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(content.subject)}</title><body style="margin:24px auto;padding:0 20px;max-width:840px;">${content.html}</body></html>` : content.text;
        const url = URL.createObjectURL(new Blob([body], { type: `${format === "html" ? "text/html" : "text/markdown"};charset=utf-8` }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `会议纪要-${current().meeting_date}-${current().id}.${format}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast("纪要文件已生成");
      }
    } catch (error) { toast(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  }

  function install({ reorder }) {
    $("#meetingSearch").addEventListener("input", refreshSelection);
    $("#meetingStatusFilter").addEventListener("change", refreshSelection);
    $("#meetingClearSearch").addEventListener("click", () => { $("#meetingSearch").value = ""; $("#meetingStatusFilter").value = ""; refreshSelection(); });
    document.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-mw-tab]");
      if (tab) { panel = tab.dataset.mwTab; renderDetail(current()); $(`[data-mw-tab="${panel}"]`)?.focus(); return; }
      const filter = event.target.closest("[data-mw-filter]");
      if (filter) { agendaFilter = filter.dataset.mwFilter; renderDetail(current()); return; }
      const exporter = event.target.closest("[data-mw-export]");
      if (exporter) { exportDocument(exporter.dataset.mwExport, exporter); return; }
      const order = event.target.closest("[data-mw-order]");
      if (order) {
        const meeting = current();
        const index = meeting.items.findIndex((item) => String(item.id) === order.dataset.itemId);
        const target = meeting.items[index + (order.dataset.mwOrder === "up" ? -1 : 1)];
        if (target) reorder(meeting.id, Number(order.dataset.itemId), target.id).catch((error) => toast(error.message));
        return;
      }
      if (event.target.closest("[data-mw-custom]")) {
        const meeting = current();
        if (!meeting || meetingIsLocked(meeting) || meeting.inherited || !canOperate("meetings", "create")) return;
        $("#meetingCustomAgendaContent").innerHTML = renderCustomTopicForm(meeting);
        $("#meetingCustomAgendaModal").showModal();
        return;
      }
      if (event.target.closest("#openMeetingManagement")) { if (isAdminView()) $("#meetingManagementModal").showModal(); return; }
      const close = event.target.closest("[data-mw-close]");
      if (close) close.closest("dialog").close();
    });
    document.addEventListener("change", (event) => {
      if (event.target.id === "mwIncludeThanks") { includeThanks = event.target.checked; loadPreview(current()); }
    });
    document.addEventListener("keydown", (event) => {
      if (!event.target.matches("[data-mw-tab]") || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const values = ["agenda", "minutes", "attendance"];
      panel = values[event.key === "Home" ? 0 : event.key === "End" ? 2 : (values.indexOf(panel) + (event.key === "ArrowRight" ? 1 : 2)) % 3];
      renderDetail(current());
      $(`[data-mw-tab="${panel}"]`).focus();
    });
  }

  return { install, renderDetail, renderList, renderAgendaItem, matchesMeeting, syncScope };
}
