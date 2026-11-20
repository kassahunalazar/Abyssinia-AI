import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { createAssistant } from '../server.mjs';

test('Amharic round trip through the real Hermes agent and a deterministic model endpoint', {
  skip: !process.env.ASSISTANT_PYTHON || !process.env.ASSISTANT_HERMES_SOURCE,
}, async t => {
  const requests = [];
  const model = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      requests.push(JSON.parse(Buffer.concat(chunks)));
      if (requests.at(-1).stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        const send = (delta, finish_reason) => res.write('data: ' + JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          model: 'assistant-test-model',
          created: 1,
          choices: [{ index: 0, delta, finish_reason }],
        }) + '\n\n');
        send({ role: 'assistant', content: 'ሰላም፣ እንዴት ልርዳዎት?' }, null);
        send({}, 'stop');
        return res.end('data: [DONE]\n\n');
      }
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      model: 'assistant-test-model',
      created: 1,
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'ሰላም፣ እንዴት ልርዳዎት?' },
      }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    }));
  }).listen(0, '127.0.0.1');
  await once(model, 'listening');
  t.after(() => new Promise(resolve => model.close(resolve)));
  process.env.ASSISTANT_MODEL_URL = 'http://127.0.0.1:' + model.address().port + '/v1';
  process.env.ASSISTANT_MODEL_ID = 'assistant-test-model';
  delete process.env.ASSISTANT_MODEL_KEY;
  await mkdir('.runtime', { recursive: true });
  const server = createAssistant().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const prompt = 'ጤና ይስጥልኝ';
  const response = await fetch(origin + '/api/chat', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: prompt }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: 'ሰላም፣ እንዴት ልርዳዎት?' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].tools?.length ?? 0, 0);
  assert.ok(requests[0].messages.some(message => message.role === 'user' && message.content === prompt));
  assert.ok(requests[0].messages.some(message => message.role === 'system' && message.content.includes('everyday Amharic')));
});
