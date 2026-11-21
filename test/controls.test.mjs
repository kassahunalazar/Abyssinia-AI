import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceControl } from '../workspace-control.mjs';
import { browserCookie, testAssistant } from '../http-fixture.mjs';
import { once } from 'node:events';

test('approval binds exact text, expires, prevents overwrite and survives pause safely', () => {
  const root = mkdtempSync(join(tmpdir(),'abyssinia-policy-'));
  let clock = 0;
  const c = workspaceControl(root,()=>clock);
  const propose = () => c.execute({ action:'propose', name:'ሰላም.txt', text:'saved once' }).id;
  const {workspace} = c.execute({action:'status'});
  const file = join(workspace,'ሰላም.txt');
  const id = propose();
  assert.equal(existsSync(file),false);
  c.execute({action:'approve',id,text:'altered'});
  assert.equal(readFileSync(file,'utf8'),'saved once');
  assert.throws(()=>c.execute({action:'approve',id}));
  assert.throws(()=>c.execute({action:'approve',id:propose()}));
  const expired = propose(); clock += 120001;
  assert.throws(()=>c.execute({action:'approve',id:expired}));
  const rejected = propose(); c.execute({action:'reject',id:rejected});
  assert.throws(()=>c.execute({action:'approve',id:rejected}));
  for(const name of ['../other.txt','NUL.txt','a:b.txt']) assert.throws(()=>c.execute({action:'propose',name,text:'x'}));
  const revoked=propose();
  const signal=c.begin(); c.execute({action:'pause'});
  assert.equal(signal.aborted,true); assert.equal(c.begin(),null);
  assert.equal(workspaceControl(root).paused,true);
  c.execute({action:'resume'});assert.throws(()=>c.execute({action:'approve',id:revoked}));
});

test('pause interrupts active HTTP turn and requires the local browser session', async t=>{
  let started;
  const running=new Promise(r=>{started=r});
  const app=testAssistant({reply:async (m,h,p,a,onRead,signal)=>{
    started(); await once(signal,'abort'); return 'late';
  }}).listen(0,'127.0.0.1');
  await once(app,'listening');t.after(()=>app.close());
  const origin='http://127.0.0.1:'+app.address().port;
  const cookie=await browserCookie(origin);
  function post(path,data,credential=cookie){return fetch(origin+path,{method:'POST',headers:{
    Origin:origin,Cookie:credential,'Content-Type':'application/json'},body:JSON.stringify(data)})}
  assert.equal((await post('/api/control',{action:'pause'},'')).status,401);
  const turn=post('/api/chat',{message:'wait'});await running;
  assert.equal((await post('/api/control',{action:'pause'})).status,200);
  assert.equal((await turn).status,423);
  assert.equal((await post('/api/chat',{message:'again'})).status,423);
});

test('reminders honor quiet hours, pause and hold, then deliver once',()=>{
  let clock = new Date(2026,10,20,21,59).getTime();
  const root=mkdtempSync(join(tmpdir(),'abyssinia-clock-'));
  let c=workspaceControl(root,()=>clock);
  const {id}=c.execute({action:'schedule',title:'ማስታወሻ',daily:true,next:clock+60000});
  c.execute({action:'quiet',enabled:true});clock+=60000;c.tick();
  assert.equal(c.execute({action:'heartbeat'}).notice,undefined);
  clock+=9*3600000;
  c.execute({action:'pause'});c.tick();assert.equal(c.execute({action:'heartbeat'}).notice,undefined);
  c.execute({action:'resume'});c.execute({action:'hold',id});c.tick();
  assert.equal(c.execute({action:'heartbeat'}).notice,undefined);
  c.execute({action:'release',id});c.tick();c.tick();
  c=workspaceControl(root,()=>clock);
  const s=c.execute({action:'status'});
  assert.equal(s.events.filter(e=>e.result==='delivered').length,1);
  assert.ok(s.reminders[0].next>clock);assert.equal(s.quiet,true);
  c.execute({action:'removeReminder',id});assert.deepEqual(c.execute({action:'status'}).reminders,[]);
});

test('scheduled research runs only when due and persists a result or failure',async()=>{
  let clock=new Date(2026,10,20,10).getTime();
  const root=mkdtempSync(join(tmpdir(),'abyssinia-job-'));
  let c=workspaceControl(root,()=>clock);
  const invoke=action=>c.execute({action});
  const add=(title,next,daily)=>c.execute({action:'schedule',title,next,daily,job:'research',language:'am'});
  add('renewable energy',clock+60000,true);
  const runs=[];
  const research=async(title,language)=>{
    runs.push([title,language]);
    return [{title:'Reference',url:'https://am.wikipedia.org/wiki/Reference'}];
  };
  await c.tick(research);
  assert.equal(runs.length,0);
  clock+=60000;
  invoke('pause');
  await c.tick(research);
  assert.equal(runs.length,0);
  invoke('resume');
  await c.tick(research);
  c=workspaceControl(root,()=>clock);
  let [row]=invoke('status').reminders;
  assert.deepEqual(runs,[['renewable energy','am']]);
  assert.equal(row.jobResult.sources[0].title,'Reference');
  assert.equal(new Date(row.next).getDate(),21);
  add('failure',clock+1000,false);
  clock+=1000;
  await c.tick(async()=>{throw Error('test');});
  row=invoke('status').reminders.find(item=>item.title==='failure');
  assert.equal(row.jobResult.status,'failed');
  assert.equal(row.next,null);
});
