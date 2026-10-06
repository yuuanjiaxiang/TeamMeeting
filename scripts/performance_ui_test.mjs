import assert from 'node:assert/strict';
import { createRequestScheduler } from '../static/request-scheduler.js';
import { createPageRegistry } from '../static/page-registry.js';
import { groupShiftRows } from '../static/shift-workspace.js';
import { scoreMonthPeriod } from '../static/score-period.js';
import { agendaColor } from '../static/meeting-calendar-planner.js';
import { matchesMorningFocus, newestMorningHistory } from '../static/morning-followup.js';

let active = 0, peak = 0, calls = 0;
assert.deepEqual(scoreMonthPeriod(2024, 2), { from: '2024-02-01', to: '2024-02-29' });
assert.deepEqual(scoreMonthPeriod(2026, 2), { from: '2026-02-01', to: '2026-02-28' });
assert.deepEqual(scoreMonthPeriod(2026, 12), { from: '2026-12-01', to: '2026-12-31' });
assert.throws(() => scoreMonthPeriod(2026, 13));
assert.equal(agendaColor({type_color:'#2563eb'}), '#2563eb');
assert.match(agendaColor({type_color:'red;position:fixed',type_id:2}), /^#[0-9a-f]{6}$/);
assert.notEqual(agendaColor({type_id:1}), agendaColor({type_id:2}));
const scheduler = createRequestScheduler({ concurrency: 2, fetchImpl: async (url) => {
  calls++; peak = Math.max(peak, ++active);
  await new Promise((resolve) => setTimeout(resolve, 5));
  active--;
  return new Response(url);
} });
const results = await Promise.all(['/a', '/a', '/b', '/c', '/d'].map((url) => scheduler.read(url).then((r) => r.text())));
assert.deepEqual(results, ['/a', '/a', '/b', '/c', '/d']);
assert.equal(calls, 4); assert.equal(peak, 2);
await scheduler.read('/a'); assert.equal(calls, 5);
const aborting = createRequestScheduler({ concurrency: 1, fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
  if (signal.aborted) reject(new DOMException('aborted', 'AbortError'));
  signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
}) });
const pending = Promise.allSettled([aborting.read('/a'), aborting.read('/b')]);
aborting.invalidate();
assert.ok((await pending).every((r) => r.status === 'rejected' && r.reason.name === 'AbortError' && !r.reason.message));
const empty = createRequestScheduler({ fetchImpl: async () => new Response(null, { status: 204 }) });
assert.equal((await empty.read('/empty')).status, 204);
const modules = createPageRegistry();
const loaded = [];
modules.register('one', { load: () => loaded.push('one') });
modules.register('two', { load: () => loaded.push('two') });
await modules.load('one'); await modules.load('two', () => false);
assert.deepEqual(loaded, ['one']);
assert.throws(() => modules.register('one', { load() {} }));
assert.equal(matchesMorningFocus({ status: 'doing', blocker: 'blocked' }, 'risk'), true);
assert.equal(matchesMorningFocus({ status: 'risk' }, 'risk'), true);
assert.equal(matchesMorningFocus({ status: 'done', needs_attention: true }, 'risk'), false);
const history = [
  { id: 1, item_date: '2026-07-01', updated_at: '2026-07-01T09:00:00' },
  { id: 2, item_date: '2026-07-02', updated_at: '2026-07-02T09:00:00' },
  { id: 3, item_date: '2026-07-02', updated_at: '2026-07-02T10:00:00' },
];
assert.deepEqual(newestMorningHistory(history).map((row) => row.id), [3, 2, 1]);
assert.deepEqual(history.map((row) => row.id), [1, 2, 3]);
assert.deepEqual(newestMorningHistory(), []);
const groups = groupShiftRows([
  { shift_date: '2026-10-02', shift_type: 'night', display_name: 'A' },
  { shift_date: '2026-10-01', shift_type: 'day', display_name: 'B' },
]);
assert.equal(groups[0][0], '2026-10-01');
assert.equal(groupShiftRows(groups.flatMap(([, rows]) => rows), { type: 'night', keyword: 'a' }).length, 1);
console.log('Request scheduling, module isolation, risk matching and shift grouping: OK');
