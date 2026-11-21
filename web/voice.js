const field=id=>document.getElementById(id);
const panel=field('voice-panel');
const state=field('voice-state');
const record=field('voice-record'), stop=field('voice-stop'), run=field('voice-run');
const model=field('voice-model'), transcript=field('voice-transcript');
let recorder, pcm, timer, generation=0;
let grantedModels=[];
async function post(path,data){
  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  if(!r.ok)throw Error();
  return r.json();
}
panel.ontoggle=async()=>{
  if(!panel.open || grantedModels.length)return;
  try {
    const {models}=await post('/api/control',{action:'voice.models'});
    grantedModels=models; model.replaceChildren(...models.map(m=>new Option(m,m)));
    record.disabled=!models.length||!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder;
    state.textContent=record.disabled?'የቀረጻ ሞዴል ወይም ማይክሮፎን አይገኝም።':'እስከ 15 ሰከንድ · በዚህ ኮምፒውተር ይሰራል።';
  }catch{state.textContent='የድምፅ ሞዴሎችን መጫን አልተቻለም።'}
};
function stopRecording(){if(recorder?.state==='recording')recorder.stop();}
stop.onclick=stopRecording;
document.getElementById('work').addEventListener('close',()=>{generation++;stopRecording();pcm=null;run.disabled=true;transcript.value='';});
record.onclick=async()=>{
  record.disabled=true; run.disabled=true; pcm=null; transcript.value='';
  const id=++generation;let stream;
  try{
    const status=await post('/api/control',{action:'heartbeat'});if(status.paused)throw Error();
    stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(id!==generation){stream.getTracks().forEach(t=>t.stop());record.disabled=false;return}
    const chunks=[];recorder=new MediaRecorder(stream);
    recorder.ondataavailable=e=>chunks.push(e.data);
    recorder.onstop=async()=>{
      clearTimeout(timer);stream.getTracks().forEach(t=>t.stop());stop.disabled=true;
      let context;
      try{
        if(id!==generation)return;
        context=new AudioContext();
        const audio=await context.decodeAudioData(await new Blob(chunks).arrayBuffer());
        const length=Math.min(320000,Math.ceil(audio.duration*16000));
        const offline=new OfflineAudioContext(1,length,16000);
        const source=offline.createBufferSource();source.buffer=audio;source.connect(offline.destination);source.start();
        const values=(await offline.startRendering()).getChannelData(0);
        const raw=Int16Array.from(values,v=>Math.round(Math.max(-1,Math.min(1,v))*32767));
        const bytes=new Uint8Array(raw.buffer);let encoded='';
        for(let pos=0;pos<bytes.length;pos+=8192)encoded+=String.fromCharCode(...bytes.subarray(pos,pos+8192));
        if(id!==generation)return;
        pcm=btoa(encoded);run.disabled=false;state.textContent='ቀረጻው ዝግጁ ነው።';
      }catch{state.textContent='ቀረጻውን ማንበብ አልተቻለም።'}finally{await context?.close();record.disabled=false}
    };
    recorder.start(); stop.disabled=false; state.textContent='🔴 በመቅረጽ ላይ…';timer=setTimeout(stopRecording,15000);
  }catch{stream?.getTracks().forEach(t=>t.stop());record.disabled=false;state.textContent='ማይክሮፎኑን ማስጀመር አልተቻለም።'}
};
run.onclick=async()=>{
  const id=generation;run.disabled=true;record.disabled=true;model.disabled=true;transcript.value='';
  state.textContent='ጽሑፍ በማዘጋጀት ላይ…';
  try{
    const result=await post('/api/voice/benchmark',{pcm,model:model.value});
    if(id===generation){transcript.value=result.text;state.textContent=result.model+' · '+(result.latency/1000).toFixed(1)+' s';}
  }catch{state.textContent='ድምፁን ወደ ጽሑፍ መቀየር አልተቻለም።'}finally{run.disabled=!pcm;record.disabled=false;model.disabled=false}
};
field('voice-use').onclick=()=>{
  const input=field('message'), text=(input.value+' '+transcript.value.trim()).trim();
  if(!transcript.value.trim()||text.length>input.maxLength)return;
  input.value=text;input.dispatchEvent(new Event('input'));field('work').close();input.focus();
};
const player=field('tts-player'), ttsStatus=field('tts-status');
let playbackUrl, ticket, approved=false, playbackRequest=0;
function stopSpeech(){
  playbackRequest++;player.pause();player.removeAttribute('src');player.load();
  if(playbackUrl)URL.revokeObjectURL(playbackUrl);
  playbackUrl=null;ticket=null;player.hidden=true;field('tts-rating').hidden=true;
}
async function outputSettings(){
  const config=await post('/api/control',{action:'voice.output'});
  approved=Boolean(config.reviewed && config.configured);
  field('tts-model').replaceChildren(...config.candidates.map(m=>new Option(m,m)));
  field('tts-voice').replaceChildren(...config.voices.map(v=>new Option(v,v)));
  field('tts-script').textContent=config.speechScript;
  field('tts-sample').disabled=!config.configured;field('tts-disable').hidden=!config.reviewed;
  ttsStatus.textContent=!config.configured?'የሙከራ ቁልፍ ያስፈልጋል · ABYSSINIA_TTS_KEY':approved?'የተፈቀደ ድምፅ · '+config.reviewed.voice:'የአፍ መፍቻ ተናጋሪ ግምገማ ያስፈልጋል።';
  document.dispatchEvent(new Event('speechready'));
}
export function speechReady(){return approved;}
async function playRequest(data){
  stopSpeech();const sequence=playbackRequest;
  const result=await post('/api/control',data);
  if(sequence!==playbackRequest)return;
  const bytes=Uint8Array.from(atob(result.audio),c=>c.charCodeAt(0));
  playbackUrl=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));player.src=playbackUrl;
  ticket=result.ticket; player.hidden=false;
  await player.play();
}
export async function speakAnswer(text){
  if(!approved)return;
  try{await playRequest({action:'voice.speak',text});}
  catch{field('status').textContent='ድምፁን ማጫወት አልተቻለም።'}
}
export {stopSpeech};
field('tts-sample').onclick=async()=>{
  field('tts-sample').disabled=true;ttsStatus.textContent='በማዘጋጀት ላይ…';
  try{await playRequest({action:'voice.sample',model:field('tts-model').value,voice:field('tts-voice').value});ttsStatus.textContent='ያዳምጡና ይገምግሙ።';}
  catch{ttsStatus.textContent='ድምፁን ማዘጋጀት አልተቻለም።'}
  finally{field('tts-sample').disabled=false}
};
player.onended=()=>{if(ticket)field('tts-rating').hidden=false;};
field('tts-model').onchange=field('tts-voice').onchange=stopSpeech;
field('tts-rating').onsubmit=async e=>{
  e.preventDefault();try{
    await post('/api/control',{action:'voice.rate',ticket,native:field('tts-native').checked,naturalness:Number(field('tts-natural').value),clarity:Number(field('tts-clear').value)});
    e.target.reset();stopSpeech();await outputSettings();
  }catch{ttsStatus.textContent='የሙከራው ጊዜ አልፏል። እንደገና ይሞክሩ።'}
};
field('tts-disable').onclick=async()=>{stopSpeech();await post('/api/control',{action:'voice.disable'});await outputSettings();};
record.addEventListener('click',stopSpeech);
field('agent-pause').addEventListener('click',()=>{stopSpeech();stopRecording();});
field('work').addEventListener('close',stopSpeech);
outputSettings().catch(()=>{ttsStatus.textContent='የድምፅ ቅንብር አልተገኘም።'});
