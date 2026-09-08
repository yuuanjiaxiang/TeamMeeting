const $ = (selector, root = document) => root.querySelector(selector);
const statusNames = { todo: "待处理", doing: "进行中", risk: "有风险", done: "已完成" };
const priorityNames = { high: "高", normal: "中", low: "低" };
const focusNames = { all: "全部事项", active: "未完成", risk: "有风险", overdue: "已逾期", due: "今日到期", stale: "待跟进" };

export function matchesMorningFocus(item, focus) {
  return ({
    all: true,
    active: item.status !== "done",
    risk: Boolean(item.needs_attention),
    overdue: Boolean(item.is_overdue),
    due: Boolean(item.due_today),
    stale: Boolean(item.is_stale),
  })[focus] ?? true;
}

export function createMorningFollowup({ state, api, escapeHtml, toast, render, organizationPath }) {
  let focus = "all";
  let scope = "";
  let report = null;
  let reportSequence = 0;
  let reportTrigger = null;
  const drafts = new Map();
  const modal = () => $("#morningReportModal");
  const scopeKey = () => `${state.user?.id || "guest"}:${organizationPath()}`;
  const draftKey = (id) => `${state.morningDate}:${id}`;
  const formValues = (form) => Object.fromEntries(new FormData(form));

  function syncScope() {
    if (scope === scopeKey()) return;
    scope = scopeKey();
    focus = "all";
    drafts.clear();
    report = null;
    reportSequence += 1;
    for (const id of ["morningKeyword", "morningPriorityFilter", "morningNavigatorSearch"]) {
      if ($(`#${id}`)) $(`#${id}`).value = "";
    }
    if (modal()?.open) modal().close();
  }

  function matches(item) {
    const keyword = ($("#morningKeyword")?.value || "").trim().toLocaleLowerCase();
    const priority = $("#morningPriorityFilter")?.value || "";
    const text = [item.title, item.owner_name, item.owner_account, item.detail, item.blocker].join(" ").toLocaleLowerCase();
    return matchesMorningFocus(item, focus) && (!priority || item.priority === priority) && (!keyword || text.includes(keyword));
  }

  function hasFilters() {
    return focus !== "all" || Boolean($("#morningKeyword")?.value.trim() || $("#morningPriorityFilter")?.value);
  }

  function renderSummary() {
    syncScope();
    const target = $("#morningStats");
    target.innerHTML = Object.entries(focusNames).map(([key, name]) => `
      <button type="button" class="followup-metric ${key === focus ? "is-active" : ""} tone-${key}"
        data-morning-focus="${key}" aria-pressed="${key === focus}"
        ${key === "stale" ? 'title="连续至少 3 个工作日没有手动更新；自动继承不计作更新"' : ""}>
        <span>${name}</span><strong>${state.morningItems.filter((item) => matchesMorningFocus(item, key)).length}</strong>
      </button>`).join("");
  }

  function renderDraftCount() {
    const count = [...drafts.keys()].filter((key) => key.startsWith(`${state.morningDate}:`)).length;
    $("#morningDraftStatus").textContent = count ? `${count} 项有未保存更改` : "";
  }

  function restoreDrafts() {
    syncScope();
    document.querySelectorAll(".morning-item-form").forEach((form) => {
      form.dataset.savedValues = JSON.stringify(formValues(form));
      const draft = drafts.get(draftKey(form.dataset.itemId));
      if (!draft) return;
      const conflict = draft.expected_version !== form.elements.expected_version.value;
      Object.entries(draft).forEach(([key, value]) => {
        if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
      });
      const note = document.createElement("div");
      note.className = `morning-draft-note ${conflict ? "has-conflict" : ""}`;
      note.innerHTML = `<span>${conflict ? "该事项已有新版本，你的输入已保留。请先核对最新进展。" : "未保存"}</span>
        <button type="button" class="secondary" data-drop-morning-draft="${form.dataset.itemId}">${conflict ? "放弃草稿，加载新版" : "放弃更改"}</button>`;
      form.append(note);
    });
    renderDraftCount();
  }

  function captureDraft(event) {
    const form = event.target.closest(".morning-item-form");
    if (!form) return;
    const values = formValues(form);
    if (JSON.stringify(values) === form.dataset.savedValues) drafts.delete(draftKey(form.dataset.itemId));
    else drafts.set(draftKey(form.dataset.itemId), values);
    renderDraftCount();
  }

  function dropDraft(id) { drafts.delete(draftKey(id)); }
  function hasDrafts() {
    syncScope();
    return [...drafts.keys()].some((key) => key.startsWith(`${state.morningDate}:`));
  }

  function reportText() {
    if (!report) return "";
    const s = report.summary;
    const lines = [`# ${report.organization.toUpperCase()} 项目进展汇总`, `${report.from} 至 ${report.to}`,
      `事项 ${s.total} | 期间完成 ${s.completed} | 未完成 ${s.active} | 风险 ${s.risk} | 逾期 ${s.overdue} | 待跟进 ${s.stale}`,
      "", "统计口径：按事项合并跨日记录，展示截至结束日的状态；包含未完成事项与期间完成事项。连续 3 个工作日未手动更新标为待跟进。", ""];
    for (const group of reportGroups()) {
      lines.push(`## ${group.name}（${group.account}）`, "");
      group.items.forEach((item) => {
        lines.push(`### ${item.title}`, `状态：${statusNames[item.status]} | 优先级：${priorityNames[item.priority]} | 到期：${item.due_date || "未设置"}`,
          `最近手动更新：${item.last_progress_date} | 期间更新记录：${item.period_updates} 条`);
        if (item.detail) lines.push(`进展：${item.detail}`);
        if (item.blocker) lines.push(`风险：${item.blocker}`);
        const flags = attentionLabels(item);
        if (flags.length) lines.push(`关注：${flags.join("、")}`);
        lines.push("");
      });
    }
    if (!report.items.length) lines.push("当前团队在此期间暂无事项。");
    return lines.join("\n");
  }

  function attentionLabels(item) {
    return [item.is_overdue && "已逾期", item.needs_attention && "风险待处理", item.is_stale && `${item.idle_workdays} 个工作日未更新`].filter(Boolean);
  }

  function reportGroups() {
    const groups = new Map();
    for (const item of report.items) {
      if (!groups.has(item.owner_id)) groups.set(item.owner_id, { name: item.owner_name, account: item.owner_account, items: [] });
      groups.get(item.owner_id).items.push(item);
    }
    return [...groups.values()];
  }

  function renderReport() {
    const s = report.summary;
    $("#morningReportSummary").textContent = `${report.organization.toUpperCase()} · ${report.from} 至 ${report.to} · ${s.members} 人 · 完成 ${s.completed} 项 · 未完成 ${s.active} 项`;
    $("#morningReportContent").innerHTML = reportGroups().map((group) => `
      <section class="progress-report-person"><h3>${escapeHtml(group.name)} <small>${escapeHtml(group.account)}</small></h3>
      ${group.items.map((item) => `<article class="progress-report-item">
        <div><strong>${escapeHtml(item.title)}</strong><span class="progress-report-status ${item.status === "done" ? "is-done" : ""}">${statusNames[item.status]}</span></div>
        <small>优先级 ${priorityNames[item.priority]} · 到期 ${escapeHtml(item.due_date || "未设置")} · 最近更新 ${escapeHtml(item.last_progress_date)}</small>
        ${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ""}
        ${item.blocker ? `<p class="report-risk">风险：${escapeHtml(item.blocker)}</p>` : ""}
        ${attentionLabels(item).length ? `<small class="report-risk">${escapeHtml(attentionLabels(item).join(" · "))}</small>` : ""}
      </article>`).join("")}</section>`).join("") || '<p class="empty-note">当前团队在此期间暂无事项</p>';
    setExportEnabled(true);
  }

  function setExportEnabled(enabled) {
    for (const id of ["copyMorningReport", "downloadMorningReport"]) $(`#${id}`).disabled = !enabled;
  }

  async function generateReport() {
    const form = $("#morningReportForm");
    if (!form.reportValidity()) return;
    const version = ++reportSequence;
    const reportScope = scopeKey();
    const data = new FormData(form);
    report = null;
    setExportEnabled(false);
    $("#morningReportSummary").textContent = "正在汇总…";
    $("#morningReportContent").replaceChildren();
    const button = $("button[type=submit]", form);
    button.disabled = true;
    try {
      const result = await api(`/api/morning-items/report?${new URLSearchParams({ from: data.get("from"), to: data.get("to") })}`);
      if (version !== reportSequence || reportScope !== scopeKey() || !modal().open) return;
      report = result;
      renderReport();
    } catch (error) {
      if (version === reportSequence) $("#morningReportSummary").textContent = error.message;
    } finally {
      if (version === reportSequence) button.disabled = false;
    }
  }

  function setPeriod(period) {
    const end = new Date();
    end.setHours(12, 0, 0, 0);
    const start = new Date(end);
    if (period === "month") start.setDate(1);
    else {
      start.setDate(start.getDate() - (start.getDay() + 6) % 7);
      if (period === "last") { end.setTime(start.getTime()); end.setDate(end.getDate() - 1); start.setDate(start.getDate() - 7); }
    }
    const localIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    $("#morningReportForm").elements.from.value = localIso(start);
    $("#morningReportForm").elements.to.value = localIso(end);
  }

  function install() {
    document.addEventListener("input", captureDraft);
    document.addEventListener("change", captureDraft);
    window.addEventListener("beforeunload", (event) => {
      if (drafts.size && scope === scopeKey()) { event.preventDefault(); event.returnValue = ""; }
    });
    for (const id of ["morningKeyword", "morningPriorityFilter"]) {
      $(`#${id}`).addEventListener(id === "morningKeyword" ? "input" : "change", render);
    }
    $("#morningNavigatorSearch").addEventListener("input", render);
    $("#morningClearFilters").addEventListener("click", () => {
      focus = "all";
      for (const id of ["morningKeyword", "morningPriorityFilter", "morningOwnerFilter", "morningStatusFilter", "morningNavigatorSearch"]) $(`#${id}`).value = "";
      render();
    });
    $("#morningStats").addEventListener("click", (event) => {
      const button = event.target.closest("[data-morning-focus]");
      if (!button) return;
      focus = button.dataset.morningFocus;
      render();
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-drop-morning-draft]");
      if (!button || !window.confirm("放弃这条事项的未保存更改，显示服务器最新内容？")) return;
      dropDraft(button.dataset.dropMorningDraft);
      render();
    });
    $("#openMorningReport").addEventListener("click", (event) => {
      syncScope();
      reportTrigger = event.currentTarget;
      setPeriod("week");
      modal().showModal();
      generateReport();
    });
    $("#closeMorningReport").addEventListener("click", () => modal().close());
    modal().addEventListener("close", () => { reportSequence += 1; reportTrigger?.focus(); });
    modal().addEventListener("click", (event) => { if (event.target === modal()) modal().close(); });
    $("#morningReportForm").addEventListener("submit", (event) => { event.preventDefault(); generateReport(); });
    $("#morningReportForm").addEventListener("change", () => {
      reportSequence += 1;
      report = null;
      setExportEnabled(false);
      $("#morningReportSummary").textContent = "日期已更改，请重新生成汇总";
      $("#morningReportContent").replaceChildren();
      $("#morningReportForm button[type=submit]").disabled = false;
    });
    document.querySelectorAll("[data-report-period]").forEach((button) => button.addEventListener("click", () => { setPeriod(button.dataset.reportPeriod); generateReport(); }));
    $("#copyMorningReport").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(reportText()); toast("已复制项目进展汇总"); }
      catch { toast("当前浏览器无法复制，请下载汇总文件"); }
    });
    $("#downloadMorningReport").addEventListener("click", () => {
      if (!report) return;
      const url = URL.createObjectURL(new Blob([reportText()], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `项目进展-${report.from}-${report.to}.md`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  return { install, matches, hasFilters, renderSummary, restoreDrafts, hasDrafts, dropDraft, syncScope };
}
