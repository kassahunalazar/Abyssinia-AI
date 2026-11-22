import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, opendirSync,
  readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { bindProjectWorktree, checkRepository, inspectRepository, readRepositoryFile } from './repository-workspace.mjs';

const execute = promisify(execFile);
const revisionPattern = /^[a-f0-9]{40}$/u;
const byteLimit = 64 * 1024 * 1024;
const fileLimit = 4096;
const blobLimit = 8 * 1024 * 1024;

function pathInside(root, path) {
  const child = relative(root, path);
  return !isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep);
}

function stat(path) {
  const result = lstatSync(path, { bigint: true });
  const real = realpathSync(path);
  const exact = process.platform === 'win32' ? real.toLowerCase() === path.toLowerCase() : real === path;
  if (result.isSymbolicLink() || !exact) throw Error('invalid');
  return result;
}

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.ctimeNs === b.ctimeNs && a.mtimeNs === b.mtimeNs;
}

function readRegular(path, limit) {
  const before = stat(path);
  if (!before.isFile() || before.nlink !== 1n || before.size > limit) throw Error('invalid');
  const handle = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    if (!sameFile(before, fstatSync(handle, { bigint: true }))) throw Error('stale');
    const bytes = Buffer.alloc(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(handle, bytes, offset, bytes.length - offset, null);
      if (!count) throw Error('stale');
      offset += count;
    }
    if (!sameFile(before, stat(path))) throw Error('stale');
    return bytes;
  } finally {
    closeSync(handle);
  }
}

