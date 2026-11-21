import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { browserCookie } from '../http-fixture.mjs';
import { createAssistant } from '../server.mjs';
import { candidates, speechScript, synthesize, voices } from '../speech-output.mjs';
import { workspaceControl } from '../workspace-control.mjs';

const [model, alternate] = candidates;
const [voice] = voices;

function tempState(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ah-speech-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('synthesis sends the explicit credential and accepts synthetic WAV audio', async () => {
  const wav = Buffer.from('524946462600000057415645666d74201000000001000100401f0000803e00000200100064617461020000000000', 'hex');
  const audio = wav.toString('base64');
  const controller = new AbortController();
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url, options });
    return Response.json({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: audio }] }] });
  };

  assert.equal(await synthesize(speechScript, model, voice, controller.signal, 'synthetic-key', request), audio);
  assert.equal(requests.length, 1);
  const [{ url, options }] = requests;
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(options.headers['x-goog-api-key'], 'synthetic-key');
  assert.equal(options.redirect, 'error');
  const body = JSON.parse(options.body);
  assert.equal(body.model, model);
  assert.deepEqual(body.input[0].content, [{ type: 'text', text: speechScript }]);
  assert.deepEqual(body.response_format, { type: 'audio' });
  assert.deepEqual(body.generation_config.speech_config, [{ voice }]);
  assert.equal(body.store, false);
  assert.equal(options.signal.aborted, false);
  controller.abort();
  assert.equal(options.signal.aborted, true);
});

test('synthesis rejects absent credentials, invalid pairs, and non-WAV audio', async () => {
  const { signal } = new AbortController();
  let calls = 0;
  const request = async () => {
    calls++;
    return Response.json({ steps: [{ type: 'model_output', content: [{
      type: 'audio', data: Buffer.alloc(44).toString('base64'),
    }] }] });
  };
  await assert.rejects(synthesize(speechScript, model, voice, signal, '', request), /unavailable/);
  await assert.rejects(synthesize(speechScript, 'unknown-model', voice, signal, 'synthetic-key', request), /unavailable/);
  assert.equal(calls, 0);
  await assert.rejects(synthesize(speechScript, model, voice, signal, 'synthetic-key', request), /audio/);
  assert.equal(calls, 1);
});

test('synthetic ratings gate a voice pair and persist the accepted review', t => {
  const directory = tempState(t);
  const control = workspaceControl(directory, () => 10);
  assert.equal(control.reviewedVoice, null);
  assert.throws(() => control.reviewVoice(model, voice, 4.5, 5), /invalid/);
  assert.deepEqual(control.reviewVoice(model, voice, 3, 5), { accepted: false });
  assert.equal(control.reviewedVoice, null);
  assert.deepEqual(control.reviewVoice(model, voice, 4, 5), { accepted: true });
  const accepted = { model, voice, naturalness: 4, clarity: 5, reviewed: 10 };
  assert.deepEqual(workspaceControl(directory).reviewedVoice, accepted);
  assert.deepEqual(control.reviewVoice(alternate, voice, 5, 3), { accepted: false });
  assert.deepEqual(control.reviewedVoice, accepted);
  assert.deepEqual(control.reviewVoice(model, voice, 5, 3), { accepted: false });
  assert.equal(control.reviewedVoice, null);
  control.execute({ action: 'pause' });
  assert.throws(() => control.reviewVoice(model, voice, 5, 5), /invalid/);
});

test('voice API denies sample and reviewed playback without a backend credential', async t => {
  const savedKey = process.env.ABYSSINIA_TTS_KEY;
  delete process.env.ABYSSINIA_TTS_KEY;
  t.after(() => {
    if (savedKey !== undefined) process.env.ABYSSINIA_TTS_KEY = savedKey;
  });
  const stateDirectory = tempState(t);
  workspaceControl(stateDirectory).reviewVoice(model, voice, 4, 4);
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

  const output = await post({ action: 'voice.output' });
  assert.equal(output.status, 200);
  assert.equal(output.body.configured, false);
  assert.equal(output.body.reviewed.model, model);
  for (const action of ['voice.sample', 'voice.speak']) {
    assert.deepEqual(await post({ action, model, voice, text: speechScript, key: 'caller-key' }), {
      status: 409, body: { error: 'unavailable' },
    });
  }
  assert.deepEqual(await post({ action: 'voice.rate', native: true, ticket: 'invalid', naturalness: 5, clarity: 5 }), {
    status: 409, body: { error: 'review' },
  });
});
