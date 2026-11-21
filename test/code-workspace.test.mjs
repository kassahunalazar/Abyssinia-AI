import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { browserCookie } from '../http-fixture.mjs';
import { createAssistant } from '../server.mjs';
import { workspaceControl } from '../workspace-control.mjs';

const original = '\uFEFFexport const label = "ሰላም";\r\n';
const replacement = 'export const label = "updated";\n';
const external = 'export const label = "external";\n';

function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ah-code-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'source.mjs');
  writeFileSync(path, original);
  const control = workspaceControl(join(directory, 'control'));
  const execute = (action, fields = {}) => control.execute({ action, ...fields });
  const { grant } = control.grantFile(path);
  const propose = (fields = {}) => execute('code.propose', {
    grant, before: original, text: replacement, ...fields,
  });
  const read = () => readFileSync(path, 'utf8');
  return { control, execute, grant, path, propose, read };
}

test('replacing and restoring the granted file each require one approval', t => {
  const { execute, grant, path, propose, read } = fixture(t);
  assert.deepEqual(execute('code.read'), { grant, target: path, text: original });
  assert.throws(() => propose({ grant: 'unrelated' }), /unavailable/);

  const rejected = propose();
  execute('reject', rejected);
  assert.throws(() => execute('approve', rejected), /expired/);
  const edit = propose();
  assert.equal(read(), original);
  assert.equal(execute('status').canUndo, false);
  execute('approve', edit);
  assert.equal(read(), replacement);
  assert.equal(execute('status').canUndo, true);
  assert.throws(() => execute('approve', edit), /expired/);

  const undo = execute('code.undo', { grant });
  assert.equal(read(), replacement);
  execute('approve', undo);
  assert.equal(read(), original);
  assert.equal(execute('status').canUndo, false);
  assert.throws(() => execute('approve', undo), /expired/);
});

test('stale proposals and approvals preserve changes made outside the workspace', t => {
  const { execute, grant, path, propose, read } = fixture(t);
  assert.throws(() => propose({ before: external }), /stale/);
  const edit = propose();
  writeFileSync(path, external);
  assert.throws(() => execute('approve', edit), /stale/);
  assert.throws(() => execute('approve', edit), /expired/);
  assert.equal(read(), external);
  assert.equal(execute('status').canUndo, false);

  execute('approve', propose({ before: external }));
  const undo = execute('code.undo', { grant });
  writeFileSync(path, original);
  assert.throws(() => execute('approve', undo), /stale/);
  assert.throws(() => execute('code.undo', { grant }), /stale/);
  assert.equal(read(), original);
});

test('replacing a granted file with identical bytes invalidates the grant and pending approval', t => {
  const { control, execute, path, propose, read } = fixture(t);
  const pending = propose();
  renameSync(path, `${path}.original`);
  writeFileSync(path, original);
  assert.equal(read(), original);
  assert.throws(() => execute('code.read'), /stale/);
  assert.throws(() => propose(), /stale/);
  assert.throws(() => execute('approve', pending), /stale/);
  assert.throws(() => execute('approve', pending), /expired/);
  assert.equal(read(), original);
  const next = control.grantFile(path);
  assert.deepEqual(execute('code.read'), next);
});

test('HTTP syntax checks require a file grant and parse drafts without executing or writing them', async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ah-code-check-')));
  const source = join(directory, 'fixture.mjs');
  writeFileSync(source, original);
  const app = createAssistant({ stateDirectory: join(directory, 'state'), pickFile: async () => source })
    .listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(async () => {
    await new Promise(resolve => app.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${app.address().port}`;
  const cookie = await browserCookie(origin);
  const post = (action, fields = {}) => fetch(`${origin}/api/control`, {
    method: 'POST', headers: { origin, cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...fields }),
  });
  const selected = await post('code.pick');
  assert.equal(selected.status, 200);
  const { grant, target } = await selected.json();
  assert.equal(target, source);
  const check = (text, fileGrant = grant) => post('code.check', { text, grant: fileGrant });

  assert.equal((await check(replacement, 'wrong-grant')).status, 409);
  const valid = await check('throw new Error("would fail if executed");');
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).valid, true);
  const invalid = await check('export const = ;');
  assert.equal(invalid.status, 200);
  assert.equal((await invalid.json()).valid, false);
  assert.equal(readFileSync(source, 'utf8'), original);
  assert.equal((await post('code.close')).status, 200);
  const revoked = await check(replacement);
  assert.equal(revoked.status, 409);
  assert.deepEqual(await revoked.json(), { error: 'unavailable' });
});

for (const reason of ['closing the file', 'pausing the agent', 'granting a different file']) {
  test(`${reason} revokes outstanding code approvals`, t => {
    const { control, execute, grant, path, propose, read } = fixture(t);
    execute('approve', propose());
    const undo = execute('code.undo', { grant });
    const edit = propose({ before: replacement, text: external });

    if (reason === 'closing the file') execute('code.close');
    if (reason === 'pausing the agent') {
      execute('pause');
      execute('resume');
    }
    if (reason === 'granting a different file') {
      const nextPath = join(path, '..', 'other.mjs');
      writeFileSync(nextPath, external);
      control.grantFile(nextPath);
      assert.equal(execute('code.read').text, external);
    }

    assert.deepEqual(execute('status').approvals, []);
    assert.equal(execute('status').canUndo, false);
    assert.throws(() => execute('approve', undo), /expired/);
    assert.throws(() => execute('approve', edit), /expired/);
    assert.throws(() => propose(), /unavailable/);
    assert.equal(read(), replacement);
  });
}
