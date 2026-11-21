import assert from 'node:assert/strict';
import {test} from 'node:test';
import {once} from 'node:events';
import {browserCookie,testAssistant} from '../http-fixture.mjs';
test('Amharic chat previews a local reminder, saves once on confirmation and lists it',async t=>{
  const server=testAssistant({reply:()=>{throw Error('Unexpected model request')}}).listen(0,'127.0.0.1');
  await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const origin='http://127.0.0.1:'+server.address().port,cookie=await browserCookie(origin);
  const post=async(path,data)=>(await fetch(origin+path,{method:'POST',headers:{origin,cookie,'Content-Type':'application/json'},body:JSON.stringify(data)})).json();
  const chat=message=>post('/api/chat',{message,conversation:null,provider:{kind:'none'}});
  const control=(action,data={})=>post('/api/control',{action,...data});
  const {reminder}=await chat('ከአምስት ደቂቃ በኋላ ውሃ መጠጣት አስታውሰኝ።');
  assert.equal(reminder.title,'ውሃ መጠጣት');assert.ok(Math.abs(reminder.next-Date.now()-300000)<5000);
  assert.equal((await control('status')).reminders.length,0);
  const params={...reminder,draft:reminder.id};
  assert.deepEqual(await control('schedule',params),await control('schedule',params));
  assert.equal((await control('status')).reminders.length,1);
  assert.match((await chat('ማስታወሻዎቼን አሳየኝ')).reply,/ውሃ መጠጣት/);
});
