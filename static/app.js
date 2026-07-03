import "/vendor/emoji-picker-element/index.js";
import zhCnEmojiI18n from "/vendor/emoji-picker-element/i18n/zh_CN.js";

const uiThemeVersion = "miro-v1";

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
  showLogin: false,
  uiTheme: safeStorageGet("teamLoopThemeVersion", "") === uiThemeVersion
    ? safeStorageGet("teamLoopUiTheme", "miro")
    : "miro",
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
const guestPages = new Set(["members", "shifts", "rules", "thanks", "links"]);
const uiThemes = new Set(["miro", "feishu", "yuque", "linear", "dingtalk"]);
const teamReactionOptions = ["+1", "👍", "收到", "辛苦了", "已跟进"];
const emojiDataSource = "/vendor/emoji-picker-element-data/zh/emojibase/data.json";
let activeReactionPostId = null;

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
  const theme = uiThemes.has(state.uiTheme) ? state.uiTheme : "miro";
  state.uiTheme = theme;
  document.body.dataset.theme = theme;
  safeStorageSet("teamLoopThemeVersion", uiThemeVersion);
  safeStorageSet("teamLoopUiTheme", theme);
  const select = $("#themeSelect");
  if (select) select.value = theme;
}

function setUiTheme(theme) {
  state.uiTheme = uiThemes.has(theme) ? theme : "miro";
  safeStorageSet("teamLoopUiTheme", state.uiTheme);
  applyUiTheme();
}

function isAdminAccount() {
  return Boolean(state.permissions?.isAdmin);
}

function isAdminView() {
  return isAdminAccount() && state.viewMode !== "user";
}

function isGuest() {
  return !state.user;
}

