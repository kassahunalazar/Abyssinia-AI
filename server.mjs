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

const root = fileURLToPath(new URL('.', import.meta.url));
const loopback = '127.0.0.1';
const limits = { request: 16384, message: 4000, reply: 64000 };
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/settings.js': ['settings.js', 'text/javascript; charset=utf-8'],
  '/controls.js': ['controls.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

export function hermesReply(message, history = [], provider = resolveProvider(), attachment, onRead, signal) {
  const { ASSISTANT_PYTHON, ASSISTANT_HERMES_SOURCE } = process.env;
  const { base: ASSISTANT_MODEL_URL, model: ASSISTANT_MODEL_ID, key } = provider ?? {};
  if (![ASSISTANT_PYTHON, ASSISTANT_HERMES_SOURCE, ASSISTANT_MODEL_URL, ASSISTANT_MODEL_ID].every(Boolean)) {
    throw new Error('Missing Hermes configuration.');
  }
  return new Promise((accept, reject) => {
    const child = spawn(ASSISTANT_PYTHON, ['-I', '-B', resolve(root, 'hermes_worker.py')], {
      cwd: resolve(root, '.runtime'),
      env: {
        SystemRoot: process.env.SystemRoot,
        PATH: process.env.SystemRoot ? resolve(process.env.SystemRoot, 'System32') : '/usr/bin:/bin',
        TEMP: resolve(root, '.runtime'),
        TMP: resolve(root, '.runtime'),
        HOME: resolve(root, '.runtime'),
        USERPROFILE: resolve(root, '.runtime'),
        HERMES_HOME: resolve(root, '.runtime', 'hermes'),
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
    const chunks = [];
    let size = 0;
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > limits.reply) child.kill();
      else chunks.push(chunk);
    });
    child.stdin.on('error', reject);
    child.on('error', reject);
    child.on('close', code => {
      try {
        if (code !== 0 || size > limits.reply) throw new Error('Hermes run failed.');
        const { reply, attachmentRead } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof reply !== 'string' || !reply.trim()) throw new Error('Invalid Hermes response.');
        if (attachment && attachmentRead) onRead?.();
        accept(reply);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ message, history, attachment }));
  });
}

export function createAssistant({ reply = hermesReply, stateDirectory = resolve(root, '.runtime', 'product') } = {}) {
  const control = workspaceControl(stateDirectory);
  const session = randomUUID();
  const conversations = new Map();
  const server = createServer({ requestTimeout: 10000, headersTimeout: 5000 }, async (req, res) => {
    const authority = loopback + ':' + server.address().port;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, data) => {
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
    if (req.method !== 'POST' || (!testing && !managing && !searching && !capturing && req.url !== '/api/chat')) return json(404, { error: 'route' });
    if (req.headers.origin !== 'http://' + authority) return json(403, { error: 'origin' });
    if (!req.headers.cookie?.split(/;\s*/).includes('abyssinia_' + server.address().port + '=' + session)) return json(401, { error: 'session' });
    if (req.headers['content-type'] !== 'application/json') return json(415, { error: 'type' });

    const length = Number(req.headers['content-length']);
    const maxBytes = capturing ? 2800100 : managing || req.headers['x-text-attachment'] === '1' ? 128 * 1024 : limits.request;
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
        try { return json(200, control.execute(data)); }
        catch (error) { return json(409, { error: ['invalid','expired','write_failed'].includes(error.message) ? error.message : 'unavailable' }); }
      }
      if (searching || capturing) {
        if (control.paused) return json(423,{error:'paused'});
        const signal = control.begin();
        if (!signal) return json(429,{error:'busy'});
        try {
          const result = capturing ? await readScreen(data.image,signal) : {sources:await referenceSearch(data.query,data.language,signal)};
          signal.throwIfAborted();
          control.record(capturing?'screen.read':'research','completed'); return json(200,result);
        } catch (error) {
          control.record(capturing?'screen.read':'research',signal.aborted?'interrupted':'failed');
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
      const answer = await reply(message, prior?.turns ?? [], provider, attachment, () => { read = true; }, signal);
      signal.throwIfAborted();
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
