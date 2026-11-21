import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { workspaceControl } from '../workspace-control.mjs';

const panel = { pid: 41, handle: '900', title: 'Synthetic panel', process: 'demo', started: '100' };
const other = { pid: 42, handle: '901', title: 'Other panel', process: 'demo', started: '101' };

function createControl(perform = async () => ({})) {
  const calls = [];
  const root = mkdtempSync(join(tmpdir(), 'abyssinia-desktop-'));
  const control = workspaceControl(root, Date.now, async (operation, window, signal) => {
    calls.push({ operation, window });
    return operation === 'list' ? [panel, other] : perform(signal);
  });
  return { execute: (action, fields) => control.execute({ action, ...fields }), calls };
}

test('desktop approval binds the selected window and operation once', async () => {
  const { execute, calls } = createControl();
  assert.throws(() => execute('desktop.list'), /unavailable/);
  execute('desktop.enable');
  const { windows } = await execute('desktop.list');
  const { id } = execute('desktop.propose', { window: windows[0].id, operation: 'scrollDown' });
  assert.deepEqual(calls, [{ operation: 'list', window: null }]);
  await execute('approve', { id, window: windows[1].id, operation: 'focus' });
  assert.deepEqual(calls[1], { operation: 'scrollDown', window: panel });
  assert.throws(() => execute('approve', { id }), /expired/);

  const rejected = execute('desktop.propose', { window: windows[1].id, operation: 'focus' });
  execute('reject', rejected);
  assert.throws(() => execute('approve', rejected), /expired/);
  assert.equal(calls.length, 2);
});

test('disable and pause revoke desktop selections and approvals', async () => {
  const { execute, calls } = createControl(signal => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  execute('desktop.enable');
  const first = (await execute('desktop.list')).windows[0].id;
  const disabled = execute('desktop.propose', { window: first, operation: 'focus' });
  execute('desktop.disable');
  assert.throws(() => execute('approve', disabled), /expired/);
  assert.throws(() => execute('desktop.list'), /unavailable/);

  execute('desktop.enable');
  assert.throws(() => execute('desktop.propose', { window: first, operation: 'focus' }), /expired/);
  const second = (await execute('desktop.list')).windows[0].id;
  const pending = execute('desktop.propose', { window: second, operation: 'scrollUp' });
  const active = execute('desktop.propose', { window: second, operation: 'scrollDown' });
  const approval = execute('approve', active);
  execute('pause');
  await assert.rejects(approval, { name: 'AbortError' });
  assert.throws(() => execute('desktop.enable'), /unavailable/);
  execute('resume');
  assert.throws(() => execute('desktop.list'), /unavailable/);
  assert.throws(() => execute('approve', active), /expired/);
  assert.throws(() => execute('approve', pending), /expired/);
  assert.deepEqual(calls.map(call => call.operation), ['list', 'list', 'scrollDown']);
});

test('desktop text approval binds the control, exact Amharic value and one window', async () => {
  const editable={runtime:'42,1',name:'Fixture field',id:'text',class:'Edit',type:'ControlType.Edit',operation:'setText'};
  const called=[];
  const root=mkdtempSync(join(tmpdir(),'abyssinia-desktop-control-'));
  const control=workspaceControl(root,Date.now,async(operation,window,signal,parameters)=>{
    called.push({operation,window,parameters});
    if(operation==='list')return [panel,other];
    if(operation==='controls')return [editable];
    return {ok:true};
  });
  const execute=(action,data)=>control.execute({action,...data});
  execute('desktop.enable');
  const {windows}=await execute('desktop.list');
  const [window,another]=windows.map(item=>item.id);
  const selection=(await execute('desktop.controls',{window})).controls[0];
  assert.deepEqual(Object.keys(selection).sort(),['id','name','operation']);
  const request={control:selection.id,window,operation:'setText',text:'ሰላም'};
  assert.throws(()=>execute('desktop.propose',{...request,window:another}),/expired/);
  assert.throws(()=>execute('desktop.propose',{...request,operation:'invoke'}),/expired/);
  const stale=execute('desktop.propose',request);
  await execute('desktop.controls',{window});
  assert.throws(()=>execute('approve',stale),/expired/);
  const current=(await execute('desktop.controls',{window})).controls[0];
  const {id}=execute('desktop.propose',{...request,control:current.id});
  await execute('approve',{id,text:'changed',window:another,control:selection.id});
  assert.deepEqual(called.at(-1),{operation:'setText',window:panel,parameters:{control:editable,text:'ሰላም'}});
  assert.throws(()=>execute('approve',{id}),/expired/);
});
