import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { readWikiArticle, wikiArticle } from '../browser-reader.mjs';
import { browserCookie, testAssistant } from '../http-fixture.mjs';

const url = 'https://en.wikipedia.org/wiki/Addis_Ababa';
const article = { url, title:'Addis Ababa', text:'Addis Ababa is the capital of Ethiopia.', links:[] };

test('article reader permits only exact Wikipedia articles and returns bounded plain text and article links', async () => {
  for (const bad of [
    'http://en.wikipedia.org/wiki/Addis_Ababa', 'https://127.0.0.1/wiki/Addis_Ababa',
    'https://en.wikipedia.org@127.0.0.1/wiki/Addis_Ababa', 'https://en.wikipedia.org:443/wiki/Addis_Ababa',
    'https://en.wikipedia.org/wiki/Addis_Ababa?redirect=yes', 'https://am.wikipedia.org/wiki/Special%3AUserLogin',
    'https://am.wikipedia.org/wiki/%2E%2E%2Fstate', 'https://en.wikipedia.org/wiki/%00',
    'https://en.wikipedia.org/wiki/Addis_Ababa%7CEthiopia',
  ]) assert.throws(() => wikiArticle(bad), /invalid/);
  assert.equal(wikiArticle('https://am.wikipedia.org/wiki/አዲስ_አበባ'),
    'https://am.wikipedia.org/wiki/' + encodeURIComponent('አዲስ_አበባ'));
  const signal = new AbortController().signal;
  const observed = await readWikiArticle(url, signal, async (endpoint, options) => {
    assert.equal(endpoint.origin, 'https://en.wikipedia.org');
    assert.equal(endpoint.pathname, '/w/api.php');
    assert.equal(endpoint.searchParams.get('titles'), 'Addis Ababa');
    assert.equal(endpoint.searchParams.has('redirects'), false);
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    return Response.json({query:{pages:[{ ns:0, title:'Addis Ababa', extract:'በኢትዮጵያ', links:[
      {ns:0,title:'Ethiopia'}, {ns:4,title:'Wikipedia:Help'}, {ns:0,title:'https://127.0.0.1/'},
    ] }]}});
  });
  assert.deepEqual(observed, { url, title:'Addis Ababa', text:'በኢትዮጵያ', links:[
    {title:'Ethiopia',url:'https://en.wikipedia.org/wiki/Ethiopia'},
  ] });
  await assert.rejects(readWikiArticle(url, signal, () => Response.json({query:{pages:[
    {ns:0,title:'Different page',extract:'Unexpected'},
  ]}})), /upstream/);
  await assert.rejects(readWikiArticle(url, signal, () => Response.json({ value:'x'.repeat(1024*1024) })), /upstream/);
});

test('reading a browser article from Hermes or the workspace requires one approval for the exact selection', async t => {
  const requested = [];
  let toolArgs = { read:true };
  const server = testAssistant({
    async reply(_message,_history,_provider,_attachment,_read,_signal,_delta,_schedule,extension) {
      assert.equal(extension.capability.name,'request_article_read');
      assert.deepEqual(Object.keys(extension.capability.properties),['read']);
      extension.onAction(toolArgs);
      return 'Review the request';
    },
    async readArticle(target) { requested.push(target); return article; },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const cookie = await browserCookie(origin);
  const post = async (path, body) => {
    const response = await fetch(origin + path, {method:'POST', headers:{Cookie:cookie, Origin:origin, 'Content-Type':'application/json'},
      body:JSON.stringify(body)});
    return {status:response.status, ...(await response.json())};
  };
  const control = (action, data) => post('/api/control', {action,...data});
  const chat = target => post('/api/chat', {message:'Read the selected page',scope:{name:'browser',target}});
  assert.equal((await chat('https://localhost/wiki/Addis_Ababa')).status,400);
  toolArgs = {read:true,url:'https://en.wikipedia.org/wiki/Ethiopia'};
  assert.equal((await chat(url)).status,422);
  toolArgs = {read:true};
  const pending = await chat(url);
  assert.equal(pending.status,200);
  const status = await control('status');
  assert.equal(status.approvals.find(row => row.id === pending.approval).target,url);
  assert.deepEqual(requested,[]);
  assert.deepEqual(await control('approve',{id:pending.approval,url:'https://en.wikipedia.org/wiki/Ethiopia'}),
    {status:200,browserPage:article});
  assert.equal((await control('approve',{id:pending.approval})).status,409);
  const rejected = await control('browser.propose',{url});
  assert.equal((await control('reject',{id:rejected.id})).status,200);
  assert.equal((await control('approve',{id:rejected.id})).status,409);
  const paused = await control('browser.propose',{url});
  await control('pause');
  assert.equal((await control('approve',{id:paused.id})).status,409);
  assert.deepEqual(requested,[url]);
});
