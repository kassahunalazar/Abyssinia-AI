import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { resolveProvider } from './providers.mjs';
import { workspaceControl } from './workspace-control.mjs';
import { referenceSearch } from './reference-search.mjs';
import { readScreen } from './screen-reader.mjs';
import { pickSourceFile, checkDraft } from './code-workspace.mjs';
import { discoverMcp } from './mcp-connections.mjs';
import { speechModels, transcribe } from './speech.mjs';
import { candidates, voices, speechScript, synthesize } from './speech-output.mjs';
import { askGeminiKey } from './gemini-key.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const runtime = resolve(process.env.ASSISTANT_RUNTIME_DIR ?? resolve(root, '.runtime'));
const loopback = '127.0.0.1';
const limits = { request: 16384, message: 4000, reply: 64000 };
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/theme.js': ['theme.js', 'text/javascript; charset=utf-8'],
  '/settings.js': ['settings.js', 'text/javascript; charset=utf-8'],
  '/controls.js': ['controls.js', 'text/javascript; charset=utf-8'],
  '/voice.js': ['voice.js','text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

export function hermesReply(message, history = [], provider = resolveProvider(), attachment, onRead, signal, onDelta) {
  const { ASSISTANT_PYTHON, ASSISTANT_HERMES_SOURCE } = process.env;
  const { base: ASSISTANT_MODEL_URL, model: ASSISTANT_MODEL_ID, key } = provider ?? {};
  if (![ASSISTANT_PYTHON, ASSISTANT_HERMES_SOURCE, ASSISTANT_MODEL_URL, ASSISTANT_MODEL_ID].every(Boolean)) {
    throw new Error('Missing Hermes configuration.');
  }
  return new Promise((accept, reject) => {
    const child = spawn(ASSISTANT_PYTHON, ['-I', '-B', resolve(root, 'hermes_worker.py')], {
      cwd: runtime,
      env: {
        SystemRoot: process.env.SystemRoot,
        PATH: process.env.SystemRoot ? resolve(process.env.SystemRoot, 'System32') : '/usr/bin:/bin',
        TEMP: runtime,
        TMP: runtime,
        HOME: runtime,
        USERPROFILE: runtime,
        HERMES_HOME: resolve(runtime, 'hermes'),
        HERMES_DISABLE_LAZY_INSTALLS: '1',
        ASSISTANT_TEST_WORKER_LOG: process.env.ASSISTANT_TEST_WORKER_LOG,
        ASSISTANT_HERMES_SOURCE,
        ASSISTANT_MODEL_URL,
        ASSISTANT_MODEL_ID,
        ASSISTANT_MODEL_KEY: key,
      },
      windowsHide: true,
      signal,
      stdio: ['pipe', 'pipe', process.env.ASSISTANT_TEST_WORKER_LOG === '1' ? 'inherit' : 'ignore'],
      timeout: 180000,
    });
    let buffer='', final;
    let size = 0;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > (onDelta?512000:limits.reply)) {child.kill();return}
      buffer+=chunk;
      for(let end; (end=buffer.indexOf('\n'))!==-1;){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        try{
          const item=JSON.parse(line);
          if(typeof item.delta==='string')onDelta?.(item.delta);
          else final=item;
        }catch{child.kill();reject(Error('Invalid worker event'));return}
      }
    });
    child.stdin.on('error', reject);
    child.on('error', reject);
    child.on('close', code => {
      try {
        if (code !== 0 || !final || buffer.trim()) throw new Error('Hermes run failed.');
        const { reply, attachmentRead } = final;
        if (typeof reply !== 'string' || !reply.trim()) throw new Error('Invalid Hermes response.');
        if (attachment && attachmentRead) onRead?.();
        accept(reply);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ message, history, attachment,stream:!!onDelta }));
  });
}

