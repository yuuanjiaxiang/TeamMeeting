import "./vendor/emoji-picker-element/index.js";
import zhCnEmojiI18n from "./vendor/emoji-picker-element/i18n/zh_CN.js";

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
  morningItems: [],
  morningUsers: [],
  morningReadOnly: false,
  morningCarriedCount: 0,
  userTypes: [],
  moduleCatalog: [],
  settings: [],
  publicSettings: {},
  backups: [],
  auditLogs: [],
  shifts: [],
  activeShiftPopoverDate: null,
  personalMorningMonthItems: [],
  activePersonalMorningChain: null,
  currentPage: "members",
  morningDate: iso(new Date()),
  shiftMonth: new Date(),
  selectedShiftDate: iso(new Date()),
  meetingMonth: new Date(),
  meetingListScope: "week",
  selectedMeetingDate: iso(new Date()),
  selectedMeetingId: null,
  thankYear: new Date().getFullYear(),
  thankScope: "month",
  thankMonth: new Date().getMonth() + 1,
  viewMode: safeStorageGet("teamLoopViewMode", "admin"),
  showLogin: false,
  uiTheme: safeStorageGet("teamLoopThemeVersion", "") === uiThemeVersion
    ? safeStorageGet("teamLoopUiTheme", "miro")
    : "miro",
};

const pages = [
  ["members", "👥", "团队成员", "先看人，再看事。成员档案、职责和团队对话都在这里。"],
  ["dashboard", "⌂", "工作台", "快速查看团队本周重点数据。"],
  ["morning", "☀", "早例会", "按人追踪当天事项、风险和下一步。"],
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
const dateFilterPages = new Set(["dashboard", "rules"]);
const guestPages = new Set(["members", "shifts", "rules", "thanks", "links"]);
const uiThemes = new Set(["miro", "feishu", "yuque", "linear", "dingtalk"]);
const teamReactionOptions = ["+1", "👍", "🤑", "🤔", "收到", "辛苦了", "已跟进"];
const teamReactionEmojiAssets = {
  "1f44d": "/vendor/team-reaction-emoji/1f44d.svg",
  "1f911": "/vendor/team-reaction-emoji/1f911.svg",
  "1f914": "/vendor/team-reaction-emoji/1f914.svg",
};
const teamReactionEmojiDataSource = "/vendor/emoji-picker-element-data/zh/emojibase/data.json";
let activeReactionTarget = null;
let activePageRefreshId = 0;

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
  if (isAdminView()) return true;
  if (["users", "system"].includes(id)) return false;
  const modules = state.permissions?.modules;
  if (!Array.isArray(modules)) return true;
  return modules.includes(id);
}

function canManageLinks() {
  if (!state.user) return false;
  return state.user.role === "admin" || (state.user.user_type || "internal") === "internal";
}

function firstAccessiblePage() {
  return pages.find(([id]) => canAccessPage(id))?.[0] || (isGuest() ? "members" : "morning");
}

function canLoadModule(id) {
  return canAccessPage(id) || isAdminView();
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

function compactDate(value) {
  if (!value) return "";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(value).slice(5, 10).replace("-", "/");
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const prefix = sameYear ? "" : `${date.getFullYear()}/`;
  return `${prefix}${date.getMonth() + 1}/${date.getDate()}`;
}

function shortDateTime(value) {
  if (!value) return "";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ").slice(0, 16);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${shortDate(value)} ${time}`;
}

function isTodayValue(value) {
  return String(value || "").slice(0, 10) === iso(new Date());
}

function mondayOf(value) {
  const d = new Date(value);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return iso(d);
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
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
  const morningDate = $("#morningDate");
  if (morningDate && !morningDate.value) morningDate.value = state.morningDate;
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
  const duration = Math.min(9000, Math.max(2200, String(message).length * 90));
  window.__toastTimer = setTimeout(() => el.classList.add("hidden"), duration);
}

function periodQuery() {
  return `from=${encodeURIComponent($("#fromDate").value)}&to=${encodeURIComponent($("#toDate").value)}`;
}

function thankPeriodRange() {
  if (state.thankScope === "year") {
    return {
      from: `${state.thankYear}-01-01`,
      to: `${state.thankYear}-12-31`,
      label: `${state.thankYear} 年全年`,
    };
  }
  const start = new Date(state.thankYear, state.thankMonth - 1, 1);
  const end = monthEnd(start);
  return {
    from: iso(start),
    to: iso(end),
    label: `${state.thankYear} 年 ${state.thankMonth} 月`,
  };
}

function thankPeriodQuery() {
  const range = thankPeriodRange();
  return `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
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
  $("#passwordBtn")?.classList.toggle("hidden", guest);
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
    switchPage(firstAccessiblePage());
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
  if (!canAccessPage(id)) id = firstAccessiblePage();
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
  const tasks = [];
  if (canLoadModule("members")) {
    tasks.push(api("/api/members").then((data) => { state.members = data.members; }));
  } else {
    state.members = [];
  }
  if (canLoadModule("rules")) {
    tasks.push(api("/api/rules").then((data) => { state.rules = data.rules; }));
  } else {
    state.rules = [];
  }
  if (canLoadModule("shifts")) {
    tasks.push(api("/api/machines").then((data) => { state.machines = data.machines; }));
  } else {
    state.machines = [];
  }
  if (canLoadModule("links")) {
    tasks.push(api("/api/link-categories").then((data) => { state.linkCategories = data.categories; }));
  } else {
    state.linkCategories = [];
  }
  if (!isGuest() && canLoadModule("meetings")) {
    tasks.push(api("/api/meeting-topics").then((data) => { state.topics = data.types; }));
  } else {
    state.topics = [];
  }
  if (isAdminView()) {
    tasks.push(api("/api/users").then((data) => { state.users = data.users; }));
    tasks.push(api("/api/user-types").then((data) => {
      state.userTypes = data.types;
      state.moduleCatalog = data.modules;
    }));
  } else {
    state.users = [];
  }
  await Promise.all(tasks);
  if (!isAdminView() && state.members.length) {
    state.users = state.members
      .filter((member) => member.user_id)
      .map((member) => ({ id: member.user_id, display_name: member.linked_user || member.name, active: 1, role: "user" }));
  }
  populateSelects();
}

function populateSelects() {
  const selectUsers = state.users.length ? state.users : state.morningUsers.map((user) => ({ ...user, active: 1 }));
  const activeUsers = selectUsers.filter((user) => user.active !== 0);
  const userOptions = activeUsers.map((user) => `<option value="${user.id}">${escapeHtml(user.display_name)}</option>`).join("");
  const userOptional = `<option value="">不绑定账号</option>${userOptions}`;
  const ruleOptions = `<option value="">不关联规则</option>${state.rules.map((rule) => `<option value="${rule.id}">${rule.kind === "red" ? "红" : "黑"} · ${escapeHtml(rule.title)}</option>`).join("")}`;
  const machineOptions = state.machines.map((machine) => `<option value="${machine.id}">${escapeHtml(machine.name)}</option>`).join("");
  const thankUsers = activeUsers.filter((user) => user.id !== state.user?.id);
  const thankOptions = thankUsers.map((user) => `<option value="${user.id}">${escapeHtml(user.display_name)}</option>`).join("");
  const topicOptions = state.topics.map((topic) => `<option value="${topic.id}">${escapeHtml(topic.name)}</option>`).join("");
  const linkCategoryOptions = state.linkCategories.map((category) => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`).join("");
  const userTypeOptions = state.userTypes.map((type) => `<option value="${escapeHtml(type.key)}">${escapeHtml(type.name)}</option>`).join("");

  $$("[data-users]").forEach((select) => { select.innerHTML = userOptions; });
  $$("[data-morning-users]").forEach((select) => { select.innerHTML = userOptions; });
  $$("[data-user-types]").forEach((select) => { select.innerHTML = userTypeOptions; });
  $$("[data-users-optional]").forEach((select) => { select.innerHTML = userOptional; });
  $$("[data-rules]").forEach((select) => { select.innerHTML = ruleOptions; });
  $$("[data-machines]").forEach((select) => { select.innerHTML = machineOptions; });
  $$("[data-thank-users]").forEach((select) => { select.innerHTML = thankOptions; });
  $$("[data-thank-users-checklist]").forEach((box) => {
    const form = box.closest("form");
    const selected = form ? new Set(new FormData(form).getAll("receiver_ids").map(String)) : new Set();
    const selectedNames = thankUsers
      .filter((user) => selected.has(String(user.id)))
      .map((user) => user.display_name);
    box.innerHTML = `
      <summary class="thank-recipient-summary">
        <span data-thank-selected-label>${escapeHtml(selectedNames.length ? selectedNames.join("、") : "选择感谢对象（可多选）")}</span>
        <strong data-thank-selected-count>${selectedNames.length} 人</strong>
      </summary>
      <div class="thank-recipient-menu">
        ${thankUsers.length
          ? thankUsers.map((user) => `
            <label class="check-chip">
              <input type="checkbox" name="receiver_ids" value="${user.id}" data-name="${escapeHtml(user.display_name)}" ${selected.has(String(user.id)) ? "checked" : ""}>
              <span>${escapeHtml(user.display_name)}</span>
            </label>`).join("")
          : '<p class="empty-note">暂无可感谢成员</p>'}
      </div>`;
  });
  $$("[data-topic-types]").forEach((select) => { select.innerHTML = topicOptions; });
  $$("[data-owner-users]").forEach((select) => {
    const current = select.value;
    select.innerHTML = renderUserOptions(current);
    select.value = activeUsers.some((user) => Number(user.id) === Number(current)) ? current : "";
  });
  $$("[data-link-categories], [data-link-edit-categories]").forEach((select) => { select.innerHTML = linkCategoryOptions || '<option value="通用">通用</option>'; });
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

function renderThankRank(items = []) {
  if (!items.length) return `<p>暂无数据</p>`;
  return items.map((item, index) => `
    <div class="rank-row thank-rank-row">
      <span class="rank-no">${index + 1}</span>
      <strong>${escapeHtml(item.display_name || "未命名")}</strong>
      ${index < 3 ? '<span class="thank-rank-heart" aria-label="Thank You 之星">♥</span>' : ""}
      <span>${Number(item.thanks || 0)} 次</span>
    </div>`).join("");
}

function settingValue(key, fallback = "") {
  const setting = state.settings.find((item) => item.key === key);
  if (setting) return setting.value;
  return state.publicSettings?.[key] ?? fallback;
}

function applyBranding() {
  const brandName = settingValue("app_brand_name", "Team Loop") || "Team Loop";
  const teamName = settingValue("app_team_name", "技术项目团队") || "技术项目团队";
  const mark = brandName.trim().slice(0, 1).toUpperCase() || "T";
  const brandNameEl = $("#brandName");
  const brandTeamEl = $("#brandTeam");
  const brandMarkEl = $("#brandMark");
  if (brandNameEl) brandNameEl.textContent = brandName;
  if (brandTeamEl) brandTeamEl.textContent = teamName;
  if (brandMarkEl) brandMarkEl.textContent = mark;
  document.title = `${teamName}周例会`;
}

function formatBytes(value = 0) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isMyMorningItem(item) {
  return Number(item.owner_id) === Number(state.user?.id);
}

function sortMorningForWorkbench(items = []) {
  return [...items].sort((a, b) => {
    const score = (item) => (item.status === "risk" ? 4 : 0)
      + (item.blocker ? 3 : 0)
      + (isMorningDue(item) ? 2 : 0)
      + (item.priority === "high" ? 1 : 0);
    return score(b) - score(a) || String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
  });
}

function dateListBetween(startValue, endValue) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  const dates = [];
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    dates.push(iso(date));
  }
  return dates;
}

function morningChainId(item) {
  return String(item.root_id || item.id || `${item.owner_id}-${item.title}`);
}

function hashIndex(value, size) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 9973;
  }
  return Math.abs(hash) % size;
}

const personalLineColors = ["#3370ff", "#12b981", "#f59e0b", "#8b5cf6", "#ef4444", "#0ea5e9", "#14b8a6", "#f97316"];

function latestByMorningChain(items = []) {
  const map = new Map();
  items.forEach((item) => {
    const key = morningChainId(item);
    const current = map.get(key);
    if (!current || String(item.item_date) > String(current.item_date) || Number(item.id) > Number(current.id)) {
      map.set(key, item);
    }
  });
  return [...map.values()];
}

function renderPersonalMorningCard(item) {
  const [statusLabel, statusClass] = morningStatusMeta[item.status] || morningStatusMeta.todo;
  const chain = morningChainId(item);
  const color = personalLineColors[hashIndex(chain, personalLineColors.length)];
  const isActive = state.activePersonalMorningChain === chain;
  return `<article class="personal-reminder-card ${statusClass} ${isActive ? "calendar-focused" : ""}" data-personal-calendar-focus="${escapeHtml(chain)}" style="--line-color:${color}">
    <form class="personal-morning-form" data-item-id="${item.id}">
      <div class="personal-card-head">
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <div class="personal-card-meta">
            <span>${escapeHtml(compactDate(item.start_date || item.item_date))} 起 · ${Number(item.duration_days || 1)} 天</span>
            ${item.due_date ? `<span class="${isMorningDue(item) ? "risk-text" : ""}">到期 ${escapeHtml(shortDate(item.due_date))}</span>` : ""}
          </div>
        </div>
        <span class="pill">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="personal-edit-grid">
        <div class="personal-choice-field">
          <span>进度</span>
          ${renderMorningChoiceGroup("status", item.status || "todo", "status")}
        </div>
        <div class="personal-choice-field">
          <span>优先级</span>
          ${renderMorningChoiceGroup("priority", item.priority || "normal", "priority")}
        </div>
        <label>到期<input name="due_date" type="date" value="${escapeHtml(item.due_date || item.item_date)}"></label>
      </div>
      <label class="personal-edit-field">进展 / 下一步<textarea name="detail" placeholder="更新今天的进展、下一步动作">${escapeHtml(item.detail || "")}</textarea></label>
      <label class="personal-edit-field">风险<textarea name="blocker" placeholder="没有风险可留空">${escapeHtml(item.blocker || "")}</textarea></label>
      <div class="personal-card-actions">
        <button type="submit">保存进展</button>
        <button class="secondary morning-history-btn" type="button" data-morning-history-id="${item.id}">查看进展</button>
      </div>
    </form>
  </article>`;
}

