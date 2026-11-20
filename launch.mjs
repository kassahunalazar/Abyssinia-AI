import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAssistant } from './server.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const env = process.env;
const port = Number(env.ASSISTANT_PORT ?? 8789);
const url = 'http://127.0.0.1:' + port;
const home = join(env.LOCALAPPDATA ?? '', 'hermes');
env.ASSISTANT_HERMES_SOURCE ??= join(home, 'hermes-agent');
if (!env.ASSISTANT_PYTHON) {
  const installs = join(home, 'installs');
  const candidates = [];
  for (const install of existsSync(installs) ? readdirSync(installs) : []) {
    const dir = join(installs, install, 'environments');
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const exe = join(dir, entry, 'venv', 'Scripts', 'python.exe');
      if (existsSync(exe)) candidates.push({exe, time:statSync(join(dir, entry)).mtimeMs});
    }
  }
  const latest = candidates.sort((a,b)=>b.time-a.time)[0];
  if (latest) env.ASSISTANT_PYTHON = latest.exe;
}
if (!existsSync(env.ASSISTANT_PYTHON ?? '') || !existsSync(join(env.ASSISTANT_HERMES_SOURCE,'run_agent.py'))) {
  throw Error('Set ASSISTANT_PYTHON and ASSISTANT_HERMES_SOURCE in .env to your installed Hermes environment.');
}
env.ASSISTANT_MODEL_URL ??= 'http://127.0.0.1:20128/v1';
env.ASSISTANT_MODEL_ID ??= 'kc/openrouter/free';
const server = createAssistant();
server.on('error', async error => {
  if (error.code === 'EADDRINUSE') {
    try {
      const page = await fetch(url,{signal:AbortSignal.timeout(3000)});
      if ((await page.text()).includes('<title>Abyssinia AI</title>')) {
        console.log('Abyssinia AI is already running at ' + url);
        return;
      }
    } catch {}
  }
  console.error('Unable to start Abyssinia AI:', error.code);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log('Open Abyssinia AI at ' + url + '\nPress Ctrl+C to stop the gateway.'));
