import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createAssistant } from '../server.mjs';

async function start(t, reply) {
  const server = createAssistant({reply}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const chat = (message, from = origin) => fetch(origin + '/api/chat', {
    method: 'POST',
    headers: { Origin: from, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return { origin, chat };
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
  assert.deepEqual(await response.json(), { error: 'hermes' });
});
