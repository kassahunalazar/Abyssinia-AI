import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {connect} from 'node:net';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

function listening(){
  return new Promise(resolve=>{
    const socket=connect({host:'127.0.0.1',port:20128});
    const finish=value=>{socket.destroy();resolve(value);};
    socket.setTimeout(500,()=>finish(false));
    socket.once('error',()=>finish(false));
    socket.once('connect',()=>finish(true));
  });
}

// Start the installed local provider only when a request selects its configured address.
export async function prepareLocalProvider(base,signal){
  if(base!=='http://127.0.0.1:20128/v1'||process.platform!=='win32'||process.env.ABYSSINIA_START_OMNIROUTE==='0')return;
  if(await listening())return;
  const cli=join(process.env.APPDATA??'','npm','node_modules','omniroute','bin','omniroute.mjs');
  if(!existsSync(cli))return;
  signal?.throwIfAborted();
  const env=Object.fromEntries(['APPDATA','LOCALAPPDATA','USERPROFILE','PATH','SystemRoot','WINDIR','TEMP','TMP','ProgramFiles','ProgramFiles(x86)','COMSPEC']
    .filter(name=>process.env[name]).map(name=>[name,process.env[name]]));
  const child=spawn(process.execPath,[cli,'serve','--port','20128','--no-open','--no-tray','--no-recovery'],{
    cwd:join(process.env.APPDATA,'npm','node_modules','omniroute'),env:{...env,OMNIROUTE_SERVER_HOST:'127.0.0.1',HOSTNAME:'127.0.0.1'},
    windowsHide:true,detached:true,stdio:'ignore',
  });
  let failed=false;
  child.once('error',()=>{failed=true;});
  child.unref();
  for(let attempt=0;attempt<60&&!failed;attempt++){
    await delay(500,undefined,{signal});
    if(await listening())return;
  }
  throw Error('Local provider unavailable.');
}
