import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const worker=fileURLToPath(new URL('./scripts/project-test-worker.mjs', import.meta.url));

export function runProjectTests(files, signal) {
  if (!files.some(file=>/\.test\.m?js$/i.test(file.path)) ||
      files.some(file=>!(/\.m?js$/i.test(file.path)))) throw Error('invalid');
  return new Promise((resolve,reject)=>{
    const child=execFile(process.execPath,[worker],{
      env:{SystemRoot:process.env.SystemRoot},timeout:8000,maxBuffer:65536,windowsHide:true,signal,
    },(error,output)=>{
      if(error)return reject(Error('unavailable'));
      try{resolve(JSON.parse(output));}catch{reject(Error('unavailable'));}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(files.map(({path,text})=>({path,text}))));
  });
}
