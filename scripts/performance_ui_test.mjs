import assert from 'node:assert/strict';
import { createRequestScheduler } from '../static/request-scheduler.js';
import { createPageRegistry } from '../static/page-registry.js';
import { groupShiftRows } from '../static/shift-workspace.js';
import { matchesMorningFocus } from '../static/morning-followup.js';

let active = 0, peak = 0, calls = 0;
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
const groups = groupShiftRows([
  { shift_date: '2026-10-02', shift_type: 'night', display_name: 'A' },
  { shift_date: '2026-10-01', shift_type: 'day', display_name: 'B' },
]);
assert.equal(groups[0][0], '2026-10-01');
assert.equal(groupShiftRows(groups.flatMap(([, rows]) => rows), { type: 'night', keyword: 'a' }).length, 1);
console.log('Request scheduling, module isolation, risk matching and shift grouping: OK');
