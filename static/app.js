const state = {
  user: null,
  permissions: {},
  users: [],
  members: [],
  rules: [],
  machines: [],
  topics: [],
  linkCategories: [],
  links: [],
  meetings: [],
  settings: [],
  backups: [],
  auditLogs: [],
  shifts: [],
  currentPage: "members",
  shiftMonth: new Date(),
  selectedShiftDate: iso(new Date()),
  meetingMonth: new Date(),
  selectedMeetingDate: iso(new Date()),
  selectedMeetingId: null,
  viewMode: safeStorageGet("teamLoopViewMode", "admin"),
  uiTheme: safeStorageGet("teamLoopUiTheme", "yuque"),
};

const pages = [
  ["members", "👥", "团队成员", "先看人，再看事。成员档案、职责和团队对话都在这里。"],
  ["dashboard", "⌂", "工作台", "快速查看团队本周重点数据。"],
  ["meetings", "▦", "会议沙盘", "按会议沉淀议题、参会签到和行动项。"],
  ["shifts", "◷", "机台排班", "用月历查看白班/夜班，并统计周期工时。"],
  ["rules", "★", "红黑榜", "发布规则、记录积分，并按时间查看排行。"],
  ["thanks", "♥", "Thank You", "每周感谢帮助过自己的团队成员。"],
  ["links", "↗", "常用链接", "归档团队常用系统、文档和工具入口。"],
  ["users", "⚙", "用户管理", "管理员维护账号和权限。"],
  ["system", "▣", "系统管理", "配置、备份和审计日志。"],
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const dateFilterPages = new Set(["dashboard", "rules", "thanks"]);
const uiThemes = new Set(["feishu", "yuque", "linear", "dingtalk"]);

function safeStorageGet(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Theme preference is cosmetic; ignore storage failures.
  }
}

function applyUiTheme() {
  const theme = uiThemes.has(state.uiTheme) ? state.uiTheme : "yuque";
  state.uiTheme = theme;
  document.body.dataset.theme = theme;
  const select = $("#themeSelect");
  if (select) select.value = theme;
}

function setUiTheme(theme) {
  state.uiTheme = uiThemes.has(theme) ? theme : "yuque";
  safeStorageSet("teamLoopUiTheme", state.uiTheme);
  applyUiTheme();
}

function isAdminAccount() {
  return Boolean(state.permissions?.isAdmin);
}

function isAdminView() {
  return isAdminAccount() && state.viewMode !== "user";
}

function setViewMode(mode) {
  state.viewMode = mode === "user" ? "user" : "admin";
  safeStorageSet("teamLoopViewMode", state.viewMode);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function iso(date) {
  const value = new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mondayOf(value) {
  const d = new Date(value);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return iso(d);
}

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function setDefaultDates() {
  const today = iso(new Date());
  $("#fromDate").value = $("#fromDate").value || mondayOf(today);
  $("#toDate").value = $("#toDate").value || today;
  $$('input[type="date"]').forEach((input) => {
    if (!input.value) input.value = today;
  });
  const shiftStartDate = $('input[name="shift_start_date"]');
  const shiftEndDate = $('input[name="shift_end_date"]');
  if (shiftStartDate) shiftStartDate.value = state.selectedShiftDate;
  if (shiftEndDate && !shiftEndDate.value) shiftEndDate.value = state.selectedShiftDate;
  const meetingDate = $('input[name="meeting_date"]');
  if (meetingDate) meetingDate.value = state.selectedMeetingDate;
  const generateStart = $('input[name="start_date"]');
  if (generateStart) generateStart.value = mondayOf(state.selectedMeetingDate);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function formData(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  Object.keys(data).forEach((key) => {
    if (data[key] === "" || data[key] instanceof File) delete data[key];
  });
  return data;
}

function fullFormData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.size) return resolve("");
    if (!file.type.startsWith("image/")) return resolve("");
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const maxSize = 320;
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("头像图片读取失败"));
    };
    image.src = url;
  });
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
}

function periodQuery() {
  return `from=${encodeURIComponent($("#fromDate").value)}&to=${encodeURIComponent($("#toDate").value)}`;
}

function shiftPeriodQuery() {
  const start = monthStart(state.shiftMonth);
  const end = monthEnd(state.shiftMonth);
  return `from=${iso(start)}&to=${iso(end)}`;
}

function meetingPeriodQuery() {
  const start = monthStart(state.meetingMonth);
  const end = monthEnd(state.meetingMonth);
  return `from=${iso(start)}&to=${iso(end)}`;
}

function renderPageToolbar(id = state.currentPage) {
  const toolbar = $("#pageToolbar");
  if (!toolbar) return;
  const periodControls = $("#periodControls");
  const showDateFilter = dateFilterPages.has(id);
  toolbar.classList.toggle("toolbar-compact", !showDateFilter);
  if (periodControls) periodControls.classList.toggle("hidden", !showDateFilter);
}

function applyAuthView() {
  if (state.user && !isAdminAccount()) setViewMode("user");
  $("#loginView").classList.toggle("hidden", Boolean(state.user));
  $("#appView").classList.toggle("hidden", !state.user);
  const roleText = state.user?.role === "admin" ? "管理员" : "普通用户";
  const modeText = isAdminAccount() ? (isAdminView() ? "管理视图" : "用户视图") : "";
  $("#currentUser").textContent = state.user ? `${state.user.display_name} · ${roleText}${modeText ? ` · ${modeText}` : ""}` : "未登录";
  const viewModeBtn = $("#viewModeBtn");
  if (viewModeBtn) {
    viewModeBtn.classList.toggle("hidden", !isAdminAccount());
    viewModeBtn.textContent = isAdminView() ? "切换用户视图" : "切换管理视图";
  }
  $$(".admin-only").forEach((el) => el.classList.toggle("hidden", !isAdminView()));
  renderPageToolbar();
  renderNav();
}

function renderNav() {
  $("#nav").innerHTML = pages
    .filter(([id]) => !["users", "system"].includes(id) || isAdminView())
    .map(([id, icon, title]) => `<button class="nav-item ${state.currentPage === id ? "active" : ""}" data-page="${id}"><span>${icon}</span>${title}</button>`)
    .join("");
}

function switchPage(id) {
  if (!isAdminView() && ["users", "system"].includes(id)) id = "members";
  state.currentPage = id;
  $$(".page").forEach((page) => page.classList.toggle("active", page.id === id));
  const meta = pages.find((page) => page[0] === id);
  $("#pageTitle").textContent = meta?.[2] || "团队成员";
  $("#pageDesc").textContent = meta?.[3] || "";
  renderPageToolbar(id);
  renderNav();
}

