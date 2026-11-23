import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const privateAddress = new BlockList();
for (const [ip,bits,type] of [
  ['0.0.0.0',8,'ipv4'], ['10.0.0.0',8,'ipv4'], ['100.64.0.0',10,'ipv4'], ['127.0.0.0',8,'ipv4'],
  ['169.254.0.0',16,'ipv4'], ['172.16.0.0',12,'ipv4'], ['192.0.0.0',24,'ipv4'], ['192.168.0.0',16,'ipv4'],
  ['198.18.0.0',15,'ipv4'], ['224.0.0.0',4,'ipv4'], ['240.0.0.0',4,'ipv4'],
  ['::',128,'ipv6'], ['::1',128,'ipv6'], ['fc00::',7,'ipv6'], ['fe80::',10,'ipv6'], ['ff00::',8,'ipv6'],
]) privateAddress.addSubnet(ip,bits,type);

export function edgeUrl(value, allowLocal = false) {
  if (typeof value !== 'string' || value.length > 2048 || /[\p{C}\\]/u.test(value)) throw Error('invalid');
  const url = new URL(value);
  const local = allowLocal && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if (url.username || url.password || (!local && (url.protocol !== 'https:' || url.port ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(url.hostname) || isIP(url.hostname))))
    throw Error('invalid');
  return url.href;
}

export function edgeExecutable() {
  return [process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA].filter(Boolean)
    .map(base=>join(base,'Microsoft','Edge','Application','msedge.exe')).find(existsSync);
}

function connect(child) {
  const send = child.stdio[3];
  const receive = child.stdio[4];
  const pending = new Map();
  const events = new Map();
  let sequence = 0;
  let buffer = '';
  let ended = false;
  function finish() {
    ended = true;
    for (const response of pending.values()) response.reject(Error('browser'));
  }
  child.on('error',finish);
  child.on('close',finish);
  send.on('error',finish);
  receive.on('error',finish);
  receive.setEncoding('utf8');
  receive.on('data', text => {
    buffer += text;
    if (buffer.length > 1024*1024) { child.kill(); return; }
    for (let end; (end=buffer.indexOf('\0'))!==-1;) {
      const content=buffer.slice(0,end);
      buffer=buffer.slice(end+1);
      let message;
      try { message=JSON.parse(content); } catch { child.kill(); return; }
      if (message.id) {
        const response = pending.get(message.id);
        if (message.error) response?.reject(Error('browser'));
        else response?.resolve(message.result);
      } else {
        events.get(message.method)?.(message.params,message.sessionId);
      }
    }
  });
  return {
    on(method,handler) { events.set(method,handler); },
    command(method,params,sessionId) {
      if (ended) return Promise.reject(Error('browser'));
      const id = ++sequence;
      return new Promise((resolve,reject) => {
        pending.set(id,{ resolve,reject });
        send.write(JSON.stringify({id,method,params,sessionId})+'\0');
      }).finally(() => pending.delete(id));
    },
  };
}

