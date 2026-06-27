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
  selectedShiftDate: new Date().toISOString().slice(0, 10),
  meetingMonth: new Date(),
  selectedMeetingDate: new Date().toISOString().slice(0, 10),
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
  return date.toISOString().slice(0, 10);
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
  const shiftDate = $('input[name="shift_date"]');
  if (shiftDate) shiftDate.value = state.selectedShiftDate;
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
  toolbar.classList.toggle("hidden", !dateFilterPages.has(id));
}

function applyAuthView() {
  $("#loginView").classList.toggle("hidden", Boolean(state.user));
  $("#appView").classList.toggle("hidden", !state.user);
  $("#currentUser").textContent = state.user ? `${state.user.display_name} · ${state.user.role === "admin" ? "管理员" : "普通用户"}` : "未登录";
  $$(".admin-only").forEach((el) => el.classList.toggle("hidden", !state.permissions.isAdmin));
  renderPageToolbar();
  renderNav();
}

function renderNav() {
  $("#nav").innerHTML = pages
    .filter(([id]) => !["users", "system"].includes(id) || state.permissions.isAdmin)
    .map(([id, icon, title]) => `<button class="nav-item ${state.currentPage === id ? "active" : ""}" data-page="${id}"><span>${icon}</span>${title}</button>`)
    .join("");
}

function switchPage(id) {
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
  if (state.permissions.isAdmin) {
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
  if (!state.permissions.isAdmin) return;
  const data = await api("/api/users");
  state.users = data.users;
  $("#userList").innerHTML = renderUserTable(data.users);
  populateSelects();
}

function renderUserTable(users) {
  if (!users.length) return "<p>暂无数据</p>";
  return `<table><thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>${users.map((user) => `
    <tr>
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.display_name)}</td>
      <td>${user.role === "admin" ? "管理员" : "普通用户"}</td>
      <td>${user.active ? "启用" : "已删除"}</td>
      <td>${user.active && user.id !== state.user?.id ? `<button class="danger user-delete-btn" data-user-id="${user.id}" data-user-name="${escapeHtml(user.display_name)}">删除</button>` : "-"}</td>
    </tr>`).join("")}</tbody></table>`;
}

async function loadSystemAdmin() {
  if (!state.permissions.isAdmin) return;
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
  $("#ruleList").innerHTML = state.rules.length ? state.rules.map((rule) => `
    <div class="item">
      <span class="pill ${rule.kind === "red" ? "red" : "black"}">${rule.kind === "red" ? "红榜" : "黑榜"}</span>
      <p>${escapeHtml(rule.content)}</p>
    </div>`).join("") : "<p>暂无规则</p>";
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

async function loadMembers() {
  state.members = (await api("/api/members")).members;
  $("#memberList").innerHTML = state.members.map((member) => {
    const posts = [...(member.posts || [])].reverse();
    const canEdit = state.permissions.isAdmin || member.user_id === state.user?.id;
    return `
      <article class="member-card">
        <section class="member-profile">
          <div class="member-head">
            ${member.avatar_url ? `<img class="avatar" src="${escapeHtml(member.avatar_url)}" alt="${escapeHtml(member.name)}">` : `<div class="avatar">${escapeHtml(member.name.slice(0, 1))}</div>`}
            <div><h3>${escapeHtml(member.name)}</h3><p>${escapeHtml(member.title || "")}</p></div>
          </div>
          <div class="tags">${(member.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
          <p><strong>职责：</strong>${escapeHtml(member.responsibilities || "未填写")}</p>
          <p>${escapeHtml(member.comment || "")}</p>
          ${canEdit ? `<form class="avatar-tools avatar-form" data-member-id="${member.id}"><input name="avatar_url" placeholder="头像 URL"><input name="avatar_file" type="file" accept="image/*"><button>更换头像</button></form>` : ""}
        </section>
        <section class="chat-panel">
          <div class="chat-title"><strong>成员对话</strong><span>评论 / 吐槽广场</span></div>
          <div class="chat-list" data-chat-list>
            ${posts.length ? posts.map((post) => `<div class="chat-bubble ${post.kind === "roast" ? "roast" : ""}"><span class="pill ${post.kind === "roast" ? "warn" : ""}">${post.kind === "roast" ? "吐槽" : "评论"}</span><p>${escapeHtml(post.content)}</p><small>${escapeHtml(post.display_name)} · ${post.created_at}</small></div>`).join("") : "<p>还没有对话，来开个头。</p>"}
          </div>
          <form class="chat-form post-form" data-member-id="${member.id}">
            <select name="kind"><option value="comment">评论</option><option value="roast">吐槽</option></select>
            <input name="content" placeholder="输入后发布，消息会出现在下方聊天流" required />
            <button>发送</button>
          </form>
        </section>
      </article>`;
  }).join("");
  $$("[data-chat-list]").forEach((el) => { el.scrollTop = el.scrollHeight; });
}

function recurrenceOptions(selected = 1) {
  return [1, 2, 3, 4].map((value) => `<option value="${value}" ${Number(selected) === value ? "selected" : ""}>每 ${value} 周</option>`).join("");
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
          <select name="recurrence_weeks">${recurrenceOptions(option.recurrence_weeks || 1)}</select>
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
    cells.push(`<div class="day-cell meeting-day ${d.getMonth() !== month.getMonth() ? "other" : ""} ${date === state.selectedMeetingDate ? "selected" : ""} ${dayMeetings.length ? "has-meeting" : ""}" data-date="${date}">
      <div class="day-no">${d.getDate()}</div>
      ${dayMeetings.map((meeting) => `<div class="meeting-line">${escapeHtml(meeting.title)} · ${meeting.items.length} 议题</div>`).join("")}
    </div>`);
  }
  $("#meetingCalendar").innerHTML = weekdays + cells.join("");
}

