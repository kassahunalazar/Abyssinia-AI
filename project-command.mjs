import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { localTool, snapshotWorktree } from './project-worktree.mjs';

const execute = promisify(execFile);
const imagePattern = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,200}$/u;
const commandPattern = /^(?:\.\/)?[A-Za-z0-9][A-Za-z0-9._/-]{0,95}$/u;
const outputLimit = 24 * 1024;

export function projectCommandConfig() {
  const image = process.env.ASSISTANT_PROJECT_CONTAINER_IMAGE;
  if (typeof image !== 'string' || !imagePattern.test(image)) return;
  const executable = localTool('docker');
  if (executable) return { image, executable };
}

export function projectCommand(command, args) {
  if (typeof command !== 'string' || !commandPattern.test(command) || !Array.isArray(args) || args.length > 32 ||
      args.some(value => typeof value !== 'string' || Buffer.byteLength(value) > 512 || /[\x00-\x1f\x7f]/u.test(value)))
    throw Error('invalid');
  return { command, args };
}

export function commandContainerArgs(name, image, request) {
  return ['container', 'create', '--name', name, '--interactive', '--network=none', '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=512m',
    '--memory-swap=512m', '--cpus=1', '--user=65534:65534', '--init', '--restart=no', '--log-driver=none',
    '--tmpfs=/workspace:rw,exec,nosuid,nodev,size=160m,mode=1777',
    '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=48m,mode=1777', '--env=HOME=/tmp', '--workdir=/workspace',
    '--pull=never', '--entrypoint=/bin/sh', image,
    '-c', 'tar --no-same-owner --no-same-permissions -xf - && exec "$@"', 'project-command',
    request.command, ...request.args];
}

function startContainer(executable, prefix, name, options, archive, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...prefix, 'container', 'start', '--attach', '--interactive', name],
      { ...options, signal, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [];
    let stored = 0;
    let truncated = false;
    const collect = chunk => {
      const take = Math.min(chunk.length, outputLimit - stored);
      if (take) output.push(chunk.subarray(0, take));
      stored += take;
      if (take < chunk.length) truncated = true;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.stdin.on('error', () => {});
    child.once('error', reject);
    child.once('close', (code, reason) => {
      if (code === null || reason) reject(Error('unavailable'));
      else resolve({ code, output: new TextDecoder().decode(Buffer.concat(output)), truncated });
    });
    child.stdin.end(archive);
  });
}

export async function runProjectCommand(config, worktree, request, signal) {
  const { archive, hash } = snapshotWorktree(worktree);
  if (request.snapshotHash !== hash) throw Error('stale');
  const name = 'abyssinia-project-' + randomUUID();
  const host = process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';
  const prefix = ['--host', host, '--config', worktree.stage];
  const options = { cwd: worktree.stage, windowsHide: true, env: {
    SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: worktree.stage, TMP: worktree.stage,
  } };
  const cli = (args, extra = {}) => execute(config.executable, [...prefix, ...args], {
    ...options, timeout: 12000, maxBuffer: 32 * 1024, ...extra,
  });
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
  const inspect = await cli(['image', 'inspect', '--format={{.Os}} {{.Id}}', config.image], { signal: deadline });
  const image = /^linux (sha256:[a-f0-9]{64})$/u.exec(inspect.stdout.trim())?.[1];
  if (!image) throw Error('unsupported');
  let created = false;
  try {
    await cli(commandContainerArgs(name, image, request), { signal: deadline });
    created = true;
    const result = await startContainer(config.executable, prefix, name, options, archive, deadline);
    const state = await cli(['container', 'inspect', '--format={{.State.Status}} {{.State.ExitCode}}', name], { signal: deadline });
    const code = /^exited ([0-9]{1,3})$/u.exec(state.stdout.trim())?.[1];
    if (code === undefined) throw Error('unavailable');
    return { ...result, code: Number(code) };
  } finally {
    try {
      await cli(['container', 'rm', '--force', '--volumes', name]);
    } catch (error) {
      if (created) throw Object.assign(Error('unavailable'), { cause: error });
    }
  }
}
