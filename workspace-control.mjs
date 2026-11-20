import { randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function workspaceControl(directory, now = Date.now) {
  directory = resolve(directory);
  mkdirSync(directory, { recursive: true });
  const workspace = join(directory, 'documents');
  const stateFile = join(directory, 'activity.json');
  let state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { paused: false, events: [] };
  const pending = new Map();
  let active;
  function record(action, result, target = '', paused = state.paused, changes = {}) {
    const event = { time: new Date(now()).toISOString(), action, result, target };
    const next = { ...state, ...changes, paused, events: [...state.events.slice(-199), event] };
    writeFileSync(stateFile + '.tmp', JSON.stringify(next), { mode: 0o600 });
    renameSync(stateFile + '.tmp', stateFile);
    state = next;
  }
  function expire() {
    for (const [id, item] of pending) if (item.expires <= now()) {
      pending.delete(id); record('file.create', 'expired', item.target);
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
          approvals: [...pending.values()], events: state.events.slice().reverse(), reminders: state.reminders ?? [], quiet: !!state.quiet };
      case 'quiet':
        if (typeof data.enabled !== 'boolean') throw Error('invalid');
        record('quiet_hours', data.enabled ? 'enabled' : 'disabled', '', state.paused, { quiet: data.enabled }); return {};
      case 'schedule': {
        const reminders = state.reminders ?? [];
        if (reminders.length >= 100 || typeof data.title !== 'string' || !data.title.trim() || data.title.length > 160 ||
            !Number.isSafeInteger(data.next) || data.next <= now() || data.next > now() + 315576000000 || typeof data.daily !== 'boolean') throw Error('invalid');
        const r = {id:randomUUID(), title:data.title.trim(), next:data.next, daily:data.daily, status:'scheduled'};
        record('reminder','scheduled',r.title,state.paused,{ reminders:[...reminders,r] }); return {id:r.id};
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
        for (const item of pending.values()) record('file.create', 'cancelled', item.target);
        pending.clear(); record('agent', 'paused', '', true); return {};
      case 'resume':
        record('agent', 'resumed', '', false); return {};
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
        pending.delete(data.id);
        if (data.action === 'reject') { record(item.tool, 'rejected', item.target); return {}; }
        record(item.tool, 'approved', item.target);
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
