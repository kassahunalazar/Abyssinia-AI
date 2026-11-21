import assert from 'node:assert/strict';
import { once } from 'node:events';
import { linkSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { browserCookie } from '../http-fixture.mjs';
import { grantRepository, inspectRepository, readRepositoryFile } from '../repository-workspace.mjs';
import { createAssistant } from '../server.mjs';

function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ah-repository-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'project');
  mkdirSync(root);
  const write = (relative, text) => {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return path;
  };
  return { directory, root, write };
}

test('maps project text, flags editable files, and preserves selected UTF-8 text', t => {
  const { root, write } = fixture(t);
  const text = '\uFEFFexport const message = "ሰላም";\r\n';
  const target = write('lib/hello.mjs', text);
  write('package.json', '{}');
  write('Dockerfile', 'FROM scratch');
  write('.git/HEAD', 'ref: refs/heads/feature/repository\n');
  write('large.txt', Buffer.alloc(64 * 1024 + 1));
  write('bad.txt', Buffer.from([0xff]));
  write('binary.dat', Buffer.from([0, 0xff]));
  const repository = grantRepository(root);
  const result = inspectRepository(repository);
  assert.equal(result.root, root);
  assert.equal(result.truncated, false);
  assert.equal(result.branch, 'feature/repository');
  const files = new Map(result.files.map(file => [file.path, file]));
  assert.deepEqual([...files.keys()].sort(), ['Dockerfile', 'bad.txt', 'lib/hello.mjs', 'package.json']);
  assert.deepEqual(files.get('lib/hello.mjs'), { path: 'lib/hello.mjs', editable: true, size: Buffer.byteLength(text) });
  assert.equal(files.get('package.json').editable, false);
  const source = readRepositoryFile(repository, 'lib/hello.mjs');
  assert.equal(source.target, target);
  assert.equal(source.text, text);
  assert.match(source.fileId, /^\d+\/\d+$/u);
  assert.equal(readRepositoryFile(repository, 'package.json').text, '{}');
  assert.throws(() => readRepositoryFile(repository, 'bad.txt'), /invalid/);
  assert.throws(() => readRepositoryFile(repository, 'large.txt'), /invalid/);
});

test('keeps ignored directories, linked files and out-of-scope paths outside a grant', t => {
  const { directory, root, write } = fixture(t);
  const outside = join(directory, 'outside');
  mkdirSync(outside);
  const privateFile = join(outside, 'private.txt');
  writeFileSync(privateFile, 'private');
  write('public.txt', 'public');
  write('credentials.json', '{}');
  write('.git/config.txt', 'hidden');
  write('.runtime/state.json', '{}');
  write('node_modules/library/index.js', 'hidden');
  symlinkSync(outside, join(root, 'linked'), 'junction');
  linkSync(privateFile, join(root, 'linked.txt'));
  const repository = grantRepository(root);
  assert.deepEqual(inspectRepository(repository).files.map(file => file.path), ['public.txt']);
  assert.throws(() => grantRepository(join(root, 'linked')), /invalid/);
  assert.throws(() => grantRepository(join(root, 'public.txt')), /invalid/);
  for (const path of [privateFile, '../outside/private.txt',
    'credentials.json', '.git/config.txt', '.runtime/state.json', 'node_modules/library/index.js',
    'linked/private.txt', 'linked.txt', './public.txt', 'public.txt:stream', 'linked\\private.txt', '/public.txt']) {
    assert.throws(() => readRepositoryFile(repository, path), /invalid/, path);
  }
});

test('rejects a project grant after its directory is replaced', t => {
  const { directory, root, write } = fixture(t);
  write('app.js', 'export const oldValue = 1');
  const repository = grantRepository(root);
  renameSync(root, join(directory, 'old-project'));
  write('app.js', 'export const newValue = 2');
  assert.throws(() => inspectRepository(repository), /stale/);
  assert.throws(() => readRepositoryFile(repository, 'app.js'), /stale/);
});

test('bounds repository maps and reports truncation', t => {
  const { root, write } = fixture(t);
  for (let number = 0; number <= 512; number++) write(`file-${number}.txt`, '');
  const result = inspectRepository(grantRepository(root));
  assert.equal(result.files.length, 512);
  assert.equal(result.truncated, true);
});

test('HTTP project access uses the native selection and a revocable repository and source grant', async t => {
  const { directory, root, write } = fixture(t);
  const target = write('lib/source.mjs', 'export const code = 1;\n');
  write('lib/other.mjs', 'export const code = 2;\n');
  write('package.json', '{}');
  const outside = join(directory, 'outside.mjs');
  writeFileSync(outside, 'external');
  const stateDirectory = join(root, 'assistant-state');
  const app = createAssistant({ stateDirectory, pickRepository: async () => root }).listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const origin = `http://127.0.0.1:${app.address().port}`;
  const cookie = await browserCookie(origin);
  const post = (action, data = {}) => fetch(`${origin}/api/control`, {
    method: 'POST', headers: { origin, cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...data }),
  });
  assert.equal((await post('code.open', { path: target })).status, 409);
  const picked = await post('code.pickRepository', { path: outside });
  assert.equal(picked.status, 200);
  const map = await picked.json();
  const repository = map.repository;
  assert.equal(map.root, root);
  assert.deepEqual(map.files.map(file => file.path), ['lib/other.mjs', 'lib/source.mjs', 'package.json']);
  assert.deepEqual(await (await post('code.repository', { repository })).json(), map);

  const read = (action, path, fields = {}) => post(action, { repository, path, ...fields });
  assert.equal((await read('code.preview', '../outside.mjs')).status, 409);
  assert.equal((await read('code.preview', 'assistant-state/activity.json')).status, 409);
  assert.equal((await read('code.open', 'lib/source.mjs', { repository: 'forged' })).status, 409);
  assert.equal((await read('code.open', 'package.json')).status, 409);
  assert.deepEqual(await (await read('code.preview', 'package.json')).json(), {
    path: 'package.json', editable: false, text: '{}', size: 2,
  });
  assert.equal((await post('code.read')).status, 409);
  const file = await (await read('code.open', 'lib/source.mjs')).json();
  assert.equal(file.target, target);
  const edit = () => post('code.propose', { grant: file.grant, before: file.text, text: 'export const code = 3;\n' });
  const pending = await (await edit()).json();
  assert.ok(pending.id);
  assert.equal((await read('code.open', 'lib/other.mjs')).status, 200);
  assert.equal((await post('approve', pending)).status, 409);
  assert.equal((await edit()).status, 409);

  assert.equal((await post('code.closeRepository', { repository: 'forged' })).status, 409);
  assert.equal((await post('code.closeRepository', { repository })).status, 200);
  assert.equal((await read('code.preview', 'package.json')).status, 409);
  assert.equal((await post('code.read')).status, 409);

  const next = await (await post('code.pickRepository')).json();
  assert.notEqual(next.repository, repository);
  assert.equal((await post('pause')).status, 200);
  assert.equal((await post('resume')).status, 200);
  assert.equal((await post('code.repository', { repository: next.repository })).status, 409);
});