function canAccessPage(id) {
  if (isGuest()) return guestPages.has(id);
  if (!isAdminView() && ["users", "system"].includes(id)) return false;
  return true;
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

function shortDate(value) {
  if (!value) return "";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const prefix = sameYear ? "" : `${date.getFullYear()}年`;
  return `${prefix}${date.getMonth() + 1}月${date.getDate()}日`;
}

function shortDateTime(value) {
  if (!value) return "";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ").slice(0, 16);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${shortDate(value)} ${time}`;
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
  const guest = isGuest();
  const showLogin = guest && state.showLogin;
  $("#loginView").classList.toggle("hidden", !showLogin);
  $("#appView").classList.toggle("hidden", showLogin);
  const roleText = state.user?.role === "admin" ? "管理员" : "普通用户";
  const modeText = isAdminAccount() ? (isAdminView() ? "管理视图" : "用户视图") : "";
  $("#currentUser").textContent = state.user ? `${state.user.display_name} · ${roleText}${modeText ? ` · ${modeText}` : ""}` : "访客 · 只读";
  $("#logoutBtn")?.classList.toggle("hidden", guest);
  $("#loginEntryBtn")?.classList.toggle("hidden", !guest || showLogin);
  const viewModeBtn = $("#viewModeBtn");
  if (viewModeBtn) {
    viewModeBtn.classList.toggle("hidden", !isAdminAccount());
    viewModeBtn.textContent = isAdminView() ? "切换用户视图" : "切换管理视图";
  }
  $$(".admin-only").forEach((el) => el.classList.toggle("hidden", !isAdminView()));
  $("#teamChatForm")?.classList.toggle("hidden", guest);
  $("#thankForm")?.closest(".panel")?.classList.toggle("hidden", guest);
  $("#linkForm")?.closest(".panel")?.classList.toggle("hidden", guest);
  if (!canAccessPage(state.currentPage)) {
    switchPage("members");
  } else {
    renderPageToolbar();
    renderNav();
  }
}

function renderNav() {
  $("#nav").innerHTML = pages
    .filter(([id]) => canAccessPage(id))
    .map(([id, icon, title]) => `<button class="nav-item ${state.currentPage === id ? "active" : ""}" data-page="${id}"><span>${icon}</span>${title}</button>`)
    .join("");
}

function switchPage(id) {
  if (!canAccessPage(id)) id = "members";
  if (isGuest()) {
    state.showLogin = false;
    $("#loginView")?.classList.add("hidden");
    $("#appView")?.classList.remove("hidden");
    $("#loginEntryBtn")?.classList.remove("hidden");
  }
  state.currentPage = id;
  $$(".page").forEach((page) => page.classList.toggle("active", page.id === id));
  const meta = pages.find((page) => page[0] === id);
  $("#pageTitle").textContent = meta?.[2] || "团队成员";
  $("#pageDesc").textContent = meta?.[3] || "";
  renderPageToolbar(id);
  renderNav();
}

async function loadReferenceData() {
  const [members, rules, machines, linkCategories] = await Promise.all([
    api("/api/members"),
    api("/api/rules"),
    api("/api/machines"),
    api("/api/link-categories"),
  ]);
  state.members = members.members;
  state.rules = rules.rules;
  state.machines = machines.machines;
  state.linkCategories = linkCategories.categories;
  if (isGuest()) {
    state.topics = [];
  } else {
    state.topics = (await api("/api/meeting-topics")).types;
  }
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
  $$("[data-owner-users]").forEach((select) => {
    const current = select.value;
    select.innerHTML = renderUserOptions(current);
    select.value = activeUsers.some((user) => Number(user.id) === Number(current)) ? current : "";
  });
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

function meetingTopicTypes(meeting) {
  return meeting?.topic_types || [];
}

function topicOptionsForMeeting(meeting, selectedId = null) {
  const topics = meetingTopicTypes(meeting);
  return topics.map((topic) => `<option value="${topic.id}" ${Number(selectedId) === Number(topic.id) ? "selected" : ""}>${escapeHtml(topic.name)}</option>`).join("");
}

function renderUserOptions(selectedId, placeholder = "负责人") {
  const options = state.users
    .filter((user) => user.active !== 0)
    .map((user) => `<option value="${user.id}" ${Number(selectedId) === Number(user.id) ? "selected" : ""}>${escapeHtml(user.display_name)}</option>`)
    .join("");
  return `<option value="">${placeholder}</option>${options}`;
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
          <select name="owner_id">${renderUserOptions(option.owner_id, "默认负责人")}</select>
          <input name="default_detail" value="${escapeHtml(option.default_detail || "")}" placeholder="默认说明">
          <button>保存</button>
          <button class="danger preset-delete-btn" type="button" data-option-id="${option.id}">删除</button>
        </form>`).join("")}
    </div>` : "<p>暂无预设议题</p>";
}

function renderPresetTopicForm(meeting) {
  const topics = meetingTopicTypes(meeting);
  const firstTopic = topics[0];
  const sourceTopic = state.topics.find((topic) => Number(topic.id) === Number(firstTopic?.id));
  const options = sourceTopic?.options || [];
  if (!topics.length) return "<p>请先在本场会议主题里选择至少一个主题。</p>";
  return `
    <form class="form-grid compact topic-item-form" data-meeting-id="${meeting.id}">
      <select name="type_id" data-meeting-topic-select required>${topicOptionsForMeeting(meeting)}</select>
      <select name="option_id" data-meeting-option-select><option value="">自定义议题</option>${options.map((option) => `<option value="${option.id}">${escapeHtml(option.title)}</option>`).join("")}</select>
      <input name="title" placeholder="自定义标题，选择预设时可留空" />
      <select name="owner_id">${renderUserOptions(null)}</select>
      <input name="due_date" type="date" />
      <textarea name="detail" placeholder="议题说明、背景、结论或行动要求"></textarea>
      <button>添加到本次例会</button>
    </form>`;
}

function renderCustomTopicForm(meeting) {
  const topics = meetingTopicTypes(meeting);
  if (!topics.length) return "<p>本场会议尚未设置主题，暂不能添加议题。</p>";
  return `
    <form class="form-grid compact topic-item-form custom-topic-form" data-meeting-id="${meeting.id}">
      <select name="type_id" required>${topicOptionsForMeeting(meeting)}</select>
      <input name="title" placeholder="自定义议题标题" required />
      <select name="owner_id">${renderUserOptions(null)}</select>
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
  const thankYouTopic = isThankYouTopic(item);
  return `<div class="topic-item">
    <strong>${escapeHtml(item.title)}</strong>
    ${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ""}
    ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
    ${thankYouTopic ? `
      <div class="topic-auto-summary">
        Thank You 议题将由系统自动汇总本周点赞记录，无需单独填写会议纪要。
      </div>` : `
      <form class="minute-form" data-item-id="${item.id}">
      <select name="owner_id">${renderUserOptions(item.owner_id)}</select>
      <textarea name="minutes" placeholder="输入本议题会议纪要">${escapeHtml(item.minutes || "")}</textarea>
      <textarea name="open_issues" placeholder="本议题遗留问题">${escapeHtml(item.open_issues || "")}</textarea>
      <textarea name="next_steps" placeholder="下一步行动或处理计划">${escapeHtml(item.next_steps || "")}</textarea>
      <button>保存纪要</button>
    </form>`}
  </div>`;
}

function renderTopicBoard(meeting) {
  const typed = new Set();
  const topics = meetingTopicTypes(meeting);
  if (!topics.length && !meeting.items.length) {
    return `<div class="topic-board-empty">本场会议尚未设置主题。</div>`;
  }
  const columns = topics.map((topic) => {
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
  const statuses = [
    ["present", "出席"],
    ["leave", "请假"],
    ["late", "迟到"],
    ["absent", "缺席"],
  ];
  return `<div class="attendance-grid">${state.users.filter((user) => user.active !== 0).map((user) => {
    const record = map.get(Number(user.id)) || {};
    const status = record.status || "present";
    const needsDonation = status === "late" || status === "absent";
    return `<form class="attendance-row" data-meeting-id="${meeting.id}">
      <strong>${escapeHtml(user.display_name)}</strong>
      <input type="hidden" name="user_id" value="${user.id}">
      <input type="hidden" name="status" value="${status}">
      <div class="attendance-status-group" role="group" aria-label="${escapeHtml(user.display_name)}签到状态">
        ${statuses.map(([value, label]) => `<button type="button" class="attendance-status-btn ${status === value ? "active" : ""} ${value}" data-attendance-status="${value}">${label}</button>`).join("")}
      </div>
      <div class="attendance-donation ${needsDonation ? "" : "hidden"}">
        <label>金额<input name="donation_amount" type="number" min="0" step="1" value="${Number(record.donation_amount || 0) || ""}" placeholder="乐捐金额"></label>
        <label class="donation-received"><input name="donation_done" type="checkbox" ${record.donation_done ? "checked" : ""}> 已收到</label>
      </div>
      <span class="attendance-save-state" aria-live="polite"></span>
    </form>`;
  }).join("")}</div>`;
}

function buildAttendanceDashboard(meetings = []) {
  const activeUsers = state.users.filter((user) => user.active !== 0);
  const totalMeetings = meetings.length;
  return activeUsers.map((user) => {
    const stats = {
      user,
      total: totalMeetings,
      present: 0,
      late: 0,
      leave: 0,
      absent: 0,
      unsigned: 0,
      donationRequired: 0,
      donationReceived: 0,
      donationPending: 0,
    };
    meetings.forEach((meeting) => {
      const record = (meeting.attendance || []).find((item) => Number(item.user_id) === Number(user.id));
      if (!record) {
        stats.unsigned += 1;
        return;
      }
      if (record.donation_required) {
        const amount = Number(record.donation_amount || 0);
        stats.donationRequired += amount;
        if (record.donation_done) {
          stats.donationReceived += amount;
        } else {
          stats.donationPending += amount;
        }
      }
      if (Object.prototype.hasOwnProperty.call(stats, record.status)) {
        stats[record.status] += 1;
      } else {
        stats.unsigned += 1;
      }
    });
    stats.attended = stats.present + stats.late;
    stats.rate = totalMeetings ? Math.round((stats.attended / totalMeetings) * 100) : 0;
    return stats;
  }).sort((a, b) => b.rate - a.rate || b.attended - a.attended || String(a.user.display_name).localeCompare(String(b.user.display_name), "zh-CN"));
}

function renderAttendanceDashboard(meetings = []) {
  const rows = buildAttendanceDashboard(meetings);
  if (!meetings.length) return "<p>本月暂无会议，暂不能统计出勤。</p>";
  if (!rows.length) return "<p>暂无成员账号。</p>";
  return `<div class="attendance-board">
    ${rows.map((row) => `
      <div class="attendance-board-row">
        <div class="attendance-person">
          <strong>${escapeHtml(row.user.display_name)}</strong>
          <span>${row.total} 场会议</span>
        </div>
        <div class="attendance-rate">
          <strong>${row.rate}%</strong>
          <span>出勤率</span>
        </div>
        <div class="attendance-bar" title="出席 ${row.present}，迟到 ${row.late}，请假 ${row.leave}，缺席 ${row.absent}，未签到 ${row.unsigned}">
          <span style="width:${row.total ? (row.present / row.total) * 100 : 0}%" class="present"></span>
          <span style="width:${row.total ? (row.late / row.total) * 100 : 0}%" class="late"></span>
          <span style="width:${row.total ? (row.leave / row.total) * 100 : 0}%" class="leave"></span>
          <span style="width:${row.total ? (row.absent / row.total) * 100 : 0}%" class="absent"></span>
          <span style="width:${row.total ? (row.unsigned / row.total) * 100 : 0}%" class="unsigned"></span>
        </div>
        <div class="attendance-counts">
          <span>出席 ${row.present}</span>
          <span>迟到 ${row.late}</span>
          <span>请假 ${row.leave}</span>
          <span>缺席 ${row.absent}</span>
          <span>未签到 ${row.unsigned}</span>
          <span class="${row.donationPending ? "warn" : ""}">乐捐 ${row.donationReceived}/${row.donationRequired}</span>
        </div>
      </div>`).join("")}
  </div>`;
}

function updateAttendanceDonationVisibility(form) {
  const status = form.elements.status?.value || "present";
  const needsDonation = status === "late" || status === "absent";
  const donation = form.querySelector(".attendance-donation");
  donation?.classList.toggle("hidden", !needsDonation);
  if (!needsDonation) {
    if (form.elements.donation_amount) form.elements.donation_amount.value = "";
    if (form.elements.donation_done) form.elements.donation_done.checked = false;
  }
}

function attendancePayload(form) {
  const status = form.elements.status?.value || "present";
  const needsDonation = status === "late" || status === "absent";
  return {
    user_id: form.elements.user_id.value,
    status,
    donation_amount: needsDonation ? form.elements.donation_amount?.value || 0 : 0,
    donation_done: needsDonation ? Boolean(form.elements.donation_done?.checked) : false,
  };
}

async function saveAttendanceForm(form) {
  const stateEl = form.querySelector(".attendance-save-state");
  if (stateEl) stateEl.textContent = "保存中";
  const response = await api(`/api/meetings/${form.dataset.meetingId}/attendance`, {
    method: "POST",
    body: JSON.stringify(attendancePayload(form)),
  });
  state.meetings = response.meetings || state.meetings;
  const current = state.meetings.find((meeting) => Number(meeting.id) === Number(state.selectedMeetingId));
  if (current) {
    renderMeetingList(state.meetings);
    renderMeetingDetail(current);
  }
  toast("签到已更新");
}

function meetingMinutesSubject(meeting) {
  return `【周例会纪要】${meeting.meeting_date} ${meeting.title}`;
}

function tableCell(value, fallback = "无") {
  const text = String(value || fallback).trim() || fallback;
  return text.replace(/\|/g, "｜").replace(/\r?\n+/g, "；");
}

function groupAttendance(meeting) {
  const statusMap = { present: "出席", leave: "请假", absent: "缺席", late: "迟到" };
  const groups = { present: [], leave: [], absent: [], late: [] };
  (meeting.attendance || []).forEach((item) => {
    const key = groups[item.status] ? item.status : "present";
    groups[key].push(item.display_name);
  });
  return {
    present: groups.present.join("、") || "暂无签到记录",
    exceptions: ["leave", "absent", "late"]
      .filter((key) => groups[key].length)
      .map((key) => `${statusMap[key]}：${groups[key].join("、")}`)
      .join("；") || "无",
  };
}

function thankYouSummary(thankData = {}) {
  const votes = thankData.votes || [];
  const stars = thankData.stars || [];
  return {
    minutes: votes.length
      ? `本周共收到 ${votes.length} 条 Thank You，主要记录团队成员之间的具体协助事项。`
      : "本周暂无 Thank You 记录。",
    stars: stars.length
      ? stars.map((item) => `${item.display_name} ${Number(item.thanks || 0)} 次`).join("；")
      : "暂无",
    details: votes.length
      ? votes.map((vote, index) => `${index + 1}. ${vote.voter_name} 感谢 ${vote.receiver_name}：${vote.evidence}`).join("；")
      : "暂无明细",
  };
}

function markdownTable(rows) {
  return [
    "| 项目 | 内容 |",
    "|---|---|",
    ...rows.map(([label, value]) => `| ${tableCell(label)} | ${tableCell(value)} |`),
  ].join("\r\n");
}

function buildMeetingMinutesText(meeting, thankData = {}) {
  const attendance = groupAttendance(meeting);
  const lines = [
    meetingMinutesSubject(meeting),
    "",
    markdownTable([
      ["会议名称", meeting.title],
      ["会议时间", meeting.meeting_date],
      ["与会人", attendance.present],
      ["请假/缺席/迟到", attendance.exceptions],
      ["主持人", meeting.creator || "未记录"],
      ["会议摘要", meeting.summary || "无"],
    ]),
    "",
    "一、议题纪要",
    "",
  ];
  if (!meeting.items.length) {
    lines.push("暂无议题。");
    return lines.join("\r\n");
  }
  meeting.items.forEach((item, index) => {
    const topicName = item.type_name || item.section || "议题";
    lines.push(`${index + 1}. ${topicName} - ${item.title}`);
    if (isThankYouTopic(item)) {
      const summary = thankYouSummary(thankData);
      lines.push(markdownTable([
        ["议题类型", "Thank You"],
        ["议题内容", item.title],
        ["会议纪要", summary.minutes],
        ["本周之星", summary.stars],
        ["明细", summary.details],
        ["遗留问题", "无需人工记录，如需跟进请转为普通议题。"],
      ]));
    } else {
      lines.push(markdownTable([
        ["议题类型", topicName],
        ["议题内容", item.title],
        ["责任人", item.owner_name || "未指定"],
        ["会议纪要", item.minutes || "待补充"],
        ["遗留问题", item.open_issues || "无"],
        ["下一步", item.next_steps || "无"],
        ["截止时间", item.due_date || "无"],
      ]));
    }
    lines.push("");
  });
  return lines.join("\r\n");
}

function htmlCell(value, fallback = "无") {
  return escapeHtml(String(value || fallback).trim() || fallback).replace(/\r?\n/g, "<br>");
}

function htmlTable(rows) {
  return `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:Arial,'Microsoft YaHei',sans-serif;font-size:14px;">
    <tbody>${rows.map(([label, value]) => `<tr><th style="width:120px;background:#f6f8fa;text-align:left;">${htmlCell(label)}</th><td>${htmlCell(value)}</td></tr>`).join("")}</tbody>
  </table>`;
}

function buildMeetingMinutesHtml(meeting, thankData = {}) {
  const attendance = groupAttendance(meeting);
  const sections = meeting.items.length ? meeting.items.map((item, index) => {
    const topicName = item.type_name || item.section || "议题";
    if (isThankYouTopic(item)) {
      const summary = thankYouSummary(thankData);
      return `<h3>${index + 1}. ${htmlCell(topicName)} - ${htmlCell(item.title)}</h3>${htmlTable([
        ["议题类型", "Thank You"],
        ["议题内容", item.title],
        ["会议纪要", summary.minutes],
        ["本周之星", summary.stars],
        ["明细", summary.details],
        ["遗留问题", "无需人工记录，如需跟进请转为普通议题。"],
      ])}`;
    }
    return `<h3>${index + 1}. ${htmlCell(topicName)} - ${htmlCell(item.title)}</h3>${htmlTable([
      ["议题类型", topicName],
      ["议题内容", item.title],
      ["责任人", item.owner_name || "未指定"],
      ["会议纪要", item.minutes || "待补充"],
      ["遗留问题", item.open_issues || "无"],
      ["下一步", item.next_steps || "无"],
      ["截止时间", item.due_date || "无"],
    ])}`;
  }).join("") : "<p>暂无议题。</p>";
  return `<article style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#172033;">
    <h2>${htmlCell(meetingMinutesSubject(meeting))}</h2>
    ${htmlTable([
      ["会议名称", meeting.title],
      ["会议时间", meeting.meeting_date],
      ["与会人", attendance.present],
      ["请假/缺席/迟到", attendance.exceptions],
      ["主持人", meeting.creator || "未记录"],
      ["会议摘要", meeting.summary || "无"],
    ])}
    <h2>一、议题纪要</h2>
    ${sections}
  </article>`;
}

async function copyMeetingMinutes(html, text) {
  if (!navigator.clipboard) return false;
  try {
    if (window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    return true;
  } catch {
    return false;
  }
}

async function openMeetingEmail(meetingId) {
  const meeting = state.meetings.find((item) => Number(item.id) === Number(meetingId));
  if (!meeting) throw new Error("请先选择会议");
  const weekStart = mondayOf(meeting.meeting_date);
  const needsThankYou = meeting.items.some(isThankYouTopic);
  const thankData = needsThankYou
    ? {
        votes: (await api(`/api/thank-you?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekStart)}`)).votes,
        stars: (await api(`/api/dashboards/thank-you?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekStart)}`)).stars,
      }
    : { votes: [], stars: [] };
  const text = buildMeetingMinutesText(meeting, thankData);
  const html = buildMeetingMinutesHtml(meeting, thankData);
  const copied = await copyMeetingMinutes(html, text);
  window.location.href = `mailto:?subject=${encodeURIComponent(meetingMinutesSubject(meeting))}&body=${encodeURIComponent(text)}`;
  toast(copied ? "已复制表格纪要并打开邮件草稿" : "已打开邮件草稿");
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
      <small>${meetingTopicTypes(meeting).length} 个主题 · ${meeting.items.length} 个议题 · ${(meeting.attendance || []).length} 条签到</small>
    </button>`).join("") : "<p>本月暂无会议。</p>";
}