export function createAssistant({ reply = hermesReply, stateDirectory = resolve(runtime, 'product'), pickFile = pickSourceFile } = {}) {
  const control = workspaceControl(stateDirectory);
  const session = randomUUID();
  const conversations = new Map();
  let sampleTicket;
  let sessionVoiceKey;
  const voiceKey=()=>sessionVoiceKey || process.env.ABYSSINIA_TTS_KEY || process.env.GEMINI_API_KEY;
  const server = createServer({ requestTimeout: 10000, headersTimeout: 5000 }, async (req, res) => {
    const authority = loopback + ':' + server.address().port;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, data) => {
      if(res.headersSent){res.end(JSON.stringify({status,...data})+'\n');return;}
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };

    if (req.headers.host !== authority) return json(403, { error: 'host' });
    if (req.method === 'GET' && Object.hasOwn(assets, req.url)) {
      const [file, type] = assets[req.url];
      try {
        const content = await readFile(resolve(root, 'web', file));
        if (req.url === '/') res.setHeader('Set-Cookie', 'abyssinia_' + server.address().port + '=' + session + '; HttpOnly; SameSite=Strict; Path=/');
        res.writeHead(200, { 'Content-Type': type });
        return res.end(content);
      } catch {
        return json(500, { error: 'asset' });
      }
    }
    const testing = req.url === '/api/provider/test';
    const managing = req.url === '/api/control';
    const searching = req.url === '/api/research';
    const capturing = req.url === '/api/screen/read';
    const hearing = req.url === '/api/voice/benchmark';
    if (req.method !== 'POST' || (!testing && !managing && !searching && !capturing && !hearing && req.url !== '/api/chat')) return json(404, { error: 'route' });
    if (req.headers.origin !== 'http://' + authority) return json(403, { error: 'origin' });
    if (!req.headers.cookie?.split(/;\s*/).includes('abyssinia_' + server.address().port + '=' + session)) return json(401, { error: 'session' });
    if (req.headers['content-type'] !== 'application/json') return json(415, { error: 'type' });

    const length = Number(req.headers['content-length']);
    const maxBytes = capturing ? 2800100 : hearing ? 855000 : managing || req.headers['x-text-attachment'] === '1' ? 128 * 1024 : limits.request;
    if (!Number.isInteger(length) || length < 1 || length > maxBytes) {
      res.setHeader('Connection', 'close');
      return json(413, { error: 'size' });
    }
    let message;
    let conversation;
    let provider;
    let attachment;
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      if (managing) {
        if(data?.action==='voice.output')return json(200,{configured:!!voiceKey(),candidates,voices,speechScript,reviewed:control.reviewedVoice});
        if(data?.action==='voice.connect'){
          const signal=control.begin();
          if(!signal)return json(409,{error:'unavailable'});
          try{
            const key=await askGeminiKey(signal);
            signal.throwIfAborted();
            if(key){sessionVoiceKey=key;sampleTicket=null;control.record('voice.connect','completed','Gemini');}
            return json(200,{configured:!!voiceKey()});
          }catch{return json(409,{error:'unavailable'})}finally{control.end()}
        }
        if(data?.action==='voice.rate'){
          if(!sampleTicket||data.ticket!==sampleTicket.id||sampleTicket.expires<Date.now()||data.native!==true)return json(409,{error:'review'});
          try{
            const result=control.reviewVoice(sampleTicket.model,sampleTicket.voice,data.naturalness,data.clarity);
            sampleTicket=null;return json(200,result);
          }catch{return json(409,{error:'review'})}
        }
        if(data?.action==='voice.sample'||data?.action==='voice.speak'){
          const sample=data.action==='voice.sample';
          const pair=sample?data:control.reviewedVoice;
          if(!pair||!voiceKey())return json(409,{error:'unavailable'});
          const signal=control.begin();
          if(!signal)return json(409,{error:'unavailable'});
          try{
            const audio=await synthesize(sample?speechScript:data.text,pair.model,pair.voice,signal,voiceKey());
            signal.throwIfAborted();control.record(data.action,'completed',pair.model+'/'+pair.voice);
            if(sample)sampleTicket={id:randomUUID(),model:pair.model,voice:pair.voice,expires:Date.now()+600000};
            return json(200,{audio,...(sample&&{ticket:sampleTicket.id})});
          }catch{return json(502,{error:'speech'})}
          finally{control.end()}
        }
        if(data?.action==='voice.models')return json(200,{models:speechModels()});
        if(data?.action==='mcp.check'){
          let connection;
          try{connection=control.connection(data.id)}catch{return json(409,{error:'unavailable'})}
          const signal=control.begin();
          if(!signal)return json(409,{error:'unavailable'});
          try {
            const result=await discoverMcp(connection.url,signal);
            signal.throwIfAborted();control.discovery(connection.id,{...result,error:false});
            return json(200,{ok:true});
          }catch{control.discovery(connection.id,{error:true,tools:[],capabilities:[]});return json(502,{error:'mcp'});}
          finally{control.end();}
        }
        if(data?.action==='code.check'){
          let snapshot;
          try{snapshot=control.execute({action:'code.read'});}catch{return json(409,{error:'unavailable'});}
          if(snapshot.grant!==data.grant)return json(409,{error:'unavailable'});
          const signal=control.begin();
          if(!signal)return json(409,{error:'unavailable'});
          try{
            const result=await checkDraft(snapshot.target,data.text,signal);
            control.record('code.check',result.valid?'passed':'failed',snapshot.target);
            return json(200,result);
          }catch{return json(400,{error:'unsupported'})}finally{control.end()}
        }
        if (data?.action==='code.pick') {
          const signal=control.begin();
          if(!signal)return json(409,{error:'unavailable'});
          try {
            const path=await pickFile(signal);
            signal.throwIfAborted();
            return json(200,path?control.grantFile(path):{cancelled:true});
          }catch{return json(409,{error:'picker'});}
          finally{control.end();}
        }
        try { return json(200, await control.execute(data)); }
        catch (error) { return json(409, { error: ['invalid','expired','stale','write_failed'].includes(error.message) ? error.message : 'unavailable' }); }
      }
      if (searching || capturing || hearing) {
        if (control.paused) return json(423,{error:'paused'});
        const signal = control.begin();
        if (!signal) return json(429,{error:'busy'});
        try {
          const result = hearing ? await transcribe(data.pcm,data.model,signal) : capturing ? await readScreen(data.image,signal) : {sources:await referenceSearch(data.query,data.language,signal)};
          signal.throwIfAborted();
          control.record(hearing?'speech.transcribe':capturing?'screen.read':'research','completed'); return json(200,result);
        } catch (error) {
          control.record(hearing?'speech.transcribe':capturing?'screen.read':'research',signal.aborted?'interrupted':'failed');
          return json(signal.aborted?423:error.message==='invalid'?400:502,{error:capturing?'screen':'research'});
        } finally {control.end();}
      }
      provider = resolveProvider(data?.provider);
      if (!provider && (testing || data?.provider !== undefined || reply === hermesReply)) return json(409, { error: 'provider' });
      message = testing ? 'Reply with OK.' : typeof data?.message === 'string' ? data.message.trim() : '';
      conversation = testing ? undefined : data?.conversation;
      attachment = testing ? undefined : data?.attachment;
      if (attachment !== undefined && (typeof attachment?.text !== 'string' ||
          Buffer.byteLength(attachment.text) > 16384 || typeof attachment.name !== 'string' ||
          !attachment.name || attachment.name.length > 255)) return json(400, { error: 'attachment' });
    } catch {
      return json(400, { error: 'message' });
    }
    if (!message || message.length > limits.message) return json(400, { error: 'message' });
    // Omit for a standalone turn, send null to start a chat, or reuse its handle.
    if (conversation != null && typeof conversation !== 'string') return json(400, { error: 'conversation' });
    if (typeof conversation === 'string' && !conversations.has(conversation)) {
      return json(410, { error: 'conversation' });
    }
    if (control.paused) return json(423, { error: 'paused' });
    const signal = control.begin();
    if (!signal) return json(429, { error: 'busy' });
    const action = testing ? 'provider.test' : 'chat';
    try {
      const prior = conversations.get(conversation);
      const route = JSON.stringify([provider?.base, provider?.model]);
      if (prior && prior.route !== route) return json(409, { error: 'provider_changed' });
      let read = false;
      let onDelta;
      if(!testing && req.headers.accept==='application/x-ndjson'){
        res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});
        res.write(JSON.stringify({state:'thinking'})+'\n');
        onDelta=delta=>{if(!attachment&&!res.destroyed&&!signal.aborted)res.write(JSON.stringify({delta})+'\n');};
      }
      const answer = await reply(message, prior?.turns ?? [], provider, attachment, () => { read = true; }, signal,onDelta);
      signal.throwIfAborted();
      if (attachment && !read) {
        control.record('attachment.read', 'unused');
        return json(422, {error:'attachment_unread'});
      }
      if (read) control.record('attachment.read', 'completed');
      control.record(action, 'completed');
      if (testing) return json(200, { ok: true, model: provider.model });
      if (conversation === undefined) return json(200, { reply: answer });
      const id = conversation ?? randomUUID();
      const turns = [...(prior?.turns ?? []), { role: 'user', content: message }, { role: 'assistant', content: answer }];
      conversations.delete(id);
      conversations.set(id, { route, turns: turns.slice(-8) });
      if (conversations.size > 32) conversations.delete(conversations.keys().next().value);
      return json(200, { reply: answer, conversation: id, ...(read && { tool: 'read_attached_text' }) });
    } catch {
      control.record(action, signal.aborted ? 'interrupted' : 'failed');
      if (signal.aborted) return json(423, { error: 'paused' });
      return json(502, { error: 'provider_failed' });
    } finally {
      control.end();
    }
  });
  const timer = setInterval(() => {
    try { control.tick(); } catch { console.error('Reminder storage unavailable.'); }
  }, 5000);
  timer.unref();
  server.once('close', () => clearInterval(timer));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.ASSISTANT_PORT ?? 8788);
  createAssistant().listen(port, loopback, () => console.log('http://127.0.0.1:' + port));
}
