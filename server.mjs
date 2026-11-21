import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, resolve } from 'node:path';
import { resolveProvider } from './providers.mjs';
import { workspaceControl } from './workspace-control.mjs';
import { referenceSearch } from './reference-search.mjs';
import { wikiArticle } from './browser-reader.mjs';
import { readScreen } from './screen-reader.mjs';
import { pickSourceFile, checkDraft } from './code-workspace.mjs';
import { pickRepository as pickRepositoryFolder } from './repository-workspace.mjs';
import { discoverMcp } from './mcp-connections.mjs';
import { speechModels, transcribe } from './speech.mjs';
import { candidates, voices, speechScript, synthesize } from './speech-output.mjs';
import { askGeminiKey } from './gemini-key.mjs';
import { nativeSkills } from './native-skills.mjs';

import { wantsReminder, listsReminders, relativeReminder, validateDraft } from './web/reminders.js';

import { tools as capabilities, skills, providerProbe } from './web/capability-catalog.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const runtime = resolve(process.env.ASSISTANT_RUNTIME_DIR ?? resolve(root, '.runtime'));
const loopback = '127.0.0.1';
const limits = { request: 16384, message: 4000, reply: 64000 };
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/reminders.js': ['reminders.js','text/javascript; charset=utf-8'],
  '/theme.js': ['theme.js', 'text/javascript; charset=utf-8'],
  '/settings.js': ['settings.js', 'text/javascript; charset=utf-8'],
  '/controls.js': ['controls.js', 'text/javascript; charset=utf-8'],
  '/voice.js': ['voice.js','text/javascript; charset=utf-8'],
  '/capability-catalog.js': ['capability-catalog.js','text/javascript; charset=utf-8'],
  '/capabilities.js': ['capabilities.js','text/javascript; charset=utf-8'],
  '/browser-reader.js': ['browser-reader.js','text/javascript; charset=utf-8'],
  '/fonts/NotoSansEthiopic.ttf': ['fonts/NotoSansEthiopic.ttf','font/ttf'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

export function hermesReply(message, history = [], provider = resolveProvider(), attachment, onRead, signal, onDelta, onSchedule, extension) {
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
          else if(item.activity)extension?.onActivity?.(item.activity);
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
        if (final.schedule && onSchedule) onSchedule(final.schedule);
        if (final.proposedAction && extension?.onAction) extension.onAction(final.proposedAction);
        accept(reply);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ message, history, attachment,capability:extension?.capability,skill:extension?.skill,nativeToolset:extension?.nativeToolset,progress:!!extension?.onActivity,stream:!!onDelta,schedule:onSchedule?{now:new Date().toISOString(),zone:Intl.DateTimeFormat().resolvedOptions().timeZone}:undefined }));
  });
}

