import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const python=()=>process.env.ASSISTANT_STT_PYTHON ?? join(process.env.LOCALAPPDATA??'','Programs','Python','Python313','python.exe');
function modelPath(size){
  if(size==='hohe-int8'){
    const dir=join(process.env.LOCALAPPDATA??'','AbyssiniaAI','models','hohe-int8');
    return ['model.onnx','assets/frontend.npz','assets/meta.json'].every(f=>existsSync(join(dir,f)))?dir:undefined;
  }
  if(!['tiny','base'].includes(size))return;
  const root=join(process.env.HF_HUB_CACHE??join(homedir(),'.cache','huggingface','hub'),'models--Systran--faster-whisper-'+size,'snapshots');
  if(!existsSync(root))return;
  return readdirSync(root).map(d=>join(root,d)).find(d=>['model.bin','config.json','tokenizer.json'].every(f=>existsSync(join(d,f))));
}
export function speechModels(){return existsSync(python())?['hohe-int8','tiny','base'].filter(size=>modelPath(size)):[];}
export function transcribe(pcm, size, signal){
  const path=modelPath(size);
  if(!path||typeof pcm!=='string'||pcm.length>854000)throw Error('invalid');
  const audio=Buffer.from(pcm,'base64');
  if(audio.length<8000 || audio.length>640000 || audio.length%2)throw Error('invalid');
  const started=Date.now();
  return new Promise((accept,reject)=>{
    const child=spawn(python(),['-I','-B',fileURLToPath(new URL('./scripts/transcribe.py',import.meta.url)),path],
        {windowsHide:true,signal,timeout:180000,env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,LOCALAPPDATA:process.env.LOCALAPPDATA,
          TEMP:process.env.TEMP,TMP:process.env.TMP,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'},stdio:['pipe','pipe','ignore']});
    const chunks=[];let bytes=0;
    child.stdout.on('data',c=>{bytes+=c.length;if(bytes>32000)child.kill();else chunks.push(c);});
    child.on('error',reject);child.stdin.on('error',reject);
    child.on('close',code=>{try{
      if(code!==0||bytes>32000)throw Error('speech');
      const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      accept({text:result.text,model:size,latency:Date.now()-started});
    }catch(e){reject(e)}});
    child.stdin.end(audio);
  });
}
