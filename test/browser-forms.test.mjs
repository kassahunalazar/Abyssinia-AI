import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { edgeExecutable, edgeUrl, openEdgeForm } from '../edge-browser.mjs';
import { browserCookie, testAssistant } from '../http-fixture.mjs';

test('browser forms accept public HTTPS pages without credentials or custom transports', () => {
  assert.equal(edgeUrl('https://example.com/form?a=1'), 'https://example.com/form?a=1');
  for (const bad of ['http://127.0.0.1/form','https://127.0.0.1/form','https://localhost/form',
    'https://user@example.com/form','https://example.com:9443/form','file:///C:/Users/test.html'])
    assert.throws(()=>edgeUrl(bad),/invalid/);
});

test('isolated Edge applies only reviewed field actions and submits the exact previewed standard form',
  {skip:process.platform!=='win32'||!edgeExecutable(),timeout:60000},async t=>{
    const requests = [];
    let formUrl;
    const fixture = createServer(async (req,res)=>{
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      requests.push({method:req.method,path:req.url,body:Buffer.concat(chunks).toString('utf8')});
      res.setHeader('Content-Type','text/html; charset=utf-8');
      if (req.url==='/submit') return res.end('<title>Submitted</title><h1>Submitted</h1>');
      res.end('<title>Contact form</title><script>fetch("'+formUrl+'blocked"); window.open("'+formUrl+'popup");</script>'+
        '<img src="'+formUrl+'image"><iframe src="'+formUrl+'frame"></iframe>'+
        '<form method="post" action="/submit"><label>Name<input name="name" required></label>'+
        '<label>Keep<input name="keep" type="checkbox"></label><button>Submit</button></form>'+
        '<form method="post" action="/blocked"><label>Password<input type="password" name="password"></label>'+
        '<input name="hidden" type="hidden" value="secret"><input type="file" name="upload"><button>Hidden fields</button></form>');
    }).listen(0,'127.0.0.1');
    await once(fixture,'listening');
    formUrl = 'http://127.0.0.1:'+fixture.address().port+'/';
    t.after(()=>new Promise(resolve=>fixture.close(resolve)));
    const app = testAssistant({formOptions:{normalize:url=>edgeUrl(url,true),open:(url,signal)=>openEdgeForm(url,signal,{allowLocal:true,headless:true})},
      async reply(_message,_history,_provider,_attachment,_read,_signal,_delta,_schedule,extension) {
        assert.equal(extension.capability.name,'request_browser_field');
        extension.onAction({value:'አማርኛ'});
        return 'Review the requested field change.';
      },
    }).listen(0,'127.0.0.1');
    await once(app,'listening');
    t.after(()=>new Promise(resolve=>app.close(resolve)));
    const origin = 'http://127.0.0.1:'+app.address().port;
    const cookie = await browserCookie(origin);
    const send = async (path,body)=>{
      const response = await fetch(origin+path,{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},
        body:JSON.stringify(body)});
      return {status:response.status,...(await response.json())};
    };
    const api = (action,body) => send('/api/control',{action,...body});
    const opening = await api('browserForm.open',{url:formUrl});
    assert.equal(opening.status,200);
    assert.deepEqual(requests,[]);
    const opened = await api('approve',{id:opening.id});
    assert.equal(opened.status,200);
    const page = opened.browserForm.page;
    assert.equal(page.title,'Contact form');
    assert.deepEqual(page.controls.map(({label})=>label),['Name','Keep','Submit','Hidden fields']);
    const [name,keep,submit,hidden] = page.controls;
    const propose = (control,value='') => api('browserForm.action',{page:page.id,control:control.id,value});
    const requested = await send('/api/chat',{message:'Fill this field',scope:{name:'browserForm',target:page.id,control:name.id}});
    assert.equal(requested.status,200);
    assert.equal((await api('approve',{id:requested.approval})).browserForm.last.applied,true);
    assert.equal((await api('approve',{id:requested.approval})).status,409);
    assert.equal((await propose(hidden)).status,409);
    const stale = await propose(submit);
    const checking = await propose(keep,'true');
    assert.equal((await api('approve',{id:checking.id})).browserForm.last.applied,true);
    assert.equal((await api('approve',{id:stale.id})).status,409);
    assert.deepEqual(requests,[{method:'GET',path:'/',body:''}]);
    const submission = await propose(submit);
    const review = (await api('status')).approvals.find(item=>item.id===submission.id);
    assert.match(review.text,/POST .*\/submit\n"name" = "አማርኛ"\n"keep" = "on"/u);
    const submitted = await api('approve',{id:submission.id,value:'modified'});
    assert.equal(submitted.status,200);
    assert.equal(submitted.browserForm.page.title,'Submitted');
    assert.deepEqual(requests,[{method:'GET',path:'/',body:''},{method:'POST',path:'/submit',
      body:new URLSearchParams({name:'አማርኛ',keep:'on'}).toString()}]);
    assert.equal((await api('browserForm.close')).active,false);
  });
