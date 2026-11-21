import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

export function windowAction(action,window,signal,parameters){
  if(process.platform!=='win32'||!['list','focus','scrollDown','scrollUp','controls','invoke','setText'].includes(action))throw Error('invalid');
  const executable=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((accept,reject)=>{
    const child=spawn(executable,['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./scripts/window-action.ps1',import.meta.url))],
      {stdio:['pipe','pipe','ignore'],windowsHide:true,signal,timeout:45000});
    const chunks=[];let size=0;
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>128000)child.kill();else chunks.push(chunk)});
    child.on('error',reject);child.stdin.on('error',reject);
    child.on('close',code=>{try{if(code!==0||size>128000)throw Error('window');accept(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch(e){reject(e)}});
    child.stdin.end(JSON.stringify({action,window,parameters}));
  });
}
