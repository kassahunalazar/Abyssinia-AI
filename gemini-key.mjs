import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run=promisify(execFile);
export async function askGeminiKey(signal){
  if(process.platform!=='win32')throw Error('unavailable');
  try{
    const {stdout}=await run(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile','-STA','-File',fileURLToPath(new URL('./scripts/gemini-key.ps1',import.meta.url))],
      {windowsHide:true,timeout:120000,maxBuffer:1024,signal});
    const key=stdout.trim();
    if(key && !/^[a-zA-Z0-9_-]{16,256}$/.test(key))throw Error('invalid');
    return key;
  }catch{throw Error('unavailable');}
}
