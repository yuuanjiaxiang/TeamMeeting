import assert from 'node:assert/strict';
import { buildMinutesDocument, meetingOverview, plannedAgendaTime, isSystemThanks } from '../static/meeting-minutes.js';

const meeting = { title: '<script>test</script>', meeting_date: '2026-09-08', start_time: '23:55',
  attendance: [{ display_name: 'A', status: 'late' }],
  items: [{ title: 'Review', owner_id: 1, owner_name: 'A', minutes: 'Done\nVerified', next_steps: 'Follow up', due_date: '2026-09-09', duration_minutes: 10 }, { title: 'Thank You' }] };
const doc = buildMinutesDocument(meeting);
assert(!doc.html.includes('<script>'));
assert(doc.html.includes('&lt;script&gt;'));
assert(doc.html.includes('Done<br>Verified'));
assert(doc.text.includes('Follow up'));
assert(doc.text.includes('2026-09-09'));
assert.equal(meetingOverview(meeting).attending, 1);
assert.equal(meetingOverview(meeting).recorded, 1);
assert.equal(plannedAgendaTime(meeting, 1), '次日 00:05');
assert(isSystemThanks({ option_title: '团队感谢' }));
assert(!doc.text.includes('## 团队感谢'));
assert(buildMinutesDocument(meeting, { votes: [], stars: [] }).text.includes('## 团队感谢'));
assert(buildMinutesDocument({ title: 'Empty', items: [] }).html.includes('暂无下一步安排'));
assert(!/display:\s*(grid|flex)/.test(doc.html));
console.log('Meeting minutes tests passed');