export function createAssistant({ reply = hermesReply, stateDirectory = resolve(runtime, 'product'),
  pickFile = pickSourceFile, pickRepository = pickRepositoryFolder, readArticle } = {}) {
  const control = workspaceControl(stateDirectory, undefined, undefined, readArticle);
  const session = randomUUID();
  const conversations = new Map();
  let sampleTicket;
  let skillCatalog;
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
    let scoped, skill, target, controlId, codeSnapshot, projectFiles, testingTools, nativeToolset;
    let provider;
    let attachment;
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      if (managing) {
        if(data?.action==='skills.native'){
          if(control.paused)return json(423,{error:'paused'});
          if(skillCatalog)return json(200,{skills:skillCatalog});
          const signal=control.begin();
          if(!signal)return json(409,{error:'busy'});
          try{skillCatalog=await nativeSkills({signal});return json(200,{skills:skillCatalog});}
          catch{return json(503,{error:'skills_unavailable'});}finally{control.end();}
        }
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
          res.once('close',()=>{if(!res.writableEnded)control.cancel(signal);});
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
        if (data?.action==='code.pick' || data?.action==='code.pickRepository') {
          const folder = data.action === 'code.pickRepository';
          const signal=control.begin();
          if(!signal)return json(409,{error:'unavailable'});
          res.once('close',()=>{if(!res.writableEnded)control.cancel(signal);});
          try {
            const path=await (folder ? pickRepository(signal) : pickFile(signal));
            signal.throwIfAborted();
            return json(200,path?(folder ? control.grantRepository(path) : control.grantFile(path)):{cancelled:true});
          }catch{return json(409,{error:'picker'});}
          finally{control.end();}
        }
        if(['code.projectSnapshot','code.projectPropose'].includes(data?.action))return json(400,{error:'scope'});
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
      const localSchedule=!testing&&!data?.attachment&&(listsReminders(data?.message)||relativeReminder(String(data?.message),Date.now()));
      if (!provider && !localSchedule && (testing || data?.provider !== undefined || reply === hermesReply)) return json(409, { error: 'provider' });
      testingTools=testing && data?.mode==='tools';
      message = testing ? testingTools?'Call confirm_tool_call with code READY, then reply with OK.':'Reply with OK.' :
        typeof data?.message === 'string' ? data.message.trim() : '';
      conversation = testing ? undefined : data?.conversation;
      attachment = testing ? undefined : data?.attachment;
      if(!testing && data?.skill!==undefined){
        if(typeof data.skill!=='string')return json(400,{error:'skill'});
        if(Object.hasOwn(skills,data.skill)){
          skill=skills[data.skill].guidance;
          nativeToolset=skills[data.skill].native;
        }else if(skillCatalog?.some(item=>'hermes/'+(item.category??'')+'/'+item.name===data.skill)){
          nativeToolset=data.skill;
        }else return json(400,{error:'skill'});
      }
      if(!testing && data?.scope!==undefined){
        const name=data.scope?.name;
        if(attachment || typeof name!=='string' || !Object.hasOwn(capabilities,name))return json(400,{error:'scope'});
        scoped=name;target=data.scope.target;
        if(name==='browser') {
          try { target = wikiArticle(target); } catch { return json(400,{error:'scope'}); }
        } else if(!['research','specialist'].includes(name) && (typeof target!=='string' || target.length>64))return json(400,{error:'scope'});
        if(name==='desktopControl'){
          controlId=data.scope.control;
          if(typeof controlId!=='string'||controlId.length>64)return json(400,{error:'scope'});
        }
        if(name==='project'){
          try{projectFiles=control.execute({action:'code.projectSnapshot',repository:target,paths:data.scope.paths});}
          catch{return json(409,{error:'scope_unavailable'});}
          attachment={name:'project-files.json',text:JSON.stringify(projectFiles.map(({path,text})=>({path,text})))};
        }
        if(name==='source'){
          try{codeSnapshot=control.execute({action:'code.read'});}catch{return json(409,{error:'scope_unavailable'});}
          if(codeSnapshot.grant!==target || Buffer.byteLength(codeSnapshot.text)>16384)return json(409,{error:'scope_unavailable'});
          attachment={name:basename(codeSnapshot.target),text:codeSnapshot.text};
        }
      }
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
    res.once('close',()=>{if(!res.writableEnded)control.cancel(signal);});
    const action = testing ? 'provider.test' : 'chat';
    try {
      const prior = conversations.get(conversation);
      if(nativeToolset?.startsWith('hermes/')){
        skill=await nativeSkills({selected:nativeToolset.slice(7),signal});
        control.record('skill.selected','completed',nativeToolset);
        nativeToolset=undefined;
      }
      const route = JSON.stringify([provider?.base, provider?.model]);
      if (prior && prior.route !== route) return json(409, { error: 'provider_changed' });
      let read = false;
      let onDelta, onActivity;
      if(!testing && req.headers.accept==='application/x-ndjson'){
        res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});
        res.write(JSON.stringify({state:'thinking'})+'\n');
        onActivity=activity=>{if(!res.destroyed&&!signal.aborted)res.write(JSON.stringify({activity})+'\n');};
        onDelta=delta=>{if(!attachment&&!res.destroyed&&!signal.aborted)res.write(JSON.stringify({delta})+'\n');};
      }
      const scheduling=!testing&&!scoped&&!attachment&&(wantsReminder(message)||(prior?.awaitingTime&&/ደቂቃ|ሰዓት|ነገ|ጠዋት|ማታ|\b(?:tomorrow|minutes?|hours?|am|pm|noon)\b|\d:\d/iu.test(message)));
      let draft=scheduling?relativeReminder(message,Date.now()):undefined;
      let answer, proposal, sources, approval, delegated;
      if(!testing&&!scoped&&!attachment&&listsReminders(message)){
        const active=control.execute({action:'status'}).reminders.filter(r=>r.status!=='delivered').sort((a,b)=>a.next-b.next);
        answer=active.length?active.map(r=>r.title+' · '+new Date(r.next).toLocaleString('am-ET')+(r.weekly?' · በየሳምንቱ':r.daily?' · በየቀኑ':'')+(r.status==='held'?' · ለአፍታ ቆሟል':'')).join('\n'):'የተመዘገበ ማስታወሻ የለም።';
      }else if(!draft){
        answer=await reply(message,prior?.turns??[],provider,attachment,()=>{read=true;},signal,scheduling||scoped?undefined:onDelta,
          scheduling?candidate=>{draft=validateDraft(candidate,Date.now());}:undefined,
          {skill,nativeToolset,onActivity,capability:testingTools?providerProbe:scoped?capabilities[scoped]:undefined,onAction:args=>{proposal=args;}});
      }
      if(scoped){
        signal.throwIfAborted();
        if(!proposal){
          answer='መሣሪያው ጥቅም ላይ አልዋለም። መሣሪያ ጥሪን የሚደግፍ ሞዴል ይምረጡ።';
        }else if(scoped==='specialist'){
          if(!['research','coding','planning'].includes(proposal.specialty)||typeof proposal.task!=='string'||!proposal.task.trim()||proposal.task.length>1600)
            return json(422,{error:'scope_unavailable'});
          answer=await reply(proposal.task,[],provider,undefined,undefined,signal,undefined,undefined,
            {skill:'You are a read-only '+proposal.specialty+' specialist. Give advice and analysis. You have no workspace, web, or action access.'});
          signal.throwIfAborted();
          delegated=proposal.specialty;
          control.record('hermes.specialist','completed',delegated);
        }else if(scoped==='research'){
          sources=await referenceSearch(proposal.query,proposal.language,signal);
          control.record('research','completed');
          answer=sources.length?'የተገኙ ምንጮች።':'ምንጭ አልተገኘም።';
        }else{
          try{
            if(scoped==='project'){
              if(!read||!Array.isArray(proposal.edits))return json(422,{error:'scope_unavailable'});
              const edits=proposal.edits.map(({path,text})=>{
                const file=projectFiles.find(item=>item.path===path);
                if(!file||typeof text!=='string')throw Error('scope');
                if(file.text.includes('\r\n')&&!file.text.replaceAll('\r\n','').includes('\n'))text=text.replace(/\r?\n/g,'\r\n');
                if(file.text.startsWith('\ufeff')&&!text.startsWith('\ufeff'))text='\ufeff'+text;
                return {path,text,fileId:file.fileId,before:file.text};
              });
              approval=control.execute({action:'code.projectPropose',repository:target,edits});
            }else if(scoped==='source'){
              if(!read || typeof proposal.text!=='string')return json(422,{error:'attachment_unread'});
              let text=proposal.text;
              if(!codeSnapshot.text.replaceAll('\r\n','').includes('\n') && codeSnapshot.text.includes('\r\n'))
                text=text.replace(/\r?\n/g,'\r\n');
              if(codeSnapshot.text.startsWith('\ufeff')&&!text.startsWith('\ufeff'))text='\ufeff'+text;
              approval=control.execute({action:'code.propose',grant:target,before:codeSnapshot.text,text});
            }else if(scoped==='browser'){
              if(proposal.read!==true || Object.keys(proposal).length!==1)return json(422,{error:'scope_unavailable'});
              approval=control.execute({action:'browser.propose',url:target});
            }else if(scoped==='desktop'||scoped==='desktopControl'){
              const allowed=scoped==='desktop'?['focus','scrollUp','scrollDown']:['invoke','setText'];
              if(!allowed.includes(proposal.operation))return json(422,{error:'scope_unavailable'});
              approval=control.execute({action:'desktop.propose',window:target,operation:proposal.operation,control:controlId,text:proposal.text});
            }else approval=control.execute({action:'mcp.time',id:target,timezone:proposal.timezone});
          }catch{return json(409,{error:'scope_unavailable'});}
          answer='እርምጃውን እንዲፈጽም በፈቃድ ጥያቄዎች ውስጥ ይገምግሙ።';
        }
      }
      if(scheduling){
        if(draft)draft.id=randomUUID();
        answer=draft?'ይህን ማስታወሻ አዘጋጅቻለሁ። ለመመዝገብ ርዕሱንና ሰዓቱን አረጋግጡ። · '+draft.title+' · '+new Date(draft.next).toLocaleString('am-ET',{timeZoneName:'short'}) :
          'ምን ላስታውስዎት? ቀኑንና ሰዓቱን ወይም ከስንት ደቂቃ በኋላ እንደሆነ ይግለጹ። ማስታወሻው ገና አልተመዘገበም።';
      }
      signal.throwIfAborted();
      if (attachment && !read) {
        control.record('attachment.read', 'unused');
        return json(422, {error:'attachment_unread'});
      }
      if (read) control.record('attachment.read', 'completed');
      control.record(action, 'completed');
      if (testingTools && proposal?.code!=='READY') return json(422,{error:'tool_not_used'});
      if (testing) return json(200, { ok: true, model: provider.model });
      const metadata={...(draft&&{reminder:draft}),...(sources&&{sources}),...(delegated&&{delegated}),...(approval&&{approval:approval.id})};
      if (conversation === undefined) return json(200, { reply: answer,...metadata });
      const id = conversation ?? randomUUID();
      const turns = [...(prior?.turns ?? []), { role: 'user', content: message }, { role: 'assistant', content: answer }];
      conversations.delete(id);
      conversations.set(id, { route, awaitingTime:scheduling&&!draft, turns: turns.slice(-8) });
      if (conversations.size > 32) conversations.delete(conversations.keys().next().value);
      return json(200, { reply: answer, conversation: id,...metadata, ...(read && { tool: 'read_attached_text' }) });
    } catch {
      control.record(action, signal.aborted ? 'interrupted' : 'failed');
      if (signal.aborted) return json(423, { error: 'paused' });
      return json(502, { error: 'provider_failed' });
    } finally {
      control.end();
    }
  });
  const timer = setInterval(() => {
    void control.tick(referenceSearch).catch(()=>console.error('Reminder storage unavailable.'));
  }, 5000);
  timer.unref();
  server.once('close', () => clearInterval(timer));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.ASSISTANT_PORT ?? 8788);
  createAssistant().listen(port, loopback, () => console.log('http://127.0.0.1:' + port));
}
