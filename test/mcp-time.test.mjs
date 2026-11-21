import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { browserCookie, testAssistant } from '../http-fixture.mjs';

test('gateway executes only the approved MCP time call and revokes rejected or cancelled requests', { timeout: 10000 }, async t => {
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
        return result({ tools: [{ name: 'get_current_time' }, { name: 'other_tool' }] });
      case 'tools/call':
        calls.push(request.params);
        if (request.params.name !== 'get_current_time') return res.writeHead(400).end();
        return result({ content: [{ type: 'text', text: JSON.stringify({ datetime }) }] });
      default:
        return res.writeHead(400).end();
    }
  });
  const app = testAssistant();
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
  async function post(action, fields = {}, expectedStatus = 200) {
    const response = await fetch(`${origin}/api/control`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...fields }),
    });
    assert.equal(response.status, expectedStatus);
    return response.json();
  }

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
  assert.deepEqual(calls, [{ name: 'get_current_time', arguments: { timezone } }]);
});
