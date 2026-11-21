import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { nativeSkills } from '../native-skills.mjs';

const configured = Boolean(process.env.ASSISTANT_PYTHON && process.env.ASSISTANT_HERMES_SOURCE);

test('native skill discovery requires a configured Hermes installation', async () => {
  await assert.rejects(nativeSkills({ python: '', source: '' }), /Missing Hermes configuration/);
});

test('reads bundled skill metadata from the real Hermes install without a model or tools', {
  skip: !configured,
}, async () => {
  const skills = await nativeSkills();
  assert.ok(skills.some(skill => skill.category === 'software-development'));
  assert.ok(skills.length <= 256);
  for (const skill of skills) {
    assert.deepEqual(Object.keys(skill), ['name', 'description', 'category']);
    assert.match(skill.name, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.ok(skill.description.length > 0 && skill.description.length <= 120);
    assert.ok(skill.category === null || /^[a-zA-Z0-9_-]+$/.test(skill.category));
  }
});

test('bundled discovery excludes linked folders, support files, and skill bodies', {
  skip: !configured,
}, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'abyssinia-native-skills-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = join(temp, 'engine');
  const bundled = join(source, 'skills');
  const outside = join(temp, 'outside');
  await mkdir(join(source, 'agent'), { recursive: true });
  for (const file of ['hermes_constants.py', 'hermes_yaml.py', 'agent/skill_utils.py']) {
    await copyFile(join(process.env.ASSISTANT_HERMES_SOURCE, file), join(source, file));
  }
  async function manifest(directory, name) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: የሙከራ ችሎታ\n---\nPrivate body`);
  }
  await manifest(join(bundled, 'topic', 'included'), 'included');
  await manifest(join(bundled, 'topic', 'included', 'scripts', 'nested'), 'nested');
  await manifest(outside, 'outside');
  await symlink(outside, join(bundled, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(await nativeSkills({ source }), [{
    name: 'included', description: 'የሙከራ ችሎታ', category: 'topic',
  }]);
  assert.equal(await nativeSkills({source,selected:'topic/included'}),'Private body');
  await assert.rejects(nativeSkills({source,selected:'../outside'}));
  await assert.rejects(nativeSkills({source,selected:'topic/nested'}));
});
