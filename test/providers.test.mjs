import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    const names = (body.tools ?? []).map(tool=>tool.function.name);
    const results=body.messages.filter(m=>m.role==='tool');
    let toolName = !results.length && (names.includes('read_attached_text')?'read_attached_text':names[0]);
    if(names.includes('propose_source_edit') && results.length===1)toolName='propose_source_edit';
    if(names.includes('propose_project_edits') && results.length===1)toolName='propose_project_edits';
    const needTool = Boolean(toolName);
    const parameters={
      propose_reminder:{title:'ስብሰባ',when:new Date(Date.now()+86400000).toISOString().replace(/\.\d{3}Z$/,'Z'),daily:true},
      request_window_action:{operation:'focus'},
      confirm_tool_call:{code:'READY'},
      propose_source_edit:{text:'export const value = 2;\n'},
      propose_project_edits:{edits:[{path:'source.mjs',text:'export const value = 3;\n'},{path:'two.mjs',text:'export default 4;\n'}]},
      consult_specialist:{specialty:'coding',task:'Analyze this example'},
      todo_list:{todos:[{id:'one',content:'Review test',status:'pending'}]},
    };
    const args=JSON.stringify(parameters[toolName]??{});
    const choice = needTool ? { finish_reason:'tool_calls', message:{ tool_calls:[{
      type:'function', id:'read1', function:{name:toolName,arguments:args},
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
  const folder=realpathSync(mkdtempSync(join(tmpdir(),'abyssinia-model-source-')));
  const source=join(folder,'source.mjs');
  writeFileSync(source,'export const value = 1;\n');
  const app = createAssistant({pickFile:async()=>source,pickRepository:async()=>folder}).listen(0,'127.0.0.1');
  await Promise.all([once(endpoint,'listening'),once(app,'listening')]);
  t.after(() => { app.close(); endpoint.close(); });
  const origin = 'http://127.0.0.1:' + app.address().port;
  const cookie = await browserCookie(origin);
  const provider = {kind:'custom', url:'http://127.0.0.1:'+endpoint.address().port+'/v1', model:'fixture'};
  const post = (path, data, accept='application/json') => fetch(origin+path,{method:'POST',headers:{Cookie:cookie,Origin:origin,Accept:accept,'Content-Type':'application/json'},body:JSON.stringify(data)});
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
  const draft=await (await post('/api/chat',{provider,message:'Remind me daily at noon to check the agenda',conversation:null})).json();
  assert.equal(draft.reminder.title,'ስብሰባ');
  assert.equal(draft.reminder.daily,true);
  assert.deepEqual(requests[3].tools.map(t=>t.function.name),['propose_reminder']);
  assert.equal(requests[4].messages.at(-1).role,'tool');
  const check=await post('/api/chat',{provider,message:'መስኮቱን ወደፊት አምጣ',scope:{name:'desktop',target:'no-active-grant'}});
  assert.equal(check.status,409);
  assert.deepEqual(requests[5].tools.map(t=>t.function.name),['request_window_action']);
  assert.equal(requests[6].messages.at(-1).role,'tool');
  const status=await (await post('/api/control',{action:'status'})).json();
  assert.equal(status.reminders.length,0);
  assert.equal((await post('/api/provider/test',{provider,mode:'tools'})).status,200);
  assert.deepEqual(requests[7].tools.map(t=>t.function.name),['confirm_tool_call']);
  const grant=await (await post('/api/control',{action:'code.pick'})).json();
  const edit=await (await post('/api/chat',{provider,message:'Update my source file',scope:{name:'source',target:grant.grant}})).json();
  assert.ok(edit.approval, JSON.stringify(edit));
  assert.equal(readFileSync(source,'utf8'),'export const value = 1;\n');
  assert.equal((await post('/api/control',{action:'approve',id:edit.approval})).status,200);
  assert.equal(readFileSync(source,'utf8'),'export const value = 2;\n');
  const delegated=await (await post('/api/chat',{provider,message:'Ask a coding specialist',scope:{name:'specialist'}})).json();
  assert.equal(delegated.delegated,'coding');
  assert.equal(requests.at(-1).tools?.length ?? 0,0);
  const planned=await post('/api/chat',{provider,message:'Plan a code review',skill:'plan'},'application/x-ndjson');
  const events=(await planned.text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(events.at(-1).status,200);
  assert.ok(events.some(event=>event.activity?.name==='todo_list'), JSON.stringify(events));
  writeFileSync(join(folder,'two.mjs'),'export default 1;\n');
  const project=await (await post('/api/control',{action:'code.pickRepository'})).json();
  const library=await (await post('/api/control',{action:'skills.native'})).json();
  const selected=library.skills.find(item=>item.category==='software-development');
  const skill='hermes/'+selected.category+'/'+selected.name;
  const task=await post('/api/chat',{provider,message:'Fix both selected files',skill,scope:{name:'project',target:project.repository,paths:['source.mjs','two.mjs']}});
  assert.ok((await task.json()).approval);
  const review=await (await post('/api/control',{action:'status'})).json();
  assert.equal(review.approvals.length,2);
  for(const item of review.approvals){
    assert.equal(item.tool,'code.projectReplace');
    assert.equal((await post('/api/control',{action:'approve',id:item.id})).status,200);
  }
  assert.equal(readFileSync(source,'utf8'),'export const value = 3;\n');
  assert.equal(readFileSync(join(folder,'two.mjs'),'utf8'),'export default 4;\n');
});
