const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const text = (value) => String(value ?? "").trim();
const html = (value) => escape(text(value)).replace(/\r?\n/g, "<br>");
const filled = (value) => text(value) && !["无", "暂无", "待补充"].includes(text(value));
const statusNames = { todo: "待处理", doing: "进行中", done: "已完成" };

export function isSystemThanks(item) {
  return /thank\s*you|感谢/i.test([item.title, item.type_name, item.section, item.option_title].join(" "));
}

export function meetingOverview(meeting) {
  const items = meeting.items || [];
  const manual = items.filter((item) => !isSystemThanks(item));
  return {
    total: items.length,
    manual: manual.length,
    recorded: manual.filter((item) => filled(item.minutes)).length,
    unassigned: items.filter((item) => !item.owner_id).length,
    actions: manual.filter((item) => filled(item.next_steps)),
    duration: items.reduce((sum, item) => sum + (Number(item.duration_minutes) || 10), 0),
    attending: (meeting.attendance || []).filter((record) => ["present", "late"].includes(record.status)).length,
  };
}

export function plannedAgendaTime(meeting, itemIndex) {
  if (!/^\d{2}:\d{2}$/.test(meeting.start_time || "")) return "";
  const [hour, minute] = meeting.start_time.split(":").map(Number);
  const offset = (meeting.items || []).slice(0, itemIndex).reduce((sum, item) => sum + (Number(item.duration_minutes) || 10), 0);
  const total = hour * 60 + minute + offset;
  return `${total >= 1440 ? "次日 " : ""}${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function buildMinutesDocument(meeting, thankData = null) {
  const items = (meeting.items || []).filter((item) => !isSystemThanks(item));
  const attendees = (meeting.attendance || []).filter((row) => ["present", "late"].includes(row.status)).map((row) => row.display_name).join("、");
  const schedule = [meeting.meeting_date, meeting.start_time].filter(Boolean).join(" ");
  const subject = `【会议纪要】${meeting.meeting_date || ""} ${meeting.title || ""}`;
  const cell = "border:1px solid #555;padding:10px 12px;vertical-align:middle;overflow-wrap:anywhere;word-break:break-word;";
  const metadata = [
    ["会议主题", meeting.title || "未填写"],
    ["会议时间", schedule || "未填写", "会议地点", meeting.location || "未填写"],
    ["会议主持人", meeting.host_name || meeting.creator || "未填写", "会议记录人", meeting.recorder_name || "未填写"],
    ["参会人员", attendees || "尚无出席签到"],
  ];
  const content = [];
  if (filled(meeting.summary)) content.push(meeting.summary);
  items.forEach((item) => {
    const parts = [item.title, item.detail, filled(item.minutes) ? item.minutes : "尚未记录结论"];
    if (filled(item.materials)) parts.push(`会前材料：${item.materials}`);
    content.push(parts.filter(Boolean).join("\n"));
  });
  const discussions = items.filter((item) => filled(item.open_issues)).map((item) => `${item.title}\n${item.open_issues}`);
  const tasks = items.filter((item) => filled(item.next_steps)).map((item) =>
    `${item.owner_name || "待指定负责人"}：${item.next_steps}\n关联议题：${item.title}；完成时间：${item.due_date || "未填写"}；状态：${statusNames[item.status] || "待处理"}`);
  const sections = [
    ["一、会议内容", content, "暂无会议内容"],
    ["二、会议讨论事项", discussions, "暂无待确认的讨论事项"],
    ["三、会议待办事项", tasks, "暂无下一步安排"],
  ];
  if (thankData) {
    const thanks = (thankData.votes || []).map((vote) => `${vote.voter_name} 感谢 ${vote.receiver_name}：${vote.evidence}`);
    if (thankData.stars?.length) thanks.unshift("Thank You 之星：" + thankData.stars.map((star) => `${star.display_name} · ${Number(star.thanks || 0)} 次`).join("；"));
    sections.push(["团队感谢", thanks, "本周暂无 Thank You"]);
  }
  const markup = `<article class="meeting-document" style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#111;line-height:1.7;">
    <h1 style="text-align:center;font-size:30px;line-height:1.4;margin:16px 0 28px;color:#111;">会议纪要</h1>
    <table cellpadding="0" cellspacing="0" width="100%" aria-label="会议纪要" style="width:100%;table-layout:fixed;border-collapse:collapse;border:2px solid #444;font-size:14px;background:#fff;">
      <colgroup><col width="25%"><col width="25%"><col width="25%"><col width="25%"></colgroup>
      <tbody>${metadata.map((row) => row.length === 2
        ? `<tr><th scope="row" style="${cell}font-weight:normal;text-align:center;">${html(row[0])}</th><td colspan="3" style="${cell}">${html(row[1])}</td></tr>`
        : `<tr><th scope="row" style="${cell}font-weight:normal;text-align:center;">${html(row[0])}</th><td style="${cell}">${html(row[1])}</td><th scope="row" style="${cell}font-weight:normal;text-align:center;">${html(row[2])}</th><td style="${cell}">${html(row[3])}</td></tr>`).join("")}
      ${sections.map(([title, rows, empty]) => `<tr><th colspan="4" style="${cell}text-align:left;background:#eef0f3;font-size:16px;font-weight:600;">${title}</th></tr>${(rows.length ? rows : [empty]).map((value, index) => `<tr><td colspan="4" style="${cell}vertical-align:top;">${rows.length ? `${index + 1}. ` : ""}${html(value)}</td></tr>`).join("")}`).join("")}
      </tbody>
    </table>
  </article>`;
  const lines = ["# 会议纪要", ""];
  metadata.forEach((row) => {
    lines.push(`${row[0]}：${row[1]}`);
    if (row.length === 4) lines.push(`${row[2]}：${row[3]}`);
  });
  sections.forEach(([title, rows, empty]) => {
    lines.push("", `## ${title}`, "");
    lines.push(...(rows.length ? rows.map((value, index) => `${index + 1}. ${value}`) : [empty]));
  });
  return { html: markup, text: lines.join("\n"), subject };
}