// This function runs in a separate world in the selected top-level document.
// Model and user data travel as structured arguments, never as JavaScript.
function installFormInspector(pageUrl) {
  const selectors = 'input, textarea, select, button';
  let selected = new Map();
  function describe(node) {
    if (!node.isConnected || node.hidden || node.matches(':disabled, [aria-disabled=true]') ||
        node.closest('[inert]') || !node.getClientRects().length || getComputedStyle(node).visibility !== 'visible') return;
    const type = node.type;
    const label = ([...node.labels ?? []].map(item=>item.innerText).join(' ') || node.getAttribute('aria-label') ||
      node.placeholder || (node.tagName==='BUTTON'?node.innerText:'') || node.name || node.id || '').trim().slice(0,160);
    if (!label) return;
    if ((node.tagName==='TEXTAREA'||['text','search','email','tel','url','number'].includes(type)) && !node.readOnly)
      return { operation:'fill',label };
    if (type==='checkbox'||type==='radio') return {operation:'check',label};
    if (node.tagName==='SELECT' && !node.multiple) {
      const options = [...node.options].slice(0,40).map((option,index)=>({index,label:option.label.slice(0,120),disabled:option.matches(':disabled')}));
      return {operation:'select',label,options};
    }
    if (type==='submit' && node.form) {
      const method = (node.getAttribute('formmethod')||node.form.method||'get').toUpperCase();
      const url = new URL(node.getAttribute('formaction')||node.form.getAttribute('action')||pageUrl, pageUrl);
      url.hash = '';
      const encoding = node.getAttribute('formenctype')||node.form.enctype;
      if (url.origin !== new URL(pageUrl).origin || !['GET','POST'].includes(method) || encoding!=='application/x-www-form-urlencoded' ||
          (node.getAttribute('formtarget')||node.form.target||'_self') !== '_self' || document.characterSet!=='UTF-8') return;
      return {operation:'submit',label,method,destination:url.href};
    }
  }
  function checkedField(control) {
    const node = selected.get(control.id);
    const {id,...expected} = control;
    if (node && location.href==='about:blank' && JSON.stringify(describe(node))===JSON.stringify(expected)) return node;
  }
  function submission(node) {
    if (!node.form.checkValidity()) return;
    const fields = [];
    const eligible = [...node.form.elements].filter(field => field.name && !field.matches(':disabled') &&
      (field===node || (describe(field)?.operation!=='submit' && describe(field) &&
       (!['checkbox','radio'].includes(field.type)||field.checked))));
    for (const [name,value] of new FormData(node.form,node)) {
      const index = eligible.findIndex(field=>field.name===name && field.value===value);
      if (index<0 || typeof value!=='string' || fields.length>=32 || name.length>160 || value.length>1000) return;
      eligible.splice(index,1);
      fields.push([name,value]);
    }
    return fields;
  }
  globalThis.abyssiniaForms = {
    snapshot() {
      selected = new Map();
      const controls = [];
      for (const node of [...document.querySelectorAll(selectors)].slice(0,400)) {
        const details = describe(node);
        if (!details) continue;
        const id = String(controls.length+1);
        selected.set(id,node);
        controls.push({id,...details});
        if (controls.length === 32) break;
      }
      return {url:pageUrl,title:document.title.slice(0,160),controls};
    },
    preview(control) {
      const node = checkedField(control);
      return node && control.operation==='submit' ? submission(node) : null;
    },
    act(url, control, value) {
      const node = checkedField(control);
      if (!node || pageUrl!==url) return {stale:true};
      if (control.operation==='fill') {
        const prototype = node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,value);
        node.dispatchEvent(new Event('input',{bubbles:true}));
        node.dispatchEvent(new Event('change',{bubbles:true}));
        return {applied:node.value===value};
      }
      if (control.operation==='select') {
        node.selectedIndex = value;
        node.dispatchEvent(new Event('input',{bubbles:true}));
        node.dispatchEvent(new Event('change',{bubbles:true}));
        return {applied:node.selectedIndex===value};
      }
      if (control.operation==='check') {
        if (node.checked!==value && !(node.type==='radio'&&!value)) node.click();
        return {applied:node.checked===value};
      }
      return {applied:false};
    },
  };
  return globalThis.abyssiniaForms.snapshot();
}

function readHtml(url, pinned, body, signal) {
  return new Promise((resolve,reject) => {
    const request = url.protocol==='https:' ? httpsRequest : httpRequest;
    const headers = {Accept:'text/html','Accept-Encoding':'identity','User-Agent':'AbyssiniaAI Form Reader'};
    if (body!==undefined) {
      headers['Content-Type']='application/x-www-form-urlencoded; charset=UTF-8';
      headers['Content-Length']=Buffer.byteLength(body);
    }
    const req = request(url,{agent:false,signal,method:body===undefined?'GET':'POST',headers,
      ...(pinned && {lookup:(_host,options,callback)=>options.all ? callback(null,[pinned]) : callback(null,pinned.address,pinned.family)})},res=>{
      const type = res.headers['content-type'] ?? '';
      if (res.statusCode<200 || res.statusCode>=300 || !/^text\/html\b/i.test(type) ||
          res.headers['content-encoding'] && res.headers['content-encoding']!=='identity') {
        res.resume();reject(Error('browser'));return;
      }
      const bytes = [];
      let size = 0;
      res.on('data',chunk=>{
        size += chunk.length;
        if (size>512*1024) { req.destroy(Error('browser'));return; }
        bytes.push(chunk);
      });
      res.on('error',reject);
      res.on('end',()=>{
        try { resolve(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(bytes))); }
        catch(error) { reject(error); }
      });
    });
    req.on('error',reject);
    req.end(body);
  });
}

function encodeSubmission(control, fields) {
  const destination = new URL(control.destination);
  const encoded = new URLSearchParams(fields.map(([name,value])=>[name.replace(/\r\n|\r|\n/g,'\r\n'),value.replace(/\r\n|\r|\n/g,'\r\n')])).toString();
  if (Buffer.byteLength(encoded)>16384) throw Error('invalid');
  if (control.method==='GET') { destination.search=encoded; return [destination,undefined]; }
  return [destination,encoded];
}

