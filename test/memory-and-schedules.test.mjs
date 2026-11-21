import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { browserCookie, testAssistant } from '../http-fixture.mjs';
import { workspaceControl } from '../workspace-control.mjs';

function temporaryState(t) {
  const root = mkdtempSync(join(tmpdir(), 'abyssinia-workspace-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('confirmed memory CRUD persists and requires the current revision', t => {
  const root = temporaryState(t);
  let now = 100;
  let control = workspaceControl(root, () => now);
  const run = (action, values = {}) => control.execute({ action, ...values });
  const text = 'ለሚቀጥለው ጊዜ አስቀምጥ።';
  assert.throws(() => run('memory.create', { text }), /invalid/);
  assert.throws(() => run('memory.create', { text: 'ሀ'.repeat(1501), confirmed: true }), /invalid/);
  const { memory } = run('memory.create', { text, source: 'claimed', created: 10, confirmed: true });
  assert.deepEqual(memory, { id: memory.id, text, source: 'user', revision: memory.revision, created: 100, updated: 100 });
  const { id, revision } = memory;
  control = workspaceControl(root, () => now);
  assert.deepEqual(run('memory.list').memories, [memory]);
  assert.throws(() => run('memory.update', { id, revision, text: 'changed' }), /invalid/);
  now = 110;
  const { memory: updated } = run('memory.update', { id, revision, text: 'ሁለተኛ እትም', confirmed: true });
  assert.equal(updated.created, 100);
  assert.equal(updated.updated, 110);
  assert.equal(updated.source, 'user');
  assert.notEqual(updated.revision, revision);
  assert.throws(() => run('memory.delete', { id, revision, confirmed: true }), /stale/);
  assert.throws(() => run('memory.delete', { id, revision: updated.revision }), /invalid/);
  run('memory.delete', { id, revision: updated.revision, confirmed: true });
  control = workspaceControl(root);
  assert.deepEqual(run('memory.list').memories, []);
  assert.equal(JSON.stringify(run('status').events).includes(text), false);
  assert.equal(JSON.stringify(run('status')).includes(updated.text), false);
});

test('browser note import preserves provenance and retries cannot revert edits', t => {
  const root = temporaryState(t);
  let control = workspaceControl(root, () => 1500);
  const note = { id: randomUUID(), created: 800, text: 'የቆየ ማስታወሻ' };
  const importNote = confirmed => control.execute({ action: 'memory.import', ...note, confirmed });
  assert.throws(() => importNote(false), /invalid/);
  const { memory } = importNote(true);
  assert.equal(memory.created, note.created);
  assert.equal(memory.updated, 1500);
  assert.equal(memory.source, 'browser-note');
  assert.equal(memory.id, note.id);
  control = workspaceControl(root, () => 2000);
  const { memory: updated } = control.execute({ action: 'memory.update', id: memory.id, revision: memory.revision,
    text: 'የታረመ ማስታወሻ', confirmed: true });
  assert.deepEqual(importNote(true).memory, updated);
  assert.deepEqual(control.execute({ action: 'memory.list' }).memories, [updated]);
});

test('HTTP memory requires a browser session and stays out of unscoped chat', async t => {
  const privateNote = 'private memory fixture';
  let chatMessages;
  const app = testAssistant({ reply: async (...args) => { chatMessages = args;return 'ሰላም'; } }).listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const cookie = await browserCookie(origin);
  function post(route, data, credential = cookie) {
    return fetch(origin + route, { method: 'POST', headers: { Cookie: credential, Origin: origin,
      'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  }
  const creation = { action: 'memory.create', text: privateNote, confirmed: true };
  assert.equal((await post('/api/control', creation, '')).status, 401);
  assert.equal((await post('/api/control', creation)).status, 200);
  assert.equal((await post('/api/chat', { message: 'ሰላም' })).status, 200);
  assert.equal(JSON.stringify(chatMessages).includes(privateNote), false);
});

test('run history preserves legacy results and retains recurring failures and interrupted runs', async t => {
  const root = temporaryState(t);
  let now = new Date(2026, 10, 20, 11).getTime();
  const prior = { id: randomUUID(), title: 'Legacy', job: 'research', status: 'delivered', last: now - 1000,
    jobResult: { status: 'completed', sources: [{ title: 'Legacy result', url: 'https://am.wikipedia.org/wiki/Legacy' }] } };
  writeFileSync(join(root, 'activity.json'), JSON.stringify({ paused: false, events: [], reminders: [prior] }));
  let control = workspaceControl(root, () => now);
  const run = (action, values = {}) => control.execute({ action, ...values });
  assert.equal(run('schedule.history').runs[0].sources[0].title, 'Legacy result');
  run('removeReminder', { id: prior.id });
  const { id } = run('schedule', { job: 'research', language: 'am', title: 'Recurring', next: now + 1000, daily: true });
  now += 1000;
  await control.tick(async () => { throw Error('Internal provider details'); });
  const nextDue = run('status').reminders[0].next;
  assert.ok(nextDue > now);
  now = nextDue;
  const running = control.tick(async (title, language, signal) => {
    assert.equal(title, 'Recurring');
    assert.equal(language, 'am');
    await once(signal, 'abort');
    return [{ title: 'Late result' }];
  });
  run('hold', { id });
  run('release', { id });
  await running;
  assert.equal(run('status').reminders[0].next, nextDue);
  const sources = [{ title: 'New result', url: 'https://am.wikipedia.org/wiki/Recurring' }];
  await control.tick(async () => sources);
  control = workspaceControl(root, () => now);
  const { runs } = run('schedule.history');
  assert.deepEqual(runs.map(row => row.outcome), ['completed', 'interrupted', 'failed', 'completed']);
  assert.deepEqual(runs[0].sources, sources);
  assert.equal(runs[0].due, nextDue);
  assert.equal(runs[1].failure, 'cancelled');
  assert.deepEqual(runs[1].sources, []);
  assert.equal(runs[2].failure, 'research_unavailable');
  assert.equal(runs[3].schedule, prior.id);
  assert.equal(JSON.stringify(runs).includes('Internal provider details'), false);
});
