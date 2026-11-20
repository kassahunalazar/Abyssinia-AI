import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { testAssistant as createAssistant, browserCookie } from '../http-fixture.mjs';
import { resolveProvider } from '../providers.mjs';

test('credentials stay bound to their configured endpoint', () => {
  const env = { ASSISTANT_MODEL_URL: 'https://one.example/v1', ASSISTANT_MODEL_KEY: 'fixture' };
  assert.equal(resolveProvider({kind:'custom', url:env.ASSISTANT_MODEL_URL, model:'x'}, env).key, 'fixture');
  assert.equal(resolveProvider({kind:'custom', url:'https://two.example/v1', model:'x'}, env).key, undefined);
  assert.throws(() => resolveProvider({kind:'custom', url:'http://two.example/v1', model:'x'}, env));
});

test('custom endpoint through Hermes, scoped read, chat isolation and no-provider mode', { skip: !process.env.ASSISTANT_PYTHON || !process.env.ASSISTANT_HERMES_SOURCE }, async t => {
  const requests = [];
  const endpoint = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.setHeader('Content-Type','application/json');
      return res.end(JSON.stringify({data:[]}));
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    requests.push(body);
    const needTool = body.tools?.length && !body.messages.some(m => m.role === 'tool');
    const choice = needTool ? { finish_reason:'tool_calls', message:{ tool_calls:[{
      type:'function', id:'read1', function:{name:'read_attached_text',arguments:'{}'},
    }] } } : { finish_reason:'stop', message:{content:'fixture answer'} };
    if (body.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      const delta = {...choice.message};
      if (delta.tool_calls) delta.tool_calls[0].index = 0;
      for (const [piece, stop] of [[delta,null],[{},choice.finish_reason]]) {
        res.write('data: '+JSON.stringify({id:'fixture',model:'fixture',object:'chat.completion.chunk',created:1,choices:[{index:0,delta:piece,finish_reason:stop}]})+'\n\n');
      }
      return res.end('data: [DONE]\n\n');
    }
    res.end(JSON.stringify({choices:[choice]}));
  }).listen(0,'127.0.0.1');
  const app = createAssistant().listen(0,'127.0.0.1');
  await Promise.all([once(endpoint,'listening'),once(app,'listening')]);
  t.after(() => { app.close(); endpoint.close(); });
  const origin = 'http://127.0.0.1:' + app.address().port;
  const cookie = await browserCookie(origin);
  const provider = {kind:'custom', url:'http://127.0.0.1:'+endpoint.address().port+'/v1', model:'fixture'};
  const post = (path, data) => fetch(origin+path,{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
  assert.equal((await post('/api/provider/test',{provider})).status,200);
  const data = {message:'read it',conversation:null,provider,attachment:{name:'note.txt',text:'fixture marker'}};
  const first = await (await post('/api/chat',data)).json();
  assert.equal(first.reply,'fixture answer');
  assert.equal(first.tool,'read_attached_text');
  assert.equal(requests[1].messages.some(m=>m.content==='fixture marker'),false);
  assert.equal(requests[2].messages.at(-1).role,'tool');
  assert.match(requests[2].messages.at(-1).content,/fixture marker/);
  assert.equal((await post('/api/chat',{message:'again',conversation:first.conversation,provider:{...provider,model:'another'}})).status,409);
  assert.equal((await post('/api/chat',{message:'hello',provider:{kind:'none'}})).status,409);
  assert.equal(requests.length,3);
});
