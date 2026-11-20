import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export function readScreen(image, signal) {
  if (process.platform !== 'win32' || typeof image !== 'string' || image.length > 2800000) throw Error('invalid');
  const bytes=Buffer.from(image,'base64');
  if (bytes.length<33 || bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' ||
      bytes.toString('ascii',12,16)!=='IHDR' || bytes.readUInt32BE(16)>2048 || bytes.readUInt32BE(20)>2048) throw Error('invalid');
  return new Promise((accept,reject)=>{
    const child=spawn(join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./scripts/read-screen.ps1',import.meta.url))],
      {windowsHide:true,signal,timeout:20000,stdio:['pipe','pipe','ignore']});
    const chunks=[];let size=0;
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>128000)child.kill();else chunks.push(chunk)});
    child.stdin.on('error',reject);child.on('error',reject);
    child.on('close',code=>{
      try {
        if(code!==0||size>128000)throw Error('OCR failed');
        const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        accept({text:String(data.text ?? '').slice(0,12000),language:data.language});
      }catch(e){reject(e)}
    });
    child.stdin.end(image);
  });
}