function gitDirectory(repository) {
  checkRepository(repository);
  const git = join(repository.root, '.git');
  if (repository.protectedDirectory && pathInside(repository.protectedDirectory, git)) throw Error('invalid');
  try {
    if (stat(git).isDirectory()) return git;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  throw Error('unsupported');
}

export function projectHead(repository) {
  const git = gitDirectory(repository);
  const head = readRegular(join(git, 'HEAD'), 1024).toString('ascii').trim();
  if (revisionPattern.test(head)) return head;
  const ref = /^ref: (refs\/heads\/[A-Za-z0-9._/-]{1,255})$/u.exec(head)?.[1];
  if (!ref || ref.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock') || part.includes('..')))
    throw Error('unsupported');
  let oid;
  try {
    oid = readRegular(join(git, ...ref.split('/')), 1024).toString('ascii').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      const packed = readRegular(join(git, 'packed-refs'), 1024 * 1024).toString('ascii');
      oid = packed.split(/\r?\n/u).find(line => line.slice(41) === ref)?.slice(0, 40);
    } catch (missing) {
      if (missing.code !== 'ENOENT') throw missing;
    }
  }
  if (!revisionPattern.test(oid)) throw Error('unsupported');
  return oid;
}

export function localTool(name) {
  const folders = process.platform === 'win32'
    ? name === 'git'
      ? [join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git', 'cmd')]
      : [join(process.env.ProgramFiles ?? 'C:/Program Files', 'Docker', 'Docker', 'resources', 'bin')]
    : ['/usr/bin', '/usr/local/bin'];
  for (const folder of folders) {
    const path = join(folder, name + (process.platform === 'win32' ? '.exe' : ''));
    if (!isAbsolute(path)) continue;
    try {
      if (lstatSync(path).isFile()) return path;
    } catch {
      // Tool is not installed at this location.
    }
  }
}

function visitDirectory(path, consume) {
  if (!stat(path).isDirectory()) throw Error('invalid');
  const directory = opendirSync(path);
  try {
    for (let entry; (entry = directory.readSync());) consume(entry.name);
  } finally {
    directory.closeSync();
  }
}

function copyObjects(source, destination, signal) {
  let remaining = byteLimit;
  let entries = 0;
  function count() {
    signal.throwIfAborted();
    if (++entries > fileLimit + 256) throw Error('invalid');
  }
  function copy(bucket, file) {
    count();
    const bytes = readRegular(join(source, bucket, file), remaining);
    remaining -= bytes.length;
    mkdirSync(join(destination, bucket), { recursive: true });
    writeFileSync(join(destination, bucket, file), bytes, { flag: 'wx' });
  }
  visitDirectory(source, bucket => {
    count();
    const pack = bucket === 'pack';
    if (!pack && !/^[a-f0-9]{2}$/u.test(bucket)) return;
    visitDirectory(join(source, bucket), file => {
      if (pack ? /^pack-[a-f0-9]{40}\.(?:pack|idx)$/u.test(file) : /^[a-f0-9]{38}$/u.test(file))
        copy(bucket, file);
      else count();
    });
  });
}

function checkedTree(data) {
  const rows = data.split('\0');
  rows.pop();
  if (rows.length > fileLimit) throw Error('invalid');
  const names = new Map();
  return rows.map(row => {
    const entry = /^(100644|100755) blob ([a-f0-9]{40}) +([0-9]+)\t([^\0]+)$/u.exec(row);
    if (!entry) throw Error('unsupported');
    const path = entry[4];
    const parts = path.split('/');
    let key = '';
    for (const [index, part] of parts.entries()) {
      if (!part || /^\.{1,2}$/u.test(part) || /^\.git$/iu.test(part) ||
          /[<>:"|?*\\\x00-\x1f\x7f\uFFFD]|[. ]$/u.test(part) ||
          /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]) *(?:\.|$)/iu.test(part)) throw Error('invalid');
      key += '/' + part.toLowerCase();
      // Track directories as well as files to prevent ambiguous Windows checkouts.
      const end = index === parts.length - 1;
      const spelling = '/' + parts.slice(0, index + 1).join('/');
      const marker = (end ? 'file:' : 'dir:') + spelling;
      const prior = names.get(key);
      if (prior && (prior !== marker || end)) throw Error('invalid');
      names.set(key, marker);
    }
    if (path.length > 1024 || parts.length > 16 || Number(entry[3]) > blobLimit) throw Error('invalid');
    return { path, size: Number(entry[3]), executable: entry[1] === '100755' };
  });
}

function safeEnvironment(stage) {
  return {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: stage, TMP: stage,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(stage, 'empty-config'),
    GIT_CONFIG_SYSTEM: join(stage, 'empty-config'), GIT_TERMINAL_PROMPT: '0',
    GIT_ATTR_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: '', GIT_OPTIONAL_LOCKS: '0',
  };
}

function tarHeader(path, length, mode, type = '0') {
  const header = Buffer.alloc(512);
  const octal = (value, offset, width) => header.write(value.toString(8).padStart(width - 1, '0') + '\0', offset, width, 'ascii');
  header.write(path, 0, 100, 'utf8');
  octal(mode, 100, 8);
  octal(0, 108, 8);
  octal(0, 116, 8);
  octal(length, 124, 12);
  octal(0, 136, 12);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  octal(header.reduce((sum, value) => sum + value, 0), 148, 7);
  return header;
}

function appendArchiveFile(parts, path, bytes, mode, index) {
  const pad = data => Buffer.alloc((512 - data.length % 512) % 512);
  if (Buffer.byteLength(path) > 100) {
    const record = ' path=' + path + '\n';
    const length = Buffer.byteLength(record);
    let size = length;
    while (size !== length + String(size).length) size = length + String(size).length;
    const extended = Buffer.from(String(size) + record);
    parts.push(tarHeader('PaxHeaders/' + index, extended.length, 0o644, 'x'), extended, pad(extended));
    path = 'file-' + index;
  }
  parts.push(tarHeader(path, bytes.length, mode), bytes, pad(bytes));
}

export function snapshotWorktree(worktree) {
  checkRepository(worktree.scope);
  const parts = [];
  let remaining = byteLimit;
  for (const [index, file] of worktree.files.entries()) {
    let bytes;
    try {
      bytes = readRegular(join(worktree.path, ...file.path.split('/')), Math.min(blobLimit, remaining));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    remaining -= bytes.length;
    appendArchiveFile(parts, file.path, bytes, file.executable ? 0o755 : 0o644, index);
  }
  checkRepository(worktree.scope);
  parts.push(Buffer.alloc(1024));
  const archive = Buffer.concat(parts);
  return { archive, hash: createHash('sha256').update(archive).digest('hex') };
}

const inspectionArgs = {
  status: ['status', '--porcelain=v1', '--untracked-files=normal'],
  diff: ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--submodule=short'],
};

export async function inspectProjectWorktree(worktree, operation, query, signal) {
  checkRepository(worktree.scope);
  let text;
  if (operation === 'grep') {
    const matches = [];
    const { files } = inspectRepository(worktree.scope);
    for (const file of files) {
      signal.throwIfAborted();
      let content;
      try { content = readRepositoryFile(worktree.scope, file.path).text; }
      catch { continue; }
      const lines = content.split(/\r?\n/u);
      for (const [index, line] of lines.entries()) {
        if (line.includes(query)) matches.push(file.path + ':' + (index + 1) + ': ' + line.slice(0, 512));
        if (matches.length >= 200) break;
      }
      if (matches.length >= 200) break;
    }
    text = matches.join('\n');
  } else {
    const executable = localTool('git');
    if (!executable || !Object.hasOwn(inspectionArgs, operation)) throw Error('unsupported');
    const git = join(worktree.stage, 'repository.git');
    const config = readRegular(join(git, 'config'), 8192);
    if (createHash('sha256').update(config).digest('hex') !== worktree.configHash ||
        readRegular(join(worktree.stage, 'empty-config'), 1).length) throw Error('stale');
    const administrativeDir = join(git, 'worktrees', 'checkout');
    if (!stat(administrativeDir).isDirectory() ||
        readRegular(join(administrativeDir, 'commondir'), 128).toString().trim() !== '../..') throw Error('stale');
    const args = [...inspectionArgs[operation]];
    if (operation === 'diff') args.push(worktree.revision, '--');
    const result = await execute(executable, [
      '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=' + join(worktree.stage, 'empty-hooks'),
      '-c', 'protocol.allow=never', '--no-pager', '--git-dir=' + administrativeDir, '--work-tree=' + worktree.path, ...args,
    ], { cwd: worktree.stage, env: safeEnvironment(worktree.stage), signal, timeout: 8000,
      maxBuffer: 2 * 1024 * 1024, windowsHide:true });
    text = result.stdout;
  }
  checkRepository(worktree.scope);
  const bytes = Buffer.from(text);
  const limit = 24 * 1024;
  return { code:0, output:bytes.subarray(0,limit).toString('utf8'), truncated:bytes.length > limit };
}

export async function createProjectWorktree(repository, expected, storage, signal) {
  if (!revisionPattern.test(expected) || projectHead(repository) !== expected) throw Error('stale');
  const executable = localTool('git');
  if (!executable) throw Error('unsupported');
  mkdirSync(storage, { recursive: true, mode: 0o700 });
  if (!stat(storage).isDirectory()) throw Error('invalid');
  const stage = mkdtempSync(join(storage, 'worktree-'));
  const git = join(stage, 'repository.git');
  const path = join(stage, 'checkout');
  const hooks = join(stage, 'empty-hooks');
  mkdirSync(hooks);
  writeFileSync(join(stage, 'empty-config'), '');
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  const env = safeEnvironment(stage);
  const gitRun = (args, options = {}) => execute(executable, [
    '-c', 'core.hooksPath=' + hooks, '-c', 'protocol.allow=never', '-c', 'core.symlinks=false',
    '-c', 'core.protectNTFS=true', '-c', 'core.protectHFS=true', ...args,
  ], { cwd: stage, env, signal: deadline, timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, ...options });
  try {
    await gitRun(['init', '--bare', '--template=', git]);
    copyObjects(join(gitDirectory(repository), 'objects'), join(git, 'objects'), deadline);
    checkRepository(repository);
    const { stdout } = await gitRun(['--git-dir=' + git, 'ls-tree', '-r', '-l', '-z', expected]);
    const files = checkedTree(stdout);
    if (files.reduce((total, file) => total + file.size, 0) > byteLimit) throw Error('invalid');
    await gitRun(['--git-dir=' + git, 'worktree', 'add', '--detach', '--no-guess-remote', '--', path, expected]);
    deadline.throwIfAborted();
    const scope = bindProjectWorktree(path, stage);
    const configHash = createHash('sha256').update(readRegular(join(git, 'config'), 8192)).digest('hex');
    return { revision: expected, path, stage, files, scope, configHash };
  } catch (error) {
    if (pathInside(storage, stage) && dirname(stage) === storage && stat(stage).isDirectory())
      rmSync(stage, { recursive: true, force: true });
    throw Object.assign(Error(error.message === 'invalid' ? 'invalid' : error.message === 'unsupported' ? 'unsupported' : 'unavailable'), { cause: error });
  }
}