async function loadReferenceData() {
  const [members, rules, machines, topics, linkCategories] = await Promise.all([
    api("/api/members"),
    api("/api/rules"),
    api("/api/machines"),
    api("/api/meeting-topics"),
    api("/api/link-categories"),
  ]);
  state.members = members.members;
  state.rules = rules.rules;
  state.machines = machines.machines;
  state.topics = topics.types;
  state.linkCategories = linkCategories.categories;
  if (isAdminView()) {
    state.users = (await api("/api/users")).users;
  } else {
    state.users = state.members
      .filter((member) => member.user_id)
      .map((member) => ({ id: member.user_id, display_name: member.linked_user || member.name, active: 1, role: "user" }));
  }
  populateSelects();
}

function populateSelects() {
  const activeUsers = state.users.filter((user) => user.active !== 0);
  const userOptions = activeUsers.map((user) => `<option value="${user.id}">${escapeHtml(user.display_name)}</option>`).join("");
  const userOptional = `<option value="">不绑定账号</option>${userOptions}`;
  const ruleOptions = `<option value="">不关联规则</option>${state.rules.map((rule) => `<option value="${rule.id}">${rule.kind === "red" ? "红" : "黑"} · ${escapeHtml(rule.title)}</option>`).join("")}`;
  const machineOptions = state.machines.map((machine) => `<option value="${machine.id}">${escapeHtml(machine.name)}</option>`).join("");
  const thankOptions = activeUsers.filter((user) => user.id !== state.user?.id).map((user) => `<option value="${user.id}">${escapeHtml(user.display_name)}</option>`).join("");
  const topicOptions = state.topics.map((topic) => `<option value="${topic.id}">${escapeHtml(topic.name)}</option>`).join("");
  const linkCategoryOptions = state.linkCategories.map((category) => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`).join("");

  $$("[data-users]").forEach((select) => { select.innerHTML = userOptions; });
  $$("[data-users-optional]").forEach((select) => { select.innerHTML = userOptional; });
  $$("[data-rules]").forEach((select) => { select.innerHTML = ruleOptions; });
  $$("[data-machines]").forEach((select) => { select.innerHTML = machineOptions; });
  $$("[data-thank-users]").forEach((select) => { select.innerHTML = thankOptions; });
  $$("[data-topic-types]").forEach((select) => { select.innerHTML = topicOptions; });
  $$("[data-link-categories]").forEach((select) => { select.innerHTML = linkCategoryOptions || '<option value="通用">通用</option>'; });
  const linkFilter = $("#linkCategoryFilter");
  if (linkFilter) {
    const current = linkFilter.value;
    linkFilter.innerHTML = `<option value="">全部分类</option>${linkCategoryOptions}`;
    linkFilter.value = state.linkCategories.some((category) => category.name === current) ? current : "";
  }
  const categoryList = $("#linkCategoryList");
  if (categoryList) {
    categoryList.innerHTML = state.linkCategories.length
      ? state.linkCategories.map((category) => `<span class="chip">${escapeHtml(category.name)}</span>`).join("")
      : "<p>暂无分类</p>";
  }
}

function table(headers, rows) {
  if (!rows.length) return "<p>暂无数据</p>";
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderRank(items, field, unit) {
  if (!items.length) return `<p>暂无数据</p>`;
  return items.map((item, index) => {
    const name = item.display_name || item.machine_name || "未命名";
    return `<div class="rank-row"><span class="rank-no">${index + 1}</span><strong>${escapeHtml(name)}</strong><span>${Number(item[field] || 0)} ${unit}</span></div>`;
  }).join("");
}

function settingValue(key, fallback = "") {
  const setting = state.settings.find((item) => item.key === key);
  return setting ? setting.value : fallback;
}

function formatBytes(value = 0) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadDashboard() {
  const [scores, thanks, shifts, meetings] = await Promise.all([
    api(`/api/dashboards/red-black?${periodQuery()}`),
    api(`/api/dashboards/thank-you?${periodQuery()}`),
    api(`/api/dashboards/shifts?${periodQuery()}`),
    api(`/api/meetings?${periodQuery()}`),
  ]);
  $("#metricScore").textContent = scores.totals.reduce((sum, item) => sum + Number(item.total || 0), 0);
  $("#metricThanks").textContent = thanks.stars.reduce((sum, item) => sum + Number(item.thanks || 0), 0);
  $("#metricHours").textContent = shifts.by_user.reduce((sum, item) => sum + Number(item.hours || 0), 0);
  $("#metricMeetings").textContent = meetings.meetings.filter((meeting) => meeting.status === "open").length;
  $("#scoreRank").innerHTML = renderRank(scores.totals, "total", "分");
  $("#thanksRank").innerHTML = renderRank(thanks.stars, "thanks", "次");
}

async function loadUsers() {
  if (!isAdminView()) return;
  const data = await api("/api/users");
  state.users = data.users;
  $("#userList").innerHTML = renderUserTable(data.users);
  populateSelects();
}

function renderUserTable(users) {
  if (!users.length) return "<p>暂无数据</p>";
  return `<table><thead><tr><th>账号</th><th>姓名 / 角色</th><th>密码</th><th>操作</th></tr></thead><tbody>${users.map((user) => `
    <tr>
      <td>${escapeHtml(user.username)}</td>
      <td>
        <form id="userEdit${user.id}" class="user-edit-form user-inline-form" data-user-id="${user.id}">
          <input name="display_name" value="${escapeHtml(user.display_name)}" placeholder="姓名" required>
          <select name="role" ${user.id === state.user?.id ? "disabled" : ""}>
            <option value="user" ${user.role === "user" ? "selected" : ""}>普通用户</option>
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>管理员</option>
          </select>
        </form>
      </td>
      <td><input form="userEdit${user.id}" class="user-password-input" name="password" placeholder="不修改则留空"></td>
      <td>
        <button form="userEdit${user.id}" type="submit">保存</button>
        ${user.id !== state.user?.id ? `<button class="danger user-delete-btn" data-user-id="${user.id}" data-user-name="${escapeHtml(user.display_name)}">删除</button>` : `<span class="pill">当前账号</span>`}
      </td>
    </tr>`).join("")}</tbody></table>`;
}

async function loadSystemAdmin() {
  if (!isAdminView()) return;
  const [settings, backups, logs] = await Promise.all([
    api("/api/settings"),
    api("/api/backups"),
    api("/api/audit-logs?limit=120"),
  ]);
  state.settings = settings.settings;
  state.backups = backups.backups;
  state.auditLogs = logs.logs;
  renderSettings();
  renderBackups();
  renderAuditLogs();
  applySettingDefaults();
}

function renderSettings() {
  const form = $("#settingsForm");
  if (!form) return;
  form.innerHTML = `
    <div class="settings-grid">
      ${state.settings.map((setting) => {
        const inputType = setting.value_type === "number" ? "number" : "text";
        if (setting.value_type === "boolean") {
          return `<label class="setting-field">
            <span>${escapeHtml(setting.label)}</span>
            <select name="${escapeHtml(setting.key)}">
              <option value="1" ${setting.value === "1" ? "selected" : ""}>启用</option>
              <option value="0" ${setting.value === "0" ? "selected" : ""}>停用</option>
            </select>
            <small>${escapeHtml(setting.description || "")}</small>
          </label>`;
        }
        return `<label class="setting-field">
          <span>${escapeHtml(setting.label)}</span>
          <input name="${escapeHtml(setting.key)}" type="${inputType}" value="${escapeHtml(setting.value)}">
          <small>${escapeHtml(setting.description || "")}</small>
        </label>`;
      }).join("")}
    </div>
    <button>保存系统配置</button>`;
}

function renderBackups() {
  const list = $("#backupList");
  if (!list) return;
  list.innerHTML = state.backups.length ? `
    <table>
      <thead><tr><th>文件</th><th>类型</th><th>大小</th><th>创建时间</th><th>创建人</th><th>操作</th></tr></thead>
      <tbody>
        ${state.backups.map((backup) => `
          <tr>
            <td>${escapeHtml(backup.filename)}</td>
            <td>${backup.kind === "auto" ? "自动" : "手动"}</td>
            <td>${formatBytes(backup.size_bytes)}</td>
            <td>${escapeHtml(backup.created_at || "")}</td>
            <td>${escapeHtml(backup.creator || "系统")}</td>
            <td><a class="link-url" href="/api/backups/download?file=${encodeURIComponent(backup.filename)}">下载</a></td>
          </tr>`).join("")}
      </tbody>
    </table>` : "<p>暂无备份</p>";
}

function renderAuditLogs() {
  const list = $("#auditLogList");
  if (!list) return;
  list.innerHTML = state.auditLogs.length ? `
    <table>
      <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>摘要</th></tr></thead>
      <tbody>
        ${state.auditLogs.map((log) => `
          <tr>
            <td>${escapeHtml(log.created_at)}</td>
            <td>${escapeHtml(log.actor || "系统")}</td>
            <td><span class="pill">${escapeHtml(log.action)}</span></td>
            <td>${escapeHtml(log.entity_type)}${log.entity_id ? ` #${escapeHtml(log.entity_id)}` : ""}</td>
            <td>${escapeHtml(log.summary || "")}</td>
          </tr>`).join("")}
      </tbody>
    </table>` : "<p>暂无审计日志</p>";
}

function applySettingDefaults() {
  const shiftHours = $('input[name="hours"]');
  if (shiftHours && !shiftHours.value) shiftHours.value = settingValue("shift_default_hours", "12");
  const thankEvidence = $('textarea[name="evidence"]');
  if (thankEvidence) thankEvidence.placeholder = `写下对方帮助你的具体事实。本周最多感谢 ${settingValue("thank_you_weekly_limit", "3")} 人。`;
  const scorePoints = $('input[name="points"]');
  if (scorePoints && !scorePoints.value) scorePoints.value = settingValue("red_score_default_points", "1");
}

async function loadRulesAndScores() {
  state.rules = (await api("/api/rules")).rules;
  const scores = (await api(`/api/scores?${periodQuery()}`)).scores;
  const renderRuleColumn = (kind, title) => {
    const rules = state.rules.filter((rule) => rule.kind === kind);
    return `<section class="rule-column ${kind}">
      <div class="rule-column-head">
        <span class="pill ${kind}">${title}</span>
        <small>${rules.length} 条</small>
      </div>
      <div class="item-list">
        ${rules.length ? rules.map((rule) => `<div class="item"><p>${escapeHtml(rule.content)}</p></div>`).join("") : "<p>暂无规则</p>"}
      </div>
    </section>`;
  };
  $("#ruleList").innerHTML = renderRuleColumn("red", "红榜") + renderRuleColumn("black", "黑榜");
  $("#scoreList").innerHTML = table(["日期", "成员", "类型", "积分", "规则", "依据"], scores.map((score) => [
    score.score_date,
    score.display_name,
    score.kind === "red" ? "红榜" : "黑榜",
    score.points,
    score.rule_title || "-",
    score.reason,
  ]));
  populateSelects();
}

function recurrenceRule(option = {}) {
  const type = option.recurrence_type || "weekly";
  const value = option.recurrence_value || option.recurrence_weeks || "1";
  return `${type}:${value}`;
}

function recurrenceOptions(selected = "weekly:1") {
  const options = [
    ["weekly:1", "每 1 周"],
    ["weekly:2", "每 2 周"],
    ["weekly:3", "每 3 周"],
    ["weekly:4", "每 4 周"],
    ["monthly_week:first", "每月第 1 周"],
    ["monthly_week:second", "每月第 2 周"],
    ["monthly_week:third", "每月第 3 周"],
    ["monthly_week:fourth", "每月第 4 周"],
    ["monthly_week:penultimate", "每月倒数第 2 周"],
    ["monthly_week:last", "每月最后 1 周"],
  ];
  return options.map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function renderPresetTypeOptions(selectedId) {
  return state.topics.map((topic) => `<option value="${topic.id}" ${Number(selectedId) === Number(topic.id) ? "selected" : ""}>${escapeHtml(topic.name)}</option>`).join("");
}

function renderTopicPresetList() {
  const rows = state.topics.flatMap((topic) => (topic.options || []).map((option) => ({ ...option, typeName: topic.name })));
  const list = $("#topicPresetList");
  if (!list) return;
  list.innerHTML = rows.length ? `
    <div class="preset-list">
      ${rows.map((option) => `
        <form class="preset-row preset-form" data-option-id="${option.id}">
          <select name="type_id">${renderPresetTypeOptions(option.type_id)}</select>
          <input name="title" value="${escapeHtml(option.title)}" placeholder="议题名称" required>
          <select name="recurrence_rule">${recurrenceOptions(recurrenceRule(option))}</select>
          <input name="default_detail" value="${escapeHtml(option.default_detail || "")}" placeholder="默认说明">
          <button>保存</button>
          <button class="danger preset-delete-btn" type="button" data-option-id="${option.id}">删除</button>
        </form>`).join("")}
    </div>` : "<p>暂无预设议题</p>";
}

function renderPresetTopicForm(meetingId) {
  const firstTopic = state.topics[0];
  const options = firstTopic?.options || [];
  return `
    <form class="form-grid compact topic-item-form" data-meeting-id="${meetingId}">
      <select name="type_id" data-meeting-topic-select required>${state.topics.map((topic) => `<option value="${topic.id}">${escapeHtml(topic.name)}</option>`).join("")}</select>
      <select name="option_id" data-meeting-option-select><option value="">自定义议题</option>${options.map((option) => `<option value="${option.id}">${escapeHtml(option.title)}</option>`).join("")}</select>
      <input name="title" placeholder="自定义标题，选择预设时可留空" />
      <select name="owner_id"><option value="">负责人</option>${state.users.map((user) => `<option value="${user.id}">${escapeHtml(user.display_name)}</option>`).join("")}</select>
      <input name="due_date" type="date" />
      <textarea name="detail" placeholder="议题说明、背景、结论或行动要求"></textarea>
      <button>添加到本次例会</button>
    </form>`;
}

function renderCustomTopicForm(meetingId) {
  return `
    <form class="form-grid compact topic-item-form custom-topic-form" data-meeting-id="${meetingId}">
      <select name="type_id" required>${state.topics.map((topic) => `<option value="${topic.id}">${escapeHtml(topic.name)}</option>`).join("")}</select>
      <input name="title" placeholder="自定义议题标题" required />
      <textarea name="detail" placeholder="补充议题背景、希望讨论的问题或建议结论"></textarea>
      <button>提交自定义议题</button>
    </form>`;
}

function renderMeetingItem(item) {
  const meta = [
    item.owner_name || "",
    item.created_by_name ? `提交：${item.created_by_name}` : "",
    item.due_date ? `截止：${item.due_date}` : "",
  ].filter(Boolean).join(" · ");
  return `<div class="topic-item">
    <strong>${escapeHtml(item.title)}</strong>
    ${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ""}
    ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
    <form class="minute-form" data-item-id="${item.id}">
      <textarea name="minutes" placeholder="输入本议题会议纪要">${escapeHtml(item.minutes || "")}</textarea>
      <button>保存纪要</button>
    </form>
  </div>`;
}

function renderTopicBoard(meeting) {
  const typed = new Set();
  const columns = state.topics.map((topic) => {
    const items = meeting.items.filter((item) => Number(item.type_id) === Number(topic.id) || item.section === topic.name);
    items.forEach((item) => typed.add(item.id));
    return `<section class="topic-column">
      <h4><span class="topic-dot" style="background:${escapeHtml(topic.color)}"></span>${escapeHtml(topic.name)}</h4>
      ${items.length ? items.map(renderMeetingItem).join("") : "<p>暂无议题</p>"}
    </section>`;
  });
  const others = meeting.items.filter((item) => !typed.has(item.id));
  if (others.length) {
    columns.push(`<section class="topic-column">
      <h4><span class="topic-dot"></span>其他议题</h4>
      ${others.map(renderMeetingItem).join("")}
    </section>`);
  }
  return `<div class="topic-board">${columns.join("")}</div>`;
}

function renderAttendance(meeting) {
  const map = new Map((meeting.attendance || []).map((item) => [Number(item.user_id), item]));
  if (!state.users.length) return "<p>暂无成员账号</p>";
  return `<div class="attendance-grid">${state.users.filter((user) => user.active !== 0).map((user) => {
    const record = map.get(Number(user.id)) || {};
    const status = record.status || "present";
    return `<form class="attendance-row" data-meeting-id="${meeting.id}">
      <strong>${escapeHtml(user.display_name)}</strong>
      <input type="hidden" name="user_id" value="${user.id}">
      <select name="status">
        <option value="present" ${status === "present" ? "selected" : ""}>出席</option>
        <option value="leave" ${status === "leave" ? "selected" : ""}>请假</option>
        <option value="absent" ${status === "absent" ? "selected" : ""}>缺席</option>
        <option value="late" ${status === "late" ? "selected" : ""}>迟到</option>
      </select>
      <label><input type="checkbox" name="donation_required" ${record.donation_required ? "checked" : ""}>乐捐</label>
      <label><input type="checkbox" name="donation_done" ${record.donation_done ? "checked" : ""}>完成</label>
      <input name="note" value="${escapeHtml(record.note || "")}" placeholder="备注">
      <button class="admin-only">保存</button>
    </form>`;
  }).join("")}</div>`;
}

function buildMeetingEmailHref(meeting) {
  const statusMap = { present: "出席", leave: "请假", absent: "缺席", late: "迟到" };
  const lines = [
    "各位好，",
    "",
    `以下是 ${meeting.meeting_date} ${meeting.title} 的会议纪要，请查收。`,
    "",
    "一、会议概览",
    `会议摘要：${meeting.summary || "无"}`,
    `发起人：${meeting.creator || "未记录"}`,
    "",
    "二、议题与纪要",
  ];
  if (meeting.items.length) {
    meeting.items.forEach((item, index) => {
      lines.push(`${index + 1}. 【${item.type_name || item.section || "议题"}】${item.title}`);
      if (item.detail) lines.push(`背景：${item.detail}`);
      lines.push(`纪要：${item.minutes || "待补充"}`);
      if (item.owner_name || item.due_date) {
        lines.push(`负责人/截止：${[item.owner_name, item.due_date].filter(Boolean).join(" / ") || "无"}`);
      }
      lines.push("");
    });
  } else {
    lines.push("暂无议题。", "");
  }
  lines.push("三、参会情况");
  if (meeting.attendance?.length) {
    meeting.attendance.forEach((item) => {
      lines.push(`${item.display_name}：${statusMap[item.status] || item.status}${item.donation_required ? "，需乐捐" : ""}${item.donation_done ? "，已完成" : ""}`);
    });
  } else {
    lines.push("暂无签到记录。");
  }
  const subject = `【周例会纪要】${meeting.meeting_date} ${meeting.title}`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\r\n"))}`;
}

function renderMeetingCalendar(meetings) {
  const month = state.meetingMonth;
  const start = monthStart(month);
  const gridStart = new Date(start);
  gridStart.setDate(start.getDate() - (start.getDay() || 7) + 1);
  const byDate = {};
  meetings.forEach((meeting) => {
    byDate[meeting.meeting_date] ||= [];
    byDate[meeting.meeting_date].push(meeting);
  });
  $("#meetingMonthTitle").textContent = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;
  const meetingDate = $('input[name="meeting_date"]');
  if (meetingDate) meetingDate.value = state.selectedMeetingDate;
  const generateStart = $('input[name="start_date"]');
  if (generateStart && !generateStart.value) generateStart.value = mondayOf(state.selectedMeetingDate);

  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((day) => `<div class="weekday">${day}</div>`).join("");
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const date = iso(d);
    const dayMeetings = byDate[date] || [];
    const hasSelected = dayMeetings.some((meeting) => Number(meeting.id) === Number(state.selectedMeetingId));
    cells.push(`<div class="day-cell meeting-day ${d.getMonth() !== month.getMonth() ? "other" : ""} ${date === state.selectedMeetingDate ? "selected" : ""} ${hasSelected ? "active-meeting-day" : ""} ${dayMeetings.length ? "has-meeting" : ""}" data-date="${date}">
      <div class="day-no">${d.getDate()}</div>
      ${dayMeetings.map((meeting) => `<div class="meeting-line">${escapeHtml(meeting.title)} · ${meeting.items.length} 议题</div>`).join("")}
    </div>`);
  }
  $("#meetingCalendar").innerHTML = weekdays + cells.join("");
}

function renderMeetingList(meetings) {
  const list = $("#meetingList");
  if (!list) return;
  list.innerHTML = meetings.length ? meetings.map((meeting) => `
    <button type="button" class="meeting-list-item meeting-select-btn ${Number(meeting.id) === Number(state.selectedMeetingId) ? "active" : ""}" data-meeting-id="${meeting.id}">
      <span>${escapeHtml(meeting.meeting_date)}</span>
      <strong>${escapeHtml(meeting.title)}</strong>
      <small>${meeting.items.length} 个议题 · ${(meeting.attendance || []).length} 条签到</small>
    </button>`).join("") : "<p>本月暂无会议。</p>";
}

function renderMeetingDetail(meeting) {
  const detail = $("#meetingDetail");
  if (!detail) return;
  if (!meeting) {
    detail.innerHTML = `
      <div class="meeting-empty">
        <h2>选择一场会议</h2>
        <p>从左侧列表或上方月历选择会议后，这里会显示议题、纪要、签到和邮件入口。</p>
      </div>`;
    return;
  }
  detail.innerHTML = `
    <div class="meeting-detail-head">
      <div>
        <h2>${escapeHtml(meeting.title)}</h2>
        <p>${meeting.meeting_date} · ${escapeHtml(meeting.summary || "无会议摘要")}</p>
      </div>
      <div class="meeting-meta-actions">
        <span class="pill">${escapeHtml(meeting.creator || "")}</span>
        <a class="button-link" href="${escapeHtml(buildMeetingEmailHref(meeting))}">生成会议邮件</a>
      </div>
    </div>

    <div class="meeting-kpis">
      <div><span>议题</span><strong>${meeting.items.length}</strong></div>
      <div><span>已签到</span><strong>${(meeting.attendance || []).length}</strong></div>
      <div><span>未补纪要</span><strong>${meeting.items.filter((item) => !item.minutes).length}</strong></div>
    </div>

    <section class="detail-section">
      <h3>议题与纪要</h3>
      ${renderTopicBoard(meeting)}
    </section>

    <div class="meeting-detail-grid">
      <section class="detail-card">
        <h3>成员自定义议题</h3>
        ${renderCustomTopicForm(meeting.id)}
      </section>
      <section class="detail-card admin-only">
        <h3>管理员添加预设议题</h3>
        ${renderPresetTopicForm(meeting.id)}
      </section>
      <section class="detail-card">
        <h3>参会签到</h3>
        ${isAdminView() ? renderAttendance(meeting) : renderAttendanceReadonly(meeting)}
      </section>
    </div>`;
  $$(".admin-only", detail).forEach((el) => el.classList.toggle("hidden", !isAdminView()));
}

async function loadMeetings() {
  const data = await api(`/api/meetings?${meetingPeriodQuery()}`);
  state.meetings = data.meetings;
  const selectedStillVisible = state.meetings.some((meeting) => Number(meeting.id) === Number(state.selectedMeetingId));
  if (!selectedStillVisible) {
    const sameDate = state.meetings.find((meeting) => meeting.meeting_date === state.selectedMeetingDate);
    state.selectedMeetingId = sameDate?.id || state.meetings[0]?.id || null;
  }
  const selectedMeeting = state.meetings.find((meeting) => Number(meeting.id) === Number(state.selectedMeetingId));
  if (selectedMeeting) state.selectedMeetingDate = selectedMeeting.meeting_date;
  renderMeetingCalendar(state.meetings);
  renderMeetingList(state.meetings);
  renderMeetingDetail(selectedMeeting);
  renderTopicPresetList();
  $("#topicTypeList").innerHTML = state.topics.map((topic) => `<span class="chip"><span class="topic-dot" style="background:${escapeHtml(topic.color)}"></span>${escapeHtml(topic.name)} · ${topic.options.length} 项</span>`).join("");
  populateSelects();
}

function renderAttendanceReadonly(meeting) {
  if (!meeting.attendance || !meeting.attendance.length) return "<p>管理员尚未签到</p>";
  const statusMap = { present: "出席", leave: "请假", absent: "缺席", late: "迟到" };
  return `<div class="item-list">${meeting.attendance.map((item) => `<div class="item"><strong>${escapeHtml(item.display_name)}</strong><p>${statusMap[item.status] || item.status} ${item.donation_required ? " · 需乐捐" : ""} ${item.donation_done ? " · 已完成" : ""}</p></div>`).join("")}</div>`;
}

async function loadLinks() {
  const data = await api("/api/links");
  state.links = data.links;
  renderLinks();
}

function renderLinks() {
  const category = $("#linkCategoryFilter")?.value || "";
  const status = $("#linkStatusFilter")?.value || "";
  const keyword = ($("#linkKeywordSearch")?.value || "").trim().toLowerCase();
  const filtered = state.links.filter((link) => {
    const hitCategory = !category || link.category === category;
    const hitStatus = !status
      || (status === "valid" && Number(link.invalid) !== 1)
      || (status === "pinned" && Number(link.pinned) === 1)
      || (status === "invalid" && Number(link.invalid) === 1);
    const text = [
      link.title,
      link.url,
      link.description,
      link.category,
      link.creator,
      link.quality_note,
      ...(link.machine_scope || []),
      ...(link.process_tags || []),
    ].filter(Boolean).join(" ").toLowerCase();
    return hitCategory && hitStatus && (!keyword || text.includes(keyword));
  });
  const qualityHeader = isAdminView() ? "<th>质量管理</th>" : "";
  $("#linkList").innerHTML = filtered.length ? `
    <table>
      <thead><tr><th>名称</th><th>质量</th><th>分类</th><th>适用范围</th><th>地址</th><th>点击</th><th>归档人</th>${qualityHeader}</tr></thead>
      <tbody>
        ${filtered.map((link) => `
          <tr class="${Number(link.invalid) === 1 ? "link-invalid" : ""}">
            <td>
              <strong>${escapeHtml(link.title)}</strong>
              ${Number(link.pinned) === 1 ? '<span class="pill">置顶</span>' : ""}
            </td>
            <td>
              <span class="pill ${Number(link.invalid) === 1 ? "warn" : "success"}">${Number(link.invalid) === 1 ? "失效" : "可用"}</span>
              ${link.quality_note ? `<p>${escapeHtml(link.quality_note)}</p>` : ""}
            </td>
            <td><span class="pill">${escapeHtml(link.category)}</span></td>
            <td>
              <div class="tags">${(link.machine_scope || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div>
              <div class="tags">${(link.process_tags || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div>
            </td>
            <td>
              ${Number(link.invalid) === 1
                ? `<span class="link-url disabled">${escapeHtml(link.url)}</span>`
                : `<a class="link-url" href="/api/links/${link.id}/open" target="_blank" rel="noreferrer">${escapeHtml(link.url)}</a>`}
              ${link.description ? `<p>${escapeHtml(link.description)}</p>` : ""}
            </td>
            <td>${Number(link.click_count || 0)} 次${link.last_clicked_at ? `<br><small>${escapeHtml(link.last_clicked_at)}</small>` : ""}</td>
            <td>${escapeHtml(link.creator || "-")}</td>
            ${isAdminView() ? `
              <td>
                <form class="link-quality-form" data-link-id="${link.id}">
                  <select name="pinned">
                    <option value="0" ${Number(link.pinned) === 1 ? "" : "selected"}>不置顶</option>
                    <option value="1" ${Number(link.pinned) === 1 ? "selected" : ""}>置顶</option>
                  </select>
                  <select name="invalid">
                    <option value="0" ${Number(link.invalid) === 1 ? "" : "selected"}>可用</option>
                    <option value="1" ${Number(link.invalid) === 1 ? "selected" : ""}>失效</option>
                  </select>
                  <input name="machine_scope" value="${escapeHtml((link.machine_scope || []).join(", "))}" placeholder="适用机台">
                  <input name="process_tags" value="${escapeHtml((link.process_tags || []).join(", "))}" placeholder="流程标签">
                  <input name="quality_note" value="${escapeHtml(link.quality_note || "")}" placeholder="质量备注">
                  <button>保存</button>
                </form>
              </td>` : ""}
          </tr>`).join("")}
      </tbody>
    </table>` : "<p>没有匹配的链接</p>";
}

function renderCalendar() {
  const month = state.shiftMonth;
  const start = monthStart(month);
  const end = monthEnd(month);
  const gridStart = new Date(start);
  gridStart.setDate(start.getDate() - (start.getDay() || 7) + 1);
  const byDate = {};
  state.shifts.forEach((shift) => {
    byDate[shift.shift_date] ||= [];
    byDate[shift.shift_date].push(shift);
  });
  const title = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;
  $("#shiftMonthTitle").textContent = title;
  $("#shiftMonthTitle2").textContent = title;
  $("#selectedShiftDateTitle").textContent = isAdminView() ? `编辑排班 · ${state.selectedShiftDate}` : "我的本月排班";
  const shiftStartInput = $('input[name="shift_start_date"]');
  const shiftEndInput = $('input[name="shift_end_date"]');
  if (shiftStartInput) shiftStartInput.value = state.selectedShiftDate;
  if (shiftEndInput) shiftEndInput.value = state.selectedShiftDate;

  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((day) => `<div class="weekday">${day}</div>`).join("");
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const date = iso(d);
    const shifts = byDate[date] || [];
    const hasMine = shifts.some((shift) => Number(shift.user_id) === Number(state.user?.id));
    cells.push(`<div class="day-cell shift-day ${d.getMonth() !== month.getMonth() ? "other" : ""} ${date === state.selectedShiftDate ? "selected" : ""} ${hasMine ? "has-mine" : ""}" data-date="${date}">
      <div class="day-no">${d.getDate()}</div>
      ${shifts.map((shift) => `<div class="shift-line ${shift.shift_type === "night" ? "night" : ""} ${Number(shift.user_id) === Number(state.user?.id) ? "mine" : ""}">
        <span>${shift.shift_type === "day" ? "白" : "夜"} · ${escapeHtml(shift.machine_name)} · ${escapeHtml(shift.display_name)}</span>
        ${isAdminView() ? `<button class="shift-delete-btn" type="button" data-shift-id="${shift.id}" title="删除排班">×</button>` : ""}
      </div>`).join("")}
    </div>`);
  }
  $("#shiftCalendar").innerHTML = weekdays + cells.join("");
}

async function loadShifts() {
  const [list, dashboard] = await Promise.all([
    api(`/api/shifts?${shiftPeriodQuery()}`),
    api(`/api/dashboards/shifts?${shiftPeriodQuery()}`),
  ]);
  state.shifts = list.shifts;
  $("#shiftStats").innerHTML = renderRank(dashboard.by_user, "hours", "小时");
  renderCalendar();
}

async function loadThanks() {
  const [votes, dashboard] = await Promise.all([
    api(`/api/thank-you?${periodQuery()}`),
    api(`/api/dashboards/thank-you?${periodQuery()}`),
  ]);
  $("#thankStars").innerHTML = renderRank(dashboard.stars, "thanks", "次");
  $("#thankList").innerHTML = votes.votes.length ? votes.votes.map((vote) => `
    <div class="item">
      <h3>${escapeHtml(vote.voter_name)} → ${escapeHtml(vote.receiver_name)}</h3>
      <p>${escapeHtml(vote.evidence)}</p>
      <p>${vote.week_start} · ${vote.created_at}</p>
    </div>`).join("") : "<p>暂无感谢记录</p>";
}

async function refreshAll() {
  if (!state.user) return;
  await loadReferenceData();
  await Promise.all([
    loadDashboard(),
    loadUsers(),
    loadRulesAndScores(),
    loadMembers(),
    loadMeetings(),
    loadLinks(),
    loadShifts(),
    loadThanks(),
    loadSystemAdmin(),
  ]);
  applyAuthView();
}

function bindForm(id, handler) {
  const form = $(id);
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await handler(formData(form), form);
      form.reset();
      setDefaultDates();
      await refreshAll();
      toast("已保存");
    } catch (error) {
      toast(error.message);
    }
  });
}

async function submitMemberForm(form) {
  const data = formData(form);
  const file = form.elements.avatar_file?.files?.[0];
  const avatar = await fileToDataUrl(file);
  if (avatar) data.avatar_url = avatar;
  await api("/api/members", { method: "POST", body: JSON.stringify(data) });
}

async function submitAvatarForm(form) {
  const data = formData(form);
  const file = form.elements.avatar_file?.files?.[0];
  const avatar = await fileToDataUrl(file);
  if (avatar) data.avatar_url = avatar;
  if (!data.avatar_url) throw new Error("请选择图片或输入头像 URL");
  await api(`/api/members/${form.dataset.memberId}`, { method: "PATCH", body: JSON.stringify({ avatar_url: data.avatar_url }) });
}

async function submitProfileForm(form) {
  const data = formData(form);
  await api(`/api/members/${form.dataset.memberId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: data.name || "",
      title: data.title || "",
      tags: data.tags || "",
      responsibilities: data.responsibilities || "",
      comment: data.comment || "",
      skills: data.skills || "",
      machine_scope: data.machine_scope || "",
      expertise: data.expertise || "",
      backup_owner: data.backup_owner || "",
      contact: data.contact || "",
    }),
  });
  if (Number(form.dataset.userId) === Number(state.user?.id) && data.name) {
    state.user.display_name = data.name;
    applyAuthView();
  }
}

async function submitUserEditForm(form) {
  const data = formData(form);
  const response = await api(`/api/users/${form.dataset.userId}`, { method: "PATCH", body: JSON.stringify(data) });
  state.users = response.users || state.users;
  if (Number(form.dataset.userId) === Number(state.user?.id)) {
    state.user.display_name = data.display_name || state.user.display_name;
    if (data.role) state.user.role = data.role;
    applyAuthView();
  }
}

function renderTeamChat(posts) {
  const list = $("#teamChatList");
  if (!list) return;
  list.innerHTML = posts.length ? posts.map((post) => `
    <div class="chat-bubble ${post.kind === "roast" ? "roast" : ""}">
      <span class="pill ${post.kind === "roast" ? "warn" : ""}">${post.kind === "roast" ? "吐槽" : "评论"}</span>
      <p>${escapeHtml(post.content)}</p>
      <small>${escapeHtml(post.display_name)} · ${post.created_at}</small>
    </div>`).join("") : "<p>还没有团队对话，来开个头。</p>";
  list.scrollTop = list.scrollHeight;
}

function filledText(value) {
  return String(value || "").trim();
}

function memberPersona(member, skills = [], machines = []) {
  const rows = [
    ["技能", skills.map(escapeHtml).join(" / ")],
    ["负责机台", machines.map(escapeHtml).join(" / ")],
    ["擅长问题", escapeHtml(filledText(member.expertise))],
    ["备用负责人", escapeHtml(filledText(member.backup_owner))],
    ["联系方式", escapeHtml(filledText(member.contact))],
  ].filter(([, value]) => value);
  if (!rows.length) return "";
  return `<div class="member-persona">
    ${rows.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}
  </div>`;
}

function renderMemberCard(member) {
  const canEdit = isAdminView() || member.user_id === state.user?.id;
  const profileEditTitle = isAdminView() ? "管理员编辑成员资料" : "编辑我的成员资料";
  const tagPlaceholder = isAdminView() ? "成员标签，用逗号分隔" : "我的标签，用逗号分隔";
  const responsibilityPlaceholder = isAdminView() ? "成员职责范围" : "我的职责范围";
  const skills = member.skills || [];
  const machines = member.machine_scope || [];
  const tags = member.tags || [];
  const responsibilities = filledText(member.responsibilities);
  const comment = filledText(member.comment);
  return `
    <article class="member-card profile-only">
      <section class="member-profile">
        <div class="member-head">
          ${member.avatar_url ? `<img class="avatar" src="${escapeHtml(member.avatar_url)}" alt="${escapeHtml(member.name)}">` : `<div class="avatar">${escapeHtml(member.name.slice(0, 1))}</div>`}
          <div><h3>${escapeHtml(member.name)}</h3><p>${escapeHtml(member.title || "")}</p></div>
        </div>
        ${tags.length ? `<div class="tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        <div class="member-brief">
          <p><strong>职责：</strong>${responsibilities ? escapeHtml(responsibilities) : "待补充"}</p>
          ${comment ? `<p>${escapeHtml(comment)}</p>` : ""}
        </div>
        ${memberPersona(member, skills, machines)}
        ${canEdit ? `
          <details class="member-editor">
            <summary>编辑资料</summary>
            <form class="profile-edit-form" data-member-id="${member.id}" data-user-id="${member.user_id || ""}">
              <strong>${profileEditTitle}</strong>
              <input name="name" value="${escapeHtml(member.name || "")}" placeholder="姓名" required>
              <input name="title" value="${escapeHtml(member.title || "")}" placeholder="岗位 / 角色">
              <input name="tags" value="${escapeHtml(tags.join(", "))}" placeholder="${tagPlaceholder}">
              <textarea name="responsibilities" placeholder="${responsibilityPlaceholder}">${escapeHtml(member.responsibilities || "")}</textarea>
              <textarea name="comment" placeholder="个人备注">${escapeHtml(member.comment || "")}</textarea>
              <input name="skills" value="${escapeHtml(skills.join(", "))}" placeholder="技能标签，用逗号分隔">
              <input name="machine_scope" value="${escapeHtml(machines.join(", "))}" placeholder="负责机台，用逗号分隔">
              <input name="expertise" value="${escapeHtml(member.expertise || "")}" placeholder="擅长问题类型">
              <input name="backup_owner" value="${escapeHtml(member.backup_owner || "")}" placeholder="备用负责人">
              <input name="contact" value="${escapeHtml(member.contact || "")}" placeholder="联系方式">
              <button>保存成员资料</button>
            </form>
            <form class="avatar-tools avatar-form" data-member-id="${member.id}">
              <input name="avatar_url" placeholder="头像 URL">
              <input name="avatar_file" type="file" accept="image/*">
              <button>更换头像</button>
            </form>
          </details>` : ""}
      </section>
    </article>`;
}

async function loadMembers() {
  const [membersData, postsData] = await Promise.all([
    api("/api/members"),
    api("/api/team-posts"),
  ]);
  state.members = membersData.members;
  renderTeamChat(postsData.posts);
  $("#memberList").innerHTML = state.members.map(renderMemberCard).join("");
}

function updateOptionSelect(typeSelect) {
  const form = typeSelect.closest("form");
  const optionSelect = form?.querySelector("[data-meeting-option-select]");
  if (!optionSelect) return;
  const topic = state.topics.find((item) => Number(item.id) === Number(typeSelect.value));
  optionSelect.innerHTML = `<option value="">自定义议题</option>${(topic?.options || []).map((option) => `<option value="${option.id}">${escapeHtml(option.title)}</option>`).join("")}`;
}

function moveMonth(delta) {
  state.shiftMonth = new Date(state.shiftMonth.getFullYear(), state.shiftMonth.getMonth() + delta, 1);
  loadShifts().catch((error) => toast(error.message));
}

function moveMeetingMonth(delta) {
  state.meetingMonth = new Date(state.meetingMonth.getFullYear(), state.meetingMonth.getMonth() + delta, 1);
  state.selectedMeetingDate = iso(new Date(state.meetingMonth.getFullYear(), state.meetingMonth.getMonth(), 1));
  loadMeetings().catch((error) => toast(error.message));
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api("/api/login", { method: "POST", body: JSON.stringify(formData(event.currentTarget)) });
      state.user = data.user;
      state.permissions = data.permissions;
      applyAuthView();
      await refreshAll();
    } catch (error) {
      toast(error.message);
    }
  });

  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    state.user = null;
    state.permissions = {};
    applyAuthView();
  });

  $("#nav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (button) switchPage(button.dataset.page);
  });

  $("#refreshBtn").addEventListener("click", refreshAll);
  $("#themeSelect").addEventListener("change", (event) => {
    setUiTheme(event.target.value);
    const label = event.target.selectedOptions?.[0]?.textContent || "新主题";
    toast(`已切换到 ${label}`);
  });
  $("#viewModeBtn").addEventListener("click", async () => {
    setViewMode(isAdminView() ? "user" : "admin");
    if (!isAdminView() && ["users", "system"].includes(state.currentPage)) {
      switchPage("members");
    }
    applyAuthView();
    await refreshAll();
    toast(isAdminView() ? "已切换到管理视图" : "已切换到用户视图");
  });
  $("#prevMeetingMonthBtn").addEventListener("click", () => moveMeetingMonth(-1));
  $("#nextMeetingMonthBtn").addEventListener("click", () => moveMeetingMonth(1));
  $("#prevMonthBtn").addEventListener("click", () => moveMonth(-1));
  $("#nextMonthBtn").addEventListener("click", () => moveMonth(1));
  $("#prevMonthBtn2").addEventListener("click", () => moveMonth(-1));
  $("#nextMonthBtn2").addEventListener("click", () => moveMonth(1));

  bindForm("#userForm", (data) => api("/api/users", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#ruleForm", (data) => api("/api/rules", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#scoreForm", (data) => api("/api/scores", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#meetingForm", (data) => api("/api/meetings", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#meetingGenerateForm", (data) => api("/api/meetings/bulk-generate", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#topicTypeForm", (data) => api("/api/meeting-topic-types", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#topicOptionForm", (data) => api("/api/meeting-topic-options", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#linkForm", (data) => api("/api/links", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#linkCategoryForm", (data) => api("/api/link-categories", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#machineForm", (data) => api("/api/machines", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#shiftForm", (data) => api("/api/shifts", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#thankForm", (data) => api("/api/thank-you", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#teamChatForm", (data) => api("/api/team-posts", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#settingsForm", (data) => api("/api/settings", { method: "PATCH", body: JSON.stringify({ settings: data }) }));
  bindForm("#manualBackupForm", () => api("/api/backups", { method: "POST", body: "{}" }));

  $("#linkCategoryFilter").addEventListener("change", renderLinks);
  $("#linkStatusFilter").addEventListener("change", renderLinks);
  $("#linkKeywordSearch").addEventListener("input", renderLinks);

  const memberForm = $("#memberForm");
  if (memberForm) {
    memberForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await submitMemberForm(event.currentTarget);
        event.currentTarget.reset();
        await refreshAll();
        toast("成员已保存");
      } catch (error) {
        toast(error.message);
      }
    });
  }

  document.body.addEventListener("click", (event) => {
    const deleteButton = event.target.closest(".user-delete-btn");
    if (deleteButton) {
      const name = deleteButton.dataset.userName || "该用户";
      if (!window.confirm(`确定删除 ${name} 吗？历史记录会保留，但该账号将无法登录。`)) return;
      api(`/api/users/${deleteButton.dataset.userId}`, { method: "DELETE" })
        .then(refreshAll)
        .then(() => toast("用户已删除"))
        .catch((error) => toast(error.message));
      return;
    }
    const presetDelete = event.target.closest(".preset-delete-btn");
    if (presetDelete) {
      if (!window.confirm("确定删除这个预设议题吗？已生成到会议里的历史议题会保留。")) return;
      api(`/api/meeting-topic-options/${presetDelete.dataset.optionId}`, { method: "DELETE" })
        .then(refreshAll)
        .then(() => toast("预设议题已删除"))
        .catch((error) => toast(error.message));
      return;
    }
    const meetingSelect = event.target.closest(".meeting-select-btn");
    if (meetingSelect) {
      const meeting = state.meetings.find((item) => Number(item.id) === Number(meetingSelect.dataset.meetingId));
      state.selectedMeetingId = meeting?.id || null;
      if (meeting) state.selectedMeetingDate = meeting.meeting_date;
      renderMeetingCalendar(state.meetings);
      renderMeetingList(state.meetings);
      renderMeetingDetail(meeting);
      return;
    }
    const meetingCell = event.target.closest(".meeting-day");
    if (meetingCell) {
      state.selectedMeetingDate = meetingCell.dataset.date;
      const input = $('input[name="meeting_date"]');
      if (input) input.value = state.selectedMeetingDate;
      const meeting = state.meetings.find((item) => item.meeting_date === state.selectedMeetingDate);
      state.selectedMeetingId = meeting?.id || null;
      renderMeetingCalendar(state.meetings);
      renderMeetingList(state.meetings);
      renderMeetingDetail(meeting || null);
      return;
    }
    const shiftDelete = event.target.closest(".shift-delete-btn");
    if (shiftDelete) {
      event.stopPropagation();
      if (!window.confirm("确定删除这条排班吗？")) return;
      api(`/api/shifts/${shiftDelete.dataset.shiftId}`, { method: "DELETE" })
        .then(loadShifts)
        .then(() => toast("排班已删除"))
        .catch((error) => toast(error.message));
      return;
    }
    const shiftCell = event.target.closest(".shift-day");
    if (shiftCell) {
      state.selectedShiftDate = shiftCell.dataset.date;
      renderCalendar();
    }
  });

  document.body.addEventListener("change", (event) => {
    if (event.target.matches("[data-meeting-topic-select]")) updateOptionSelect(event.target);
    if (event.target.matches('select[name="status"]')) {
      const form = event.target.closest(".attendance-row");
      const required = form?.elements.donation_required;
      if (required) required.checked = event.target.value === "late";
    }
  });

  document.body.addEventListener("submit", async (event) => {
    const postForm = event.target.closest(".post-form");
    const avatarForm = event.target.closest(".avatar-form");
    const profileForm = event.target.closest(".profile-edit-form");
    const userEditForm = event.target.closest(".user-edit-form");
    const topicForm = event.target.closest(".topic-item-form");
    const attendanceForm = event.target.closest(".attendance-row");
    const minuteForm = event.target.closest(".minute-form");
    const presetForm = event.target.closest(".preset-form");
    const linkQualityForm = event.target.closest(".link-quality-form");
    if (!postForm && !avatarForm && !profileForm && !userEditForm && !topicForm && !attendanceForm && !minuteForm && !presetForm && !linkQualityForm) return;
    event.preventDefault();
    try {
      if (userEditForm) {
        await submitUserEditForm(userEditForm);
        await refreshAll();
        toast("用户已更新");
        return;
      }
      if (postForm) {
        await api(`/api/members/${postForm.dataset.memberId}/posts`, { method: "POST", body: JSON.stringify(formData(postForm)) });
      }
      if (avatarForm) {
        await submitAvatarForm(avatarForm);
      }
      if (profileForm) {
        await submitProfileForm(profileForm);
      }
      if (topicForm) {
        await api(`/api/meetings/${topicForm.dataset.meetingId}/items`, { method: "POST", body: JSON.stringify(formData(topicForm)) });
      }
      if (attendanceForm) {
        const data = formData(attendanceForm);
        data.donation_required = attendanceForm.elements.donation_required.checked;
        data.donation_done = attendanceForm.elements.donation_done.checked;
        await api(`/api/meetings/${attendanceForm.dataset.meetingId}/attendance`, { method: "POST", body: JSON.stringify(data) });
      }
      if (minuteForm) {
        await api(`/api/meeting-items/${minuteForm.dataset.itemId}`, { method: "PATCH", body: JSON.stringify(fullFormData(minuteForm)) });
      }
      if (presetForm) {
        await api(`/api/meeting-topic-options/${presetForm.dataset.optionId}`, { method: "PATCH", body: JSON.stringify(fullFormData(presetForm)) });
      }
      if (linkQualityForm) {
        await api(`/api/links/${linkQualityForm.dataset.linkId}`, { method: "PATCH", body: JSON.stringify(fullFormData(linkQualityForm)) });
      }
      event.target.reset();
      setDefaultDates();
      await refreshAll();
      toast("已更新");
    } catch (error) {
      toast(error.message);
    }
  });
}

async function boot() {
  applyUiTheme();
  setDefaultDates();
  bindEvents();
  try {
    const data = await api("/api/me");
    state.user = data.user;
    state.permissions = data.permissions;
    applyAuthView();
    switchPage("members");
    if (state.user) await refreshAll();
  } catch {
    applyAuthView();
  }
}

boot();
