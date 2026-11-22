import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { browserCookie } from '../http-fixture.mjs';
import { createAssistant } from '../server.mjs';
function tempState(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ah-speech-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('dictation remains available and narration actions are unregistered', async t => {
  const stateDirectory = tempState(t);
  const app = createAssistant({ stateDirectory }).listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const origin = `http://127.0.0.1:${app.address().port}`;
  const cookie = await browserCookie(origin);
  const post = async body => {
    const response = await fetch(`${origin}/api/control`, {
      method: 'POST', headers: { origin, cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  const input = await post({action:'voice.models'});
  assert.equal(input.status, 200);
  assert.ok(Array.isArray(input.body.models));
  for (const action of ['voice.output','voice.connect','voice.rate','voice.sample','voice.speak','voice.disable']) {
    assert.deepEqual(await post({action}), {status:409,body:{error:'invalid'}});
  }
});