function renderMeetingTopicScopeForm(meeting) {
  const selected = new Set((meeting.topic_type_ids || []).map((id) => Number(id)));
  if (!state.topics.length) return "<p>请先在下方维护可用的议题类型。</p>";
  return `
    <form class="meeting-topic-scope-form" data-meeting-id="${meeting.id}">
      <div class="topic-scope-grid">
        ${state.topics.map((topic) => `
          <label class="topic-scope-option">
            <input type="checkbox" name="topic_type_ids" value="${topic.id}" ${selected.has(Number(topic.id)) ? "checked" : ""}>
            <span class="topic-dot" style="background:${escapeHtml(topic.color)}"></span>
            <span>${escapeHtml(topic.name)}</span>
          </label>`).join("")}
      </div>
      <button>保存本场会议主题</button>
    </form>`;
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
        <button class="button-link meeting-email-btn" type="button" data-meeting-id="${meeting.id}">生成会议邮件</button>
      </div>
    </div>

    <div class="meeting-kpis">
      <div><span>议题</span><strong>${meeting.items.length}</strong></div>
      <div><span>已签到</span><strong>${(meeting.attendance || []).length}</strong></div>
      <div><span>未补纪要</span><strong>${meeting.items.filter((item) => !item.minutes).length}</strong></div>
    </div>

    <section class="detail-section attendance-board-section">
      <div class="section-headline">
        <h3>本月参会看板</h3>
        <span>${state.meetings.length} 场会议</span>
      </div>
      ${renderAttendanceDashboard(state.meetings)}
    </section>

    <section class="detail-section">
      <h3>本场会议主题</h3>
      <p>每场会议单独配置主题，议题看板只展示本场会议选中的主题。</p>
      <div class="admin-only">${renderMeetingTopicScopeForm(meeting)}</div>
      ${!isAdminView() && meetingTopicTypes(meeting).length ? `<div class="chip-list">${meetingTopicTypes(meeting).map((topic) => `<span class="chip"><span class="topic-dot" style="background:${escapeHtml(topic.color)}"></span>${escapeHtml(topic.name)}</span>`).join("")}</div>` : ""}
    </section>

    <section class="detail-section">
      <h3>议题与纪要</h3>
      ${renderTopicBoard(meeting)}
    </section>

    <div class="meeting-detail-grid">
      <section class="detail-card">
        <h3>成员自定义议题</h3>
        ${renderCustomTopicForm(meeting)}
      </section>
      <section class="detail-card admin-only">
        <h3>管理员添加预设议题</h3>
        ${renderPresetTopicForm(meeting)}
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
  $("#topicTypeList").innerHTML = state.topics.length
    ? state.topics.map((topic) => `
      <span class="chip topic-type-chip">
        <span class="topic-dot" style="background:${escapeHtml(topic.color)}"></span>
        ${escapeHtml(topic.name)} · ${topic.options.length} 项
        <button class="chip-delete topic-type-delete-btn" type="button" data-topic-type-id="${topic.id}" data-topic-type-name="${escapeHtml(topic.name)}">×</button>
      </span>`).join("")
    : "<p>暂无议题类型</p>";
  populateSelects();
}

