import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { discoverMcp, mcpEndpoint } from '../mcp-connections.mjs';

const version = '2025-06-18';
const session = 'synthetic-session';

function reply(res, request, result, headers = {}) {
  res.writeHead(200, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: request.body.id, result }));
}

async function serve(t, respond) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const request = { method: req.method, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
    requests.push(request);
    respond(res, request);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return { endpoint: `http://127.0.0.1:${server.address().port}/mcp`, requests };
}

function handshake(res, request) {
  if (request.body?.method === 'initialize') {
    reply(res, request, { protocolVersion: version, capabilities: { tools: {}, resources: {} } }, {
      'Mcp-Session-Id': session,
    });
    return true;
  }
  if (request.body?.method === 'notifications/initialized' || request.method === 'DELETE') {
    res.writeHead(request.method === 'DELETE' ? 204 : 202).end();
    return true;
  }
  return false;
}

test('MCP discovery initializes, lists paginated metadata, and closes the session', async t => {
  const { endpoint, requests } = await serve(t, (res, request) => {
    if (handshake(res, request)) return;
    if (request.body.method !== 'tools/list') return res.writeHead(400).end();
    if (request.body.params.cursor) return reply(res, request, { tools: [{ name: 'second' }] });

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    res.write('data: {"jsonrpc":"2.0","id":"server-request","method":"sampling/createMessage"}\r\n\r\n');
    const result = { tools: [{ name: 'first', description: 'unused metadata' }], nextCursor: 'page-two' };
    res.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: request.body.id, result })}\r\n\r\n`);
  });

  assert.deepEqual(await discoverMcp(endpoint, new AbortController().signal), {
    tools: ['first', 'second'], capabilities: ['tools', 'resources'],
  });
  assert.deepEqual(requests.map(req => [req.method, req.body?.method]), [
    ['POST', 'initialize'], ['POST', 'notifications/initialized'],
    ['POST', 'tools/list'], ['POST', 'tools/list'], ['DELETE', undefined],
  ]);
  assert.equal(requests[0].body.params.protocolVersion, version);
  assert.equal(requests[1].body.id, undefined);
  assert.deepEqual(requests[2].body.params, {});
  assert.deepEqual(requests[3].body.params, { cursor: 'page-two' });
  for (const request of requests.slice(1)) {
    assert.equal(request.headers['mcp-session-id'], session);
    assert.equal(request.headers['mcp-protocol-version'], version);
  }
});

test('MCP discovery bounds endless pagination and closes its session on failure', async t => {
  const { endpoint, requests } = await serve(t, (res, request) => {
    if (handshake(res, request)) return;
    reply(res, request, { tools: [], nextCursor: 'repeated' });
  });

  await assert.rejects(discoverMcp(endpoint, new AbortController().signal), /limit/);
  const pages = requests.filter(req => req.body?.method === 'tools/list');
  assert.ok(pages.length <= 9);
  assert.equal(requests.at(-1).method, 'DELETE');
});

test('MCP discovery rejects oversized bodies and propagates JSON-RPC errors', async t => {
  for (const [kind, error] of [['large body', /limit/], ['JSON-RPC error', /protocol/]]) {
    await t.test(kind, async subtest => {
      const { endpoint, requests } = await serve(subtest, (res, request) => {
        if (handshake(res, request)) return;
        if (kind === 'large body') return reply(res, request, { tools: [], padding: 'a'.repeat(262145) });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: request.body.id, error: { code: -32603, message: 'synthetic error' } }));
      });
      await assert.rejects(discoverMcp(endpoint, new AbortController().signal), error);
      assert.deepEqual(requests.map(req => req.body?.method ?? req.method), [
        'initialize', 'notifications/initialized', 'tools/list', 'DELETE',
      ]);
    });
  }
});

test('MCP discovery denies endpoints outside its explicit loopback scope', async () => {
  for (const endpoint of [
    'https://127.0.0.1:8080/mcp', 'http://localhost:8080/mcp', 'http://192.0.2.1:8080/mcp',
    'http://user:secret@127.0.0.1:8080/mcp', 'http://127.0.0.1:8080/mcp?q=hidden',
    'http://127.0.0.1:8080/mcp#fragment', 'http://127.0.0.1:8080/', 'http://127.0.0.1/mcp',
  ]) {
    assert.throws(() => mcpEndpoint(endpoint), /invalid/);
    await assert.rejects(discoverMcp(endpoint, new AbortController().signal), /invalid/);
  }
});
