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
  const overview = meetingOverview(meeting);
  const items = (meeting.items || []).filter((item) => !isSystemThanks(item));
  const attending = (meeting.attendance || []).filter((row) => ["present", "late"].includes(row.status)).map((row) => row.display_name).join("、");
  const exceptions = (meeting.attendance || []).filter((row) => ["late", "leave", "absent"].includes(row.status))
    .map((row) => `${row.display_name}（${({ late: "迟到", leave: "请假", absent: "缺席" })[row.status]}）`).join("、");
  const schedule = `${meeting.meeting_date}${meeting.start_time ? ` ${meeting.start_time}` : ""}`;
  const subject = `【会议纪要】${meeting.meeting_date} ${meeting.title}`;
  const muted = "color:#667085;font-size:12px;line-height:1.7;";
  const paragraph = "margin:6px 0 12px;font-size:14px;line-height:1.8;overflow-wrap:anywhere;word-break:break-word;";
  const heading = "margin:26px 0 12px;padding-bottom:9px;border-bottom:2px solid #dce5ef;font-size:17px;color:#24354b;";
  const cell = "padding:10px 12px;border-bottom:1px solid #e5e9ef;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;";
  const block = (label, value, color = "#344054") => filled(value)
    ? `<p style="${paragraph}color:${color};"><strong>${label}</strong><br>${html(value)}</p>` : "";
  const actions = overview.actions.map((item, index) => `<tr>
    <td style="${cell}"><span style="${muted}">${index + 1}. ${html(item.title)}</span><br>${html(item.next_steps)}</td>
    <td style="${cell}width:16%;">${html(item.owner_name || "待指定")}</td>
    <td style="${cell}width:23%;font-size:12px;">${html(item.due_date || "未设日期")}<br>${statusNames[item.status] || "待处理"}</td>
  </tr>`).join("");
  const thanks = thankData ? `<h2 style="${heading}">团队感谢</h2>
    <p style="${paragraph}">本周 ${(thankData.votes || []).length} 条 Thank You</p>
    ${(thankData.stars || []).length ? block("Thank You 之星", thankData.stars.map((star) => `${star.display_name} · ${Number(star.thanks || 0)} 次`).join("；")) : ""}
    ${(thankData.votes || []).map((vote) => `<p style="${paragraph}"><strong>${html(vote.voter_name)} → ${html(vote.receiver_name)}</strong><br>${html(vote.evidence)}</p>`).join("")}` : "";
  const markup = `<article class="meeting-document" style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#24354b;line-height:1.7;text-align:left;">
    <div style="border-top:4px solid #365f98;padding:22px 0 18px;border-bottom:1px solid #dce5ef;">
      <p style="margin:0 0 6px;color:#365f98;font-size:12px;font-weight:bold;">会议纪要</p>
      <h1 style="font-size:24px;line-height:1.4;margin:0 0 12px;color:#1d2939;overflow-wrap:anywhere;word-break:break-word;">${html(meeting.title)}</h1>
      <p style="margin:0;${muted}">${html(schedule)} · 召集人 ${html(meeting.creator || "未记录")}</p>
      ${filled(meeting.summary) ? `<p style="${paragraph}margin-bottom:0;">${html(meeting.summary)}</p>` : ""}
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;table-layout:fixed;margin:16px 0;background:#f4f7fb;">
      <tr>${[[overview.total, "议题"], [overview.attending, "出席（含迟到）"], [overview.duration, "预计分钟"]].map(([value, label]) => `<td style="padding:12px;text-align:left;vertical-align:top;"><strong style="font-size:21px;color:#24354b;">${value}</strong><br><span style="${muted}">${label}</span></td>`).join("")}</tr>
    </table>
    <p style="${paragraph}"><strong>参会人员</strong>　${html(attending || "尚无出席签到")}</p>
    ${exceptions ? block("签到备注", exceptions) : ""}
    <h2 style="${heading}">下一步安排 <span style="font-size:12px;font-weight:normal;color:#667085;">${overview.actions.length} 项</span></h2>
    ${actions ? `<table aria-label="下一步安排" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;width:100%;table-layout:fixed;font-size:14px;">
      <thead><tr style="background:#f4f7fb;"><th style="${cell}">行动内容</th><th style="${cell}width:16%;">责任人</th><th style="${cell}width:23%;">截止 / 状态</th></tr></thead><tbody>${actions}</tbody></table>` : `<p style="${muted}">暂无下一步安排</p>`}
    <h2 style="${heading}">议题纪要 <span style="font-size:12px;font-weight:normal;color:#667085;">已记录 ${overview.recorded} / ${overview.manual}</span></h2>
    ${items.map((item, index) => `<section style="padding:16px 0;border-bottom:1px solid #e5e9ef;break-inside:avoid;">
      <h3 style="margin:0 0 7px;font-size:16px;color:#24354b;overflow-wrap:anywhere;word-break:break-word;">${String(index + 1).padStart(2, "0")}　${html(item.title)}</h3>
      <p style="margin:0 0 12px;${muted}">${html(item.type_name || item.section || "议题")} · ${html(item.owner_name || "待指定负责人")} · ${statusNames[item.status] || "待处理"}</p>
      ${block("背景", item.detail)}
      ${filled(item.minutes) ? block("讨论结论", item.minutes) : `<p style="${paragraph}color:#986515;">本议题尚未记录结论</p>`}
      ${block("风险 / 待确认", item.open_issues, "#a2353c")}
      ${block("会前材料", item.materials)}
    </section>`).join("") || `<p style="${muted}">暂无手动记录的议题</p>`}
    ${thanks}
    <p style="margin:26px 0 0;padding-top:12px;border-top:1px solid #dce5ef;${muted}">${html(schedule)} · ${html(meeting.title)} · Team Loop</p>
  </article>`;
  const lines = [`# ${subject}`, "", `时间：${schedule} | 召集人：${meeting.creator || "未记录"}`,
    `议题：${overview.total} | 出席（含迟到）：${overview.attending} | 预计时长：${overview.duration} 分钟`,
    `参会：${attending || "尚无出席签到"}`];
  if (exceptions) lines.push(`签到备注：${exceptions}`);
  if (filled(meeting.summary)) lines.push("", meeting.summary);
  lines.push("", "## 下一步安排", "");
  overview.actions.forEach((item, index) => lines.push(`${index + 1}. ${item.title}：${item.next_steps}`, `   责任人：${item.owner_name || "待指定"}；截止：${item.due_date || "未设日期"}；状态：${statusNames[item.status] || "待处理"}`));
  if (!overview.actions.length) lines.push("暂无下一步安排");
  lines.push("", "## 议题纪要", "");
  items.forEach((item, index) => {
    lines.push(`### ${index + 1}. ${item.title}`, `${item.type_name || item.section || "议题"} · ${item.owner_name || "待指定负责人"} · ${statusNames[item.status] || "待处理"}`);
    for (const [label, value] of [["背景", item.detail], ["讨论结论", item.minutes || "尚未记录"], ["风险 / 待确认", item.open_issues], ["会前材料", item.materials]]) {
      if (filled(value)) lines.push("", `${label}：${value}`);
    }
    lines.push("");
  });
  if (thankData) {
    lines.push("## 团队感谢", "", `本周 ${(thankData.votes || []).length} 条 Thank You`);
    if (thankData.stars?.length) lines.push("Thank You 之星：" + thankData.stars.map((star) => `${star.display_name} · ${Number(star.thanks || 0)} 次`).join("；"));
    (thankData.votes || []).forEach((vote) => lines.push(`- ${vote.voter_name} 感谢 ${vote.receiver_name}：${vote.evidence}`));
  }
  return { html: markup, text: lines.join("\n"), subject };
}
