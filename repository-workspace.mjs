import { spawn } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { isSourceFile } from './code-workspace.mjs';

const maxBytes = 64 * 1024;
const maxFiles = 512;
const maxEntries = 4096;
const maxDepth = 12;
const maxPathLength = 1024;
const skippedDirectories = new Set(['appdata', 'build', 'coverage', 'dist', 'node_modules', 'target', 'vendor', 'venv', '__pycache__']);
const previewExtensions = new Set(['.json', '.toml', '.yaml', '.yml', '.xml', '.ini', '.rb', '.kt', '.swift', '.sql']);
const buildFiles = new Set(['dockerfile', 'makefile', 'gemfile', 'rakefile']);

function visibleName(name) {
  return !name.startsWith('.') && !/[<>:"|?*\\/\x00-\x1f\x7f]|[. ]$/u.test(name) &&
    !/^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(name) &&
    !/^(?:credentials?|secrets?|service[-_]account|id_rsa|id_ed25519)(?:[.-]|$)/i.test(name);
}

function isCandidate(name) {
  return isSourceFile(name) || previewExtensions.has(extname(name).toLowerCase()) || buildFiles.has(name.toLowerCase());
}

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function fileId(stat) {
  return `${stat.dev}/${stat.ino}`;
}

function realStat(path) {
  const stat = lstatSync(path, { bigint: true });
  if (stat.isSymbolicLink() || !samePath(realpathSync(path), path)) throw Error('invalid');
  return stat;
}

function inside(directory, target) {
  if (!directory) return false;
  const path = relative(directory, target);
  return !path || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
}

export function grantRepository(path, protectedDirectory) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw Error('invalid');
  const selected = resolve(path);
  const volume = parse(selected).root;
  const segments = selected.slice(volume.length).split(/[\\/]/);
  if (selected === volume || (process.platform === 'win32' && selected.startsWith('\\\\')) ||
      segments.some(name => !visibleName(name)))
    throw Error('invalid');
  const root = realpathSync(selected);
  if (!samePath(root, selected)) throw Error('invalid');
  if (inside(protectedDirectory, root)) throw Error('invalid');
  const stat = realStat(root);
  if (!stat.isDirectory()) throw Error('invalid');
  return Object.freeze({ root, fileId: fileId(stat), protectedDirectory });
}

export function checkRepository(repository) {
  try {
    const stat = realStat(repository.root);
    if (stat.isDirectory() && fileId(stat) === repository.fileId) return;
  } catch {
    // The selected directory is unavailable or has been replaced.
  }
  throw Error('stale');
}

function checkFile(stat) {
  if (!stat.isFile() || stat.nlink !== 1n || stat.size > maxBytes) throw Error('invalid');
  return stat;
}

function currentBranch(repository) {
  try {
    const git = join(repository.root, '.git');
    if (inside(repository.protectedDirectory, git)) return;
    if (!realStat(git).isDirectory()) return;
    const { text } = readText(repository, join(git, 'HEAD'), 512);
    const ref = text.trim();
    return /^ref: refs\/heads\/([^\s\x00-\x1f]{1,220})$/.exec(ref)?.[1] ??
      (/^[0-9a-f]{40,64}$/i.test(ref) ? ref.slice(0, 12) : undefined);
  } catch {
    // Git metadata is optional and may be outside the selected folder.
  }
}

export function inspectRepository(repository) {
  checkRepository(repository);
  const files = [];
  let remaining = maxEntries;
  let truncated = false;

  function walk(path, parent, depth) {
    const dir = opendirSync(path);
    try {
      for (let entry; (entry = dir.readSync());) {
        if (remaining-- <= 0 || files.length >= maxFiles) {
          truncated = true;
          return;
        }
        if (!visibleName(entry.name)) continue;
        const relative = parent + entry.name;
        if (relative.length > maxPathLength) {
          truncated = true;
          continue;
        }
        const target = join(path, entry.name);
        if (inside(repository.protectedDirectory, target)) continue;
        if (entry.isDirectory() && !skippedDirectories.has(entry.name.toLowerCase())) {
          if (depth >= maxDepth) {
            truncated = true;
            continue;
          }
          try {
            if (realStat(target).isDirectory()) walk(target, relative + '/', depth + 1);
          } catch {
            // An unreadable or changed subdirectory is outside this listing.
          }
        } else if (entry.isFile() && isCandidate(entry.name)) {
          try {
            const stat = checkFile(realStat(target));
            files.push({ path: relative, size: Number(stat.size), editable: isSourceFile(entry.name) });
          } catch {
            // A linked, oversized, or changed file is outside this listing.
          }
        }
        if (remaining < 0) return;
      }
    } finally {
      dir.closeSync();
    }
  }

  walk(repository.root, '', 0);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const branch = currentBranch(repository);
  checkRepository(repository);
  return { root: repository.root, files, truncated, ...(branch && { branch }) };
}

export function readRepositoryFile(repository, path) {
  if (typeof path !== 'string' || path.length > maxPathLength) throw Error('invalid');
  const segments = path.split('/');
  if (segments.length > maxDepth + 1 || segments.some(name => !name || !visibleName(name)) ||
      segments.slice(0, -1).some(name => skippedDirectories.has(name.toLowerCase())) || !isCandidate(segments.at(-1)))
    throw Error('invalid');

  checkRepository(repository);
  const target = join(repository.root, ...segments);
  if (inside(repository.protectedDirectory, target)) throw Error('invalid');
  return { path, target, editable: isSourceFile(path), ...readText(repository, target, maxBytes) };
}

function readText(repository, target, limit) {
  const before = checkFile(realStat(target));
  if (before.size > limit) throw Error('invalid');
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const fd = openSync(target, flags);
  try {
    const opened = checkFile(fstatSync(fd, { bigint: true }));
    if (fileId(opened) !== fileId(before)) throw Error('stale');
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    const after = checkFile(realStat(target));
    checkRepository(repository);
    if (fileId(after) !== fileId(opened) || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs ||
        after.size !== BigInt(size)) throw Error('stale');
    const content = bytes.subarray(0, size);
    if (size > limit || content.includes(0)) throw Error('invalid');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content);
    } catch {
      throw Error('invalid');
    }
    return { size, text, fileId: fileId(opened) };
  } finally {
    closeSync(fd);
  }
}

export function pickRepository(signal) {
  if (process.platform !== 'win32') throw Error('unsupported');
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d=New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description='Abyssinia AI - grant read access to a project folder'",
    '$d.ShowNewFolderButton=$false',
    '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)',
    'try { if($d.ShowDialog() -eq [Windows.Forms.DialogResult]::OK){[Console]::Write($d.SelectedPath)} } finally { $d.Dispose() }',
  ].join(';');
  return new Promise((accept, reject) => {
    const child = spawn(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-STA', '-Command', script],
      { signal, timeout: 120000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', code => code === 0 ? accept(Buffer.concat(chunks).toString('utf8')) : reject(Error('picker')));
  });
}
