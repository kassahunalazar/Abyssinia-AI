import { randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { snapshotFile, replaceReviewed } from './code-workspace.mjs';
import { mcpEndpoint } from './mcp-connections.mjs';
import { windowAction } from './desktop-control.mjs';

export function workspaceControl(directory, now = Date.now, desktop = windowAction) {
  directory = resolve(directory);
  mkdirSync(directory, { recursive: true });
  const workspace = join(directory, 'documents');
  const stateFile = join(directory, 'activity.json');
  let state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { paused: false, events: [] };
  const pending = new Map();
  let grant;
  function revokeEdits() {
    for (const [id,item] of pending) if (item.tool === 'code.replace') {
      pending.delete(id); record(item.tool,'cancelled',item.target);
    }
    grant=undefined;
  }
  let active;
  let desktopEnabled=false;
  let desktopBusy=false;
  const windows=new Map();
  function revokeDesktop() {
    desktopEnabled=false;windows.clear();
    if(desktopBusy)active?.abort();
    for(const [id,item] of pending)if(item.tool.startsWith('window.')){
      pending.delete(id);record(item.tool,'cancelled',item.target);
    }
  }
  function record(action, result, target = '', paused = state.paused, changes = {}) {
    const event = { time: new Date(now()).toISOString(), action, result, target };
    const next = { ...state, ...changes, paused, events: [...state.events.slice(-199), event] };
    writeFileSync(stateFile + '.tmp', JSON.stringify(next), { mode: 0o600 });
    renameSync(stateFile + '.tmp', stateFile);
    state = next;
  }
  function expire() {
    for (const [id, item] of pending) if (item.expires <= now()) {
      pending.delete(id); record(item.tool, 'expired', item.target);
    }
  }
  return {
    get paused() { return state.paused; },
    begin() {
      if (state.paused || active) return null;
      active = new AbortController();
      return active.signal;
    },
    end() { active = undefined; },
    record,
    get reviewedVoice(){return state.reviewedVoice??null;},
    reviewVoice(model,voice,naturalness,clarity) {
      if(state.paused||![naturalness,clarity].every(n=>Number.isInteger(n)&&n>=1&&n<=5))throw Error('invalid');
      const accepted=Math.min(naturalness,clarity)>=4;
      const review={model,voice,naturalness,clarity,reviewed:now()};
      const reviewedVoice=accepted?review:state.reviewedVoice?.model===model&&state.reviewedVoice?.voice===voice?null:state.reviewedVoice??null;
      record('voice.review',accepted?'approved':'rejected',model+'/'+voice,state.paused,{reviewedVoice,lastVoiceReview:review});
      return {accepted};
    },
    connection(id) {
      const c=state.connections?.find(c=>c.id===id);
      if(!c?.enabled||state.paused)throw Error('unavailable');
      return c;
    },
    discovery(id,result) {
      const c=state.connections?.find(c=>c.id===id);
      if(!c?.enabled || state.paused)return;
      const connections=state.connections.map(row=>row.id!==id?row:{...row,...result,checked:now()});
      record('mcp.list',result.error?'failed':'completed',c.name,state.paused,{connections});
    },
    grantFile(path) {
      if (state.paused) throw Error('unavailable');
      const {text,fileId}=snapshotFile(path);
      revokeEdits();
      grant={id:randomUUID(),path,fileId,undo:null};
      record('code.grant','approved',path);
      return {grant:grant.id,target:path,text};
    },
    tick() {
      if (state.paused) return;
      const hour = new Date(now()).getHours();
      if (state.quiet && (hour >= 22 || hour < 7)) return;
      const due = (state.reminders ?? []).find(r => r.status === 'scheduled' && r.next <= now());
      if (!due) return;
      const reminders = state.reminders.map(r => r.id !== due.id ? r : { ...r, last: now(),
        status: r.daily ? 'scheduled' : 'delivered', next: r.daily ? nextDay(r.next, now()) : null });
      record('reminder', 'delivered', due.title, false, { reminders });
    },
    execute(data) {
      expire();
      switch (data.action) {
      case 'heartbeat':
        return { paused: state.paused, notice: state.events.findLast(e=>e.action==='reminder' && e.result==='delivered') };
      case 'status':
        return { paused: state.paused, running: Boolean(active), workspace,
          codeTarget:grant?.path, canUndo:Boolean(grant?.undo),
          desktopEnabled,
          connections:state.connections??[],
          approvals: [...pending.values()], events: state.events.slice().reverse(), reminders: state.reminders ?? [], quiet: !!state.quiet };
      case 'quiet':
        if (typeof data.enabled !== 'boolean') throw Error('invalid');
        record('quiet_hours', data.enabled ? 'enabled' : 'disabled', '', state.paused, { quiet: data.enabled }); return {};
      case 'voice.disable':
        record('voice','disabled','',state.paused,{reviewedVoice:null});return {};
      case 'desktop.enable':
        if(state.paused)throw Error('unavailable');
        desktopEnabled=true;record('desktop','enabled');return {};
      case 'desktop.disable':
        revokeDesktop();record('desktop','disabled');return {};
      case 'desktop.list': {
        if(!desktopEnabled||state.paused||active)throw Error('unavailable');
        const signal=this.begin();desktopBusy=true;
        return desktop('list',null,signal).then(rows=>{
          signal.throwIfAborted();windows.clear();
          const result=rows.map(w=>{const id=randomUUID();windows.set(id,w);return {id,title:w.title,process:w.process};});
          return {windows:result};
        }).finally(()=>{desktopBusy=false;this.end()});
      }
      case 'desktop.propose': {
        if(!desktopEnabled||state.paused||pending.size>=16||!['focus','scrollUp','scrollDown'].includes(data.operation))throw Error('invalid');
        const window=windows.get(data.window);if(!window)throw Error('expired');
        const item={id:randomUUID(),window,operation:data.operation,agent:'Abyssinia AI',tool:'window.'+data.operation,
          target:window.process+' · '+window.title+' · PID '+window.pid,text:data.operation,risk:'desktop control',expires:now()+120000};
        pending.set(item.id,item);record(item.tool,'requested',item.target);return {id:item.id};
      }
      case 'schedule': {
        const reminders = state.reminders ?? [];
        if (reminders.length >= 100 || typeof data.title !== 'string' || !data.title.trim() || data.title.length > 160 ||
            !Number.isSafeInteger(data.next) || data.next <= now() || data.next > now() + 315576000000 || typeof data.daily !== 'boolean') throw Error('invalid');
        const r = {id:randomUUID(), title:data.title.trim(), next:data.next, daily:data.daily, status:'scheduled'};
        record('reminder','scheduled',r.title,state.paused,{ reminders:[...reminders,r] }); return {id:r.id};
      }
      case 'mcp.add': {
        const list=state.connections??[];
        const url=mcpEndpoint(data.url);
        if(typeof data.name!=='string'||!data.name.trim() || data.name.length>80 || list.length>=16 || list.some(c=>c.url===url))throw Error('invalid');
        const c={id:randomUUID(),name:data.name.trim(),url,enabled:true,tools:[],capabilities:[]};
        record('mcp.add','approved',c.name,state.paused,{connections:[...list,c]});return {id:c.id};
      }
      case 'mcp.toggle':
      case 'mcp.remove': {
        const list=state.connections??[], c=list.find(x=>x.id===data.id);
        if(!c)throw Error('invalid');
        const connections=data.action==='mcp.remove'?list.filter(x=>x!==c):list.map(x=>x===c?{...x,enabled:!x.enabled}:x);
        record(data.action,'completed',c.name,state.paused,{connections});return {};
      }
      case 'hold':
      case 'release':
      case 'removeReminder': {
        const list = state.reminders ?? [];
        const r = list.find(x => x.id === data.id);
        if (!r || (data.action === 'hold' && r.status !== 'scheduled') || (data.action === 'release' && r.status !== 'held')) throw Error('invalid');
        const status = data.action === 'hold' ? 'held' : 'scheduled';
        const reminders = data.action === 'removeReminder' ? list.filter(x=>x.id!==r.id) : list.map(x=>x.id===r.id?{...x,status}:x);
        record('reminder',data.action==='removeReminder'?'deleted':status,r.title,state.paused,{reminders}); return {};
      }
      case 'pause':
        active?.abort();
        revokeDesktop();
        for (const item of pending.values()) record(item.tool, 'cancelled', item.target);
        grant=undefined;
        pending.clear(); record('agent', 'paused', '', true); return {};
      case 'resume':
        record('agent', 'resumed', '', false); return {};
      case 'code.close':
        revokeEdits(); return {};
      case 'code.read':
        if (!grant || state.paused) throw Error('unavailable');
        return {grant:grant.id,target:grant.path,text:snapshotFile(grant.path,grant.fileId).text};
      case 'code.propose':
      case 'code.undo': {
        if (!grant || data.grant!==grant.id || state.paused || pending.size>=16) throw Error('unavailable');
        const before=snapshotFile(grant.path,grant.fileId).text;
        const undo=data.action==='code.undo';
        const expected=undo?grant.undo?.after:data.before;
        const text=undo?grant.undo?.before:data.text;
        if(before!==expected) throw Error('stale');
        if(typeof text!=='string'||text===before||text.includes('\0')||Buffer.byteLength(text)>65536) throw Error('invalid');
        const item={id:randomUUID(),tool:'code.replace',agent:'AK Code Engine',risk:undo?'rollback':'replace source',
          grant:grant.id,target:grant.path,before,text,expires:now()+120000,undo};
        record(item.tool,'requested',item.target); pending.set(item.id,item);return {id:item.id};
      }
      case 'propose': {
        if (state.paused || pending.size >= 16) throw Error('unavailable');
        const name = data.name;
        if (typeof name !== 'string' || !/^[\p{L}\p{M}\p{N} _-]{1,80}\.(txt|md)$/iu.test(name) ||
            /^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³]) *\./i.test(name) ||
            typeof data.text !== 'string' || !data.text.trim() || Buffer.byteLength(data.text) > 64000) throw Error('invalid');
        const id = randomUUID();
        const target = join(workspace, name);
        const item = { id, target, text: data.text, expires: now() + 120000, agent: 'Abyssinia AI', tool: 'file.create', risk: 'local write' };
        record('file.create', 'requested', target); pending.set(id, item); return { id };
      }
      case 'reject':
      case 'approve': {
        const item = pending.get(data.id);
        if (!item || state.paused) throw Error('expired');
        if(data.action==='approve'&&item.tool.startsWith('window.')&&active)throw Error('unavailable');
        pending.delete(data.id);
        if (data.action === 'reject') { record(item.tool, 'rejected', item.target); return {}; }
        record(item.tool, 'approved', item.target);
        if(item.tool.startsWith('window.')){
          if(!desktopEnabled)throw Error('expired');
          const signal=this.begin();desktopBusy=true;
          return desktop(item.operation,item.window,signal).then(()=>{
            signal.throwIfAborted();record(item.tool,'completed',item.target);return {};
          }).catch(error=>{record(item.tool,'failed',item.target);throw error})
            .finally(()=>{desktopBusy=false;this.end()});
        }
        if(item.tool==='code.replace'){
          try {
            if(grant?.id!==item.grant)throw Error('expired');
            grant.fileId=replaceReviewed(item.target,item.before,item.text,grant.fileId);
          }catch(error){record(item.tool,'failed',item.target);throw error;}
          grant.undo=item.undo?null:{before:item.before,after:item.text};
          record(item.tool,item.undo?'restored':'updated',item.target);return {};
        }
        try {
          if (realpathSync(directory) !== directory) throw Error('workspace');
          mkdirSync(workspace, { recursive: true });
          if (lstatSync(workspace).isSymbolicLink() || realpathSync(workspace) !== workspace || dirname(item.target) !== workspace) throw Error('workspace');
          const fd = openSync(item.target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
          let written = false;
          try { writeFileSync(fd, item.text); fsyncSync(fd); written = true; }
          finally { closeSync(fd); if (!written) unlinkSync(item.target); }
        } catch { record(item.tool, 'failed', item.target); throw Error('write_failed'); }
        record(item.tool, 'created', item.target); return {};
      }
      default: throw Error('invalid');
      }
    },
  };
}

function nextDay(previous, current) {
  const next = new Date(current);
  const original = new Date(previous);
  next.setHours(original.getHours(),original.getMinutes(),original.getSeconds(),0);
  if (next.getTime() <= current) next.setDate(next.getDate()+1);
  return next.getTime();
}
