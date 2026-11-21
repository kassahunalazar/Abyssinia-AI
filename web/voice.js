const field = id => document.getElementById(id);
const dictate = field('dictate');
const narrate = field('open-voice');
const state = field('voice-state');
const model = field('voice-model');
const speed = field('voice-speed');
const player = field('tts-player');
const status = field('tts-status');
const lesson = field('tts-rating');
let recording, capture, speech, audioUrl, ticket;
let modelReady = false, approved = false, narration = false;

function saved(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
function show(text = '') {
  state.textContent = text;
  state.hidden = !text;
}
async function post(path, data, signal) {
  const response = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data), signal});
  if (!response.ok) throw Error('Request failed');
  return response.json();
}
const control = (action, data, signal) => post('/api/control', {action, ...data}, signal);

function openSettings() {
  if (!field('settings').open) field('settings-open').click();
  field('voice-panel').open = true;
  field('voice-panel').scrollIntoView({block:'nearest'});
}
function stopSpeech() {
  speech?.abort();
  speech = null;
  player.pause();
  player.removeAttribute('src');
  player.load();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = ticket = null;
  player.hidden = lesson.hidden = true;
}
function setNarration(enabled) {
  narration = enabled;
  narrate.setAttribute('aria-pressed',String(enabled));
  if (!enabled) stopSpeech();
}
async function loadSettings() {
  const [input, output] = await Promise.all([control('voice.models'), control('voice.output')]);
  function choices(select, options, selected) {
    select.replaceChildren(...options.map(value=>new Option(value,value)));
    if (options.includes(selected)) select.value = selected;
  }
  modelReady = input.models.length > 0;
  choices(model,input.models,saved('abyssinia-stt'));
  if (!modelReady) model.add(new Option('ሞዴል አልተጫነም',''));
  approved = Boolean(output.reviewed && output.configured);
  if (!approved) setNarration(false);
  choices(field('tts-model'),output.candidates,output.reviewed?.model);
  choices(field('tts-voice'),output.voices,output.reviewed?.voice);
  field('tts-script').textContent = output.speechScript;
  field('tts-sample').disabled = !output.configured;
  field('tts-disable').hidden = !output.reviewed;
  status.textContent = !output.configured?'Gemini ያገናኙ።':approved?'የተመረጠ ድምፅ · '+output.reviewed.voice:'ድምፅ ይምረጡ፣ ያዳምጡና ይገምግሙ።';
}
model.onchange = () => save('abyssinia-stt',model.value);
if (saved('abyssinia-speed')) speed.value = saved('abyssinia-speed');
speed.onchange = () => {
  save('abyssinia-speed',speed.value);
  player.playbackRate = Number(speed.value);
};
field('voice-panel').ontoggle = () => {
  if (field('voice-panel').open) loadSettings().catch(()=>{status.textContent='የድምፅ ቅንብር አልተገኘም።';});
};

async function play(data) {
  const job = speech = new AbortController();
  const result = await control(data.action,data,job.signal);
  if (speech !== job || job.signal.aborted) return;
  const bytes = Uint8Array.from(atob(result.audio), c=>c.charCodeAt(0));
  audioUrl = URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
  player.src = audioUrl;
  player.playbackRate = Number(speed.value)||1;
  ticket = result.ticket;
  player.hidden = !ticket;
  await player.play();
  return job;
}
export async function narrateReply(text) {
  if (!narration || !approved || recording || capture) return;
  stopSpeech();
  const plain = text.replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/\x60{3}[\s\S]*?\x60{3}/g,' ').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/^[#>* -]+/gm,'').trim();
  if (!plain) return;
  try {
    let remaining=plain;
    while (remaining && narration) {
      const boundary=remaining.length<=1900?remaining.length:Math.max(remaining.lastIndexOf(' ',1900),remaining.lastIndexOf('።',1900)+1,1);
      const length=boundary<125 && remaining.length>1900?1850:boundary;
      const job=await play({action:'voice.speak',text:remaining.slice(0,length).trim()});
      remaining=remaining.slice(length).trim();
      if(!remaining || !job || job!==speech || job.signal.aborted)break;
      const signal=job.signal;
      await new Promise(resolve=>{
        const done=()=>{player.removeEventListener('ended',done);signal.removeEventListener('abort',done);resolve();};
        player.addEventListener('ended',done,{once:true});
        signal.addEventListener('abort',done,{once:true});
        if(player.ended)done();
      });
      if(signal.aborted)break;
      stopSpeech();
    }
  }
  catch(e) { if (e.name!=='AbortError' && narration) show('መልሱን በድምፅ ማንበብ አልተቻለም።'); }
}
narrate.onclick = () => {
  if (!approved) { openSettings(); return; }
  setNarration(!narration);
  show(narration?'አዲስ መልሶች በድምፅ ይነበባሉ።':'የመልስ ድምፅ ጠፍቷል።');
};