async function loadMeetings() {
  const data = await api(`/api/meetings?${meetingPeriodQuery()}`);
  state.meetings = data.meetings;
  renderMeetingCalendar(state.meetings);
  renderTopicPresetList();
  $("#topicTypeList").innerHTML = state.topics.map((topic) => `<span class="chip"><span class="topic-dot" style="background:${escapeHtml(topic.color)}"></span>${escapeHtml(topic.name)} · ${topic.options.length} 项</span>`).join("");
  $("#meetingList").innerHTML = data.meetings.length ? data.meetings.map((meeting) => `
    <article class="meeting-card">
      <div class="meeting-meta">
        <div><h3>${escapeHtml(meeting.title)}</h3><p>${meeting.meeting_date} · ${escapeHtml(meeting.summary || "")}</p></div>
        <div class="meeting-meta-actions">
          <span class="pill">${escapeHtml(meeting.creator || "")}</span>
          <a class="button-link" href="${escapeHtml(buildMeetingEmailHref(meeting))}">生成会议邮件</a>
        </div>
      </div>
      ${renderTopicBoard(meeting)}
      <div class="meeting-actions">
        <section class="panel">
          <h2>自定义议题</h2>
          ${renderCustomTopicForm(meeting.id)}
        </section>
        <section class="panel admin-only">
          <h2>添加预设议题</h2>
          ${renderPresetTopicForm(meeting.id)}
        </section>
        <section class="panel">
          <h2>参会签到</h2>
          ${state.permissions.isAdmin ? renderAttendance(meeting) : renderAttendanceReadonly(meeting)}
        </section>
      </div>
    </article>`).join("") : "<section class='panel'><p>本月暂无会议，管理员可先生成周例会。</p></section>";
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
  const qualityHeader = state.permissions.isAdmin ? "<th>质量管理</th>" : "";
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
            ${state.permissions.isAdmin ? `
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
  $("#selectedShiftDateTitle").textContent = state.permissions.isAdmin ? `编辑排班 · ${state.selectedShiftDate}` : "我的本月排班";
  const shiftDateInput = $('input[name="shift_date"]');
  if (shiftDateInput) shiftDateInput.value = state.selectedShiftDate;

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
      ${shifts.map((shift) => `<div class="shift-line ${shift.shift_type === "night" ? "night" : ""} ${Number(shift.user_id) === Number(state.user?.id) ? "mine" : ""}">${shift.shift_type === "day" ? "白" : "夜"} · ${escapeHtml(shift.machine_name)} · ${escapeHtml(shift.display_name)}</div>`).join("")}
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
      tags: data.tags || "",
      responsibilities: data.responsibilities || "",
      skills: data.skills || "",
      machine_scope: data.machine_scope || "",
      expertise: data.expertise || "",
      backup_owner: data.backup_owner || "",
      contact: data.contact || "",
    }),
  });
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

async function loadMembers() {
  const [membersData, postsData] = await Promise.all([
    api("/api/members"),
    api("/api/team-posts"),
  ]);
  state.members = membersData.members;
  renderTeamChat(postsData.posts);
  $("#memberList").innerHTML = state.members.map((member) => {
    const canEdit = state.permissions.isAdmin || member.user_id === state.user?.id;
    const profileEditTitle = state.permissions.isAdmin ? "管理员编辑标签与职责" : "编辑我的标签与职责";
    const tagPlaceholder = state.permissions.isAdmin ? "成员标签，用逗号分隔" : "我的标签，用逗号分隔";
    const responsibilityPlaceholder = state.permissions.isAdmin ? "成员职责范围" : "我的职责范围";
    const skills = member.skills || [];
    const machines = member.machine_scope || [];
    return `
      <article class="member-card profile-only">
        <section class="member-profile">
          <div class="member-head">
            ${member.avatar_url ? `<img class="avatar" src="${escapeHtml(member.avatar_url)}" alt="${escapeHtml(member.name)}">` : `<div class="avatar">${escapeHtml(member.name.slice(0, 1))}</div>`}
            <div><h3>${escapeHtml(member.name)}</h3><p>${escapeHtml(member.title || "")}</p></div>
          </div>
          <div class="tags">${(member.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
          <p><strong>职责：</strong>${escapeHtml(member.responsibilities || "未填写")}</p>
          <p>${escapeHtml(member.comment || "")}</p>
          <div class="member-persona">
            <div><span>技能</span><strong>${skills.length ? skills.map(escapeHtml).join(" / ") : "未填写"}</strong></div>
            <div><span>负责机台</span><strong>${machines.length ? machines.map(escapeHtml).join(" / ") : "未填写"}</strong></div>
            <div><span>擅长问题</span><strong>${escapeHtml(member.expertise || "未填写")}</strong></div>
            <div><span>备用负责人</span><strong>${escapeHtml(member.backup_owner || "未填写")}</strong></div>
            <div><span>联系方式</span><strong>${escapeHtml(member.contact || "未填写")}</strong></div>
          </div>
          ${canEdit ? `
            <form class="profile-edit-form" data-member-id="${member.id}">
              <strong>${profileEditTitle}</strong>
              <input name="tags" value="${escapeHtml((member.tags || []).join(", "))}" placeholder="${tagPlaceholder}">
              <textarea name="responsibilities" placeholder="${responsibilityPlaceholder}">${escapeHtml(member.responsibilities || "")}</textarea>
              <input name="skills" value="${escapeHtml(skills.join(", "))}" placeholder="技能标签，用逗号分隔">
              <input name="machine_scope" value="${escapeHtml(machines.join(", "))}" placeholder="负责机台，用逗号分隔">
              <input name="expertise" value="${escapeHtml(member.expertise || "")}" placeholder="擅长问题类型">
              <input name="backup_owner" value="${escapeHtml(member.backup_owner || "")}" placeholder="备用负责人">
              <input name="contact" value="${escapeHtml(member.contact || "")}" placeholder="联系方式">
              <button>保存成员画像</button>
            </form>
            <form class="avatar-tools avatar-form" data-member-id="${member.id}">
              <input name="avatar_url" placeholder="头像 URL">
              <input name="avatar_file" type="file" accept="image/*">
              <button>更换头像</button>
            </form>` : ""}
        </section>
      </article>`;
  }).join("");
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
    const meetingCell = event.target.closest(".meeting-day");
    if (meetingCell) {
      state.selectedMeetingDate = meetingCell.dataset.date;
      const input = $('input[name="meeting_date"]');
      if (input) input.value = state.selectedMeetingDate;
      renderMeetingCalendar(state.meetings);
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
    const topicForm = event.target.closest(".topic-item-form");
    const attendanceForm = event.target.closest(".attendance-row");
    const minuteForm = event.target.closest(".minute-form");
    const presetForm = event.target.closest(".preset-form");
    const linkQualityForm = event.target.closest(".link-quality-form");
    if (!postForm && !avatarForm && !profileForm && !topicForm && !attendanceForm && !minuteForm && !presetForm && !linkQualityForm) return;
    event.preventDefault();
    try {
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