export async function openEdgeForm(value, signal, { headless = false, allowLocal = false } = {}) {
  const url = new URL(edgeUrl(value,allowLocal));
  let pinned;
  if (!(allowLocal && url.hostname==='127.0.0.1')) {
    const addresses = await lookup(url.hostname,{all:true});
    if (!addresses.length || addresses.some(({address,family})=>privateAddress.check(address,family===4?'ipv4':'ipv6')))
      throw Error('invalid');
    pinned = addresses.find(item=>item.family===4) ?? addresses[0];
  }
  signal.throwIfAborted();
  const edge = edgeExecutable();
  if (!edge) throw Error('unavailable');
  const opening = AbortSignal.any([signal,AbortSignal.timeout(12000)]);
  const initialHtml = await readHtml(url,pinned,undefined,opening);
  const profile = await mkdtemp(join(tmpdir(),'abyssinia-form-'));
  const child = spawn(edge,[
    '--disable-features=AutoDeElevate','--edge-skip-compat-layer-relaunch','--enable-automation','--disable-background-networking',
    '--disable-sync','--disable-extensions','--no-first-run','--no-default-browser-check',
    ...(headless?['--headless']:[]),'--host-resolver-rules=MAP * ~NOTFOUND','--user-data-dir='+profile,'--remote-debugging-pipe','--no-startup-window',
  ],{stdio:['ignore','ignore','ignore','pipe','pipe']});
  const cdp = connect(child);
  const exited = new Promise(resolve => child.once('close',resolve));
  let closing, sessionId, contextId;
  let shownUrl = url.href;
  function close() {
    if (closing) return closing;
    closing = (async () => {
      const timer = setTimeout(()=>child.kill(),1200);
      void cdp.command('Browser.close').catch(()=>{});
      await exited;
      clearTimeout(timer);
      await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:300}).catch(()=>{});
    })();
    return closing;
  }
  async function bounded(action, fn, timeoutMs = 15000) {
    const deadline = AbortSignal.any([action,AbortSignal.timeout(timeoutMs)]);
    const abort = () => { void close(); };
    deadline.addEventListener('abort',abort,{once:true});
    try {
      deadline.throwIfAborted();
      const result = await fn();
      deadline.throwIfAborted();
      return result;
    } finally {
      deadline.removeEventListener('abort',abort);
    }
  }
  const command = (method,params) => cdp.command(method,params,sessionId);
  async function load(html) {
    const {frameTree:{frame}} = await command('Page.getFrameTree');
    if (frame.url !== 'about:blank') throw Error('stale');
    // This policy is parsed before any page markup. The inspected tab cannot run scripts or native submissions.
    const policy = "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";
    await command('Page.setDocumentContent',{frameId:frame.id,
      html:'<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+policy+'">'+html});
  }
  async function run(functionDeclaration,args=[]) {
    const reply = await command('Runtime.callFunctionOn',{functionDeclaration:`(${functionDeclaration.toString()})`,
      arguments:args.map(value=>({value})),executionContextId:contextId,returnByValue:true});
    if (reply.exceptionDetails) throw Error('browser');
    return reply.result.value;
  }
  const snapshot = action => bounded(action,async () => {
    const {frameTree:{frame}} = await command('Page.getFrameTree');
    if (frame.url !== 'about:blank') throw Error('stale');
    ({executionContextId:contextId}=await command('Page.createIsolatedWorld',{frameId:frame.id,worldName:'Abyssinia Forms'}));
    return run(installFormInspector,[shownUrl]);
  });
  try {
    await bounded(signal,async () => {
      const { targetId } = await cdp.command('Target.createTarget',{url:'about:blank'});
      ({sessionId}=await cdp.command('Target.attachToTarget',{targetId,flatten:true}));
      const tab = sessionId;
      cdp.on('Fetch.requestPaused',({requestId},owner)=>{
        if (owner===tab) void command('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'}).catch(()=>{});
      });
      cdp.on('Target.targetDestroyed',({targetId:destroyed})=>{
        if (destroyed===targetId) void close();
      });
      cdp.on('Page.javascriptDialogOpening',(_,owner)=>{
        if (owner===tab) void command('Page.handleJavaScriptDialog',{accept:false}).catch(()=>{});
      });
      await cdp.command('Browser.setDownloadBehavior',{behavior:'deny'});
      await cdp.command('Target.setDiscoverTargets',{discover:true});
      await command('Page.enable');
      await command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
      await load(initialHtml);
    }, 45000);
  } catch(error) {
    await close();
    throw error;
  }
  return {
    close, snapshot,
    preview(control,action) {
      return bounded(action,async () => {
        const fields = await run(field=>globalThis.abyssiniaForms.preview(field),[control]);
        if (!Array.isArray(fields)) throw Error('invalid');
        encodeSubmission(control,fields);
        return fields;
      });
    },
    apply(control,value,pageUrl,action) {
      return bounded(action,async () => {
        if (control.operation==='submit') {
          const fields = await run(field=>globalThis.abyssiniaForms.preview(field),[control]);
          if (pageUrl!==shownUrl || JSON.stringify(fields)!==JSON.stringify(value)) throw Error('stale');
          const [destination,body] = encodeSubmission(control,fields);
          if (destination.origin!==url.origin) throw Error('invalid');
          const response = await readHtml(destination,pinned,body,AbortSignal.any([action,AbortSignal.timeout(10000)]));
          action.throwIfAborted();
          await load(response);
          shownUrl=destination.href;
          return {applied:true,operation:control.operation,label:control.label};
        }
        const result = await run((url,field,next)=>globalThis.abyssiniaForms.act(url,field,next),[pageUrl,control,value]);
        if (result.stale) throw Error('stale');
        return {applied:result.applied,operation:control.operation,label:control.label};
      });
    },
  };
}
