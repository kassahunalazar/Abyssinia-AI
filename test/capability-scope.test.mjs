import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { browserCookie, testAssistant } from '../http-fixture.mjs';
import { skills } from '../web/capability-catalog.js';

test('chat scopes bind an approved MCP lookup to the user-selected connector', { timeout: 10000 }, async t => {
  const timezone = 'Africa/Nairobi';
  const datetime = '2026-11-21T13:20:00+03:00';
  const calls = [];
  const modelRequests = [];
  const mcp = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const result = data => res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: data }));
    switch (request.method) {
      case 'initialize':
        return result({ protocolVersion: '2025-06-18', capabilities: { tools: {} } });
      case 'notifications/initialized':
        return res.writeHead(202).end();
      case 'tools/list':
        return result({ tools: [{ name: 'get_current_time' }] });
      case 'tools/call':
        calls.push({ endpoint: req.url, ...request.params });
        return result({ content: [{ type: 'text', text: JSON.stringify({ datetime }) }] });
      default:
        return res.writeHead(400).end();
    }
  });
  let other;
  const app = testAssistant({
    reply: async (...args) => {
      const extension = args[8];
      modelRequests.push(extension);
      if (extension.capability) extension.onAction({ timezone, target: other, name: 'other_tool' });
      return 'Model response';
    },
  });
  for (const server of [mcp, app]) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    }));
  }

  const origin = `http://127.0.0.1:${app.address().port}`;
  const cookie = await browserCookie(origin);
  async function post(path, data, status) {
    const response = await fetch(origin + path, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    assert.equal(response.status, status);
    return response.json();
  }
  const control = (action, data = {}, status = 200) => post('/api/control', { action, ...data }, status);
  const chat = (data, status = 200) => post('/api/chat', { message: 'What is the time in Nairobi?', ...data }, status);
  const endpoint = `http://127.0.0.1:${mcp.address().port}`;
  const { id: selected } = await control('mcp.add', { name: 'Selected clock', url: endpoint + '/selected' });
  ({ id: other } = await control('mcp.add', { name: 'Other clock', url: endpoint + '/other' }));
  await control('mcp.check', { id: selected });
  await control('mcp.check', { id: other });
  const scope = { name: 'clock', target: selected };

  for (const skill of ['toString', 'custom system prompt']) {
    assert.deepEqual(await chat({ skill }, 400), { error: 'skill' });
  }
  assert.deepEqual(await chat({ scope, attachment: { name: 'note.txt', text: 'fixture' } }, 400), { error: 'scope' });
  assert.equal(modelRequests.length, 0);

  await chat({ skill: 'plan' });
  assert.equal(modelRequests[0].skill, skills.plan.guidance);
  assert.equal(modelRequests[0].capability, undefined);
  assert.deepEqual((await control('status')).approvals, []);

  const { approval } = await chat({ scope });
  assert.equal(modelRequests[1].capability.name, 'request_local_time');
  const [pending] = (await control('status')).approvals;
  assert.equal(pending.id, approval);
  assert.equal(pending.tool, 'mcp.get_current_time');
  assert.equal(pending.target, endpoint + '/selected');
  assert.deepEqual(calls, []);

  assert.deepEqual(await control('approve', { id: approval }), { datetime, timezone });
  await control('approve', { id: approval }, 409);
  assert.deepEqual(calls, [
    { endpoint: '/selected', name: 'get_current_time', arguments: { timezone } },
  ]);
});