function renderAttendanceReadonly(meeting) {
  if (!meeting.attendance || !meeting.attendance.length) return "<p>管理员尚未签到</p>";
  const statusMap = { present: "出席", leave: "请假", absent: "缺席", late: "迟到" };
  return `<div class="item-list">${meeting.attendance.map((item) => {
    const donation = item.donation_required
      ? ` · 乐捐 ${Number(item.donation_amount || 0)} · ${item.donation_done ? "已收到" : "未收到"}`
      : "";
    return `<div class="item"><strong>${escapeHtml(item.display_name)}</strong><p>${statusMap[item.status] || item.status}${donation}</p></div>`;
  }).join("")}</div>`;
}

async function loadLinks() {
  const data = await api("/api/links");
  state.links = data.links;
  renderLinks();
}

function splitKeywords(value = "") {
  return String(value)
    .split(/[,\uff0c、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferLinkKeywords(data = {}) {
  const source = [data.title, data.url, data.description, data.category].filter(Boolean).join(" ");
  const lower = source.toLowerCase();
  const machines = [];
  state.machines.forEach((machine) => {
    const name = machine.name || "";
    if (name && lower.includes(name.toLowerCase()) && !machines.includes(name)) machines.push(name);
  });
  const machineMatches = source.match(/TOPTB|机台\s*[A-Z]|老化测试台/g) || [];
  machineMatches.forEach((item) => {
    const normalized = item.replace(/\s+/g, " ");
    if (!machines.includes(normalized)) machines.push(normalized);
  });

  const rules = [
    ["会议", "会议"], ["例会", "会议"], ["纪要", "纪要"], ["模板", "模板"],
    ["看板", "看板"], ["dashboard", "看板"], ["数据", "数据"], ["交接", "交接"],
    ["报修", "报修"], ["工单", "工单"], ["sop", "SOP"], ["标准", "SOP"],
    ["复盘", "复盘"], ["质量", "质量"], ["点检", "点检"], ["白板", "白板"],
    ["miro", "白板"], ["备份", "备份"], ["审计", "审计"], ["排班", "排班"],
    ["红黑榜", "红黑榜"], ["thank", "Thank You"], ["工具", "工具"], ["文档", "文档"],
    ["流程", "流程"], ["系统", "系统"],
  ];
  const tags = [];
  rules.forEach(([needle, tag]) => {
    if (lower.includes(needle.toLowerCase()) && !tags.includes(tag)) tags.push(tag);
  });
  splitKeywords(data.category).forEach((item) => {
    if (tags.length < 4 && !tags.includes(item)) tags.push(item);
  });
  return {
    machine_scope: machines.slice(0, 4),
    process_tags: tags.slice(0, 5),
  };
}

function applyLinkKeywordSuggestion(form, force = false) {
  if (!form) return;
  const raw = Object.fromEntries(new FormData(form).entries());
  const suggestion = inferLinkKeywords(raw);
  const machineInput = form.elements.machine_scope;
  const tagInput = form.elements.process_tags;
  if (machineInput && (force || !machineInput.value.trim() || machineInput.dataset.autoSuggested === "1")) {
    machineInput.value = suggestion.machine_scope.join(", ");
    machineInput.dataset.autoSuggested = suggestion.machine_scope.length ? "1" : "";
  }
  if (tagInput && (force || !tagInput.value.trim() || tagInput.dataset.autoSuggested === "1")) {
    tagInput.value = suggestion.process_tags.join(", ");
    tagInput.dataset.autoSuggested = suggestion.process_tags.length ? "1" : "";
  }
}

function prepareLinkPayload(data) {
  const suggestion = inferLinkKeywords(data);
  if (!data.machine_scope && suggestion.machine_scope.length) data.machine_scope = suggestion.machine_scope.join(", ");
  if (!data.process_tags && suggestion.process_tags.length) data.process_tags = suggestion.process_tags.join(", ");
  return data;
}

function compareLinksForDisplay(a, b) {
  const invalidDelta = Number(a.invalid === 1) - Number(b.invalid === 1);
  if (invalidDelta) return invalidDelta;
  const pinnedDelta = Number(b.pinned === 1) - Number(a.pinned === 1);
  if (pinnedDelta) return pinnedDelta;
  const clickDelta = Number(b.click_count || 0) - Number(a.click_count || 0);
  if (clickDelta) return clickDelta;
  return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
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
      link.quality_note,
      ...(link.machine_scope || []),
      ...(link.process_tags || []),
    ].filter(Boolean).join(" ").toLowerCase();
    return hitCategory && hitStatus && (!keyword || text.includes(keyword));
  }).sort(compareLinksForDisplay);
  const manageHeader = isAdminView() ? "<th>管理</th>" : "";
  $("#linkList").innerHTML = filtered.length ? `
    <table class="link-list-table ${isAdminView() ? "has-manage" : ""}">
      <thead><tr><th>名称</th><th>适用范围</th><th>地址</th><th>点击</th>${manageHeader}</tr></thead>
      <tbody>
        ${filtered.map((link) => {
          const scope = [...(link.machine_scope || []), ...(link.process_tags || [])];
          const scopeText = scope.join(", ") || "-";
          const addressText = [link.url, link.description].filter(Boolean).join(" · ");
          return `
          <tr class="${Number(link.invalid) === 1 ? "link-invalid" : ""}">
            <td>
              <div class="link-single-line link-name-line" title="${escapeHtml(link.title)}">
                <strong>${escapeHtml(link.title)}</strong>
                ${Number(link.pinned) === 1 ? '<span class="pill">置顶</span>' : ""}
                ${Number(link.invalid) === 1 ? '<span class="pill warn">失效</span>' : ""}
              </div>
            </td>
            <td>
              <div class="link-scope-tags" title="${escapeHtml(scopeText)}">
                ${scope.length ? scope.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("") : '<span class="link-empty">-</span>'}
              </div>
            </td>
            <td>
              <div class="link-single-line" title="${escapeHtml(addressText)}">
                ${Number(link.invalid) === 1
                  ? `<span class="link-url disabled">${escapeHtml(link.url)}</span>`
                  : `<a class="link-url" href="/api/links/${link.id}/open" target="_blank" rel="noreferrer">${escapeHtml(link.url)}</a>`}
                ${link.description ? `<span class="link-description"> · ${escapeHtml(link.description)}</span>` : ""}
              </div>
            </td>
            <td><span title="${escapeHtml(link.last_clicked_at || "")}">${Number(link.click_count || 0)} 次</span></td>
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
          </tr>`;
        }).join("")}
      </tbody>
    </table>` : "<p>没有匹配的链接</p>";
}

