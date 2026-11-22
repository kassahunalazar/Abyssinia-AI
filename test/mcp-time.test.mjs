import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { browserCookie, testAssistant } from '../http-fixture.mjs';

test('gateway approves bounded MCP calls and revokes rejected or cancelled requests', { timeout: 10000 }, async t => {
  const timezone = 'Africa/Nairobi';
  const datetime = '2026-11-21T13:20:00+03:00';
  const calls = [];
  const pausedDuringListing = Promise.withResolvers();
  let holdListing = false;
  const mcp = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (req.method === 'DELETE') return res.writeHead(204).end();
    const request = JSON.parse(body);
    const result = data => res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: data }));
    switch (request.method) {
      case 'initialize':
        res.setHeader('Mcp-Session-Id', 'time-fixture');
        return result({ protocolVersion: '2025-06-18', capabilities: { tools: {} } });
      case 'notifications/initialized':
        return res.writeHead(202).end();
      case 'tools/list':
        if (holdListing) return pausedDuringListing.resolve();
        return result({ tools: [{ name: 'get_current_time' }, { name: 'add' }, { name: 'read_file' }, { name: 'run_shell' }] });
      case 'tools/call':
        calls.push(request.params);
        if (request.params.name === 'add') {
          const { a, b } = request.params.arguments;
          return result({ content: [{ type: 'text', text: String(a + b) }] });
        }
        if (request.params.name !== 'get_current_time') return res.writeHead(400).end();
        return result({ content: [{ type: 'text', text: JSON.stringify({ datetime }) }] });
      default:
        return res.writeHead(400).end();
    }
  });
  let modelArguments;
  const modelRequests = [];
  const app = testAssistant({ reply: async (...args) => {
    const options = args[8];
    modelRequests.push(options);
    options.onAction(modelArguments);
    return 'Fixture proposed an action';
  } });
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
  async function request(path, data, expectedStatus) {
    const response = await fetch(`${origin}/api/${path}`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    assert.equal(response.status, expectedStatus);
    return response.json();
  }
  const post = (action, fields = {}, status = 200) => request('control', { action, ...fields }, status);

  const url = `http://127.0.0.1:${mcp.address().port}/time`;
  const { id: connection } = await post('mcp.add', { name: 'Local time fixture', url });
  const propose = () => post('mcp.time', { id: connection, timezone });
  await post('mcp.time', { id: connection, timezone }, 409);
  await post('mcp.check', { id: connection });
  await post('mcp.time', { id: connection, timezone: 'Not/A_Time_Zone' }, 409);
  const rejected = await propose();
  await post('reject', rejected);
  await post('approve', rejected, 409);
  const disabled = await propose();
  await post('mcp.toggle', { id: connection });
  await post('approve', disabled, 409);
  await post('mcp.toggle', { id: connection });

  const approved = await propose();
  assert.deepEqual(calls, []);
  const status = await post('status');
  const approval = status.approvals.find(item => item.id === approved.id);
  assert.equal(approval.tool, 'mcp.get_current_time');
  assert.equal(approval.target, url);
  assert.deepEqual(JSON.parse(approval.text), { timezone });
  assert.deepEqual(await post('approve', { ...approved, timezone: 'UTC', tool: 'other_tool' }), { datetime, timezone });
  await post('approve', approved, 409);

  assert.deepEqual(status.connections[0].callable.map(tool => tool.name), ['get_current_time', 'add']);
  for (const tool of ['read_file', 'run_shell']) {
    await post('mcp.call', { id: connection, tool, arguments: { path: 'private.txt' } }, 409);
  }
  await post('mcp.call', { id: connection, tool: 'add', arguments: { a: '2', b: 3 } }, 409);
  await post('mcp.call', { id: connection, tool: 'add', arguments: { a: 2, b: 3, extra: true } }, 409);
  const addition = await post('mcp.call', { id: connection, tool: 'add', arguments: { a: 2, b: 3 } });
  const arithmeticStatus = await post('status');
  const reviewedAddition = arithmeticStatus.approvals.find(item => item.id === addition.id);
  assert.equal(reviewedAddition.target, url);
  assert.equal(reviewedAddition.tool, 'mcp.add');
  assert.deepEqual(JSON.parse(reviewedAddition.text), { a: 2, b: 3 });
  assert.deepEqual(await post('approve', { ...addition, arguments: { a: 8, b: 9 }, tool: 'run_shell' }), {
    mcpResult: { tool: 'add', text: '5' },
  });

  const chat = (tool, status = 200) => request('chat', {
    message: 'Add 6 and 7', conversation: null, scope: { name: 'mcp', target: connection, tool }, skill: 'plan',
  }, status);
  modelArguments = { a: 6, b: 7 };
  await chat('run_shell', 409);
  assert.equal(modelRequests.length, 0);
  const fromChat = await chat('add');
  assert.deepEqual(modelRequests[0].capability.properties, {
    a: { type: 'number', minimum: -1e12, maximum: 1e12 },
    b: { type: 'number', minimum: -1e12, maximum: 1e12 },
  });
  assert.equal(modelRequests[0].capability.name, 'request_mcp_call');
  assert.equal(modelRequests[0].nativeToolset, undefined);
  assert.equal(calls.length, 2);
  assert.deepEqual(await post('approve', { id: fromChat.approval }), { mcpResult: { tool: 'add', text: '13' } });
  modelArguments = { a: 6, b: 7, tool: 'run_shell' };
  const invalid = await chat('add', 409);
  assert.equal(invalid.approval, undefined);

  const cancelled = await propose();
  const outstanding = await propose();
  holdListing = true;
  const inFlight = post('approve', cancelled, 409);
  await pausedDuringListing.promise;
  await post('pause');
  await inFlight;
  await post('resume');
  await post('approve', cancelled, 409);
  await post('approve', outstanding, 409);
  const audited = (await post('status')).events;
  assert.deepEqual(audited.filter(event => event.approval === addition.id).map(({ result, target, arguments: args }) => [result, target, args]), [
    ['completed', url, { a: 2, b: 3 }], ['approved', url, { a: 2, b: 3 }], ['requested', url, { a: 2, b: 3 }],
  ]);
  assert.ok(audited.some(event => event.approval === cancelled.id && event.result === 'interrupted'));
  assert.ok(audited.some(event => event.approval === outstanding.id && event.result === 'cancelled'));
  assert.deepEqual(calls, [
    { name: 'get_current_time', arguments: { timezone } },
    { name: 'add', arguments: { a: 2, b: 3 } },
    { name: 'add', arguments: { a: 6, b: 7 } },
  ]);
});
