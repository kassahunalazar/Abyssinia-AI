import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { testAssistant as createAssistant, browserCookie } from '../http-fixture.mjs';

async function start(t, reply) {
  const server = createAssistant({reply}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const cookie = await browserCookie(origin);
  const chat = (message, from = origin) => fetch(origin + '/api/chat', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: from, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return { origin, chat, cookie };
}

test('serves Amharic UI and round trips UTF-8 over HTTP', async t => {
  const { origin, chat } = await start(t, async message => 'መልስ፦ ' + message);
  const page = await fetch(origin);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /lang="am"/);
  const response = await chat('ጤና ይስጥልኝ');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: 'መልስ፦ ጤና ይስጥልኝ' });
});

test('rejects unrelated origins, oversized bodies and invalid messages', async t => {
  const { chat } = await start(t, async () => assert.fail('Unexpected model invocation'));
  assert.equal((await chat('hello', 'https://example.org')).status, 403);
  assert.equal((await chat('ሀ'.repeat(6000))).status, 413);
  assert.equal((await chat(' ')).status, 400);
});

test('redacts provider failure', async t => {
  const { chat } = await start(t, async () => { throw new Error('secret'); });
  const response = await chat('ሰላም');
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'provider_failed' });
});

test('unread attachments fail closed without streaming an answer or advancing the conversation', async t => {
  const { origin, cookie } = await start(t, async (message, history, provider, attachment, onRead, signal, onDelta) => {
    if (attachment) {
      onDelta?.('unverified draft');
      return 'unverified answer';
    }
    return history.map(entry => entry.content).join('|') || 'initial answer';
  });
  const post = (body, accept = 'application/json') => fetch(origin + '/api/chat', {
    method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', Accept: accept },
    body: JSON.stringify(body),
  });
  const initial = await (await post({ message: 'initial', conversation: null })).json();
  const attachment = { name: 'fixture.txt', text: 'synthetic file contents' };
  const draft = { message: 'read fixture', conversation: initial.conversation, attachment };
  const regular = await post(draft);
  assert.equal(regular.status, 422);
  assert.deepEqual(await regular.json(), { error: 'attachment_unread' });

  const streamed = await post(draft, 'application/x-ndjson');
  assert.match(streamed.headers.get('content-type'), /^application\/x-ndjson\b/);
  assert.deepEqual((await streamed.text()).trimEnd().split('\n').map(line => JSON.parse(line)), [
    { state: 'thinking' }, { status: 422, error: 'attachment_unread' },
  ]);

  const after = await (await post({ message: 'follow-up', conversation: initial.conversation })).json();
  assert.equal(after.reply, 'initial|initial answer');
});

test('keeps completed turns isolated and bounded across chat switches and failed retries', async t => {
  const { origin, cookie } = await start(t, async (message, history) => {
    if (message === 'fail') throw Error();
    return history.filter(entry => entry.role === 'user').map(entry => entry.content).join(',') || 'empty';
  });
  const post = (message, conversation) => fetch(origin + '/api/chat', {
    method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversation }),
  });
  const a = await (await post('1', null)).json();
  const b = await (await post('other', null)).json();
  assert.notEqual(a.conversation, b.conversation);
  assert.equal(b.reply, 'empty');
  assert.equal((await post('fail', a.conversation)).status, 502);
  for (const message of ['2', '3', '4', '5']) await post(message, a.conversation);
  assert.equal((await (await post('6', a.conversation)).json()).reply, '2,3,4,5');
  assert.equal((await (await post('again', b.conversation)).json()).reply, 'other');
  assert.equal((await post('hello', 'unknown')).status, 410);
});
