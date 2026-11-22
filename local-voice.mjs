import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const localModel='mms-amharic-local';
export const localSpeaker='MMS · አማርኛ';
const runner=fileURLToPath(new URL('./scripts/synthesize-local.py',import.meta.url));
function installation(){
  const directory=join(process.env.LOCALAPPDATA??'','AbyssiniaAI','models','mms-amharic');
  const existing=join(process.env.LOCALAPPDATA??'','Programs','Python','Python313','python.exe');
  const python=process.env.ASSISTANT_STT_PYTHON??(existsSync(existing)?existing:process.env.ASSISTANT_PYTHON);
  return {directory,python};
}
export function localVoiceReady(){
  const {directory,python}=installation();
  return Boolean(python&&existsSync(python)&&['model.onnx','tokens.txt','dependencies/uroman/__init__.py','verified'].every(file=>existsSync(join(directory,file))));
}
export function synthesizeLocal(text,signal){
  if(!localVoiceReady()||typeof text!=='string'||!text.trim()||text.length>2000)throw Error('unavailable');
  const {directory,python}=installation();
  return new Promise((accept,reject)=>{
    const child=execFile(python,['-I','-B',runner,directory],{signal,timeout:180000,maxBuffer:11000000,encoding:'buffer',windowsHide:true,
      env:{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP}},(error,bytes)=>{
      if(error||!bytes||bytes.length<=44||bytes.toString('ascii',0,4)!=='RIFF')return reject(Error('speech'));
      accept(bytes.toString('base64'));
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(text),'utf8');
  });
}
