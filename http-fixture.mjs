import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssistant } from './server.mjs';
export function testAssistant(options) {
  return createAssistant({stateDirectory:mkdtempSync(join(tmpdir(),'abyssinia-test-')), ...options});
}
export async function browserCookie(origin) {
  const page = await fetch(origin);
  return page.headers.get('set-cookie').split(';')[0];
}

