import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { browserCookie } from '../http-fixture.mjs';
import { createAssistant } from '../server.mjs';

async function fixture(t, reply) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'abyssinia-extension-')));
  const source = join(directory, 'source.mjs');
  const app = createAssistant({
    stateDirectory: join(directory, 'state'),
    pickFile: async () => source,
    reply,
  }).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise(resolve => {
      app.close(resolve);
      app.closeAllConnections();
    });
    rmSync(directory, { recursive: true, force: true });
  });
  await once(app, 'listening');
  const origin = `http://127.0.0.1:${app.address().port}`;
  const cookie = await browserCookie(origin);

  async function post(path, data, status = 200) {
    const response = await fetch(origin + path, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  return {
    source,
    control: (action, data, status) => post('/api/control', { action, ...data }, status),
    chat: (data, status) => post('/api/chat', data, status),
  };
}

test('a source-scoped chat needs a matching grant, a read, and approval to edit', async t => {
  const original = '\uFEFFexport const label = "ሰላም";\r\n';
  const replacement = 'export const label = "updated";\n';
  const calls = [];
  const { source, chat, control } = await fixture(t, async (
    message, history, provider, attachment, onRead, signal, onDelta, onSchedule, extension
  ) => {
    calls.push({ attachment, capability: extension.capability.name });
    if (message === 'Read and update the source') onRead();
    extension.onAction({ text: replacement, target: 'model-chosen-path.mjs' });
    return 'Draft response';
  });
  writeFileSync(source, original);
  const { grant } = await control('code.pick');
  assert.deepEqual(await chat({
    message: 'Update the source', scope: { name: 'source', target: 'wrong-grant' },
  }, 409), { error: 'scope_unavailable' });
  assert.deepEqual(calls, []);

  const scope = { name: 'source', target: grant };
  assert.deepEqual(await chat({ message: 'Update without reading', scope }, 422), {
    error: 'attachment_unread',
  });
  assert.deepEqual((await control('status')).approvals, []);

  const result = await chat({ message: 'Read and update the source', scope, conversation: null });
  assert.equal(result.tool, 'read_attached_text');
  assert.deepEqual(calls, Array.from({ length: 2 }, () => ({
    attachment: { name: 'source.mjs', text: original },
    capability: 'propose_source_edit',
  })));
  const [pending] = (await control('status')).approvals;
  assert.equal(pending.id, result.approval);
  assert.equal(pending.tool, 'code.replace');
  assert.equal(pending.target, source);
  assert.equal(readFileSync(source, 'utf8'), original);

  await control('approve', { id: result.approval });
  assert.equal(readFileSync(source, 'utf8'), '\uFEFFexport const label = "updated";\r\n');
  await control('approve', { id: result.approval }, 409);
});

test('a specialist gets its own task with no history, attachment, or tools', async t => {
  const task = 'Review the plan for failure handling';
  const advice = 'Verify cancellation before applying the result.';
  const calls = [];
  const { chat, control } = await fixture(t, async (...args) => {
    calls.push(args);
    const [message, , , , , , , , extension] = args;
    if (extension.capability?.name === 'consult_specialist') {
      extension.onAction({ specialty: 'planning', task });
      return 'Delegating';
    }
    return message === task ? advice : 'Initial reply';
  });
  const { conversation } = await chat({ message: 'Private history', conversation: null });
  const result = await chat({
    message: 'Consult a specialist', conversation, scope: { name: 'specialist' },
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[1][1][0].content, 'Private history');
  assert.equal(calls[1][8].capability.name, 'consult_specialist');
  const [message, history, provider, attachment, onRead, , , onSchedule, extension] = calls[2];
  assert.equal(message, task);
  assert.deepEqual(history, []);
  assert.equal(provider, calls[1][2]);
  assert.equal(attachment, undefined);
  assert.equal(onRead, undefined);
  assert.equal(onSchedule, undefined);
  assert.deepEqual(Object.keys(extension), ['skill']);
  assert.match(extension.skill, /read-only planning specialist/);
  assert.deepEqual(result, { reply: advice, conversation, delegated: 'planning' });
  assert.deepEqual((await control('status')).approvals, []);
});
