import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {browserCookie} from '../http-fixture.mjs';
import {createAssistant} from '../server.mjs';
import {runProjectTests} from '../project-tests.mjs';

test('project task reads two files, previews independent diffs, and executes the approved test before and after repair',async t=>{
  const base=realpathSync(mkdtempSync(join(tmpdir(),'abyssinia-project-workflow-')));
  const repo=join(base,'repo');mkdirSync(repo);
  const paths=['left.mjs','right.mjs'];
  const fixes=paths.map((path,index)=>({path,text:'export default '+(index+1)+';'}));
  for(const path of paths)writeFileSync(join(repo,path),'export default 0;');
  writeFileSync(join(repo,'sum.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import a from './left.mjs';import b from './right.mjs';test('sum',()=>assert.equal(a+b,3));");
  const reply=async(message,history,provider,attachment,read,signal,delta,schedule,extension)=>{
    assert.equal(extension.capability.name,'propose_project_edits');
    assert.deepEqual(JSON.parse(attachment.text).map(file=>file.path),paths);
    read();extension.onAction({edits:message==='wrong'?[{path:'other.mjs',text:'bad'}]:fixes});return 'draft';
  };
  const app=createAssistant({stateDirectory:join(base,'state'),reply,pickRepository:async()=>repo}).listen(0,'127.0.0.1');
  await once(app,'listening');
  t.after(async()=>{await new Promise(resolve=>app.close(resolve));rmSync(base,{recursive:true,force:true});});
  const origin='http://127.0.0.1:'+app.address().port,cookie=await browserCookie(origin);
  async function post(path,data,status=200){
    const response=await fetch(origin+path,{method:'POST',headers:{origin,cookie,'Content-Type':'application/json'},body:JSON.stringify(data)});
    const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;
  }
  const control=(action,fields,status)=>post('/api/control',{action,...fields},status);
  const {repository}=await control('code.pickRepository');
  const run=async()=>{const request=await control('code.test',{repository,paths:[...paths,'sum.test.mjs']});return (await control('approve',request)).tests;};
  const initial=await run();assert.equal(initial.passed,false);assert.equal(initial.rows[0].name,'sum');
  const scope={name:'project',target:repository,paths};
  await post('/api/chat',{message:'wrong',scope},409);
  assert.deepEqual((await control('status')).approvals,[]);
  const task=await post('/api/chat',{message:'repair',scope});
  const {approvals}=await control('status');
  assert.equal(task.approval,approvals[0].id);assert.equal(approvals.length,2);
  for(const item of approvals){
    assert.equal(readFileSync(item.target,'utf8'),item.before);
    await control('approve',{id:item.id});await control('approve',{id:item.id},409);
  }
  assert.deepEqual(await run(),{passed:true,rows:[{name:'sum',passed:true}]});
});

test('isolated runner rejects unavailable host APIs, empty suites and unsupported async tests',async()=>{
  for(const text of ["import 'node:fs';","export const empty=true;","import test from 'node:test';test('async',async()=>{});"]){
    const result=await runProjectTests([{path:'unit.test.js',text}],new AbortController().signal);
    assert.equal(result.passed,false);
  }
});
