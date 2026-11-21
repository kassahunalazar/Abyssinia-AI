import { randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { snapshotFile, replaceReviewed } from './code-workspace.mjs';
import { checkRepository, grantRepository, inspectRepository, readRepositoryFile } from './repository-workspace.mjs';
import { mcpCurrentTime, mcpEndpoint } from './mcp-connections.mjs';
import { windowAction } from './desktop-control.mjs';
import { readWikiArticle, wikiArticle } from './browser-reader.mjs';
import { runProjectTests } from './project-tests.mjs';

const memoryId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const scheduleHistoryLimit = 100;

export function workspaceControl(directory, now = Date.now, desktop = windowAction, readArticle = readWikiArticle) {
  directory = resolve(directory);
  mkdirSync(directory, { recursive: true });
  const workspace = join(directory, 'documents');
  const stateFile = join(directory, 'activity.json');
  let state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { paused: false, events: [] };
  const pending = new Map();
  let grant;
  let repository;
  function documentPath(name) {
    if(typeof name!=='string'||!/^([\p{L}\p{M}\p{N} _-]{1,80})\.(txt|md)$/iu.test(name)||
       /^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³]) *\./i.test(name))throw Error('invalid');
    if(realpathSync(directory)!==directory || realpathSync(workspace)!==workspace)throw Error('invalid');
    return join(workspace,name);
  }
  function revokeEdits() {
    for (const [id,item] of pending) if (item.tool === 'code.replace') {
      pending.delete(id); record(item.tool,'cancelled',item.target);
    }
    grant=undefined;
  }
  function currentRepository(id) {
    if (state.paused || !repository || repository.id !== id) throw Error('unavailable');
    return repository;
  }
  function clearProjectApprovals(){
    for(const [id,item] of pending)if(['code.projectReplace','code.test'].includes(item.tool)){
      pending.delete(id);record(item.tool,'cancelled',item.target);
    }
  }
  function grantSource(path, { fileId: expectedFileId, repository: scope } = {}) {
    if (state.paused) throw Error('unavailable');
    const { text, fileId } = snapshotFile(path, expectedFileId);
    if (scope) checkRepository(scope);
    revokeEdits();
    const id = randomUUID();
    record('code.grant', 'approved', path);
    grant = { id, path, fileId, undo: null, repository: scope };
    return { grant: id, target: path, text };
  }
  function readSource() {
    if (grant.repository) checkRepository(grant.repository);
    return snapshotFile(grant.path, grant.fileId).text;
  }
  let active;
  let desktopEnabled=false;
  let desktopBusy=false;
  let runningConnection;
  let runningSchedule;
  const windows=new Map();
  const controls=new Map();
  function revokeDesktop() {
    desktopEnabled=false;windows.clear();controls.clear();
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
  function scheduleHistory() {
    return state.scheduleRuns ?? (state.reminders ?? []).filter(row => Number.isSafeInteger(row.last))
      .map(row => ({ schedule: row.id, title: row.title, job: row.job ?? 'reminder', finished: row.last,
        outcome: row.jobResult?.status ?? 'delivered', sources: row.jobResult?.sources ?? [],
        ...(row.jobResult?.status === 'failed' && { failure: 'research_unavailable' }) }))
      .sort((a, b) => b.finished - a.finished).slice(0, scheduleHistoryLimit);
  }
  function recordScheduleRun(due, started, finished, outcome, sources, reminders) {
    const job = due.job ?? 'reminder';
    const failure = outcome === 'failed' ? 'research_unavailable' : outcome === 'interrupted' ? 'cancelled' : undefined;
    const run = { schedule: due.id, title: due.title, job, due: due.next, started, finished, outcome, sources, failure };
    const scheduleRuns = [run, ...scheduleHistory()].slice(0, scheduleHistoryLimit);
    record(job === 'research' ? 'schedule.research' : 'reminder', outcome, due.title, state.paused, { reminders, scheduleRuns });
  }
  return {
    get paused() { return state.paused; },
    begin() {
      if (state.paused || active) return null;
      active = new AbortController();
      return active.signal;
    },
    end() { active = undefined; },
    cancel(signal) { if(active?.signal===signal) active.abort(); },
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
    grantFile: grantSource,
    grantRepository(path) {
      if (state.paused) throw Error('unavailable');
      const folder = grantRepository(path, realpathSync(directory));
      const map = inspectRepository(folder);
      clearProjectApprovals();
      const id = randomUUID();
      revokeEdits();
      record('code.repository', 'approved', folder.root);
      repository = { ...folder, id };
      return { repository: id, ...map };
    },
    async tick(research) {
      if (state.paused) return;
      const hour = new Date(now()).getHours();
      if (state.quiet && (hour >= 22 || hour < 7)) return;
      const due = (state.reminders ?? []).find(r => r.status === 'scheduled' && r.next <= now());
      if (!due) return;
      const started = now();
      let sources = [];
      let outcome = 'delivered';
      if(due.job==='research'){
        if(!research || active)return;
        const signal=this.begin();
        runningSchedule = due.id;
        try {
          sources = (await research(due.title,due.language,signal)) ?? [];
          outcome = 'completed';
        } catch {
          outcome = 'failed';
        } finally {
          runningSchedule = undefined;
          this.end();
        }
        if (signal.aborted || !state.reminders.includes(due)) {
          recordScheduleRun(due, started, now(), 'interrupted', [], state.reminders);
          return;
        }
      }
      const finished = now();
      const recurring = due.daily || due.weekly;
      const reminders = state.reminders.map(r => r !== due ? r : { ...r, last: finished,
        ...(due.job === 'research' && { jobResult: { status: outcome, sources } }),
        status: recurring ? 'scheduled' : 'delivered', next: recurring ? nextOccurrence(r.next, finished, r.weekly) : null });
      recordScheduleRun(due, started, finished, outcome, sources, reminders);
    },
    execute(data) {
      expire();
      switch (data.action) {
      case 'heartbeat':
        return { paused: state.paused, notice: state.events.findLast(e=>e.action==='reminder' && e.result==='delivered') };
      case 'memory.list':
        return { memories: state.memories ?? [] };
      case 'memory.create':
      case 'memory.import':
      case 'memory.update':
      case 'memory.delete': {
        if (data.confirmed !== true) throw Error('invalid');
        const memories = state.memories ?? [];
        const importing = data.action === 'memory.import';
        const creating = data.action === 'memory.create' || importing;
        const deleting = data.action === 'memory.delete';
        const existing = memories.find(memory => memory.id === data.id);
        if (!creating && (!existing || existing.revision !== data.revision)) throw Error('stale');
        const text = typeof data.text === 'string' ? data.text.trim() : '';
        if (!deleting && (!text || text.length > 1500 || text.includes('\0'))) throw Error('invalid');
        const time = now();
        if (importing) {
          if (typeof data.id !== 'string' || !memoryId.test(data.id) || !Number.isSafeInteger(data.created) ||
              data.created < 0 || data.created > 8640000000000000) throw Error('invalid');
          if (existing?.source === 'browser-note' && existing.created === data.created) return { memory: existing };
          if (existing) throw Error('stale');
        }
        if (creating && memories.length >= 500) throw Error('invalid');
        const row = { id: importing ? data.id : creating ? randomUUID() : existing.id, text,
          source: importing ? 'browser-note' : creating ? 'user' : existing.source,
          created: importing ? data.created : creating ? time : existing.created,
          updated: time, revision: randomUUID() };
        const next = creating ? [row, ...memories] : deleting ? memories.filter(memory => memory !== existing) :
          memories.map(memory => memory === existing ? row : memory);
        record(data.action, 'completed', row.id, state.paused, { memories: next });
        return deleting ? {} : { memory: row };
      }
      case 'schedule.history':
        return { runs: scheduleHistory() };
      case 'document.list':
        if(!existsSync(workspace) || state.paused)return {names:[]};
        if(realpathSync(workspace)!==workspace)throw Error('invalid');
        return {names:readdirSync(workspace,{withFileTypes:true}).filter(entry=>{
          try{return entry.isFile() && lstatSync(documentPath(entry.name)).nlink===1;}catch{return false;}
        }).map(entry=>entry.name).sort()};
      case 'document.read':
      case 'document.propose': {
        if(state.paused)throw Error('unavailable');
        const target=documentPath(data.name);
        const snapshot=snapshotFile(target);
        if(data.action==='document.read')return {text:snapshot.text};
        if(pending.size>=16 || !['rename','delete'].includes(data.operation))throw Error('invalid');
        const destination=data.operation==='rename'?documentPath(data.destination):undefined;
        if(destination && existsSync(destination))throw Error('invalid');
        const item={id:randomUUID(),agent:'Abyssinia AI',tool:'document.'+data.operation,risk:data.operation,target,
          destination,fileId:snapshot.fileId,before:snapshot.text,text:(destination?destination+'\n\n':'')+snapshot.text,expires:now()+120000};
        pending.set(item.id,item);record(item.tool,'requested',target);return {id:item.id};
      }

      case 'status':
        return { paused: state.paused, running: Boolean(active), workspace,
          codeTarget:grant?.path, codeGrant:grant?.id, canUndo:Boolean(grant?.undo),
          repository:repository?.id, repositoryRoot:repository?.root,
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
          signal.throwIfAborted();windows.clear();controls.clear();
          const result=rows.map(w=>{const id=randomUUID();windows.set(id,w);return {id,title:w.title,process:w.process};});
          return {windows:result};
        }).finally(()=>{desktopBusy=false;this.end()});
      }
      case 'desktop.controls': {
        if(!desktopEnabled||state.paused||active)throw Error('unavailable');
        const window=windows.get(data.window);
        if(!window)throw Error('expired');
        const signal=this.begin();desktopBusy=true;controls.clear();
        return desktop('controls',window,signal).then(rows=>{
          signal.throwIfAborted();
          return {controls:rows.map(row=>{
            const id=randomUUID();
            controls.set(id,{window,recipe:row,expires:now()+180000});
            return {id,name:row.name||row.id||row.type,operation:row.operation};
          })};
        }).finally(()=>{desktopBusy=false;this.end();});
      }
      case 'desktop.propose': {
        if(!desktopEnabled||state.paused||pending.size>=16||!['focus','scrollUp','scrollDown','invoke','setText'].includes(data.operation))throw Error('invalid');
        const window=windows.get(data.window);if(!window)throw Error('expired');
        const element=['invoke','setText'].includes(data.operation)?controls.get(data.control):null;
        if(['invoke','setText'].includes(data.operation) &&
           (element?.window!==window || element.expires<=now() || element.recipe.operation!==data.operation))throw Error('expired');
        if(data.operation==='setText'&&(typeof data.text!=='string'||Buffer.byteLength(data.text)>4096||data.text.includes('\0')))throw Error('invalid');
        const elementName=element?.recipe.name||element?.recipe.id||element?.recipe.type;
        const item={id:randomUUID(),window,operation:data.operation,controlGrant:data.control,
          parameters:element?{control:element.recipe,text:data.operation==='setText'?data.text:undefined}:undefined,
          agent:'Abyssinia AI',tool:'window.'+data.operation,
          target:window.process+' · '+window.title+' · PID '+window.pid,text:element?(elementName+(data.operation==='setText'?'\n\n'+data.text:'')):data.operation,risk:'desktop control',expires:now()+120000};
        pending.set(item.id,item);record(item.tool,'requested',item.target);return {id:item.id};
      }
      case 'schedule': {
        if(state.paused)throw Error('unavailable');
        const reminders = state.reminders ?? [];
        if(data.draft!==undefined){
          if(typeof data.draft!=='string'||!/^[-0-9a-f]{36}$/i.test(data.draft))throw Error('invalid');
          const existing=reminders.find(r=>r.draft===data.draft);if(existing)return {id:existing.id};
        }
        if ((data.weekly!==undefined && typeof data.weekly!=='boolean') || (data.daily && data.weekly) || reminders.length >= 100 || typeof data.title !== 'string' || !data.title.trim() || data.title.length > 160 ||
            !Number.isSafeInteger(data.next) || data.next <= now() || data.next > now() + 315576000000 || typeof data.daily !== 'boolean') throw Error('invalid');
        if(data.job!==undefined && (data.job!=='research' || !['am','en'].includes(data.language)))throw Error('invalid');
        const r = {id:randomUUID(),...(data.job&&{job:data.job,language:data.language}),draft:data.draft, title:data.title.trim(), next:data.next, daily:data.daily, weekly:!!data.weekly, status:'scheduled'};
        record('reminder','scheduled',r.title,state.paused,{ reminders:[...reminders,r] }); return {id:r.id};
      }
      case 'browser.propose': {
        if (state.paused || pending.size >= 16) throw Error('unavailable');
        const target = wikiArticle(data.url);
        const item = { id:randomUUID(), agent:'Abyssinia AI', tool:'browser.read', target,
          text:'የተመረጠውን የዊኪፔዲያ ገጽ መግቢያና አገናኞች አንብብ።', risk:'public page read', expires:now()+120000 };
        pending.set(item.id, item);
        record(item.tool, 'requested', target);
        return { id:item.id };
      }
      case 'mcp.time': {
        const c=this.connection(data.id);
        if(!c.tools.includes('get_current_time') || pending.size>=16 || typeof data.timezone!=='string' || data.timezone.length>80)throw Error('invalid');
        new Intl.DateTimeFormat('en',{timeZone:data.timezone});
        const item={id:randomUUID(),connection:c.id,timezone:data.timezone,agent:'Abyssinia AI',tool:'mcp.get_current_time',
          target:c.url,text:JSON.stringify({timezone:data.timezone}),risk:'read time',expires:now()+120000};
        pending.set(item.id,item);record(item.tool,'requested',c.url);return {id:item.id};
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
        if(runningConnection===c.id)active?.abort();
        for(const [id,item] of pending)if(item.connection===c.id){pending.delete(id);record(item.tool,'cancelled',c.url);}
        const connections=data.action==='mcp.remove'?list.filter(x=>x!==c):list.map(x=>x===c?{...x,enabled:!x.enabled}:x);
        record(data.action,'completed',c.name,state.paused,{connections});return {};
      }
      case 'hold':
      case 'release':
      case 'removeReminder': {
        const list = state.reminders ?? [];
        const r = list.find(x => x.id === data.id);
        if (!r || (data.action === 'hold' && r.status !== 'scheduled') || (data.action === 'release' && r.status !== 'held')) throw Error('invalid');
        if (runningSchedule === r.id) active?.abort();
        const status = data.action === 'hold' ? 'held' : 'scheduled';
        const reminders = data.action === 'removeReminder' ? list.filter(x=>x.id!==r.id) : list.map(x=>x.id===r.id?{...x,status}:x);
        record('reminder',data.action==='removeReminder'?'deleted':status,r.title,state.paused,{reminders,scheduleRuns:scheduleHistory()}); return {};
      }
      case 'pause':
        active?.abort();
        revokeDesktop();
        for (const item of pending.values()) record(item.tool, 'cancelled', item.target);
        grant=undefined;
        repository=undefined;
        pending.clear(); record('agent', 'paused', '', true); return {};
      case 'resume':
        record('agent', 'resumed', '', false); return {};
      case 'code.close':
        revokeEdits(); return {};
      case 'code.repository': {
        const scope = currentRepository(data.repository);
        return { repository: scope.id, ...inspectRepository(scope) };
      }
      case 'code.preview':
      case 'code.open': {
        const scope = currentRepository(data.repository);
        const { path, target, size, editable, text, fileId } = readRepositoryFile(scope, data.path);
        if (data.action === 'code.preview') return { path, size, editable, text };
        if (!editable) throw Error('invalid');
        return grantSource(target, { fileId, repository: scope });
      }
      case 'code.closeRepository': {
        const scope = currentRepository(data.repository);
        clearProjectApprovals();
        if (grant?.repository === scope) revokeEdits();
        record('code.repository', 'cancelled', scope.root);
        repository=undefined;
        return {};
      }
      case 'code.projectSnapshot': {
        const scope=currentRepository(data.repository);
        if(!Array.isArray(data.paths)||!data.paths.length||data.paths.length>4||new Set(data.paths).size!==data.paths.length)throw Error('invalid');
        const files=data.paths.map(path=>readRepositoryFile(scope,path));
        if(files.some(file=>!file.editable)||Buffer.byteLength(JSON.stringify(files.map(({path,text})=>({path,text}))))>16384)throw Error('invalid');
        return files;
      }
      case 'code.projectPropose': {
        const scope=currentRepository(data.repository);
        if(!Array.isArray(data.edits)||!data.edits.length||data.edits.length>4||pending.size+data.edits.length>16)throw Error('invalid');
        const paths=new Set();
        const items=data.edits.map(edit=>{
          const file=readRepositoryFile(scope,edit.path);
          if(!file.editable||paths.has(file.target.toLowerCase())||file.fileId!==edit.fileId||file.text!==edit.before)throw Error('stale');
          paths.add(file.target.toLowerCase());
          if(typeof edit.text!=='string'||edit.text===file.text||edit.text.includes('\0')||Buffer.byteLength(edit.text)>65536)throw Error('invalid');
          return {id:randomUUID(),agent:'AK Code Engine',tool:'code.projectReplace',risk:'replace source',repository:scope.id,path:file.path,
            target:file.target,fileId:file.fileId,before:file.text,text:edit.text,expires:now()+120000};
        });
        for(const item of items){record(item.tool,'requested',item.target);pending.set(item.id,item);}
        return {id:items[0].id,count:items.length};
      }
      case 'code.test': {
        const files=this.execute({action:'code.projectSnapshot',repository:data.repository,paths:data.paths});
        if(pending.size>=16||!files.some(file=>/\.test\.m?js$/i.test(file.path))||
          files.some(file=>!/\.m?js$/i.test(file.path)))throw Error('invalid');
        const item={id:randomUUID(),agent:'AK Code Engine',tool:'code.test',risk:'isolated JavaScript tests',
          target:currentRepository(data.repository).root,repository:data.repository,files,
          text:files.map(file=>file.path).join('\n'),expires:now()+120000};
        record(item.tool,'requested',item.target);pending.set(item.id,item);return {id:item.id};
      }
      case 'code.read':
        if (!grant || state.paused) throw Error('unavailable');
        return {grant:grant.id,target:grant.path,text:readSource()};
      case 'code.propose':
      case 'code.undo': {
        if (!grant || data.grant!==grant.id || state.paused || pending.size>=16) throw Error('unavailable');
        const before=readSource();
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
        if(data.action==='approve'&&(item.tool.startsWith('window.')||item.tool==='mcp.get_current_time'||item.tool==='browser.read')&&active)throw Error('unavailable');
        if(data.action==='approve'&&item.tool==='code.test'&&active)throw Error('unavailable');
        pending.delete(data.id);
        if (data.action === 'reject') { record(item.tool, 'rejected', item.target); return {}; }
        record(item.tool, 'approved', item.target);
        if(item.tool.startsWith('document.')){
          try{
            if(snapshotFile(item.target,item.fileId).text!==item.before)throw Error('stale');
            if(item.destination){
              linkSync(item.target,item.destination);
              try{unlinkSync(item.target);}catch(error){unlinkSync(item.destination);throw error;}
            }else unlinkSync(item.target);
            record(item.tool,'completed',item.target);
            return {};
          }catch(error){record(item.tool,'failed',item.target);throw error;}
        }
        if (item.tool === 'browser.read') {
          const signal = this.begin();
          return Promise.resolve().then(() => readArticle(item.target, signal)).then(page => {
            signal.throwIfAborted();
            record(item.tool, 'completed', item.target);
            return { browserPage:page };
          }).catch(error => {
            record(item.tool, signal.aborted ? 'interrupted' : 'failed', item.target);
            throw error;
          }).finally(() => this.end());
        }
        if(item.tool==='mcp.get_current_time'){
          const c=this.connection(item.connection);
          const signal=this.begin();
          if(!signal)throw Error('unavailable');
          runningConnection=c.id;
          return mcpCurrentTime(c.url,item.timezone,signal).then(result=>{
            signal.throwIfAborted();record(item.tool,'completed',c.url);return result;
          }).catch(error=>{record(item.tool,'failed',c.url);throw error;}).finally(()=>{runningConnection=undefined;this.end();});
        }
        if(item.tool.startsWith('window.')){
          if(!desktopEnabled || (item.parameters && (!controls.has(item.controlGrant)||controls.get(item.controlGrant).expires<=now())))throw Error('expired');
          const signal=this.begin();desktopBusy=true;
          return desktop(item.operation,item.window,signal,item.parameters).then(()=>{
            signal.throwIfAborted();record(item.tool,'completed',item.target);return {};
          }).catch(error=>{record(item.tool,'failed',item.target);throw error})
            .finally(()=>{desktopBusy=false;this.end()});
        }
        if(item.tool==='code.test'){
          const scope=currentRepository(item.repository);
          for(const original of item.files){
            const current=readRepositoryFile(scope,original.path);
            if(original.fileId!==current.fileId||original.text!==current.text){record(item.tool,'stale',item.target);throw Error('stale');}
          }
          const signal=this.begin();
          return runProjectTests(item.files,signal).then(result=>{
            signal.throwIfAborted();
            record(item.tool,result.passed?'passed':'failed',item.target);
            return {tests:result};
          }).catch(error=>{record(item.tool,signal.aborted?'interrupted':'failed',item.target);throw error;})
            .finally(()=>this.end());
        }
        if(item.tool==='code.projectReplace'){
          try{
            const scope=currentRepository(item.repository);
            const file=readRepositoryFile(scope,item.path);
            if(file.target!==item.target)throw Error('stale');
            const fileId=replaceReviewed(item.target,item.before,item.text,item.fileId);
            if(grant?.path===item.target){grant.fileId=fileId;grant.undo={before:item.before,after:item.text};}
            record(item.tool,'updated',item.target);return {};
          }catch(error){record(item.tool,'failed',item.target);throw error;}
        }
        if(item.tool==='code.replace'){
          try {
            if(grant?.id!==item.grant)throw Error('expired');
            if (grant.repository) checkRepository(grant.repository);
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

function nextOccurrence(previous, current, weekly) {
  const next = new Date(current);
  const original = new Date(previous);
  next.setHours(original.getHours(),original.getMinutes(),original.getSeconds(),0);
  if (weekly) next.setDate(next.getDate()+(original.getDay()-next.getDay()+7)%7);
  if (next.getTime() <= current) next.setDate(next.getDate()+(weekly?7:1));
  return next.getTime();
}
