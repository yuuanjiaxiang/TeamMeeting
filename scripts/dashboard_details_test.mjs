import assert from 'node:assert/strict';
import { renderDashboardDetailRows } from '../static/dashboard-details.js';

assert.match(renderDashboardDetailRows('scores', []), /暂无/);
const score = renderDashboardDetailRows('scores', [{ kind: 'black', points: null, evidence: '<script>bad()</script>', score_date: '2026-09-15' }]);
assert.match(score, /积分已隐藏/);
assert.ok(!score.includes('<script>'));
assert.match(score, /&lt;script&gt;/);
assert.match(renderDashboardDetailRows('thanks', [{ giver_name: 'A', evidence: 'help', week_start: '2026-09-14' }]), /help/);
assert.match(renderDashboardDetailRows('shifts', [{ shift_type: 'night', hours: 12, machine_name: 'TOPTB' }]), /夜班 · 12 小时/);
assert.match(renderDashboardDetailRows('morning', [{ title: 'Check', status: 'done', detail: 'Finished', blocker: 'Risk' }]), /已完成/);
console.log('Dashboard detail rendering: passed');