function renderPersonalDoneItem(item) {
  const [statusLabel, statusClass] = morningStatusMeta[item.status] || morningStatusMeta.done;
  const chain = morningChainId(item);
  const color = personalLineColors[hashIndex(chain, personalLineColors.length)];
  const isActive = state.activePersonalMorningChain === chain;
  return `<article class="personal-done-item ${statusClass} ${isActive ? "active" : ""}" role="button" tabindex="0" data-personal-calendar-focus="${escapeHtml(chain)}" style="--line-color:${color}">
    <div>
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(compactDate(item.start_date || item.item_date))} 起 · ${Number(item.duration_days || 1)} 天 · ${escapeHtml(statusLabel)}</span>
    </div>
    <button class="secondary morning-history-btn" type="button" data-morning-history-id="${item.id}">进展</button>
  </article>`;
}

function buildPersonalCalendarModel(items = [], month = new Date()) {
  const start = monthStart(month);
  const end = monthEnd(month);
  const chains = new Map();
  items.filter(isMyMorningItem).forEach((item) => {
    if (item.item_date < iso(start) || item.item_date > iso(end)) return;
    const id = morningChainId(item);
    if (!chains.has(id)) {
      chains.set(id, {
        id,
        title: item.title || "事项",
        color: personalLineColors[hashIndex(id, personalLineColors.length)],
        dates: new Map(),
        minDate: item.item_date,
        maxDate: item.item_date,
        lane: 0,
      });
    }
    const chain = chains.get(id);
    const existing = chain.dates.get(item.item_date);
    if (!existing || Number(item.id) >= Number(existing.id)) {
      chain.dates.set(item.item_date, item);
    }
    chain.minDate = String(item.item_date) < String(chain.minDate) ? item.item_date : chain.minDate;
    chain.maxDate = String(item.item_date) > String(chain.maxDate) ? item.item_date : chain.maxDate;
  });
  const laneDates = [];
  const chainList = [...chains.values()].sort((a, b) => String(a.minDate).localeCompare(String(b.minDate)) || String(a.title).localeCompare(String(b.title), "zh-CN"));
  chainList.forEach((chain) => {
    let lane = laneDates.findIndex((dates) => ![...chain.dates.keys()].some((date) => dates.has(date)));
    if (lane < 0) {
      lane = laneDates.length;
      laneDates[lane] = new Set();
    }
    chain.lane = lane;
    chain.dates.forEach((_, date) => laneDates[lane].add(date));
  });
  const byDate = {};
  chainList.forEach((chain) => {
    chain.dates.forEach((item, date) => {
      byDate[date] ||= [];
      byDate[date].push({ chain, item });
    });
  });
  Object.keys(byDate).forEach((date) => {
    byDate[date].sort((a, b) => a.chain.lane - b.chain.lane || String(a.item.title).localeCompare(String(b.item.title), "zh-CN"));
  });
  return { byDate, chains };
}

function renderPersonalMorningCalendar(items = []) {
  const target = $("#personalMorningCalendar");
  if (!target) return;
  const today = new Date();
  const month = new Date(today.getFullYear(), today.getMonth(), 1);
  const start = monthStart(month);
  const gridStart = new Date(start);
  gridStart.setDate(start.getDate() - (start.getDay() || 7) + 1);
  const model = buildPersonalCalendarModel(items, month);
  const weekdays = ["一", "二", "三", "四", "五", "六", "日"].map((day) => `<div class="personal-calendar-weekday">${day}</div>`).join("");
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateKey = iso(date);
    const dayEntries = model.byDate[dateKey] || [];
    const hasFocusedLine = dayEntries.some(({ chain }) => chain.id === state.activePersonalMorningChain);
    const visibleLanes = Array.from({ length: 4 }, (_, lane) => dayEntries.find((entry) => entry.chain.lane === lane) || null);
    if (hasFocusedLine && !visibleLanes.some((entry) => entry?.chain.id === state.activePersonalMorningChain)) {
      visibleLanes[3] = dayEntries.find(({ chain }) => chain.id === state.activePersonalMorningChain);
    }
    const visibleChainIds = new Set(visibleLanes.filter(Boolean).map((entry) => entry.chain.id));
    const hiddenCount = dayEntries.filter(({ chain }) => !visibleChainIds.has(chain.id)).length;
    cells.push(`<div class="personal-calendar-day ${date.getMonth() !== month.getMonth() ? "other" : ""} ${dateKey === iso(today) ? "today" : ""} ${hasFocusedLine ? "focused-line-day" : ""}">
      <div class="personal-calendar-date">${date.getDate()}</div>
      <div class="personal-calendar-lines">
        ${visibleLanes.map((entry) => {
          if (!entry) return `<span class="personal-calendar-line-slot"></span>`;
          const { chain, item } = entry;
          const [, statusClass] = morningStatusMeta[item.status] || morningStatusMeta.todo;
          const previousDate = iso(addDays(`${dateKey}T00:00:00`, -1));
          const nextDate = iso(addDays(`${dateKey}T00:00:00`, 1));
          const isWeekStart = date.getDay() === 1;
          const isWeekEnd = date.getDay() === 0;
          const hasPrevious = chain.dates.has(previousDate) && !isWeekStart;
          const hasNext = chain.dates.has(nextDate) && !isWeekEnd;
          const segmentClass = `${hasPrevious ? "connect-left" : "segment-start"} ${hasNext ? "connect-right" : "segment-end"}`;
          const highlighted = chain.id === state.activePersonalMorningChain ? "highlighted" : "";
          const [statusLabel] = morningStatusMeta[item.status] || morningStatusMeta.todo;
          return `<span class="personal-calendar-line ${statusClass} ${segmentClass} ${highlighted}" data-chain-id="${escapeHtml(chain.id)}" data-personal-calendar-focus="${escapeHtml(chain.id)}" tabindex="0" style="--line-color:${chain.color}" title="${escapeHtml(item.title)}">
            <span class="personal-line-popover">
              <strong>${escapeHtml(shortDate(dateKey))} · ${escapeHtml(statusLabel)} · ${escapeHtml(morningPriorityMeta[item.priority] || "中")}</strong>
              <b>${escapeHtml(item.title)}</b>
              ${item.detail ? `<small>进展：${escapeHtml(item.detail)}</small>` : ""}
              ${item.blocker ? `<small class="risk-text">风险：${escapeHtml(item.blocker)}</small>` : ""}
            </span>
          </span>`;
        }).join("")}
        ${hiddenCount ? `<span class="personal-calendar-more">+${hiddenCount}</span>` : ""}
      </div>
      ${dayEntries.length ? `<div class="personal-calendar-popover">
        <strong>${escapeHtml(shortDate(dateKey))}</strong>
        ${dayEntries.map(({ chain, item }) => {
          const [statusLabel] = morningStatusMeta[item.status] || morningStatusMeta.todo;
          const highlighted = chain.id === state.activePersonalMorningChain ? "active" : "";
          return `<div class="personal-calendar-popover-item ${highlighted}" role="button" tabindex="0" data-personal-calendar-focus="${escapeHtml(chain.id)}" style="--line-color:${chain.color}">
            <span>${escapeHtml(statusLabel)} · ${escapeHtml(morningPriorityMeta[item.priority] || "中")}</span>
            <b>${escapeHtml(item.title)}</b>
            ${item.detail ? `<small>进展：${escapeHtml(item.detail)}</small>` : ""}
            ${item.blocker ? `<small class="risk-text">风险：${escapeHtml(item.blocker)}</small>` : ""}
          </div>`;
        }).join("")}
      </div>` : ""}
    </div>`);
  }
  target.innerHTML = weekdays + cells.join("");
}

function renderPersonalMorningList(items = [], monthItems = items) {
  const activeTarget = $("#personalMorningActiveList");
  const doneTarget = $("#personalMorningDoneList");
  if (!activeTarget || !doneTarget) return;
  const myItems = sortMorningForWorkbench(items.filter(isMyMorningItem));
  const activeItems = myItems.filter((item) => item.status !== "done");
  const doneItems = latestByMorningChain(monthItems.filter((item) => isMyMorningItem(item) && item.status === "done"))
    .sort((a, b) => String(b.item_date).localeCompare(String(a.item_date)) || String(a.title || "").localeCompare(String(b.title || ""), "zh-CN"));
  activeTarget.innerHTML = activeItems.length
    ? activeItems.map(renderPersonalMorningCard).join("")
    : `<p class="empty-note">今天没有进行中的早例会事项。</p>`;
  doneTarget.innerHTML = doneItems.length
    ? doneItems.map(renderPersonalDoneItem).join("")
    : `<p class="empty-note">本月还没有完成事项。</p>`;
  renderPersonalMorningCalendar(monthItems);
}

function renderPersonalWorkbench({ morningItems = [], monthItems = [] } = {}) {
  if (!$("#personalMorningActiveList")) return;
  state.personalMorningMonthItems = monthItems.length ? monthItems : morningItems;
  const chainExists = state.personalMorningMonthItems.some((item) => morningChainId(item) === state.activePersonalMorningChain);
  if (!chainExists) state.activePersonalMorningChain = null;
  renderPersonalMorningList(morningItems, state.personalMorningMonthItems);
}