function stopRecording() {
  if (recording?.state==='recording') recording.stop();
}
async function encode(chunks) {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await new Blob(chunks).arrayBuffer());
    const offline = new OfflineAudioContext(1,Math.min(320000,Math.ceil(audio.duration*16000)),16000);
    const source = offline.createBufferSource();
    source.buffer = audio;
    source.connect(offline.destination);
    source.start();
    const samples = (await offline.startRendering()).getChannelData(0);
    const raw = Int16Array.from(samples, value=>Math.max(-32768,Math.min(32767,Math.round(value*32768))));
    return new Uint8Array(raw.buffer).toBase64();
  } finally { await context.close(); }
}
async function toggleDictation() {
  if (recording?.state==='recording') { stopRecording(); return; }
  if (capture) return;
  if (!modelReady) { openSettings(); show('ለድምፅ ጽሑፍ ሞዴል ይምረጡ።'); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { show('ማይክሮፎን በዚህ አሳሽ አይገኝም።'); return; }
  stopSpeech();
  capture = new AbortController();
  const job = capture;
  let stream, context, timer;
  function release() {
    clearInterval(timer);
    stream?.getTracks().forEach(track=>track.stop());
    context?.close().catch(()=>{});
    dictate.setAttribute('aria-pressed','false');
  }
  try {
    if ((await control('heartbeat',{},job.signal)).paused) throw Error('Paused');
    stream = await navigator.mediaDevices.getUserMedia({audio:true});
    job.signal.throwIfAborted();
    const chunks=[];
    recording = new MediaRecorder(stream);
    recording.ondataavailable = event=>chunks.push(event.data);
    recording.onerror = () => {job.abort();release();capture=recording=null;show('ቀረጻው አልተሳካም።');};
    recording.onstop = async () => {
      release();
      recording=null;
      try {
        job.signal.throwIfAborted();
        show('ድምፅን ወደ ጽሑፍ በመቀየር ላይ…');
        const {text} = await post('/api/voice/benchmark',{pcm:await encode(chunks), model:model.value},job.signal);
        job.signal.throwIfAborted();
        const input = field('message');
        const draft = [input.value.trimEnd(),text.trim()].filter(Boolean).join(' ');
        if (!text.trim() || draft.length > input.maxLength) { show('ጽሑፍ አልተጨመረም።'); return; }
        input.value = draft;
        input.dispatchEvent(new Event('input'));
        show('ጽሑፉን አርመው ይላኩ።');
        input.focus();
      } catch(e) { if (e.name!=='AbortError') show('ድምፁን ወደ ጽሑፍ መቀየር አልተቻለም።'); }
      finally { if (capture===job) capture=null; }
    };
    context = new AudioContext();
    const analyser = context.createAnalyser();
    context.createMediaStreamSource(stream).connect(analyser);
    const levels = new Float32Array(analyser.fftSize);
    const start = performance.now();
    let lastVoice = 0;
    timer = setInterval(()=>{
      analyser.getFloatTimeDomainData(levels);
      const rms = Math.sqrt(levels.reduce((sum,value)=>sum+value*value,0)/levels.length);
      const now = performance.now();
      if (rms>0.012) lastVoice=now;
      if (now-start>=18000 || (lastVoice && now-lastVoice>=3000)) stopRecording();
    },100);
    recording.start();
    dictate.setAttribute('aria-pressed','true');
    show('በመቅረጽ ላይ… · Ctrl+B ለማቆም');
  } catch(e) {
    release();capture=recording=null;
    if(e.name!=='AbortError') show('ማይክሮፎኑን ማስጀመር አልተቻለም።');
  }
}
dictate.onclick = toggleDictation;
document.addEventListener('keydown',event=>{
  if (event.ctrlKey && !event.repeat && !event.isComposing && event.key.toLowerCase()==='b' && !document.querySelector('dialog[open]')) {
    event.preventDefault();void toggleDictation();
  }
});
field('agent-pause').addEventListener('click',()=>{
  stopSpeech();capture?.abort();stopRecording();show();
});
field('tts-connect').onclick = async () => {
  const connect = field('tts-connect'); connect.disabled=true;
  try { await control('voice.connect');await loadSettings(); }
  catch { status.textContent='የGemini ግንኙነት አልተሳካም።'; }
  finally { connect.disabled=false; }
};
field('tts-sample').onclick = async () => {
  const sample = field('tts-sample');sample.disabled=true;
  stopSpeech();
  try { await play({action:'voice.sample',model:field('tts-model').value,voice:field('tts-voice').value}); }
  catch(e) { if(e.name!=='AbortError') status.textContent='ድምፁን ማዘጋጀት አልተቻለም።'; }
  finally { sample.disabled=false; }
};
player.onended = () => { if(ticket) lesson.hidden=false; };
field('tts-model').onchange = field('tts-voice').onchange = stopSpeech;
lesson.onsubmit = async event => {
  event.preventDefault();
  try {
    await control('voice.rate',{ticket,native:field('tts-native').checked,naturalness:Number(field('tts-natural').value),clarity:Number(field('tts-clear').value)});
    lesson.reset();stopSpeech();await loadSettings();
  } catch { status.textContent='ናሙናውን ደግመው ያዳምጡ።'; }
};
field('tts-disable').onclick = async () => {
  try { setNarration(false);await control('voice.disable');await loadSettings(); }
  catch { status.textContent='ድምፁን ማሰናከል አልተቻለም።'; }
};
field('settings').addEventListener('close',()=>{if(ticket)stopSpeech();});
loadSettings().catch(()=>{status.textContent='የድምፅ ቅንብር አልተገኘም።';});