function renderShiftLine(shift) {
  const isNight = shift.shift_type === "night";
  const isMine = Number(shift.user_id) === Number(state.user?.id);
  const typeText = isNight ? "夜" : "白";
  const fullText = `${typeText}班 · ${shift.machine_name || ""} · ${shift.display_name || ""}`;
  const adminAction = isAdminView();
  return `<div class="shift-line ${isNight ? "night" : ""} ${isMine ? "mine" : ""} ${adminAction ? "has-action" : ""}" title="${escapeHtml(fullText)}">
    <span class="shift-line-main">
      <span class="shift-type">${typeText}</span>
      <span class="shift-machine">${escapeHtml(shift.machine_name)}</span>
      <span class="shift-user">${escapeHtml(shift.display_name)}</span>
    </span>
    ${adminAction ? `<button class="shift-delete-btn" type="button" data-shift-id="${shift.id}" title="删除排班">×</button>` : ""}
  </div>`;
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
  $("#selectedShiftDateTitle").textContent = isAdminView()
    ? `编辑排班 · ${state.selectedShiftDate}`
    : (state.user ? "我的本月排班" : "本月排班");
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
      ${shifts.map(renderShiftLine).join("")}
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
      <p class="thank-date-line">周次 ${escapeHtml(shortDate(vote.week_start))} · 送出 ${escapeHtml(shortDateTime(vote.created_at))}</p>
    </div>`).join("") : "<p>暂无感谢记录</p>";
}

async function refreshAll() {
  await loadReferenceData();
  const loaders = [
    loadRulesAndScores,
    loadMembers,
    loadLinks,
    loadShifts,
    loadThanks,
  ];
  if (!isGuest()) {
    loaders.push(loadDashboard, loadMeetings);
  }
  if (isAdminView()) {
    loaders.push(loadUsers, loadSystemAdmin);
  }
  await Promise.all(loaders.map((loader) => loader()));
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
  if (!data.avatar_url) throw new Error("请选择本地头像图片");
  await api(`/api/members/${form.dataset.memberId}`, { method: "PATCH", body: JSON.stringify({ avatar_url: data.avatar_url }) });
}

async function submitProfileForm(form) {
  const data = formData(form);
  const file = form.elements.avatar_file?.files?.[0];
  const avatar = await fileToDataUrl(file);
  const payload = {
    title: data.title || "",
    tags: data.tags || "",
    responsibilities: data.responsibilities || "",
    comment: data.comment || "",
    skills: data.skills || "",
    machine_scope: data.machine_scope || "",
    expertise: data.expertise || "",
  };
  if (avatar) payload.avatar_url = avatar;
  await api(`/api/members/${form.dataset.memberId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
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

function renderTeamReactions(post) {
  const reactions = post.reactions || [];
  const renderCount = (item) => `${escapeHtml(item.reaction)} <span>+${Number(item.count || 0)}</span>`;
  if (isGuest()) {
    if (!reactions.length) return "";
    return `<div class="chat-reactions readonly">
      ${reactions.map((item) => `<span class="chat-reaction-count">${renderCount(item)}</span>`).join("")}
    </div>`;
  }
  return `<div class="chat-reactions chat-reaction-wrap">
    <div class="chat-reaction-summary">
      ${reactions.length ? reactions.map((item) => `<button type="button" class="chat-reaction-chip ${item.mine ? "active" : ""}" data-post-id="${post.id}" data-reaction="${escapeHtml(item.reaction)}">${renderCount(item)}</button>`).join("") : ""}
      <button type="button" class="chat-reaction-picker-toggle" data-post-id="${post.id}">＋回应</button>
    </div>
  </div>`;
}

function closeReactionPopover() {
  const popover = $("#teamReactionPopover");
  if (popover) {
    popover.classList.add("hidden");
    popover.style.left = "";
    popover.style.top = "";
  }
  activeReactionPostId = null;
}

async function sendTeamReaction(postId, reaction) {
  if (!postId || !reaction) return;
  const data = await api(`/api/team-posts/${postId}/reactions`, {
    method: "POST",
    body: JSON.stringify({ reaction }),
  });
  closeReactionPopover();
  renderTeamChat(data.posts, true);
  toast("回应已更新");
}

function ensureReactionPopover() {
  let popover = $("#teamReactionPopover");
  if (popover) return popover;
  popover = document.createElement("div");
  popover.id = "teamReactionPopover";
  popover.className = "chat-reaction-picker hidden";
  popover.innerHTML = `
    <div class="chat-reaction-quick">
      ${teamReactionOptions.map((reaction) => `<button type="button" class="chat-reaction-option" data-reaction="${escapeHtml(reaction)}">${escapeHtml(reaction)}</button>`).join("")}
    </div>
    <emoji-picker class="team-emoji-picker" locale="zh" data-source="${emojiDataSource}"></emoji-picker>`;
  const picker = popover.querySelector("emoji-picker");
  picker.i18n = zhCnEmojiI18n;
  picker.locale = "zh";
  picker.dataSource = emojiDataSource;
  picker.addEventListener("emoji-click", (event) => {
    const reaction = event.detail?.unicode || event.detail?.emoji?.unicode;
    sendTeamReaction(activeReactionPostId, reaction).catch((error) => toast(error.message));
  });
  document.body.appendChild(popover);
  return popover;
}

function openReactionPopover(button) {
  const popover = ensureReactionPopover();
  const isSameOpen = activeReactionPostId === button.dataset.postId && !popover.classList.contains("hidden");
  if (isSameOpen) {
    closeReactionPopover();
    return;
  }
  activeReactionPostId = button.dataset.postId;
  popover.dataset.postId = activeReactionPostId;
  document.body.appendChild(popover);
  popover.classList.remove("hidden");
  const buttonRect = button.getBoundingClientRect();
  const popoverWidth = popover.offsetWidth || Math.min(360, window.innerWidth - 24);
  const popoverHeight = popover.offsetHeight || Math.min(390, window.innerHeight - 24);
  const left = Math.max(8, Math.min(buttonRect.left, window.innerWidth - popoverWidth - 8));
  const preferBottom = buttonRect.bottom + 8;
  const top = preferBottom + popoverHeight <= window.innerHeight
    ? preferBottom
    : Math.max(8, buttonRect.top - popoverHeight - 8);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function renderTeamReplies(post) {
  const replies = post.replies || [];
  if (!replies.length) return "";
  return `<div class="chat-replies">
    ${replies.map((reply) => `
      <div class="chat-reply">
        <p>${escapeHtml(reply.content)}</p>
        <small>${escapeHtml(reply.display_name)} · ${escapeHtml(reply.created_at || "")}</small>
      </div>`).join("")}
  </div>`;
}

function renderTeamChat(posts, preserveScroll = false) {
  const list = $("#teamChatList");
  if (!list) return;
  const previousTop = list.scrollTop;
  const items = posts || [];
  list.innerHTML = items.length ? items.map((post) => `
    <div class="chat-bubble ${post.kind === "roast" ? "roast" : ""}" data-post-id="${post.id}">
      <span class="pill ${post.kind === "roast" ? "warn" : ""}">${post.kind === "roast" ? "吐槽" : "评论"}</span>
      <p>${escapeHtml(post.content)}</p>
      <small>${escapeHtml(post.display_name)} · ${escapeHtml(post.created_at || "")}</small>
      ${renderTeamReactions(post)}
      ${renderTeamReplies(post)}
      ${isGuest() ? "" : `
        <div class="chat-reply-tools">
          <button type="button" class="chat-reply-toggle" data-post-id="${post.id}">回复</button>
          <form class="chat-reply-form hidden" data-post-id="${post.id}">
            <input name="content" placeholder="盖楼回复这一条" maxlength="300" required>
            <button>发送</button>
          </form>
        </div>`}
    </div>`).join("") : "<p>还没有团队对话，来开个头。</p>";
  list.scrollTop = preserveScroll ? previousTop : list.scrollHeight;
}

function filledText(value) {
  return String(value || "").trim();
}

function memberPersona(member, skills = []) {
  const rows = [
    ["技能", skills.map(escapeHtml).join(" / ")],
    ["擅长问题", escapeHtml(filledText(member.expertise))],
  ].filter(([, value]) => value);
  if (!rows.length) return "";
  return `<div class="member-persona">
    ${rows.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}
  </div>`;
}

function renderAvatar(member) {
  return member.avatar_url
    ? `<img class="avatar" src="${escapeHtml(member.avatar_url)}" alt="${escapeHtml(member.name)}">`
    : `<div class="avatar">${escapeHtml((member.name || "?").slice(0, 1))}</div>`;
}

function renderAvatarPreview(member) {
  return member.avatar_url ? `<img src="${escapeHtml(member.avatar_url)}" alt="${escapeHtml(member.name)}">` : escapeHtml((member.name || "?").slice(0, 1));
}

function setMemberAvatarPreview(src = "", fallback = "?") {
  const preview = $("#memberEditAvatarPreview");
  if (!preview) return;
  preview.innerHTML = src ? `<img src="${escapeHtml(src)}" alt="">` : escapeHtml((fallback || "?").slice(0, 1));
  preview.classList.toggle("has-image", Boolean(src));
}

function closeMemberEditModal() {
  const modal = $("#memberEditModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function openMemberEditModal(memberId) {
  const member = state.members.find((item) => Number(item.id) === Number(memberId));
  const modal = $("#memberEditModal");
  const form = $("#memberEditForm");
  if (!member || !modal || !form) return;
  const skills = member.skills || [];
  const tags = member.tags || [];
  form.dataset.memberId = member.id;
  form.dataset.userId = member.user_id || "";
  form.reset();
  form.elements.title.value = member.title || "";
  form.elements.tags.value = tags.join(", ");
  form.elements.responsibilities.value = member.responsibilities || "";
  form.elements.comment.value = member.comment || "";
  form.elements.skills.value = skills.join(", ");
  form.elements.expertise.value = member.expertise || "";
  $("#memberEditName").textContent = member.name || "成员";
  $("#memberEditAccount").textContent = member.account ? `账号 ${member.account}` : "未绑定账号";
  $("#memberEditAvatarPreview").innerHTML = renderAvatarPreview(member);
  $("#memberEditAvatarPreview").classList.toggle("has-image", Boolean(member.avatar_url));
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  form.elements.title.focus();
}

function renderMemberCard(member) {
  const canEdit = isAdminView() || member.user_id === state.user?.id;
  const skills = member.skills || [];
  const tags = member.tags || [];
  const responsibilities = filledText(member.responsibilities);
  const comment = filledText(member.comment);
  const account = filledText(member.account);
  return `
    <article class="member-card profile-only">
      <section class="member-profile">
        <div class="member-head">
          ${renderAvatar(member)}
          <div>
            <h3>${escapeHtml(member.name)}${account ? `<span class="member-account">账号 ${escapeHtml(account)}</span>` : ""}</h3>
            <p>${escapeHtml(member.title || "")}</p>
          </div>
        </div>
        ${tags.length ? `<div class="tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        <div class="member-brief">
          <p><strong>职责：</strong>${responsibilities ? escapeHtml(responsibilities) : "待补充"}</p>
          ${comment ? `<p>${escapeHtml(comment)}</p>` : ""}
        </div>
        ${memberPersona(member, skills)}
        ${canEdit ? `
          <button class="secondary member-edit-btn" type="button" data-member-id="${member.id}">编辑资料</button>` : ""}
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

function updateTopicOptionDefaults(optionSelect) {
  const form = optionSelect.closest("form");
  const optionId = Number(optionSelect.value);
  const option = state.topics.flatMap((topic) => topic.options || []).find((item) => Number(item.id) === optionId);
  if (!form || !option) return;
  if (form.elements.title && !form.elements.title.value.trim()) {
    form.elements.title.value = option.title || "";
  }
  if (form.elements.detail && !form.elements.detail.value.trim()) {
    form.elements.detail.value = option.default_detail || "";
  }
  if (form.elements.owner_id && option.owner_id && !form.elements.owner_id.value) {
    form.elements.owner_id.value = String(option.owner_id);
  }
}

function isThankYouTopic(item = {}) {
  const text = [item.type_name, item.section, item.title, item.option_title]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes("thank you") || text.includes("thankyou") || text.includes("感谢");
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
      state.showLogin = false;
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
    state.showLogin = false;
    applyAuthView();
    await refreshAll();
  });

  $("#loginEntryBtn")?.addEventListener("click", () => {
    state.showLogin = true;
    applyAuthView();
  });

  $("#guestBrowseBtn")?.addEventListener("click", async () => {
    state.showLogin = false;
    applyAuthView();
    switchPage("members");
    await refreshAll();
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
  bindForm("#linkForm", (data) => api("/api/links", { method: "POST", body: JSON.stringify(prepareLinkPayload(data)) }));
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
  const linkForm = $("#linkForm");
  if (linkForm) {
    ["title", "url", "description"].forEach((name) => {
      linkForm.elements[name]?.addEventListener("input", () => applyLinkKeywordSuggestion(linkForm));
    });
    linkForm.elements.category?.addEventListener("change", () => applyLinkKeywordSuggestion(linkForm));
    ["machine_scope", "process_tags"].forEach((name) => {
      linkForm.elements[name]?.addEventListener("input", () => {
        linkForm.elements[name].dataset.autoSuggested = "0";
      });
    });
    $("#inferLinkScopeBtn")?.addEventListener("click", () => {
      applyLinkKeywordSuggestion(linkForm, true);
      toast("已根据链接内容提炼关键词");
    });
  }

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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMemberEditModal();
  });

  document.body.addEventListener("click", (event) => {
    const memberEditButton = event.target.closest(".member-edit-btn");
    if (memberEditButton) {
      openMemberEditModal(memberEditButton.dataset.memberId);
      return;
    }
    if (event.target.closest("[data-member-modal-close]") || event.target === $("#memberEditModal")) {
      closeMemberEditModal();
      return;
    }
    const attendanceStatus = event.target.closest(".attendance-status-btn");
    if (attendanceStatus) {
      const form = attendanceStatus.closest(".attendance-row");
      form.elements.status.value = attendanceStatus.dataset.attendanceStatus;
      $$(".attendance-status-btn", form).forEach((button) => button.classList.toggle("active", button === attendanceStatus));
      updateAttendanceDonationVisibility(form);
      saveAttendanceForm(form).catch((error) => toast(error.message));
      return;
    }
    const reactionToggle = event.target.closest(".chat-reaction-picker-toggle");
    if (reactionToggle) {
      openReactionPopover(reactionToggle);
      return;
    }
    const chatReaction = event.target.closest(".chat-reaction-option, .chat-reaction-chip");
    if (chatReaction) {
      const postId = chatReaction.dataset.postId || activeReactionPostId;
      sendTeamReaction(postId, chatReaction.dataset.reaction).catch((error) => toast(error.message));
      return;
    }
    if (event.target.closest("#teamReactionPopover")) {
      return;
    }
    if (!event.target.closest(".chat-reaction-wrap")) {
      closeReactionPopover();
    }
    const chatReplyToggle = event.target.closest(".chat-reply-toggle");
    if (chatReplyToggle) {
      const bubble = chatReplyToggle.closest(".chat-bubble");
      const form = bubble?.querySelector(".chat-reply-form");
      form?.classList.toggle("hidden");
      form?.elements.content?.focus();
      return;
    }
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
    const topicTypeDelete = event.target.closest(".topic-type-delete-btn");
    if (topicTypeDelete) {
      const name = topicTypeDelete.dataset.topicTypeName || "该议题类型";
      if (!window.confirm(`确定删除 ${name} 吗？该类型下的预设议题会一并停用，历史会议记录会保留。`)) return;
      api(`/api/meeting-topic-types/${topicTypeDelete.dataset.topicTypeId}`, { method: "DELETE" })
        .then(refreshAll)
        .then(() => toast("议题类型已删除"))
        .catch((error) => toast(error.message));
      return;
    }
    const meetingEmail = event.target.closest(".meeting-email-btn");
    if (meetingEmail) {
      openMeetingEmail(meetingEmail.dataset.meetingId).catch((error) => toast(error.message));
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
    if (event.target.matches('#memberEditForm input[name="avatar_file"]')) {
      const file = event.target.files?.[0];
      const member = state.members.find((item) => Number(item.id) === Number($("#memberEditForm")?.dataset.memberId));
      if (!file) {
        setMemberAvatarPreview(member?.avatar_url || "", member?.name || "?");
        return;
      }
      fileToDataUrl(file)
        .then((src) => setMemberAvatarPreview(src, member?.name || "?"))
        .catch((error) => toast(error.message));
    }
    if (event.target.matches('.attendance-donation input[name="donation_done"]')) {
      const form = event.target.closest(".attendance-row");
      saveAttendanceForm(form).catch((error) => toast(error.message));
      return;
    }
    if (event.target.matches("[data-meeting-topic-select]")) updateOptionSelect(event.target);
    if (event.target.matches("[data-meeting-option-select]")) updateTopicOptionDefaults(event.target);
  });

  document.body.addEventListener("input", (event) => {
    if (!event.target.matches('.attendance-donation input[name="donation_amount"]')) return;
    const form = event.target.closest(".attendance-row");
    const stateEl = form?.querySelector(".attendance-save-state");
    if (stateEl) stateEl.textContent = "待保存";
    clearTimeout(form.__attendanceTimer);
    form.__attendanceTimer = setTimeout(() => {
      saveAttendanceForm(form).catch((error) => toast(error.message));
    }, 650);
  });

  document.body.addEventListener("submit", async (event) => {
    const postForm = event.target.closest(".post-form");
    const avatarForm = event.target.closest(".avatar-form");
    const profileForm = event.target.closest(".profile-edit-form");
    const userEditForm = event.target.closest(".user-edit-form");
    const topicForm = event.target.closest(".topic-item-form");
    const meetingTopicScopeForm = event.target.closest(".meeting-topic-scope-form");
    const minuteForm = event.target.closest(".minute-form");
    const presetForm = event.target.closest(".preset-form");
    const linkQualityForm = event.target.closest(".link-quality-form");
    const chatReplyForm = event.target.closest(".chat-reply-form");
    if (!postForm && !avatarForm && !profileForm && !userEditForm && !topicForm && !meetingTopicScopeForm && !minuteForm && !presetForm && !linkQualityForm && !chatReplyForm) return;
    event.preventDefault();
    try {
      if (chatReplyForm) {
        const data = await api(`/api/team-posts/${chatReplyForm.dataset.postId}/replies`, { method: "POST", body: JSON.stringify(formData(chatReplyForm)) });
        renderTeamChat(data.posts, true);
        toast("已回复");
        return;
      }
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
        closeMemberEditModal();
      }
      if (topicForm) {
        await api(`/api/meetings/${topicForm.dataset.meetingId}/items`, { method: "POST", body: JSON.stringify(formData(topicForm)) });
      }
      if (meetingTopicScopeForm) {
        const topicTypeIds = new FormData(meetingTopicScopeForm).getAll("topic_type_ids");
        await api(`/api/meetings/${meetingTopicScopeForm.dataset.meetingId}/topics`, {
          method: "PATCH",
          body: JSON.stringify({ topic_type_ids: topicTypeIds }),
        });
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
    await refreshAll();
  } catch {
    state.user = null;
    state.permissions = {};
    state.showLogin = false;
    applyAuthView();
    await refreshAll();
  }
}

boot();