function focusPersonalMorningChain(chain) {
  state.activePersonalMorningChain = chain || null;
  renderPersonalMorningCalendar(state.personalMorningMonthItems);
  $$("[data-personal-calendar-focus]").forEach((item) => {
    const isActive = item.dataset.personalCalendarFocus === state.activePersonalMorningChain;
    item.classList.toggle("calendar-focused", isActive);
    if (item.classList.contains("personal-done-item")) {
      item.classList.toggle("active", isActive);
    }
  });
  $("#personalMorningCalendar")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function findMyDashboardRow(items = []) {
  return items.find((item) => Number(item.id) === Number(state.user?.id)) || null;
}

function renderOwnScoreSummary(score) {
  if (!score) return `<p class="empty-note">当前周期暂无你的红黑榜积分。</p>`;
  return `
    <div class="rank-row"><span class="rank-no">红</span><strong>红榜加分</strong><span>${Number(score.red_points || 0)} 分</span></div>
    <div class="rank-row"><span class="rank-no">黑</span><strong>黑榜记录</strong><span>${Number(score.black_points || 0)} 分</span></div>
  `;
}

function renderOwnThanksSummary(thanks) {
  if (!thanks) return `<p class="empty-note">当前周期暂无你收到的 Thank You。</p>`;
  return `
    <div class="rank-row"><span class="rank-no">谢</span><strong>收到感谢</strong><span>${Number(thanks.thanks || 0)} 次</span></div>
  `;
}

async function loadPersonalMorningMonth() {
  const today = iso(new Date());
  const start = iso(monthStart(new Date()));
  const dates = dateListBetween(start, today);
  const responses = await Promise.all(dates.map((date) => api(`/api/morning-items?date=${encodeURIComponent(date)}`)));
  const todayData = responses.find((response) => response.date === today) || responses[responses.length - 1] || { items: [] };
  return {
    today: todayData,
    monthItems: responses.flatMap((response) => response.items || []),
  };
}

async function loadDashboard() {
  const emptyScores = { totals: [], timeline: [] };
  const emptyThanks = { stars: [] };
  const emptyShifts = { by_user: [], by_machine: [] };
  const emptyMorning = { today: { items: [] }, monthItems: [] };
  const [scores, thanks, shifts, morning] = await Promise.all([
    canLoadModule("rules") ? api(`/api/dashboards/red-black?${periodQuery()}`).catch(() => emptyScores) : emptyScores,
    canLoadModule("thanks") ? api(`/api/dashboards/thank-you?${periodQuery()}`).catch(() => emptyThanks) : emptyThanks,
    canLoadModule("shifts") ? api(`/api/dashboards/shifts?${periodQuery()}`).catch(() => emptyShifts) : emptyShifts,
    canLoadModule("morning") ? loadPersonalMorningMonth().catch(() => emptyMorning) : emptyMorning,
  ]);
  const myScore = findMyDashboardRow(scores.totals);
  const myThanks = findMyDashboardRow(thanks.stars);
  const myShift = findMyDashboardRow(shifts.by_user);
  const myMorningItems = (morning.today?.items || []).filter(isMyMorningItem);
  $("#metricScore").textContent = `红 ${Number(myScore?.red_points || 0)} / 黑 ${Number(myScore?.black_points || 0)}`;
  $("#metricThanks").textContent = Number(myThanks?.thanks || 0);
  $("#metricHours").textContent = Number(myShift?.hours || 0);
  $("#metricMeetings").textContent = myMorningItems.length;
  $("#scoreRank").innerHTML = renderOwnScoreSummary(myScore);
  $("#thanksRank").innerHTML = renderOwnThanksSummary(myThanks);
  renderPersonalWorkbench({
    morningItems: morning.today?.items || [],
    monthItems: morning.monthItems || [],
  });
}

const morningStatusMeta = {
  todo: ["待处理", "status-todo"],
  doing: ["进行中", "status-doing"],
  risk: ["有风险", "status-risk"],
  done: ["已完成", "status-done"],
};

const morningPriorityMeta = {
  low: "低",
  normal: "中",
  high: "高",
};

const morningStatusChoices = [
  ["todo", "待处理"],
  ["doing", "进行中"],
  ["risk", "有风险"],
  ["done", "已完成"],
];

const morningPriorityChoices = [
  ["high", "高"],
  ["normal", "中"],
  ["low", "低"],
];

const meetingItemStatusMeta = {
  todo: ["待处理", "status-todo"],
  doing: ["进行中", "status-doing"],
  done: ["已完成", "status-done"],
};

function renderMorningStatusOptions(selected) {
  return Object.entries(morningStatusMeta)
    .map(([value, meta]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${meta[0]}</option>`)
    .join("");
}

function renderMorningPriorityOptions(selected) {
  return Object.entries(morningPriorityMeta)
    .map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`)
    .join("");
}

function renderMorningChoiceGroup(name, selected, kind) {
  const choices = kind === "priority" ? morningPriorityChoices : morningStatusChoices;
  const fallback = kind === "priority" ? "normal" : "todo";
  const value = choices.some(([choiceValue]) => choiceValue === selected) ? selected : fallback;
  return `
    <input name="${escapeHtml(name)}" type="hidden" value="${escapeHtml(value)}" />
    <div class="morning-choice-group ${escapeHtml(kind)}" role="group" aria-label="${kind === "priority" ? "事项优先级" : "事项进度"}">
      ${choices.map(([choiceValue, label]) => `
        <button class="morning-choice-btn ${escapeHtml(kind)}-${escapeHtml(choiceValue)} ${choiceValue === value ? "active" : ""}" type="button" data-choice-name="${escapeHtml(name)}" data-choice-value="${escapeHtml(choiceValue)}">
          ${escapeHtml(label)}
        </button>`).join("")}
    </div>`;
}

function syncMorningChoiceGroups(root = document) {
  $$(".morning-choice-group", root).forEach((group) => {
    const firstButton = group.querySelector("[data-choice-name]");
    const name = firstButton?.dataset.choiceName;
    const input = name ? group.closest("form")?.elements[name] : null;
    if (!input) return;
    $$(".morning-choice-btn", group).forEach((button) => {
      button.classList.toggle("active", button.dataset.choiceValue === input.value);
    });
  });
}

function setMorningChoice(button) {
  const form = button.closest("form");
  const group = button.closest(".morning-choice-group");
  const name = button.dataset.choiceName;
  if (!form || !group || !name || !form.elements[name]) return;
  form.elements[name].value = button.dataset.choiceValue || "";
  $$(".morning-choice-btn", group).forEach((item) => {
    item.classList.toggle("active", item === button);
  });
  if (name === "status" && button.dataset.choiceValue === "risk") {
    form.elements.blocker?.focus();
  }
}

function renderMeetingItemStatusOptions(selected) {
  return Object.entries(meetingItemStatusMeta)
    .map(([value, meta]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${meta[0]}</option>`)
    .join("");
}

function isMorningDue(item) {
  return item.status !== "done" && item.due_date && item.due_date <= state.morningDate;
}

function morningRiskItems(items = state.morningItems) {
  return items
    .filter((item) => item.status === "risk" || item.blocker || item.priority === "high" || isMorningDue(item))
    .sort((a, b) => {
      const score = (item) => (item.status === "risk" ? 4 : 0) + (item.blocker ? 3 : 0) + (isMorningDue(item) ? 2 : 0) + (item.priority === "high" ? 1 : 0);
      return score(b) - score(a);
    });
}

function renderMorningFocus() {
  const target = $("#morningFocusList");
  if (!target) return;
  const risks = morningRiskItems().slice(0, 4);
  target.innerHTML = risks.length
    ? `<strong>今日风险重点</strong>${risks.map((item) => `
        <span class="morning-focus-chip ${item.status === "risk" ? "is-risk" : ""}">
          ${escapeHtml(item.owner_name || "未分配")} · ${escapeHtml(item.title)}
          ${item.blocker ? `｜风险：${escapeHtml(item.blocker)}` : ""}
        </span>
      `).join("")}`
    : `<strong>今日风险重点</strong><span class="morning-focus-chip">暂无明确风险，按清单推进即可</span>`;
}

function renderMorningSummary() {
  const totals = { todo: 0, doing: 0, risk: 0, done: 0 };
  state.morningItems.forEach((item) => { totals[item.status] = (totals[item.status] || 0) + 1; });
  const total = state.morningItems.length;
  const activeTotal = state.morningItems.filter((item) => item.status !== "done").length;
  const dueTotal = state.morningItems.filter(isMorningDue).length;
  $("#morningStats").innerHTML = `
    <div class="morning-stat status-total">
      <span>总事项</span>
      <strong>${total}</strong>
    </div>
    <div class="morning-stat status-active">
      <span>未完成</span>
      <strong>${activeTotal}</strong>
    </div>
    <div class="morning-stat status-risk">
      <span>风险</span>
      <strong>${totals.risk || 0}</strong>
    </div>
    <div class="morning-stat status-due">
      <span>到期/逾期</span>
      <strong>${dueTotal}</strong>
    </div>
    <div class="morning-stat status-carried">
      <span>自动带入</span>
      <strong>${state.morningCarriedCount || 0}</strong>
    </div>`;
  renderMorningFocus();
}

function renderMorningBoard() {
  const board = $("#morningBoard");
  if (!board) return;
  const users = state.morningUsers.length ? state.morningUsers : state.users;
  if (!users.length) {
    board.innerHTML = "<p>暂无成员数据</p>";
    return;
  }
  let ownerFilter = $("#morningOwnerFilter")?.value || "";
  const statusFilter = $("#morningStatusFilter")?.value || "";
  const ownerOptions = `<option value="">全部成员</option>${users.map((user) => `<option value="${user.id}">${escapeHtml(user.display_name)}</option>`).join("")}`;
  const ownerSelect = $("#morningOwnerFilter");
  if (ownerSelect) {
    const current = ownerSelect.value;
    ownerSelect.innerHTML = ownerOptions;
    ownerSelect.value = users.some((user) => String(user.id) === String(current)) ? current : "";
    ownerFilter = ownerSelect.value;
  }
  const byOwner = {};
  const filteredItems = state.morningItems.filter((item) => {
    if (ownerFilter && String(item.owner_id) !== String(ownerFilter)) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    return true;
  });
  filteredItems.forEach((item) => {
    byOwner[item.owner_id] = byOwner[item.owner_id] || [];
    byOwner[item.owner_id].push(item);
  });
  const visibleUsers = users.filter((user) => !ownerFilter || String(user.id) === String(ownerFilter));
  board.innerHTML = visibleUsers.map((user) => {
    const items = byOwner[user.id] || [];
    const personSummary = {
      active: items.filter((item) => item.status !== "done").length,
      risk: items.filter((item) => item.status === "risk" || item.blocker).length,
      done: items.filter((item) => item.status === "done").length,
    };
    return `
      <section class="morning-person-row">
        <div class="morning-person-head">
          <div>
            <strong>${escapeHtml(user.display_name)}</strong>
            <span>账号 ${escapeHtml(user.username || "")}</span>
          </div>
          <div class="morning-person-summary">
            <span>全部 ${items.length}</span>
            <span>未完成 ${personSummary.active}</span>
            <span class="${personSummary.risk ? "is-risk" : ""}">风险 ${personSummary.risk}</span>
            <span>完成 ${personSummary.done}</span>
          </div>
        </div>
        <div class="morning-list-head">
          <span>状态</span>
          <span>事项点</span>
          <span>今日进展 / 下一步</span>
          <span>风险 / 到期</span>
          <span>操作</span>
        </div>
        <div class="morning-item-stack">
          ${items.length ? items.map(renderMorningItem).join("") : `<p class="empty-note">当天暂无匹配事项</p>`}
        </div>
      </section>
    `;
  }).join("");
}

function canEditMorningItem(item) {
  return !state.morningReadOnly && (isAdminView() || Number(item.owner_id) === Number(state.user?.id));
}

function renderMorningItem(item) {
  const [statusLabel, statusClass] = morningStatusMeta[item.status] || morningStatusMeta.todo;
  const canEdit = canEditMorningItem(item);
  const durationText = `${compactDate(item.start_date || item.item_date)}起 · ${Number(item.duration_days || 1)}天`;
  const dueText = item.due_date ? `${isMorningDue(item) ? "到期需处理" : "到期"} ${shortDate(item.due_date)}` : "未设到期";
  const riskText = item.blocker ? item.blocker : (item.status === "risk" ? "请补充风险说明" : "暂无风险");
  return `
    <article class="morning-item-card morning-list-item ${statusClass}" data-morning-history-id="${item.id}">
      ${canEdit ? `
        <form class="morning-item-form morning-list-item-form" data-item-id="${item.id}">
          <div class="morning-status-cell">
            <div class="morning-badge-stack">
              <span class="morning-badge ${statusClass}">${escapeHtml(statusLabel)}</span>
              <span class="morning-badge priority-${escapeHtml(item.priority || "normal")}">优先级 ${escapeHtml(morningPriorityMeta[item.priority] || "中")}</span>
              <span class="morning-badge source">${escapeHtml(durationText)}</span>
            </div>
            <select name="status">${renderMorningStatusOptions(item.status)}</select>
            <select name="priority">${renderMorningPriorityOptions(item.priority)}</select>
          </div>
          <input name="title" value="${escapeHtml(item.title)}" placeholder="事项点" required>
          <textarea name="detail" placeholder="今日进展 / 下一步">${escapeHtml(item.detail || "")}</textarea>
          <div class="morning-risk-cell">
            <input name="blocker" value="${escapeHtml(item.blocker || "")}" placeholder="风险说明">
            <input name="due_date" type="date" value="${escapeHtml(item.due_date || item.item_date)}">
            <small class="${isMorningDue(item) ? "risk-text" : ""}">${escapeHtml(dueText)}</small>
          </div>
          <div class="morning-item-actions">
            <button type="submit">保存</button>
            <button class="secondary morning-history-btn" type="button" data-morning-history-id="${item.id}">进展</button>
            <button class="danger morning-delete-btn" type="button" data-item-id="${item.id}">删除</button>
          </div>
        </form>
      ` : `
        <div class="morning-status-cell">
          <div class="morning-badge-stack">
            <span class="morning-badge ${statusClass}">${escapeHtml(statusLabel)}</span>
            <span class="morning-badge priority-${escapeHtml(item.priority || "normal")}">优先级 ${escapeHtml(morningPriorityMeta[item.priority] || "中")}</span>
            <span class="morning-badge source">${escapeHtml(durationText)}</span>
          </div>
        </div>
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <small>更新 ${escapeHtml(shortDateTime(item.updated_at || item.created_at))}</small>
        </div>
        <p>${escapeHtml(item.detail || "暂无进展说明")}</p>
        <div>
          <p class="${item.blocker || item.status === "risk" ? "risk-text" : ""}">风险：${escapeHtml(riskText)}</p>
          <small class="${isMorningDue(item) ? "risk-text" : ""}">${escapeHtml(dueText)}</small>
        </div>
        <div class="morning-item-actions">
          <button class="secondary morning-history-btn" type="button" data-morning-history-id="${item.id}">进展</button>
          <span class="pill">${state.morningReadOnly ? "历史只读" : "只读"}</span>
        </div>
      `}
    </article>
  `;
}

function closeMorningHistoryModal() {
  const modal = $("#morningHistoryModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function renderMorningHistory(data) {
  const item = data.item || {};
  const history = data.history || [];
  const [statusLabel, statusClass] = morningStatusMeta[item.status] || morningStatusMeta.todo;
  const title = $("#morningHistoryTitle");
  const subtitle = $("#morningHistorySubtitle");
  const meta = $("#morningHistoryMeta");
  const list = $("#morningHistoryList");
  if (title) title.textContent = item.title || "事项进展";
  if (subtitle) {
    subtitle.textContent = `${item.owner_name || "负责人"} · 从 ${shortDate(item.start_date || item.item_date)} 开始 · 持续 ${Number(item.duration_days || 1)} 天`;
  }
  if (meta) {
    meta.innerHTML = `
      <span class="morning-badge ${statusClass}">${escapeHtml(statusLabel)}</span>
      <span class="morning-badge priority-${escapeHtml(item.priority || "normal")}">优先级 ${escapeHtml(morningPriorityMeta[item.priority] || "中")}</span>
      <span class="morning-badge source">开始 ${escapeHtml(shortDate(item.start_date || item.item_date))}</span>
      <span class="morning-badge source">持续 ${Number(item.duration_days || 1)} 天</span>
    `;
  }
  if (!list) return;
  if (!history.length) {
    list.innerHTML = `<p class="empty-note">这条事项还没有手动更新记录。自动带入但未更新的日期不会展示。</p>`;
    return;
  }
  list.innerHTML = history.map((row) => {
    const [rowStatusLabel, rowStatusClass] = morningStatusMeta[row.status] || morningStatusMeta.todo;
    return `
      <article class="morning-history-entry ${rowStatusClass}">
        <div class="morning-history-date">
          <strong>${escapeHtml(shortDate(row.item_date))}</strong>
          <span>${escapeHtml(row.updated_by_name || row.owner_name || "成员")} 更新于 ${escapeHtml(shortDateTime(row.updated_at || row.created_at))}</span>
        </div>
        <div class="morning-history-content">
          <span class="morning-badge ${rowStatusClass}">${escapeHtml(rowStatusLabel)}</span>
          <h3>${escapeHtml(row.title || item.title || "事项")}</h3>
          <p>${escapeHtml(row.detail || "暂无进展说明")}</p>
          ${row.blocker ? `<p class="risk-text">风险：${escapeHtml(row.blocker)}</p>` : ""}
          <small>到期 ${escapeHtml(shortDate(row.due_date || row.item_date))} · 持续第 ${Number(row.duration_days || 1)} 天</small>
        </div>
      </article>
    `;
  }).join("");
}

async function openMorningHistory(itemId) {
  const modal = $("#morningHistoryModal");
  if (!modal || !itemId) return;
  $("#morningHistoryTitle").textContent = "事项进展";
  $("#morningHistorySubtitle").textContent = "正在加载...";
  $("#morningHistoryMeta").innerHTML = "";
  $("#morningHistoryList").innerHTML = `<p class="empty-note">正在加载进展记录...</p>`;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  const data = await api(`/api/morning-items/${itemId}/history`);
  renderMorningHistory(data);
}

function renderMorning() {
  const dateInput = $("#morningDate");
  if (dateInput) dateInput.value = state.morningDate;
  if (isAdminView()) {
    $("#morningOwnerField")?.classList.remove("hidden");
  } else {
    $("#morningOwnerField")?.classList.add("hidden");
  }
  const createPanel = $("#morningCreatePanel");
  if (createPanel) createPanel.classList.toggle("hidden", state.morningReadOnly);
  const hint = $("#morningLockHint");
  if (hint) {
    hint.classList.toggle("hidden", false);
    hint.textContent = state.morningReadOnly
      ? "当前日期已结束，早例会记录已锁定，只能查看不能修改。"
      : state.morningCarriedCount > 0
        ? `已自动带入 ${state.morningCarriedCount} 条未完成事项。`
        : "未完成事项会持续跟踪，进入新一天时自动带入。";
  }
  renderMorningSummary();
  renderMorningBoard();
  populateSelects();
}

async function loadMorning() {
  if (!canLoadModule("morning")) return;
  const date = $("#morningDate")?.value || state.morningDate || iso(new Date());
  state.morningDate = date;
  const data = await api(`/api/morning-items?date=${encodeURIComponent(date)}`);
  state.morningItems = data.items;
  state.morningUsers = data.users;
  state.morningReadOnly = Boolean(data.read_only);
  state.morningCarriedCount = Number(data.carried_count || 0);
  renderMorning();
}

async function loadUsers() {
  if (!isAdminView()) return;
  const [data, typeData] = await Promise.all([
    api("/api/users"),
    api("/api/user-types"),
  ]);
  state.users = data.users;
  state.userTypes = typeData.types;
  state.moduleCatalog = typeData.modules;
  $("#userList").innerHTML = renderUserTable(data.users);
  renderUserTypePermissions();
  populateSelects();
}

function renderUserTypeOptions(selected) {
  const options = state.userTypes.length ? state.userTypes : [{ key: "internal", name: "内部成员" }, { key: "partner", name: "合作方" }];
  return options.map((type) => `<option value="${escapeHtml(type.key)}" ${type.key === selected ? "selected" : ""}>${escapeHtml(type.name)}</option>`).join("");
}

function renderUserTable(users) {
  if (!users.length) return "<p>暂无数据</p>";
  return `<table><thead><tr><th>账号</th><th>姓名 / 角色</th><th>用户类型</th><th>密码</th><th>操作</th></tr></thead><tbody>${users.map((user) => `
    <tr>
      <td>
        <input form="userEdit${user.id}" name="username" value="${escapeHtml(user.username)}" placeholder="账号" required>
      </td>
      <td>
        <form id="userEdit${user.id}" class="user-edit-form user-inline-form" data-user-id="${user.id}">
          <input name="display_name" value="${escapeHtml(user.display_name)}" placeholder="姓名" required>
          <select name="role" ${user.id === state.user?.id ? "disabled" : ""}>
            <option value="user" ${user.role === "user" ? "selected" : ""}>普通用户</option>
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>管理员</option>
          </select>
        </form>
      </td>
      <td><select form="userEdit${user.id}" name="user_type">${renderUserTypeOptions(user.user_type || "internal")}</select></td>
      <td><input form="userEdit${user.id}" class="user-password-input" name="password" placeholder="不修改则留空"></td>
      <td>
        <button form="userEdit${user.id}" type="submit">保存</button>
        ${user.id !== state.user?.id ? `<button class="danger user-delete-btn" data-user-id="${user.id}" data-user-name="${escapeHtml(user.display_name)}">删除</button>` : `<span class="pill">当前账号</span>`}
      </td>
    </tr>`).join("")}</tbody></table>`;
}

function renderUserTypePermissions() {
  const target = $("#userTypePermissionList");
  if (!target) return;
  if (!state.userTypes.length || !state.moduleCatalog.length) {
    target.innerHTML = "<p>暂无用户类型配置</p>";
    return;
  }
  target.innerHTML = state.userTypes.map((type) => {
    const selected = new Set(type.modules || []);
    return `
      <form class="permission-card user-type-permission-form" data-type-key="${escapeHtml(type.key)}">
        <div>
          <strong>${escapeHtml(type.name)}</strong>
          <p>${escapeHtml(type.description || "")}</p>
        </div>
        <div class="permission-grid">
          ${state.moduleCatalog.map((module) => `
            <label class="permission-check">
              <input type="checkbox" name="modules" value="${escapeHtml(module.key)}" ${selected.has(module.key) ? "checked" : ""}>
              <span>${escapeHtml(module.name)}</span>
              <small>${escapeHtml(module.description || "")}</small>
            </label>
          `).join("")}
        </div>
        <button type="submit">保存 ${escapeHtml(type.name)} 权限</button>
      </form>
    `;
  }).join("");
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
  applyBranding();
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

function scoreRuleLabel(rule) {
  if (!rule) return "未关联规则";
  const sameKindRules = state.rules.filter((item) => item.kind === rule.kind);
  const index = sameKindRules.findIndex((item) => Number(item.id) === Number(rule.id)) + 1;
  return `${rule.kind === "red" ? "红榜" : "黑榜"} #${index || "-"} · ${rule.content}`;
}

function renderSelectedScoreRule() {
  const form = $("#scoreForm");
  const target = $("#selectedScoreRule");
  if (!form || !target) return;
  const ruleId = form.elements.rule_id?.value;
  const rule = state.rules.find((item) => Number(item.id) === Number(ruleId));
  target.innerHTML = rule
    ? `<strong>${escapeHtml(scoreRuleLabel(rule))}</strong><button class="secondary clear-score-rule-btn" type="button">清除</button>`
    : `<span>从下方红黑榜细则中勾选规则</span>`;
  $$(".rule-pick-btn").forEach((button) => {
    button.classList.toggle("selected", Number(button.dataset.ruleId) === Number(ruleId));
  });
}

function selectScoreRule(ruleId) {
  const form = $("#scoreForm");
  const rule = state.rules.find((item) => Number(item.id) === Number(ruleId));
  if (!form || !rule) return;
  form.elements.rule_id.value = rule.id;
  form.elements.kind.value = rule.kind;
  if (!form.elements.points.value) {
    form.elements.points.value = settingValue(rule.kind === "red" ? "red_score_default_points" : "black_score_default_points", "1");
  }
  renderSelectedScoreRule();
}

function renderRuleSelectOptions(selectedId = "") {
  return `<option value="">不关联规则</option>${state.rules.map((rule) => {
    const label = scoreRuleLabel(rule);
    return `<option value="${rule.id}" ${Number(selectedId) === Number(rule.id) ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("")}`;
}

function renderScoreList(scores) {
  const list = $("#scoreList");
  if (!list) return;
  if (!scores.length) {
    list.innerHTML = "<p>暂无积分记录</p>";
    return;
  }
  list.innerHTML = `
    <table>
      <thead><tr><th>日期</th><th>成员</th><th>类型</th><th>积分</th><th>规则</th><th>依据</th><th>操作</th></tr></thead>
      <tbody>
        ${scores.map((score) => {
          const editable = isAdminView() && score.score_date === iso(new Date());
          if (!editable) {
            return `<tr>
              <td>${escapeHtml(score.score_date)}</td>
              <td>${escapeHtml(score.display_name)}</td>
              <td>${score.kind === "red" ? "红榜" : "黑榜"}</td>
              <td>${escapeHtml(score.points)}</td>
              <td>${escapeHtml(score.rule_title || "-")}</td>
              <td>${escapeHtml(score.reason)}</td>
              <td><span class="pill">只读</span></td>
            </tr>`;
          }
          return `<tr>
            <td><input form="scoreEdit${score.id}" name="score_date" type="date" value="${escapeHtml(score.score_date)}"></td>
            <td><select form="scoreEdit${score.id}" name="user_id">${renderUserOptions(score.user_id, "成员")}</select></td>
            <td><select form="scoreEdit${score.id}" name="kind"><option value="red" ${score.kind === "red" ? "selected" : ""}>红榜</option><option value="black" ${score.kind === "black" ? "selected" : ""}>黑榜</option></select></td>
            <td><input form="scoreEdit${score.id}" name="points" type="number" min="1" value="${Math.abs(Number(score.points || 0))}"></td>
            <td><select form="scoreEdit${score.id}" name="rule_id">${renderRuleSelectOptions(score.rule_id)}</select></td>
            <td><input form="scoreEdit${score.id}" name="reason" value="${escapeHtml(score.reason || "")}"></td>
            <td>
              <form id="scoreEdit${score.id}" class="score-edit-form" data-score-id="${score.id}">
                <button type="submit">保存</button>
              </form>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

function scoreYearValue() {
  const input = $("#scoreYear");
  const fallback = new Date().getFullYear();
  const value = Number(input?.value || fallback);
  const year = Number.isFinite(value) && value >= 2000 && value <= 2100 ? value : fallback;
  if (input) input.value = String(year);
  return year;
}

function scoreClass(value) {
  const number = Number(value || 0);
  if (number > 0) return "positive";
  if (number < 0) return "negative";
  return "zero";
}

function renderAnnualScoreTable(rows = [], year = new Date().getFullYear()) {
  const target = $("#annualScoreTable");
  if (!target) return;
  const months = Array.from({ length: 12 }, (_, index) => index + 1);
  if (!rows.length) {
    target.innerHTML = `<p class="empty-note">${year} 年暂无积分数据。</p>`;
    return;
  }
  target.innerHTML = `
    <table class="annual-score-table">
      <thead>
        <tr>
          <th class="member-col">成员</th>
          ${months.map((month) => `<th>${month}月</th>`).join("")}
          <th class="total-col">年度累计</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => {
          const monthsData = row.months || {};
          return `<tr>
            <th class="member-col">${escapeHtml(row.display_name || "未命名")}</th>
            ${months.map((month) => {
              const value = monthsData[String(month)] || {};
              const red = Number(value.red || 0);
              const black = Number(value.black || 0);
              return `<td><div class="score-split-cell"><span class="score-red">红 ${red}</span><span class="score-black">黑 ${black}</span></div></td>`;
            }).join("")}
            <td class="total-col"><div class="score-split-cell"><span class="score-red">红 ${Number(row.total_red || 0)}</span><span class="score-black">黑 ${Number(row.total_black || 0)}</span></div></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

async function loadRulesAndScores() {
  state.rules = (await api("/api/rules")).rules;
  const year = scoreYearValue();
  const [scoresData, annualData] = await Promise.all([
    api(`/api/scores?${periodQuery()}`),
    api(`/api/dashboards/red-black?from=${year}-01-01&to=${year}-12-31`),
  ]);
  const scores = scoresData.scores || [];
  const renderRuleColumn = (kind, title) => {
    const rules = state.rules.filter((rule) => rule.kind === kind);
    return `<section class="rule-column ${kind}">
      <div class="rule-column-head">
        <span class="pill ${kind}">${title}</span>
        <small>${rules.length} 条</small>
      </div>
      <div class="item-list">
        ${rules.length ? rules.map((rule, index) => `
          <button class="item rule-pick-btn" type="button" data-rule-id="${rule.id}" data-rule-kind="${rule.kind}" data-rule-index="${index + 1}">
            <span class="rule-number">${index + 1}</span>
            <p>${escapeHtml(rule.content)}</p>
          </button>`).join("") : "<p>暂无规则</p>"}
      </div>
    </section>`;
  };
  $("#ruleList").innerHTML = renderRuleColumn("red", "红榜") + renderRuleColumn("black", "黑榜");
  renderAnnualScoreTable(annualData.annual || [], year);
  renderScoreList(scores);
  populateSelects();
  renderSelectedScoreRule();
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

function renderMeetingMinuteSummary(item) {
  const [statusLabel, statusClass] = meetingItemStatusMeta[item.status] || meetingItemStatusMeta.todo;
  const hasMinuteContent = Boolean(item.minutes || item.open_issues || item.next_steps);
  return `
    <div class="minute-summary ${hasMinuteContent ? "" : "is-empty"}">
      <div class="minute-summary-head">
        <span class="morning-badge ${statusClass}">${escapeHtml(statusLabel)}</span>
        <span>${hasMinuteContent ? "已记录纪要" : "待记录纪要"}</span>
      </div>
      ${item.minutes ? `<p><strong>纪要：</strong>${escapeHtml(item.minutes)}</p>` : `<p>暂无纪要，点击按钮记录本议题讨论结论。</p>`}
      ${item.open_issues ? `<p><strong>遗留：</strong>${escapeHtml(item.open_issues)}</p>` : ""}
      ${item.next_steps ? `<p><strong>下一步：</strong>${escapeHtml(item.next_steps)}</p>` : ""}
    </div>`;
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
      ${renderMeetingMinuteSummary(item)}
      <button class="secondary meeting-minute-btn" type="button" data-item-id="${item.id}">${item.minutes || item.open_issues || item.next_steps ? "编辑纪要" : "记录纪要"}</button>`}
  </div>`;
}

function findMeetingItemContext(itemId) {
  for (const meeting of state.meetings) {
    const item = (meeting.items || []).find((entry) => Number(entry.id) === Number(itemId));
    if (item) return { meeting, item };
  }
  return { meeting: null, item: null };
}

function closeMeetingMinuteModal() {
  const modal = $("#meetingMinuteModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function openMeetingMinuteModal(itemId) {
  const { meeting, item } = findMeetingItemContext(itemId);
  const modal = $("#meetingMinuteModal");
  const form = $("#meetingMinuteForm");
  if (!meeting || !item || !modal || !form) return;
  form.dataset.itemId = item.id;
  form.dataset.meetingId = meeting.id;
  form.reset();
  form.elements.owner_id.innerHTML = renderUserOptions(item.owner_id);
  form.elements.owner_id.value = item.owner_id ? String(item.owner_id) : "";
  form.elements.status.innerHTML = renderMeetingItemStatusOptions(item.status || "todo");
  form.elements.status.value = item.status || "todo";
  form.elements.due_date.value = item.due_date || "";
  form.elements.minutes.value = item.minutes || "";
  form.elements.open_issues.value = item.open_issues || "";
  form.elements.next_steps.value = item.next_steps || "";
  $("#meetingMinuteTitle").textContent = item.minutes || item.open_issues || item.next_steps ? "编辑会议纪要" : "记录会议纪要";
  $("#meetingMinuteSubtitle").textContent = `${meeting.meeting_date} · ${meeting.title}`;
  $("#meetingMinuteContext").innerHTML = `
    <h3>${escapeHtml(item.title)}</h3>
    <p>${escapeHtml(item.detail || "暂无议题说明")}</p>
    <div class="chip-list">
      <span class="chip">${escapeHtml(item.type_name || item.section || "议题")}</span>
      ${item.owner_name ? `<span class="chip">责任人 ${escapeHtml(item.owner_name)}</span>` : ""}
      ${item.due_date ? `<span class="chip">截止 ${escapeHtml(shortDate(item.due_date))}</span>` : ""}
    </div>`;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  form.elements.minutes.focus();
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
  return `【会议纪要】${meeting.meeting_date} ${meeting.title}`;
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

function markdownMatrix(headers, rows) {
  return [
    `| ${headers.map((item) => tableCell(item)).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((item) => tableCell(item)).join(" | ")} |`),
  ].join("\r\n");
}

function meetingStatusLabel(status) {
  return meetingItemStatusMeta[status]?.[0] || "待处理";
}

function meetingMinuteRows(meeting, thankData = {}) {
  const rows = (meeting.items || []).filter((item) => !isThankYouTopic(item)).map((item, index) => {
    const topicName = item.type_name || item.section || "议题";
    return [
      index + 1,
      topicName,
      item.title,
      item.minutes || "待补充",
      item.open_issues || "无",
      item.next_steps || "无",
      item.owner_name || "未指定",
      item.due_date || "无",
      meetingStatusLabel(item.status),
    ];
  });
  const summary = thankYouSummary(thankData);
  rows.push([
    rows.length + 1,
    "Thank You",
    "本周 Thank You",
    summary.minutes,
    summary.stars,
    summary.details,
    "系统自动汇总",
    meeting.meeting_date,
    "已汇总",
  ]);
  return rows;
}

function hasMeetingMinuteValue(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && !["无", "暂无", "未指定", "待补充", "暂无明细"].includes(text);
}

function meetingTopicTableRows(row) {
  const isThankYouRow = row[1] === "Thank You";
  const rows = isThankYouRow
    ? [
        ["议题类型", row[1], true],
        ["议题/事项", row[2], true],
        ["纪要/结论", row[3]],
        ["本周之星", row[4]],
        ["感谢明细", row[5]],
        ["来源", row[6]],
        ["统计日期", row[7]],
        ["状态", row[8]],
      ]
    : [
        ["议题类型", row[1], true],
        ["议题/事项", row[2], true],
        ["纪要/结论", row[3]],
        ["遗留问题", row[4]],
        ["下一步行动", row[5]],
        ["责任人", row[6]],
        ["完成时间", row[7]],
        ["状态", row[8]],
      ];
  return rows.filter(([, value, required]) => required || hasMeetingMinuteValue(value)).map(([label, value]) => [label, value]);
}

function buildMeetingMinutesText(meeting, thankData = {}) {
  const attendance = groupAttendance(meeting);
  const rows = meetingMinuteRows(meeting, thankData);
  const pendingCount = meetingPendingCount(rows);
  const attendeeCount = meetingAttendanceCount(meeting);
  const lines = [
    meetingMinutesSubject(meeting),
    "",
    "战情概览",
    "",
    markdownTable([
      ["会议日期", meeting.meeting_date],
      ["与会人数", `${attendeeCount} 人`],
      ["待闭环", `${pendingCount} 项`],
      ["与会人", attendance.present],
      ["请假/缺席/迟到", attendance.exceptions],
      ["主持人", meeting.creator || "未记录"],
      ...(hasMeetingMinuteValue(meeting.summary) ? [["会议摘要", meeting.summary]] : []),
    ]),
    "",
    "一、按议题维度纪要与行动闭环",
    "",
  ];
  if (!rows.length) {
    lines.push("暂无议题。");
    return lines.join("\r\n");
  }
  rows.forEach((row) => {
    lines.push(`议题 ${row[0]}：${row[2]}`);
    lines.push("");
    lines.push(markdownTable(meetingTopicTableRows(row)));
    lines.push("");
  });
  lines.push("二、会后跟踪要求");
  lines.push("");
  lines.push("1. 请各责任人按完成时间推进闭环，逾期事项需在下次例会说明原因和调整计划。");
  lines.push("2. 遗留问题默认进入下次会议跟踪，已关闭事项需补充结论或证据。");
  lines.push("3. 本纪要以行动闭环为准，如内容有误请在当日内反馈修订。");
  return lines.join("\r\n");
}

function htmlCell(value, fallback = "无") {
  return escapeHtml(String(value || fallback).trim() || fallback).replace(/\r?\n/g, "<br>");
}

function htmlTable(rows) {
  return `<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:Arial,'Microsoft YaHei',sans-serif;font-size:14px;border-color:#d9dfe7;">
    <tbody>${rows.map(([label, value]) => `<tr><th style="width:130px;background:#f6f8fa;text-align:left;color:#172033;">${htmlCell(label)}</th><td>${htmlCell(value)}</td></tr>`).join("")}</tbody>
  </table>`;
}

function htmlMatrixTable(headers, rows) {
  return `<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:Arial,'Microsoft YaHei',sans-serif;font-size:13px;border-color:#d9dfe7;">
    <thead><tr>${headers.map((item) => `<th style="background:#eef3f8;color:#172033;text-align:left;">${htmlCell(item)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((item, index) => `<td style="${index === 0 ? "text-align:center;" : ""}vertical-align:top;">${htmlCell(item)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;
}

function meetingAttendanceCount(meeting) {
  const present = (meeting.attendance || []).filter((item) => item.status === "present").length;
  if (present) return present;
  const names = groupAttendance(meeting).present;
  return names && names !== "暂无签到记录" ? names.split("、").filter(Boolean).length : 0;
}

function meetingPendingCount(rows) {
  return rows.filter((row) => !["已完成", "已汇总"].includes(row[8])).length;
}

function htmlTopicTable(rows) {
  return `<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:Arial,'Microsoft YaHei',sans-serif;font-size:14px;border-color:#d9dfe7;">
    <tbody>${rows.map(([label, value]) => {
      const warn = ["遗留问题", "风险"].includes(label);
      return `<tr>
        <th style="width:130px;background:${warn ? "#fff7f7" : "#eef3f8"};text-align:left;color:#172033;">${htmlCell(label)}</th>
        <td style="background:${warn ? "#fff7f7" : "#fff"};vertical-align:top;">${htmlCell(value)}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;
}

function htmlTopicSections(rows) {
  return rows.map((row) => `
    <section style="margin:14px 0 16px;padding:14px;border:1px solid #d9dfe7;background:#fff;">
      <h3 style="margin:0 0 10px;font-size:15px;color:#172033;">
        <span style="display:inline-block;min-width:26px;height:26px;line-height:26px;text-align:center;border-radius:999px;background:#c7000b;color:#fff;margin-right:8px;font-weight:700;">${htmlCell(row[0])}</span>
        ${htmlCell(row[2])}
        <span style="display:inline-block;border:1px solid #d9dfe7;border-radius:999px;padding:2px 8px;margin-left:6px;font-size:12px;font-weight:400;background:#fff;">${htmlCell(row[1])}</span>
        ${hasMeetingMinuteValue(row[8]) ? `<span style="display:inline-block;border:1px solid #d9dfe7;border-radius:999px;padding:2px 8px;margin-left:4px;font-size:12px;font-weight:400;background:#fff;">${htmlCell(row[8])}</span>` : ""}
      </h3>
      ${htmlTopicTable(meetingTopicTableRows(row))}
    </section>
  `).join("");
}

function buildMeetingMinutesHtml(meeting, thankData = {}) {
  const attendance = groupAttendance(meeting);
  const rows = meetingMinuteRows(meeting, thankData);
  const pendingCount = meetingPendingCount(rows);
  const attendeeCount = meetingAttendanceCount(meeting);
  return `<article style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#172033;line-height:1.6;">
    <h1 style="margin:0 0 18px;font-size:22px;background:#fff7f7;border-top:4px solid #c7000b;padding:16px;">${htmlCell(meetingMinutesSubject(meeting))}</h1>
    ${hasMeetingMinuteValue(attendance.present) ? `<p style="margin:0 0 12px;color:#445066;">与会人：${htmlCell(attendance.present)}</p>` : ""}
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:12px 0 18px;">
      <div style="border:1px solid #d9dfe7;background:#f8fafc;padding:14px;">
        <span style="display:block;color:#6b7280;font-size:12px;">会议日期</span>
        <strong style="display:block;margin-top:4px;color:#c7000b;font-size:23px;">${htmlCell(shortDate(meeting.meeting_date))}</strong>
      </div>
      <div style="border:1px solid #d9dfe7;background:#f8fafc;padding:14px;">
        <span style="display:block;color:#6b7280;font-size:12px;">与会人</span>
        <strong style="display:block;margin-top:4px;color:#c7000b;font-size:23px;">${attendeeCount} 人</strong>
      </div>
      <div style="border:1px solid #d9dfe7;background:#f8fafc;padding:14px;">
        <span style="display:block;color:#6b7280;font-size:12px;">待闭环</span>
        <strong style="display:block;margin-top:4px;color:#c7000b;font-size:23px;">${pendingCount} 项</strong>
      </div>
    </div>
    ${attendance.exceptions !== "无" || hasMeetingMinuteValue(meeting.summary) ? `
      <div style="border:1px solid #d9dfe7;background:#fff;padding:12px;margin:0 0 16px;">
        ${attendance.exceptions !== "无" ? `<p style="margin:0 0 6px;"><strong>请假/缺席/迟到：</strong>${htmlCell(attendance.exceptions)}</p>` : ""}
        ${hasMeetingMinuteValue(meeting.summary) ? `<p style="margin:0;"><strong>会议摘要：</strong>${htmlCell(meeting.summary)}</p>` : ""}
      </div>
    ` : ""}
    <h2 style="margin:18px 0 8px;font-size:17px;">一、按议题维度纪要与行动闭环</h2>
    ${rows.length ? htmlTopicSections(rows) : "<p>暂无议题。</p>"}
    <h2 style="margin:18px 0 8px;font-size:17px;">二、会后跟踪要求</h2>
    <ol style="margin-top:8px;padding-left:22px;">
      <li>请各责任人按完成时间推进闭环，逾期事项需在下次例会说明原因和调整计划。</li>
      <li>遗留问题默认进入下次会议跟踪，已关闭事项需补充结论或证据。</li>
      <li>本纪要以行动闭环为准，如内容有误请在当日内反馈修订。</li>
    </ol>
  </article>`;
}

function errorReason(error) {
  const name = error?.name ? `${error.name}` : "";
  const message = error?.message ? `${error.message}` : "";
  return [name, message].filter(Boolean).join("：") || "未知错误";
}

function copySelection(html, text, asHtml = true) {
  const element = document.createElement(asHtml ? "div" : "textarea");
  element.style.position = "fixed";
  element.style.left = "-9999px";
  element.style.top = "0";
  if (asHtml) {
    element.contentEditable = "true";
    element.innerHTML = html;
  } else {
    element.value = text;
  }
  document.body.appendChild(element);
  const selection = window.getSelection();
  try {
    if (asHtml) {
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      element.focus();
      element.select();
    }
    if (!document.execCommand("copy")) {
      throw new Error("浏览器返回复制失败");
    }
    return { ok: true, method: asHtml ? "html-fallback" : "text-fallback" };
  } catch (error) {
    return { ok: false, reason: errorReason(error) };
  } finally {
    selection?.removeAllRanges();
    element.remove();
  }
}

async function copyMeetingMinutes(html, text) {
  const failures = [];
  if (navigator.clipboard) {
    try {
      if (window.ClipboardItem && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        })]);
        return { ok: true, method: "html" };
      }
      await navigator.clipboard.writeText(text);
      return { ok: true, method: "text" };
    } catch (error) {
      failures.push(`剪贴板 API 失败：${errorReason(error)}`);
    }
  } else {
    failures.push("当前浏览器不支持 navigator.clipboard");
  }
  const htmlFallback = copySelection(html, text, true);
  if (htmlFallback.ok) return htmlFallback;
  failures.push(`兼容 HTML 复制失败：${htmlFallback.reason}`);
  const textFallback = copySelection("", text, false);
  if (textFallback.ok) return textFallback;
  failures.push(`兼容纯文本复制失败：${textFallback.reason}`);
  return { ok: false, reason: failures.join("；") };
}

function openMailDraft(subject) {
  const params = new URLSearchParams({ subject });
  const mailto = `mailto:?${params.toString()}`;
  try {
    window.location.href = mailto;
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: errorReason(error) };
  }
}

async function openMeetingEmail(meetingId) {
  const meeting = state.meetings.find((item) => Number(item.id) === Number(meetingId));
  if (!meeting) throw new Error("生成会议邮件失败：请先选择会议");
  const weekStart = mondayOf(meeting.meeting_date);
  let thankVotes;
  let thankDashboard;
  try {
    [thankVotes, thankDashboard] = await Promise.all([
      api(`/api/thank-you?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekStart)}`),
      api(`/api/dashboards/thank-you?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekStart)}`),
    ]);
  } catch (error) {
    throw new Error(`生成会议邮件失败：读取 Thank You 数据失败，${errorReason(error)}`);
  }
  const thankData = { votes: thankVotes.votes, stars: thankDashboard.stars };
  const text = buildMeetingMinutesText(meeting, thankData);
  const html = buildMeetingMinutesHtml(meeting, thankData);
  const copyResult = await copyMeetingMinutes(html, text);
  const mailResult = openMailDraft(meetingMinutesSubject(meeting));
  if (!mailResult.ok) {
    throw new Error(`生成会议邮件失败：无法唤起邮件客户端，${mailResult.reason}。请确认 Windows 默认邮件应用已设置为 Outlook。`);
  }
  if (!copyResult.ok) {
    toast(`已尝试打开邮件草稿，但纪要复制失败。原因：${copyResult.reason}`);
    return;
  }
  const copyHint = copyResult.method === "text" || copyResult.method === "text-fallback" ? "已复制纯文本纪要" : "已复制会议纪要模板";
  const pasteHint = copyResult.method === "text" || copyResult.method === "text-fallback" ? "HTML 模板复制未生效，请在 Outlook 正文中粘贴纯文本纪要" : "请在 Outlook 正文中粘贴模板";
  toast(`已生成会议邮件，${copyHint}，${pasteHint}`);
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

function meetingListRange() {
  const today = iso(new Date());
  if (state.meetingListScope === "month") {
    const monthFrom = iso(monthStart(state.meetingMonth));
    const monthTo = iso(monthEnd(state.meetingMonth));
    return {
      from: monthFrom > today ? monthFrom : today,
      to: monthTo,
      label: "本月",
    };
  }
  const weekFrom = mondayOf(today);
  const weekTo = iso(addDays(`${weekFrom}T00:00:00`, 6));
  return {
    from: today > weekFrom ? today : weekFrom,
    to: weekTo,
    label: "本周",
  };
}

function upcomingMeetings(meetings = state.meetings) {
  const range = meetingListRange();
  return meetings
    .filter((meeting) => meeting.meeting_date >= range.from && meeting.meeting_date <= range.to)
    .sort((a, b) => String(a.meeting_date).localeCompare(String(b.meeting_date)) || Number(a.id) - Number(b.id));
}

function renderMeetingList(meetings) {
  const list = $("#meetingList");
  if (!list) return;
  const range = meetingListRange();
  const visibleMeetings = upcomingMeetings(meetings);
  const title = $("#meetingListTitle");
  const hint = $("#meetingListHint");
  if (title) title.textContent = `${range.label}会议`;
  if (hint) hint.textContent = `${shortDate(range.from)} 至 ${shortDate(range.to)}，只显示未过期会议。`;
  $$("[data-meeting-list-scope]").forEach((button) => {
    button.classList.toggle("active", button.dataset.meetingListScope === state.meetingListScope);
  });
  list.innerHTML = visibleMeetings.length ? visibleMeetings.map((meeting) => `
    <button type="button" class="meeting-list-item meeting-select-btn ${Number(meeting.id) === Number(state.selectedMeetingId) ? "active" : ""}" data-meeting-id="${meeting.id}">
      <span>${escapeHtml(shortDate(meeting.meeting_date))}</span>
      <strong>${escapeHtml(meeting.title)}</strong>
      <small>${meetingTopicTypes(meeting).length} 个主题 · ${meeting.items.length} 个议题 · ${(meeting.attendance || []).length} 条签到</small>
    </button>`).join("") : `<p>${range.label}暂无后续会议。</p>`;
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
  const visibleMeetings = upcomingMeetings(state.meetings);
  const selectedStillVisible = visibleMeetings.some((meeting) => Number(meeting.id) === Number(state.selectedMeetingId));
  if (!selectedStillVisible) {
    const sameDate = visibleMeetings.find((meeting) => meeting.meeting_date === state.selectedMeetingDate);
    state.selectedMeetingId = sameDate?.id || visibleMeetings[0]?.id || null;
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

function setMeetingListScope(scope) {
  if (!["week", "month"].includes(scope)) return;
  state.meetingListScope = scope;
  const visibleMeetings = upcomingMeetings(state.meetings);
  const selectedVisible = visibleMeetings.some((meeting) => Number(meeting.id) === Number(state.selectedMeetingId));
  if (!selectedVisible) {
    state.selectedMeetingId = visibleMeetings[0]?.id || null;
    if (visibleMeetings[0]) state.selectedMeetingDate = visibleMeetings[0].meeting_date;
  }
  const selectedMeeting = state.meetings.find((meeting) => Number(meeting.id) === Number(state.selectedMeetingId));
  renderMeetingCalendar(state.meetings);
  renderMeetingList(state.meetings);
  renderMeetingDetail(selectedMeeting || null);
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

function linkTagTone(value, index = 0) {
  const text = String(value || "");
  let hash = index + 1;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)) % 997;
  return `tone-${(hash % 6) + 1}`;
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
  const canManage = canManageLinks();
  const manageHeader = canManage ? "<th>操作</th>" : "";
  $("#linkList").innerHTML = filtered.length ? `
    <table class="link-list-table ${canManage ? "has-manage" : ""}">
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
                <span class="tag link-tag ${linkTagTone(link.category, 0)}">${escapeHtml(link.category || "通用")}</span>
                ${Number(link.pinned) === 1 ? '<span class="pill link-pinned-pill">置顶</span>' : ""}
                ${Number(link.invalid) === 1 ? '<span class="pill warn">失效</span>' : ""}
              </div>
            </td>
            <td>
              <div class="link-scope-tags" title="${escapeHtml(scopeText)}">
                ${scope.length ? scope.map((item, index) => `<span class="tag link-tag ${linkTagTone(item, index)}">${escapeHtml(item)}</span>`).join("") : '<span class="link-empty">-</span>'}
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
            ${canManage ? `
              <td>
                <div class="link-row-actions">
                  <button class="secondary link-edit-btn" type="button" data-link-id="${link.id}">编辑</button>
                  <button class="danger link-delete-btn" type="button" data-link-id="${link.id}">删除</button>
                </div>
                ${isAdminView() ? `<form class="link-quality-form" data-link-id="${link.id}">
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
                </form>` : ""}
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

function renderMachineList() {
  const target = $("#machineList");
  if (!target) return;
  target.innerHTML = state.machines.length
    ? state.machines.map((machine) => {
      const shiftCount = state.shifts.filter((shift) => Number(shift.machine_id) === Number(machine.id)).length;
      return `<div class="machine-item">
        <div>
          <strong>${escapeHtml(machine.name)}</strong>
          <span>${machine.description ? escapeHtml(machine.description) : "暂无说明"}</span>
        </div>
        <small>${shiftCount} 条本月排班</small>
        <button class="danger machine-delete-btn" type="button" data-machine-id="${machine.id}" data-machine-name="${escapeHtml(machine.name)}">删除</button>
      </div>`;
    }).join("")
    : `<p class="empty-note">暂无机台，先新增一个机台用于排班。</p>`;
}

function shiftTypeLabel(shift) {
  return shift.shift_type === "night" ? "夜班" : "白班";
}

function renderShiftDayPopover(date, shifts) {
  if (!shifts.length) return "";
  const sorted = [...shifts].sort((a, b) => {
    const typeOrder = (a.shift_type === "night" ? 1 : 0) - (b.shift_type === "night" ? 1 : 0);
    if (typeOrder) return typeOrder;
    return String(a.machine_name || "").localeCompare(String(b.machine_name || ""), "zh-CN");
  });
  return `<div class="shift-day-popover" role="tooltip">
    <div class="shift-popover-head">
      <strong>${escapeHtml(shortDate(date))} 排班详情</strong>
      <span>${sorted.length} 条</span>
    </div>
    <div class="shift-popover-list">
      ${sorted.map((shift) => `
        <div class="shift-popover-row ${shift.shift_type === "night" ? "night" : "day"}">
          <span class="shift-popover-type">${escapeHtml(shiftTypeLabel(shift))}</span>
          <div>
            <strong>${escapeHtml(shift.machine_name || "未填写机台")}</strong>
            <span>支撑人员：${escapeHtml(shift.display_name || "未指定")}</span>
            <small>${Number(shift.hours || 0) ? `${Number(shift.hours)} 小时` : "未填写工时"}${shift.note ? ` · ${escapeHtml(shift.note)}` : ""}</small>
          </div>
          ${isAdminView() ? `<button class="shift-delete-btn shift-popover-delete" type="button" data-shift-id="${shift.id}" title="删除这条排班">删除</button>` : ""}
        </div>`).join("")}
    </div>
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
    const hasShifts = shifts.length > 0;
    const popoverOpen = hasShifts && state.activeShiftPopoverDate === date;
    const detailLabel = hasShifts
      ? `${date}，${shifts.length} 条排班，点击查看机台和支撑人员`
      : `${date}，暂无排班`;
    cells.push(`<div class="day-cell shift-day ${d.getMonth() !== month.getMonth() ? "other" : ""} ${date === state.selectedShiftDate ? "selected" : ""} ${hasMine ? "has-mine" : ""} ${hasShifts ? "has-shifts" : ""} ${popoverOpen ? "popover-open" : ""}" data-date="${date}" tabindex="0" aria-label="${escapeHtml(detailLabel)}">
      <div class="day-no">${d.getDate()}</div>
      ${shifts.map(renderShiftLine).join("")}
      ${renderShiftDayPopover(date, shifts)}
    </div>`);
  }
  $("#shiftCalendar").innerHTML = weekdays + cells.join("");
  renderMachineList();
}

function selectShiftDay(cell) {
  if (!cell) return;
  const date = cell.dataset.date;
  state.selectedShiftDate = date;
  state.activeShiftPopoverDate = cell.classList.contains("has-shifts") ? date : null;
  renderCalendar();
}

function closeShiftPopover() {
  state.activeShiftPopoverDate = null;
  $$(".shift-day.popover-open").forEach((cell) => cell.classList.remove("popover-open"));
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

function renderThankPeriodControls() {
  const target = $("#thankPeriodControls");
  if (!target) return;
  const months = Array.from({ length: 12 }, (_, index) => index + 1);
  const currentYear = new Date().getFullYear();
  const years = Array.from(new Set([
    state.thankYear,
    ...Array.from({ length: 7 }, (_, index) => currentYear - 5 + index),
  ])).sort((a, b) => b - a);
  const monthValue = state.thankScope === "year" ? "year" : String(state.thankMonth);
  target.innerHTML = `
    <label>年份
      <select id="thankYearSelect">
        ${years.map((year) => `<option value="${year}" ${year === state.thankYear ? "selected" : ""}>${year} 年</option>`).join("")}
      </select>
    </label>
    <label>月份
      <select id="thankMonthSelect">
        <option value="year" ${monthValue === "year" ? "selected" : ""}>全年</option>
        ${months.map((month) => `<option value="${month}" ${monthValue === String(month) ? "selected" : ""}>${month} 月</option>`).join("")}
      </select>
    </label>
  `;
  const label = $("#thankPeriodLabel");
  if (label) label.textContent = `${thankPeriodRange().label} Thank You 统计`;
}

async function loadThanks() {
  renderThankPeriodControls();
  const [votes, dashboard] = await Promise.all([
    api(`/api/thank-you?${thankPeriodQuery()}`),
    api(`/api/dashboards/thank-you?${thankPeriodQuery()}`),
  ]);
  $("#thankStars").innerHTML = renderThankRank(dashboard.stars || []);
  $("#thankList").innerHTML = votes.votes.length ? votes.votes.map((vote) => `
    <div class="item thank-item">
      <div class="thank-item-head">
        <h3>${escapeHtml(vote.voter_name)} → ${escapeHtml(vote.receiver_name)}</h3>
        ${canManageThankVote(vote) ? `
          <div class="thank-item-actions">
            <button class="secondary thank-edit-btn" type="button" data-vote-id="${vote.id}" data-evidence="${escapeHtml(vote.evidence || "")}">编辑</button>
            <button class="danger thank-delete-btn" type="button" data-vote-id="${vote.id}" data-vote-title="${escapeHtml(vote.voter_name)} → ${escapeHtml(vote.receiver_name)}">删除</button>
          </div>` : ""}
      </div>
      <p>${escapeHtml(vote.evidence)}</p>
      <p class="thank-date-line">周次 ${escapeHtml(shortDate(vote.week_start))} · 送出 ${escapeHtml(shortDateTime(vote.created_at))}</p>
    </div>`).join("") : "<p>暂无感谢记录</p>";
}

function canManageThankVote(vote) {
  if (!state.user) return false;
  if (isAdminView()) return true;
  return Number(vote.voter_id) === Number(state.user.id) && isTodayValue(vote.created_at);
}

function thankFormPayload(form) {
  const data = fullFormData(form);
  const receiverIds = new FormData(form).getAll("receiver_ids").filter(Boolean);
  if (!receiverIds.length) throw new Error("请选择至少 1 位感谢对象");
  return {
    receiver_ids: receiverIds,
    week_start: data.week_start,
    evidence: data.evidence,
  };
}

function updateThankRecipientPicker(picker) {
  if (!picker) return;
  const checked = $$('input[name="receiver_ids"]:checked', picker);
  const names = checked.map((input) => input.dataset.name || input.value);
  const label = $("[data-thank-selected-label]", picker);
  const count = $("[data-thank-selected-count]", picker);
  if (label) label.textContent = names.length ? names.join("、") : "选择感谢对象（可多选）";
  if (count) count.textContent = `${names.length} 人`;
}

function canLoadPageData(id) {
  if (id === "dashboard" || id === "meetings") return !isGuest() && canLoadModule(id);
  if (id === "users" || id === "system") return isAdminView();
  return canLoadModule(id);
}

async function refreshPageData(id = state.currentPage) {
  const requestId = ++activePageRefreshId;
  await loadReferenceData();
  if (requestId !== activePageRefreshId) return;
  if (!canLoadPageData(id)) return;
  const loaders = {
    members: loadMembers,
    dashboard: loadDashboard,
    morning: loadMorning,
    meetings: loadMeetings,
    shifts: loadShifts,
    rules: loadRulesAndScores,
    thanks: loadThanks,
    links: loadLinks,
    users: loadUsers,
    system: loadSystemAdmin,
  };
  const loader = loaders[id];
  if (loader) await loader();
  renderNav();
}

async function refreshAll() {
  await loadReferenceData();
  const loaders = [];
  if (canLoadModule("rules")) loaders.push(loadRulesAndScores);
  if (canLoadModule("members")) loaders.push(loadMembers);
  if (canLoadModule("morning")) loaders.push(loadMorning);
  if (canLoadModule("links")) loaders.push(loadLinks);
  if (canLoadModule("shifts")) loaders.push(loadShifts);
  if (canLoadModule("thanks")) loaders.push(loadThanks);
  if (!isGuest() && canLoadModule("dashboard")) loaders.push(loadDashboard);
  if (!isGuest() && canLoadModule("meetings")) loaders.push(loadMeetings);
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
      syncMorningChoiceGroups(form);
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
    state.user.username = data.username || state.user.username;
    state.user.display_name = data.display_name || state.user.display_name;
    if (data.role) state.user.role = data.role;
    if (data.user_type) state.user.user_type = data.user_type;
    applyAuthView();
  }
}

function renderReactionControls(targetType, targetId, reactions = []) {
  const renderCount = (item) => `${renderReactionMark(item.reaction)} <span>+${Number(item.count || 0)}</span>`;
  if (isGuest()) {
    if (!reactions.length) return "";
    return `<div class="chat-reactions readonly">
      ${reactions.map((item) => `<span class="chat-reaction-count">${renderCount(item)}</span>`).join("")}
    </div>`;
  }
  return `<div class="chat-reactions chat-reaction-wrap">
    <div class="chat-reaction-summary">
      ${reactions.length ? reactions.map((item) => `<button type="button" class="chat-reaction-chip ${item.mine ? "active" : ""}" data-reaction-target="${targetType}" data-reaction-id="${targetId}" data-reaction="${escapeHtml(item.reaction)}">${renderCount(item)}</button>`).join("") : ""}
      <button type="button" class="chat-reaction-picker-toggle" data-reaction-target="${targetType}" data-reaction-id="${targetId}">＋回应</button>
    </div>
  </div>`;
}

function renderTeamReactions(post) {
  return renderReactionControls("post", post.id, post.reactions || []);
}

function reactionAssetKey(reaction) {
  return Array.from(String(reaction || ""))
    .map((char) => char.codePointAt(0).toString(16).toLowerCase())
    .filter((code) => code !== "fe0f")
    .join("-");
}

function renderReactionMark(reaction) {
  const text = String(reaction || "");
  const asset = teamReactionEmojiAssets[reactionAssetKey(text)];
  if (!asset) return `<span class="chat-reaction-text">${escapeHtml(text)}</span>`;
  return `<img class="chat-reaction-emoji-img" src="${asset}" alt="${escapeHtml(text)}" loading="lazy" decoding="async">`;
}

function closeReactionPopover() {
  const popover = $("#teamReactionPopover");
  if (popover) {
    popover.classList.add("hidden");
    popover.style.left = "";
    popover.style.top = "";
  }
  activeReactionTarget = null;
}

async function sendTeamReaction(targetType, targetId, reaction) {
  if (!targetId || !reaction || !["post", "reply"].includes(targetType)) {
    throw new Error("回应发送失败：缺少对话或回应内容，请重新打开回应面板");
  }
  const resource = targetType === "reply" ? "team-replies" : "team-posts";
  const data = await api(`/api/${resource}/${targetId}/reactions`, {
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
    <div class="chat-reaction-picker-title">选择回应</div>
    <div class="chat-reaction-picker-section-title">快捷回应</div>
    <div class="chat-reaction-quick team-reaction-static-grid">
      ${teamReactionOptions.map((reaction) => `<button type="button" class="chat-reaction-option" data-reaction="${escapeHtml(reaction)}" aria-label="${escapeHtml(reaction)}" title="${escapeHtml(reaction)}">${renderReactionMark(reaction)}</button>`).join("")}
    </div>
    <div class="chat-reaction-picker-section-title">表情库</div>
    <div class="team-reaction-emoji-library">
      <emoji-picker class="team-reaction-emoji-picker" locale="zh" data-source="${teamReactionEmojiDataSource}"></emoji-picker>
    </div>`;
  popover.addEventListener("click", (event) => {
    const option = event.target.closest(".chat-reaction-option");
    if (!option) return;
    event.preventDefault();
    event.stopPropagation();
    const targetType = popover.dataset.reactionTarget || activeReactionTarget?.type;
    const targetId = popover.dataset.reactionId || activeReactionTarget?.id;
    sendTeamReaction(targetType, targetId, option.dataset.reaction).catch((error) => toast(error.message));
  });
  const picker = $("emoji-picker", popover);
  if (picker) {
    picker.locale = "zh";
    picker.i18n = zhCnEmojiI18n;
    picker.dataSource = teamReactionEmojiDataSource;
    picker.addEventListener("emoji-click", (event) => {
      const reaction = event.detail?.unicode || event.detail?.emoji?.unicode || event.detail?.emoji?.emoji || "";
      if (!reaction) {
        toast("没有识别到表情，请重新选择");
        return;
      }
      const targetType = popover.dataset.reactionTarget || activeReactionTarget?.type;
      const targetId = popover.dataset.reactionId || activeReactionTarget?.id;
      sendTeamReaction(targetType, targetId, reaction).catch((error) => toast(error.message));
    });
  }
  document.body.appendChild(popover);
  return popover;
}

function openReactionPopover(button) {
  const popover = ensureReactionPopover();
  const nextTarget = {
    type: button.dataset.reactionTarget || "post",
    id: button.dataset.reactionId,
  };
  const isSameOpen = activeReactionTarget?.type === nextTarget.type
    && String(activeReactionTarget?.id) === String(nextTarget.id)
    && !popover.classList.contains("hidden");
  if (isSameOpen) {
    closeReactionPopover();
    return;
  }
  activeReactionTarget = nextTarget;
  popover.dataset.reactionTarget = nextTarget.type;
  popover.dataset.reactionId = nextTarget.id;
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

function renderTeamReplies(post, replies = post.replies || [], depth = 0) {
  if (!replies.length) return "";
  return `<div class="chat-replies">
    ${replies.map((reply) => `
      <div class="chat-reply" data-reply-id="${reply.id}" style="--reply-depth:${Math.min(depth, 4)}">
        <p>${escapeHtml(reply.content)}</p>
        <small>${escapeHtml(reply.display_name)} · ${escapeHtml(shortDateTime(reply.created_at || ""))}</small>
        ${renderReactionControls("reply", reply.id, reply.reactions || [])}
        ${isGuest() ? "" : `
          <div class="chat-reply-actions">
            <button type="button" class="chat-reply-toggle" data-post-id="${post.id}" data-parent-reply-id="${reply.id}">回复</button>
            ${(reply.mine || isAdminView()) ? `<button type="button" class="chat-reply-delete" data-reply-id="${reply.id}">删除</button>` : ""}
          </div>
          <form class="chat-reply-form hidden" data-post-id="${post.id}">
            <input name="parent_reply_id" type="hidden" value="${reply.id}">
            <input name="content" placeholder="回复 ${escapeHtml(reply.display_name)}，最多 200 字" maxlength="200" required>
            <button>发送</button>
          </form>`}
        ${renderTeamReplies(post, reply.replies || [], depth + 1)}
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
            <input name="content" placeholder="回复这条对话，最多 200 字" maxlength="200" required>
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

function closePasswordModal() {
  const modal = $("#passwordModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function openPasswordModal() {
  if (isGuest()) return;
  const modal = $("#passwordModal");
  const form = $("#passwordForm");
  if (!modal || !form) return;
  form.reset();
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  form.elements.old_password?.focus();
}

function closeMemberEditModal() {
  const modal = $("#memberEditModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function closeLinkEditModal() {
  const modal = $("#linkEditModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function openLinkEditModal(linkId) {
  if (!canManageLinks()) return;
  const link = state.links.find((item) => Number(item.id) === Number(linkId));
  const modal = $("#linkEditModal");
  const form = $("#linkEditForm");
  if (!link || !modal || !form) return;
  populateSelects();
  form.dataset.linkId = link.id;
  form.elements.title.value = link.title || "";
  form.elements.url.value = link.url || "";
  form.elements.category.value = link.category || "";
  form.elements.description.value = link.description || "";
  form.elements.machine_scope.value = (link.machine_scope || []).join(", ");
  form.elements.process_tags.value = (link.process_tags || []).join(", ");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  form.elements.title.focus();
}

async function submitLinkEditForm(form) {
  if (!canManageLinks()) throw new Error("当前账号无权维护常用链接");
  const payload = prepareLinkPayload(fullFormData(form));
  const data = await api(`/api/links/${form.dataset.linkId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  state.links = data.links || state.links;
  renderLinks();
  closeLinkEditModal();
}

async function deleteLink(linkId) {
  if (!canManageLinks()) throw new Error("当前账号无权删除常用链接");
  const link = state.links.find((item) => Number(item.id) === Number(linkId));
  if (!window.confirm(`确定删除常用链接「${link?.title || ""}」吗？删除后不可恢复。`)) return;
  const data = await api(`/api/links/${linkId}`, { method: "DELETE" });
  state.links = data.links || state.links.filter((item) => Number(item.id) !== Number(linkId));
  renderLinks();
  toast(data.message || "链接已删除");
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

const memberClusterDefinitions = [
  { key: "coordination", label: "项目统筹", tone: "blue", keywords: ["管理", "统筹", "项目", "规则", "协调", "负责人"] },
  { key: "quality", label: "质量与复盘", tone: "red", keywords: ["质量", "复盘", "测试", "SOP", "标准"] },
  { key: "automation", label: "工具与自动化", tone: "purple", keywords: ["自动化", "工具", "脚本", "数据", "看板", "链接库"] },
  { key: "field", label: "现场与机台", tone: "green", keywords: ["现场", "机台", "TOPTB", "交接", "执行", "夜班"] },
  { key: "support", label: "协作支持", tone: "orange", keywords: ["支持", "协作", "新人", "轮岗", "学习"] },
];

function memberCluster(member) {
  const source = [member.title, ...(member.tags || []), ...(member.skills || [])].join(" ").toLowerCase();
  return memberClusterDefinitions.find((cluster) => cluster.keywords.some((keyword) => source.includes(keyword.toLowerCase())))
    || { key: "other", label: "其他成员", tone: "gray", keywords: [] };
}

function renderMemberCard(member, clusterIndex = 0, clusterSize = 1) {
  const canEdit = isAdminView() || member.user_id === state.user?.id;
  const skills = member.skills || [];
  const tags = member.tags || [];
  const responsibilities = filledText(member.responsibilities);
  const comment = filledText(member.comment);
  const account = filledText(member.account);
  return `
    <article class="member-card profile-only" data-member-id="${member.id}">
      <section class="member-profile">
        ${isAdminView() ? `
          <div class="member-order-actions" aria-label="调整成员顺序">
            <button class="member-order-btn" type="button" data-member-id="${member.id}" data-order-direction="up" title="向前移动" ${clusterIndex === 0 ? "disabled" : ""}>↑</button>
            <button class="member-order-btn" type="button" data-member-id="${member.id}" data-order-direction="down" title="向后移动" ${clusterIndex === clusterSize - 1 ? "disabled" : ""}>↓</button>
          </div>` : ""}
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

function renderMemberGroups() {
  const grouped = new Map();
  state.members.forEach((member) => {
    const cluster = memberCluster(member);
    if (!grouped.has(cluster.key)) grouped.set(cluster.key, { ...cluster, members: [] });
    grouped.get(cluster.key).members.push(member);
  });
  const orderedKeys = [...memberClusterDefinitions.map((item) => item.key), "other"];
  return orderedKeys
    .map((key) => grouped.get(key))
    .filter(Boolean)
    .map((cluster) => `
      <section class="member-cluster member-cluster-${cluster.tone}">
        <div class="member-cluster-head">
          <div><h2>${escapeHtml(cluster.label)}</h2><p>按成员标签与能力方向归类</p></div>
          <span>${cluster.members.length} 人</span>
        </div>
        <div class="member-layout">
          ${cluster.members.map((member, index) => renderMemberCard(member, index, cluster.members.length)).join("")}
        </div>
      </section>`)
    .join("");
}

async function moveMemberCard(memberId, direction) {
  const member = state.members.find((item) => Number(item.id) === Number(memberId));
  if (!member || !isAdminView()) return;
  const clusterKey = memberCluster(member).key;
  const clusterMembers = state.members.filter((item) => memberCluster(item).key === clusterKey);
  const index = clusterMembers.findIndex((item) => Number(item.id) === Number(memberId));
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapIndex < 0 || swapIndex >= clusterMembers.length) return;
  const firstIndex = state.members.findIndex((item) => Number(item.id) === Number(clusterMembers[index].id));
  const secondIndex = state.members.findIndex((item) => Number(item.id) === Number(clusterMembers[swapIndex].id));
  [state.members[firstIndex], state.members[secondIndex]] = [state.members[secondIndex], state.members[firstIndex]];
  $("#memberList").innerHTML = renderMemberGroups();
  try {
    const data = await api("/api/members/order", {
      method: "PATCH",
      body: JSON.stringify({ member_ids: state.members.map((item) => item.id) }),
    });
    state.members = data.members || state.members;
    $("#memberList").innerHTML = renderMemberGroups();
    toast("成员顺序已保存");
  } catch (error) {
    await loadMembers();
    throw error;
  }
}

async function loadMembers() {
  const [membersData, postsData] = await Promise.all([
    api("/api/members"),
    api("/api/team-posts"),
  ]);
  state.members = membersData.members;
  renderTeamChat(postsData.posts);
  $("#memberList").innerHTML = renderMemberGroups();
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
  state.meetingListScope = "month";
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

  $("#passwordBtn")?.addEventListener("click", openPasswordModal);

  $("#guestBrowseBtn")?.addEventListener("click", async () => {
    state.showLogin = false;
    applyAuthView();
    switchPage("members");
    await refreshAll();
  });

  $("#nav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (button) {
      switchPage(button.dataset.page);
      refreshPageData(state.currentPage).catch((error) => toast(error.message));
    }
  });

  $("#refreshBtn").addEventListener("click", refreshAll);
  $("#themeSelect").addEventListener("change", (event) => {
    setUiTheme(event.target.value);
    const label = event.target.selectedOptions?.[0]?.textContent || "新主题";
    toast(`已切换到 ${label}`);
  });
  $("#viewModeBtn").addEventListener("click", async () => {
    setViewMode(isAdminView() ? "user" : "admin");
    if (!canAccessPage(state.currentPage)) {
      switchPage(firstAccessiblePage());
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
  $("#scoreYear")?.addEventListener("change", () => {
    loadRulesAndScores().catch((error) => toast(error.message));
  });

  bindForm("#userForm", (data) => api("/api/users", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#ruleForm", (data) => api("/api/rules", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#scoreForm", (data) => api("/api/scores", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#meetingForm", (data) => api("/api/meetings", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#meetingGenerateForm", (data) => api("/api/meetings/bulk-generate", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#morningItemForm", (data) => {
    if (state.morningReadOnly) throw new Error("历史日期只读，不能新增");
    const payload = { ...data, item_date: state.morningDate };
    if (!isAdminView()) delete payload.owner_id;
    return api("/api/morning-items", { method: "POST", body: JSON.stringify(payload) });
  });
  bindForm("#personalMorningCreateForm", (data) => {
    const payload = {
      ...data,
      status: "doing",
      item_date: iso(new Date()),
    };
    return api("/api/morning-items", { method: "POST", body: JSON.stringify(payload) });
  });
  bindForm("#topicTypeForm", (data) => api("/api/meeting-topic-types", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#topicOptionForm", (data) => api("/api/meeting-topic-options", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#linkForm", (data) => api("/api/links", { method: "POST", body: JSON.stringify(prepareLinkPayload(data)) }));
  bindForm("#linkCategoryForm", (data) => api("/api/link-categories", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#machineForm", (data) => api("/api/machines", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#shiftForm", (data) => api("/api/shifts", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#thankForm", (_, form) => api("/api/thank-you", { method: "POST", body: JSON.stringify(thankFormPayload(form)) }));
  bindForm("#teamChatForm", (data) => api("/api/team-posts", { method: "POST", body: JSON.stringify(data) }));
  bindForm("#settingsForm", (data) => api("/api/settings", { method: "PATCH", body: JSON.stringify({ settings: data }) }));
  bindForm("#manualBackupForm", () => api("/api/backups", { method: "POST", body: "{}" }));

  $("#linkCategoryFilter").addEventListener("change", renderLinks);
  $("#linkStatusFilter").addEventListener("change", renderLinks);
  $("#linkKeywordSearch").addEventListener("input", renderLinks);
  $("#morningDate")?.addEventListener("change", async (event) => {
    state.morningDate = event.target.value || iso(new Date());
    await loadMorning().catch((error) => toast(error.message));
  });
  $("#morningOwnerFilter")?.addEventListener("change", renderMorningBoard);
  $("#morningStatusFilter")?.addEventListener("change", renderMorningBoard);
  $("#thankPeriodControls")?.addEventListener("change", (event) => {
    if (event.target.matches("#thankYearSelect")) {
      state.thankYear = Number(event.target.value) || state.thankYear;
      loadThanks().catch((error) => toast(error.message));
    }
    if (event.target.matches("#thankMonthSelect")) {
      if (event.target.value === "year") {
        state.thankScope = "year";
      } else {
        state.thankScope = "month";
        state.thankMonth = Number(event.target.value) || state.thankMonth;
      }
      loadThanks().catch((error) => toast(error.message));
    }
  });
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
    if (event.key === "Escape") {
      closePasswordModal();
      closeMemberEditModal();
      closeMorningHistoryModal();
      closeMeetingMinuteModal();
      closeLinkEditModal();
      closeShiftPopover();
      return;
    }
    const shiftDay = event.target.closest?.(".shift-day");
    if (shiftDay && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      selectShiftDay(shiftDay);
    }
    const personalDoneItem = event.target.closest?.("[data-personal-calendar-focus]");
    if (personalDoneItem && !event.target.closest("button, input, select, textarea, label, a") && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      focusPersonalMorningChain(personalDoneItem.dataset.personalCalendarFocus);
    }
  });

  document.body.addEventListener("click", (event) => {
    if (!event.target.closest("#shiftCalendar")) {
      closeShiftPopover();
    }
    const activeThankPicker = event.target.closest(".thank-recipient-picker");
    $$(".thank-recipient-picker[open]").forEach((picker) => {
      if (picker !== activeThankPicker) picker.removeAttribute("open");
    });
    const memberEditButton = event.target.closest(".member-edit-btn");
    if (memberEditButton) {
      openMemberEditModal(memberEditButton.dataset.memberId);
      return;
    }
    const memberOrderButton = event.target.closest(".member-order-btn");
    if (memberOrderButton && !memberOrderButton.disabled) {
      moveMemberCard(memberOrderButton.dataset.memberId, memberOrderButton.dataset.orderDirection)
        .catch((error) => toast(error.message));
      return;
    }
    if (event.target.closest("[data-member-modal-close]") || event.target === $("#memberEditModal")) {
      closeMemberEditModal();
      return;
    }
    if (event.target.closest("[data-password-modal-close]") || event.target === $("#passwordModal")) {
      closePasswordModal();
      return;
    }
    if (event.target.closest("[data-morning-history-close]") || event.target === $("#morningHistoryModal")) {
      closeMorningHistoryModal();
      return;
    }
    if (event.target.closest("[data-meeting-minute-close]") || event.target === $("#meetingMinuteModal")) {
      closeMeetingMinuteModal();
      return;
    }
    if (event.target.closest("[data-link-edit-close]") || event.target === $("#linkEditModal")) {
      closeLinkEditModal();
      return;
    }
    const linkEditButton = event.target.closest(".link-edit-btn");
    if (linkEditButton) {
      openLinkEditModal(linkEditButton.dataset.linkId);
      return;
    }
    const linkDeleteButton = event.target.closest(".link-delete-btn");
    if (linkDeleteButton) {
      deleteLink(linkDeleteButton.dataset.linkId).catch((error) => toast(error.message));
      return;
    }
    const meetingMinuteButton = event.target.closest(".meeting-minute-btn");
    if (meetingMinuteButton) {
      openMeetingMinuteModal(meetingMinuteButton.dataset.itemId);
      return;
    }
    const morningHistoryButton = event.target.closest(".morning-history-btn");
    if (morningHistoryButton) {
      openMorningHistory(morningHistoryButton.dataset.morningHistoryId).catch((error) => {
        closeMorningHistoryModal();
        toast(error.message);
      });
      return;
    }
    const morningHistoryRow = event.target.closest(".morning-list-item[data-morning-history-id]");
    if (morningHistoryRow && !event.target.closest("button, input, textarea, select, label, form")) {
      openMorningHistory(morningHistoryRow.dataset.morningHistoryId).catch((error) => {
        closeMorningHistoryModal();
        toast(error.message);
      });
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
      const targetType = chatReaction.dataset.reactionTarget || activeReactionTarget?.type;
      const targetId = chatReaction.dataset.reactionId || activeReactionTarget?.id;
      sendTeamReaction(targetType, targetId, chatReaction.dataset.reaction).catch((error) => toast(error.message));
      return;
    }
    if (event.target.closest("#teamReactionPopover")) {
      return;
    }
    if (!event.target.closest(".chat-reaction-wrap")) {
      closeReactionPopover();
    }
    const rulePick = event.target.closest(".rule-pick-btn");
    if (rulePick) {
      selectScoreRule(rulePick.dataset.ruleId);
      return;
    }
    const morningChoice = event.target.closest(".morning-choice-btn");
    if (morningChoice) {
      setMorningChoice(morningChoice);
      return;
    }
    const personalDoneFocus = event.target.closest("[data-personal-calendar-focus]");
    if (personalDoneFocus && !event.target.closest("button, input, select, textarea, label, a")) {
      focusPersonalMorningChain(personalDoneFocus.dataset.personalCalendarFocus);
      return;
    }
    const meetingListScope = event.target.closest("[data-meeting-list-scope]");
    if (meetingListScope) {
      setMeetingListScope(meetingListScope.dataset.meetingListScope);
      return;
    }
    if (event.target.closest(".clear-score-rule-btn")) {
      const form = $("#scoreForm");
      if (form) form.elements.rule_id.value = "";
      renderSelectedScoreRule();
      return;
    }
    const morningDelete = event.target.closest(".morning-delete-btn");
    if (morningDelete) {
      if (state.morningReadOnly) {
        toast("历史日期只读，不能删除");
        return;
      }
      if (!window.confirm("确定删除这条早例会事项吗？")) return;
      api(`/api/morning-items/${morningDelete.dataset.itemId}`, { method: "DELETE" })
        .then((data) => {
          state.morningItems = data.items || state.morningItems;
          state.morningUsers = data.users || state.morningUsers;
          renderMorning();
          toast("早例会事项已删除");
        })
        .catch((error) => toast(error.message));
      return;
    }
    const thankEdit = event.target.closest(".thank-edit-btn");
    if (thankEdit) {
      const evidence = window.prompt("修改感谢事实依据", thankEdit.dataset.evidence || "");
      if (evidence === null) return;
      api(`/api/thank-you/${thankEdit.dataset.voteId}`, { method: "PATCH", body: JSON.stringify({ evidence }) })
        .then(loadThanks)
        .then(() => toast("感谢记录已更新"))
        .catch((error) => toast(error.message));
      return;
    }
    const thankDelete = event.target.closest(".thank-delete-btn");
    if (thankDelete) {
      const title = thankDelete.dataset.voteTitle || "这条感谢记录";
      if (!window.confirm(`确定删除 ${title} 吗？`)) return;
      api(`/api/thank-you/${thankDelete.dataset.voteId}`, { method: "DELETE" })
        .then(loadThanks)
        .then(() => toast("感谢记录已删除"))
        .catch((error) => toast(error.message));
      return;
    }
    const chatReplyToggle = event.target.closest(".chat-reply-toggle");
    if (chatReplyToggle) {
      const container = chatReplyToggle.closest(".chat-reply") || chatReplyToggle.closest(".chat-bubble");
      const form = [...(container?.children || [])].find((child) => child.matches?.(".chat-reply-form"));
      form?.classList.toggle("hidden");
      form?.elements.content?.focus();
      return;
    }
    const chatReplyDelete = event.target.closest(".chat-reply-delete");
    if (chatReplyDelete) {
      if (!window.confirm("确定删除这条回复吗？其下的楼中回复也会一起删除。")) return;
      api(`/api/team-replies/${chatReplyDelete.dataset.replyId}`, { method: "DELETE" })
        .then((data) => renderTeamChat(data.posts, true))
        .then(() => toast("回复已删除"))
        .catch((error) => toast(error.message));
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
    const machineDelete = event.target.closest(".machine-delete-btn");
    if (machineDelete) {
      event.stopPropagation();
      const name = machineDelete.dataset.machineName || "该机台";
      if (!window.confirm(`确定删除「${name}」吗？该机台下的排班也会一起删除。`)) return;
      api(`/api/machines/${machineDelete.dataset.machineId}`, { method: "DELETE" })
        .then(refreshAll)
        .then(() => toast("机台已删除"))
        .catch((error) => toast(error.message));
      return;
    }
    const shiftDelete = event.target.closest(".shift-delete-btn");
    if (shiftDelete) {
      event.stopPropagation();
      closeShiftPopover();
      if (!window.confirm("确定删除这条排班吗？")) return;
      api(`/api/shifts/${shiftDelete.dataset.shiftId}`, { method: "DELETE" })
        .then(loadShifts)
        .then(() => toast("排班已删除"))
        .catch((error) => toast(error.message));
      return;
    }
    const shiftCell = event.target.closest(".shift-day");
    if (shiftCell) {
      selectShiftDay(shiftCell);
      return;
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
    if (event.target.matches('.thank-recipient-picker input[name="receiver_ids"]')) {
      updateThankRecipientPicker(event.target.closest(".thank-recipient-picker"));
      return;
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
    const linkEditForm = event.target.closest("#linkEditForm");
    const chatReplyForm = event.target.closest(".chat-reply-form");
    const morningItemForm = event.target.closest(".morning-item-form");
    const personalMorningForm = event.target.closest(".personal-morning-form");
    const permissionForm = event.target.closest(".user-type-permission-form");
    const passwordForm = event.target.closest("#passwordForm");
    const scoreEditForm = event.target.closest(".score-edit-form");
    if (!postForm && !avatarForm && !profileForm && !userEditForm && !topicForm && !meetingTopicScopeForm && !minuteForm && !presetForm && !linkQualityForm && !linkEditForm && !chatReplyForm && !morningItemForm && !personalMorningForm && !permissionForm && !passwordForm && !scoreEditForm) return;
    event.preventDefault();
    try {
      if (passwordForm) {
        const data = fullFormData(passwordForm);
        if ((data.new_password || "").length < 6) throw new Error("新密码至少 6 位");
        if (data.new_password !== data.confirm_password) throw new Error("两次输入的新密码不一致");
        await api("/api/me/password", { method: "PATCH", body: JSON.stringify(data) });
        closePasswordModal();
        passwordForm.reset();
        toast("密码已更新");
        return;
      }
      if (permissionForm) {
        const modules = new FormData(permissionForm).getAll("modules");
        const data = await api(`/api/user-types/${permissionForm.dataset.typeKey}/permissions`, {
          method: "PATCH",
          body: JSON.stringify({ modules }),
        });
        state.userTypes = data.types || state.userTypes;
        state.moduleCatalog = data.modules || state.moduleCatalog;
        if (data.permissions) state.permissions = data.permissions;
        renderUserTypePermissions();
        applyAuthView();
        toast("用户类型权限已保存");
        return;
      }
      if (linkEditForm) {
        await submitLinkEditForm(linkEditForm);
        toast("链接已更新");
        return;
      }
      if (scoreEditForm) {
        await api(`/api/scores/${scoreEditForm.dataset.scoreId}`, { method: "PATCH", body: JSON.stringify(fullFormData(scoreEditForm)) });
        await loadRulesAndScores();
        toast("积分明细已更新");
        return;
      }
      if (morningItemForm) {
        if (state.morningReadOnly) {
          toast("历史日期只读，不能修改");
          return;
        }
        const data = await api(`/api/morning-items/${morningItemForm.dataset.itemId}`, {
          method: "PATCH",
          body: JSON.stringify(fullFormData(morningItemForm)),
        });
        state.morningItems = data.items || state.morningItems;
        state.morningUsers = data.users || state.morningUsers;
        renderMorning();
        toast("早例会事项已保存");
        return;
      }
      if (personalMorningForm) {
        await api(`/api/morning-items/${personalMorningForm.dataset.itemId}`, {
          method: "PATCH",
          body: JSON.stringify(fullFormData(personalMorningForm)),
        });
        await loadDashboard();
        toast("事项进展已同步");
        return;
      }
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
        closeMeetingMinuteModal();
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
    state.publicSettings = data.settings || {};
    applyBranding();
    applyAuthView();
    switchPage("members");
    await refreshAll();
  } catch {
    state.user = null;
    state.permissions = {};
    state.publicSettings = {};
    applyBranding();
    state.showLogin = false;
    applyAuthView();
    await refreshAll();
  }
}

boot();
