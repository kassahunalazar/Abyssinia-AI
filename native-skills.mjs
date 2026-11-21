import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const worker = fileURLToPath(new URL('./native_skills.py', import.meta.url));

export async function nativeSkills({
  python = process.env.ASSISTANT_PYTHON,
  source = process.env.ASSISTANT_HERMES_SOURCE,
  signal,
  selected,
} = {}) {
  if (!python || !source) throw new Error('Missing Hermes configuration.');
  if (signal) signal.throwIfAborted();
  if (selected !== undefined && !/^[\w-]{0,64}\/[\w-]{1,64}$/.test(selected)) throw Error('Invalid skill.');
  const { stdout } = await execute(python, ['-I', '-B', worker, source, ...(selected === undefined ? [] : [selected])], {
    env: { SystemRoot: process.env.SystemRoot },
    windowsHide: true,
    timeout: 45000,
    maxBuffer: 128 * 1024,
    signal,
  });
  const skills = JSON.parse(stdout);
  if (selected !== undefined && typeof skills === 'string' && skills.length) return skills;
  if (!Array.isArray(skills)) throw new Error('Invalid Hermes skill catalog.');
  return skills;
}
