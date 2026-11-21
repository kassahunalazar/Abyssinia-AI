import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { workspaceControl } from '../workspace-control.mjs';

test('managed documents reject traversal, stale approvals, replays and conflicting moves', t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ah-docs-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const control = workspaceControl(directory);
  const execute = (action, fields = {}) => control.execute({ action, ...fields });
  const create = (name, text) => execute('approve', execute('propose', { name, text }));
  const name = 'Fixture.txt';
  const destination = 'Renamed.txt';
  const content = 'ሰላም';
  const target = join(directory, 'documents', name);
  const moved = join(directory, 'documents', destination);
  const rename = () => execute('document.propose', { operation: 'rename', name, destination });
  const remove = file => execute('document.propose', { operation: 'delete', name: file });

  create(name, content);
  writeFileSync(join(directory, 'Outside.txt'), 'outside');
  assert.deepEqual(execute('document.list'), { names: [name] });
  assert.deepEqual(execute('document.read', { name }), { text: content });
  for (const path of ['../Outside.txt', '..\\Outside.txt', join(directory, 'Outside.txt')]) {
    assert.throws(() => execute('document.read', { name: path }), /invalid/);
    assert.throws(() => remove(path), /invalid/);
    assert.throws(() => execute('document.propose', { operation: 'rename', name, destination: path }), /invalid/);
  }

  const stale = remove(name);
  writeFileSync(target, 'external modification');
  assert.throws(() => execute('approve', stale), /stale/);
  assert.throws(() => execute('approve', stale), /expired/);
  assert.equal(readFileSync(target, 'utf8'), 'external modification');

  const conflict = rename();
  create(destination, 'occupied');
  assert.throws(() => execute('approve', conflict), { code: 'EEXIST' });
  assert.throws(() => execute('approve', conflict), /expired/);
  assert.throws(rename, /invalid/);
  assert.equal(readFileSync(target, 'utf8'), 'external modification');
  assert.equal(readFileSync(moved, 'utf8'), 'occupied');

  execute('approve', remove(destination));
  const move = rename();
  assert.equal(existsSync(target), true);
  assert.equal(existsSync(moved), false);
  execute('approve', move);
  assert.equal(existsSync(target), false);
  assert.deepEqual(execute('document.list'), { names: [destination] });
  assert.deepEqual(execute('document.read', { name: destination }), { text: 'external modification' });
  assert.throws(() => execute('approve', move), /expired/);

  const deletion = remove(destination);
  assert.equal(existsSync(moved), true);
  execute('approve', deletion);
  assert.equal(existsSync(moved), false);
  assert.throws(() => execute('approve', deletion), /expired/);
  assert.equal(readFileSync(join(directory, 'Outside.txt'), 'utf8'), 'outside');
});
