import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { browserCookie } from '../http-fixture.mjs';
import { commandContainerArgs, projectCommand, projectCommandConfig, runProjectCommand } from '../project-command.mjs';
import { createProjectWorktree, localTool, projectHead, snapshotWorktree } from '../project-worktree.mjs';
import { grantRepository } from '../repository-workspace.mjs';
import { createAssistant } from '../server.mjs';

const git = localTool('git');
test('creates a real detached worktree from approved HEAD without source config, hooks or dirty files', {
  skip: !git,
}, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ah-worktree-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const storage = join(root, 'private-worktrees');
  mkdirSync(project);
  const run = (cwd, ...args) => execFileSync(git, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  run(project, 'init', '-b', 'main', '--template=');
  writeFileSync(join(project, 'source.mjs'), 'export const message = "ሰላም";\n');
  writeFileSync(join(project, '.gitattributes'), '*.mjs filter=untrusted\n');
  run(project, 'add', '.');
  run(project, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
  const scope = grantRepository(project);
  const revision = projectHead(scope);
  assert.equal(revision, run(project, 'rev-parse', 'HEAD'));
  run(project, 'pack-refs', '--all');
  assert.equal(projectHead(scope), revision);
  run(project, 'gc', '--quiet');
  mkdirSync(join(project, '.git', 'hooks'));
  writeFileSync(join(project, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\nprintf marker > hook-marker\n', { mode: 0o700 });
  run(project, 'config', 'filter.untrusted.required', 'true');
  run(project, 'config', 'filter.untrusted.smudge', 'false');
  writeFileSync(join(project, 'source.mjs'), 'dirty worktree content');
  writeFileSync(join(project, 'untracked.txt'), 'untracked');
  const result = await createProjectWorktree(scope, revision, storage, new AbortController().signal);
  assert.equal(result.revision, revision);
  assert.equal(run(result.path, 'rev-parse', 'HEAD'), revision);
  assert.throws(() => run(result.path, 'symbolic-ref', '-q', 'HEAD'));
  assert.equal(readFileSync(join(result.path, 'source.mjs'), 'utf8'), 'export const message = "ሰላም";\n');
  assert.equal(existsSync(join(result.path, 'untracked.txt')), false);
  assert.equal(existsSync(join(result.path, 'hook-marker')), false);
  assert.equal(readFileSync(join(project, 'source.mjs'), 'utf8'), 'dirty worktree content');
  assert.ok(!run(project, 'worktree', 'list').includes('checkout'));
  assert.deepEqual(result.files.map(file => file.path), ['.gitattributes', 'source.mjs']);
  assert.match(snapshotWorktree(result).archive.toString('utf8'), /source\.mjs/u);
  await assert.rejects(createProjectWorktree(scope, 'a'.repeat(40), storage, new AbortController().signal), /stale/);

  const app = createAssistant({ stateDirectory: join(root, '.app-state'), pickRepository: async () => project });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise(resolve => app.close(resolve)));
  const origin = 'http://127.0.0.1:' + app.address().port;
  const cookie = await browserCookie(origin);
  const post = (action, fields = {}) => fetch(origin + '/api/control', {
    method: 'POST', headers: { origin, cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...fields }),
  });
  let { repository } = await (await post('code.pickRepository')).json();
  const propose = async () => {
    const response = await post('code.worktree', { repository });
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.equal((await post('code.worktree', { repository: 'forged' })).status, 409);
  let proposal = await propose();
  assert.equal((await post('reject', proposal)).status, 200);
  assert.equal((await post('approve', proposal)).status, 409);
  proposal = await propose();
  const { approvals } = await (await post('status')).json();
  assert.equal(approvals.find(item => item.id === proposal.id).text, revision);
  const approved = await post('approve', proposal);
  assert.equal(approved.status, 200);
  const { projectWorktree } = await approved.json();
  assert.equal(projectWorktree.revision, revision);
  assert.equal(run(projectWorktree.path, 'rev-parse', 'HEAD'), revision);
  if (!projectCommandConfig()) {
    const unavailable = await post('code.command', { repository, command:'sh', args:[] });
    assert.deepEqual(await unavailable.json(), { error:'unsupported' });
  }
  const originalRepository = repository;
  const opened = await (await post('code.openWorktree', { repository })).json();
  repository = opened.repository;
  assert.notEqual(originalRepository, repository);
  assert.equal(opened.root, projectWorktree.path);
  const file = await (await post('code.open', { repository, path:'source.mjs' })).json();
  const edit = 'export const message = "edited ሰላም";\n';
  const revisionProposal = await (await post('code.propose', { grant:file.grant, before:file.text, text:edit })).json();
  assert.equal((await post('approve', revisionProposal)).status, 200);
  assert.equal(readFileSync(join(projectWorktree.path, 'source.mjs'), 'utf8'), edit);
  assert.equal(readFileSync(join(project, 'source.mjs'), 'utf8'), 'dirty worktree content');
  const inspect = async (operation, query, match) => {
    const proposalResponse = await post('code.worktreeInspect', { repository, operation, query });
    assert.equal(proposalResponse.status, 200);
    const response = await post('approve', await proposalResponse.json());
    assert.equal(response.status, 200);
    assert.match((await response.json()).projectCommand.output, match);
  };
  await inspect('status', undefined, / M source\.mjs/u);
  await inspect('diff', undefined, /\+export const message = "edited ሰላም";/u);
  await inspect('grep', 'edited ሰላም', /source\.mjs:1: export const message/u);
  const back = await (await post('code.backToProject', { repository })).json();
  assert.equal(back.root, project);
  repository = back.repository;
  proposal = await propose();
  assert.equal((await post('code.closeRepository', { repository })).status, 200);
  assert.equal((await post('approve', proposal)).status, 409);
  assert.equal((await (await post('status')).json()).projectWorktree, undefined);

  const config = projectCommandConfig();
  if (process.env.ASSISTANT_PROJECT_CONTAINER_IMAGE) assert.ok(config, 'Configured Docker image requires Docker at a supported local path');
  if (config) {
    writeFileSync(join(result.path, 'source.mjs'), edit);
    const request = projectCommand('sh', ['-c', 'grep -q edited source.mjs && test ! -e /var/run/docker.sock && printf isolated']);
    request.snapshotHash = snapshotWorktree(result).hash;
    assert.deepEqual(await runProjectCommand(config, result, request, new AbortController().signal),
      { code: 0, output:'isolated', truncated:false });
    const fails = { ...request, args:['-c','exit 7'] };
    assert.equal((await runProjectCommand(config, result, fails, new AbortController().signal)).code, 7);
    writeFileSync(join(result.path, 'source.mjs'), 'drift');
    await assert.rejects(runProjectCommand(config, result, request, new AbortController().signal), /stale/);
  }
});

test('passes command arguments only inside a local non-root, offline container', () => {
  const request = projectCommand('node', ['--test', 'a b.mjs', '$(literal string)']);
  const args = commandContainerArgs('example', 'sha256:' + 'a'.repeat(64), request);
  for (const flag of ['--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges',
    '--pull=never','--user=65534:65534','--restart=no']) assert.ok(args.includes(flag));
  assert.ok(!args.some(arg => /^(?:--mount|--volume|-v|--privileged)$/u.test(arg)));
  assert.deepEqual(args.slice(-4), ['node', '--test', 'a b.mjs', '$(literal string)']);
  assert.throws(() => projectCommand('--privileged', []), /invalid/);
  assert.throws(() => projectCommand('node', ['with\nnewline']), /invalid/);
});
