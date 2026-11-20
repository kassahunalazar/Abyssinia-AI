import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const loopback = '127.0.0.1';
const limits = { request: 16384, message: 4000, reply: 64000 };
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

export function hermesReply(message) {
  const { ASSISTANT_PYTHON, ASSISTANT_HERMES_SOURCE, ASSISTANT_MODEL_URL, ASSISTANT_MODEL_ID } = process.env;
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
        ASSISTANT_MODEL_KEY: process.env.ASSISTANT_MODEL_KEY,
      },
      windowsHide: true,
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
        const { reply } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof reply !== 'string' || !reply.trim()) throw new Error('Invalid Hermes response.');
        accept(reply);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ message }));
  });
}

export function createAssistant({ reply = hermesReply } = {}) {
  let busy = false;
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
        res.writeHead(200, { 'Content-Type': type });
        return res.end(content);
      } catch {
        return json(500, { error: 'asset' });
      }
    }
    if (req.method !== 'POST' || req.url !== '/api/chat') return json(404, { error: 'route' });
    if (req.headers.origin !== 'http://' + authority) return json(403, { error: 'origin' });
    if (req.headers['content-type'] !== 'application/json') return json(415, { error: 'type' });

    const length = Number(req.headers['content-length']);
    if (!Number.isInteger(length) || length < 1 || length > limits.request) {
      res.setHeader('Connection', 'close');
      return json(413, { error: 'size' });
    }
    let message;
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      message = typeof data?.message === 'string' ? data.message.trim() : '';
    } catch {
      return json(400, { error: 'message' });
    }
    if (!message || message.length > limits.message) return json(400, { error: 'message' });
    if (busy) return json(429, { error: 'busy' });
    busy = true;
    try {
      return json(200, { reply: await reply(message) });
    } catch {
      return json(502, { error: 'hermes' });
    } finally {
      busy = false;
    }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createAssistant().listen(8788, loopback, () => console.log('http://127.0.0.1:8788'));
}
