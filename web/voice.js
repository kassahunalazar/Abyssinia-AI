const field = id => document.getElementById(id);
const dictate = field('dictate');
const state = field('voice-state');
let recording, capture;

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
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { show('ማይክሮፎን በዚህ አሳሽ አይገኝም።'); return; }
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
    const {models} = await control('voice.models', {}, job.signal);
    if (!models.length) {
      show('የድምፅ ጽሑፍ ሞዴል አልተጫነም። · Install a dictation model.');
      capture = null;
      return;
    }
    let model = models[0];
    try {
      const preferred = localStorage.getItem('abyssinia-stt');
      if (models.includes(preferred)) model = preferred;
    } catch {}
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
        const {text} = await post('/api/voice/benchmark',{pcm:await encode(chunks), model},job.signal);
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
  capture?.abort();stopRecording();show();
});
