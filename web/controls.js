import './voice.js';
import { currentProvider } from './settings.js';
const $ = id => document.getElementById(id);
let stopped = false;
export const paused = () => stopped;
let editing = null;
function button(label, handler) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = label; b.onclick = handler; return b;
}
function line(text) {
  const p = document.createElement('p'); p.textContent = text; return p;
}
async function action(action, params = {}) {
  const r = await fetch('/api/control', { method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ action, ...params }) });
  if (!r.ok) {
    const failure=await r.json();
    throw Error(failure.error==='stale'?'ፋይሉ ተቀይሯል። እንደገና ይምረጡት።':'ጥያቄው አልተሳካም። ስሙን፣ ፈቃዱንና የአጋዡን ሁኔታ ያረጋግጡ።');
  }
  return r.json();
}
function message(text) { $('work-message').textContent = text; }
let documents=[];
function filterDocuments(){
  const q=$('doc-search').value.normalize().toLocaleLowerCase();
  const selected=$('doc-files').value;
  const matches=documents.filter(name=>name.normalize().toLocaleLowerCase().includes(q));
  $('doc-files').replaceChildren(...matches.map(name=>new Option(name,name)));
  if(matches.includes(selected))$('doc-files').value=selected;
  $('doc-preview').textContent='';
}
async function listDocuments(){
  if(!$('document-browser').open)return;
  try{documents=(await action('document.list')).names;filterDocuments();}catch(e){message(e.message)}
}
$('document-browser').ontoggle=listDocuments;
$('doc-search').oninput=filterDocuments;
$('doc-files').onchange=()=>{$('doc-preview').textContent='';};
$('doc-read').onclick=async()=>{try{$('doc-preview').textContent=(await action('document.read',{name:$('doc-files').value})).text;}catch(e){message(e.message);}};
for(const operation of ['rename','delete']){
  $('doc-'+operation).onclick=async()=>{
    try{await action('document.propose',{operation,name:$('doc-files').value,destination:$('doc-name').value});await refresh();$('approval-list').scrollIntoView();}
    catch(e){message(e.message);}
  };
}
async function decide(id, decision) {
  try { const result=await action(decision,{id}); message(result.datetime ? result.timezone+' · '+result.datetime : decision === 'approve' ? 'ጥያቄው ተፈጽሟል።' : 'ጥያቄው ውድቅ ሆኗል።');
    if(decision==='approve'&&codeFile){const s=await action('code.read');if(s.text!==codeFile.text)loadCode(s);}
  }
  catch(e) { message(e.message); }
  await refresh();await listDocuments();
}
const labels = { chat:'ውይይት', 'file.create':'ፋይል መፍጠር','provider.test':'አቅራቢ መፈተሽ','attachment.read':'አባሪ ማንበብ',agent:'አጋዥ',
  completed:'ተጠናቋል', requested:'ተጠይቋል', approved:'ተፈቅዷል',rejected:'ውድቅ ሆኗል',created:'ተፈጥሯል',failed:'አልተሳካም',expired:'ጊዜው አልፏል',paused:'ቆሟል',resumed:'ቀጥሏል',cancelled:'ተሰርዟል',interrupted:'ተቋርጧል' };
async function refresh() {
  const s = await action('status');
  stopped = s.paused;
  $('agent-pause').textContent = stopped ? 'ቀጥል · Resume' : 'አቁም · Pause';
  document.dispatchEvent(new Event('controlchange'));
  $('quiet-hours').checked = s.quiet;
  $('code-undo').disabled=!s.canUndo;
  $('desktop-enabled').checked=s.desktopEnabled;
  $('desktop-list').disabled=!s.desktopEnabled;
  if(!s.desktopEnabled)$('desktop-window').replaceChildren();
  $('desktop-propose').disabled=!s.desktopEnabled||!$('desktop-window').value;
  if(!s.codeTarget){codeFile=null;$('code-edit').hidden=true;}
  $('mcp-list').replaceChildren(...s.connections.map(c=>{
    const box=document.createElement('article');
    box.append(line(c.name+' · '+c.url),line(!c.enabled?'ተዘግቷል':!c.checked?'ገና አልተፈተሸም':c.error?'ግንኙነት አልተሳካም':'ተገናኝቷል'),
      line((c.tools??[]).join(', ')));
    if(c.checked)box.append(line(new Date(c.checked).toLocaleString()+' · '+c.capabilities.join(', ')));
    if(c.enabled)box.append(button('መሣሪያዎችን ፈትሽ',()=>mcpAction('mcp.check',c.id)));
    if(c.enabled && c.tools.includes('get_current_time')){
      const timezone=document.createElement('input');timezone.value='Africa/Addis_Ababa';timezone.setAttribute('aria-label','Time zone');
      box.append(timezone,button('ሰዓት ጠይቅ',async()=>{try{await action('mcp.time',{id:c.id,timezone:timezone.value});await refresh();$('approval-list').scrollIntoView();}catch(e){message(e.message);}}));
    }
    box.append(button(c.enabled?'አሰናክል':'አንቃ',()=>mcpAction('mcp.toggle',c.id)),
      button('አስወግድ',()=>{if(confirm('ግንኙነቱ ይወገድ?'))mcpAction('mcp.remove',c.id)}));
    return box;
  }));
  $('reminders').replaceChildren(...s.reminders.map(r=>{
    const box=document.createElement('article');
    box.append(line(r.title),line(r.next ? new Date(r.next).toLocaleString()+(r.weekly?' · በየሳምንቱ':r.daily?' · በየቀኑ':'') : 'ደርሷል'));
    if(r.status!=='delivered') box.append(button(r.status==='held'?'ቀጥል':'ለአፍታ አቁም',()=>changeReminder(r.status==='held'?'release':'hold',r.id)));
    box.append(button('ሰርዝ',()=>{if(confirm('ደወሉ ይሰረዝ?')) changeReminder('removeReminder',r.id)}));
    return box;
  }));
  $('approval-list').replaceChildren(...s.approvals.map(item => {
    const box = document.createElement('article');
    const body = document.createElement('pre'); body.textContent = item.text;
    if(item.tool==='code.replace'){
      const original=item.before.split(/\r?\n/), next=item.text.split(/\r?\n/);
      let start=0, end=0;
      while(start<Math.min(original.length,next.length) && original[start]===next[start])start++;
      while(end<Math.min(original.length,next.length)-start && original.at(-1-end)===next.at(-1-end))end++;
      const changes=document.createElement('pre');
      changes.textContent=['@@ '+(start+1)+' @@',...original.slice(start,original.length-end).map(l=>'- '+l),
        ...next.slice(start,next.length-end).map(l=>'+ '+l)].join('\n');
      box.append(line('የተቀየሩ መስመሮች · Diff'),changes);
      const old=document.createElement('pre');old.textContent=item.before;
      box.append(line('የአሁኑ ይዘት'),old,line('የታቀደ ይዘት'));
    }
    box.append(line(item.agent+' · '+item.tool+' · '+item.risk),line(item.target),
      line('የፈቃዱ መጨረሻ · '+new Date(item.expires).toLocaleTimeString()),body,
      button('ፍቀድ',()=>decide(item.id,'approve')),button('ውድቅ አድርግ',()=>decide(item.id,'reject')));
    return box;
  }));
  if (!s.approvals.length) $('approval-list').append(line('የሚጠብቅ ጥያቄ የለም።'));
  $('activity-list').replaceChildren(...s.events.map(e => {
    const li = document.createElement('li'); li.textContent = [new Date(e.time).toLocaleString(),labels[e.action] ?? e.action,labels[e.result] ?? e.result,e.target].filter(Boolean).join(' · '); return li;
  }));
}
$('agent-pause').onclick = async () => {
  try { await action(stopped ? 'resume':'pause'); await refresh(); }
  catch(e) { $('status').textContent=e.message; }
};
async function changeReminder(name,id) {
  try {await action(name,{id}); await refresh();} catch(e){message(e.message)}
}
$('quiet-hours').onchange=async e=>{
  try {await action('quiet',{enabled:e.target.checked}); await refresh();}catch(err){message(err.message)}
};
$('reminder-form').onsubmit=async e=>{
  e.preventDefault();
  try {
    await action('schedule',{draft:e.target.dataset.draft,title:$('reminder-title').value,next:new Date($('reminder-time').value).getTime(),daily:$('reminder-repeat').value==='daily',weekly:$('reminder-repeat').value==='weekly'});
    delete e.target.dataset.draft; e.target.reset(); message('ደወሉ ተመዝግቧል።'); await refresh();
  } catch(err){message(err.message)}
};
let latestNotice;
$('dismiss-reminder').onclick=()=>{
  sessionStorage.setItem('abyssinia-dismissed',latestNotice);
  $('reminder-banner').hidden=true;
};
async function heartbeat(){
  if(document.hidden)return;
  const {paused:remote,notice}=await action('heartbeat');
  if(remote!==stopped || $('work').open) await refresh();
  if(notice){
    latestNotice=JSON.stringify(notice);
    if(sessionStorage.getItem('abyssinia-dismissed')!==latestNotice){
      $('reminder-notice').textContent='ማስታወሻ · '+notice.target;
      $('reminder-banner').hidden=false;
    }
  }
}
setInterval(()=>heartbeat().catch(()=>{}),10000);
$('work-open').onclick = async () => { $('work').showModal(); message(''); displayMemos(); try {await refresh()} catch(e) {message(e.message)} };
$('work-close').onclick = () => $('work').close();
export function proposeDocument(text) {
  $('save-error').textContent=''; $('document-text').value=text; $('save-document').showModal();
}
$('save-cancel').onclick=()=>$('save-document').close();
$('document-form').onsubmit=async e=>{
  e.preventDefault();
  try {
    await action('propose',{name:$('document-name').value,text:$('document-text').value});
    $('save-document').close(); $('work-open').click();
  } catch(err) { $('save-error').textContent=err.message; }
};
function memos() { return JSON.parse(localStorage.getItem('abyssinia-memos') ?? '[]'); }
function store(list) { localStorage.setItem('abyssinia-memos', JSON.stringify(list)); displayMemos(); }
function displayMemos() {
  const q=$('memo-search').value.toLocaleLowerCase();
  $('memo-list').replaceChildren(...memos().filter(m=>m.text.toLocaleLowerCase().includes(q)).map(m=>{
    const box=document.createElement('article');
    box.append(line(m.text),line('እርስዎ ያስቀመጡት · '+new Date(m.created).toLocaleString()),
      button('በውይይት ተጠቀም',()=>{
        const field=$('message');
        const draft=(field.value+'\n'+m.text).trim();
        if(draft.length>field.maxLength){message('መልዕክቱ በጣም ረጅም ነው።');return}
        field.value=draft;field.dispatchEvent(new Event('input'));$('work').close();field.focus();
      }),button('አርም',()=>{editing=m.id;$('memo-text').value=m.text;$('memo-text').focus()}),
      button('ሰርዝ',()=>{if(confirm('ይህ ማስታወሻ ይሰረዝ?')){store(memos().filter(x=>x.id!==m.id));if(editing===m.id){editing=null;$('memo-text').value=''}}}));
    return box;
  }));
}
$('memo-search').oninput=displayMemos;
$('memo-form').onsubmit=e=>{
  e.preventDefault();const text=$('memo-text').value.trim();if(!text)return;
  const list=memos();const existing=list.find(x=>x.id===editing);
  if(existing)existing.text=text;else list.unshift({id:crypto.randomUUID(),created:Date.now(),text});
  try {store(list);editing=null;$('memo-text').value='';} catch {message('ማስታወሻውን ማስቀመጥ አልተቻለም።')}
};
refresh().catch(()=>{ $('agent-pause').title='ሁኔታውን መጫን አልተቻለም።'; });
$('research-form').onsubmit=async e=>{
  e.preventDefault();
  const go=e.target.querySelector('button');go.disabled=true;
  const list=$('sources');list.replaceChildren(line('በመፈለግ ላይ…'));
  try {
    const response=await fetch('/api/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      query:$('research-query').value,language:$('research-lang').value})});
    if(!response.ok)throw Error();
    const {sources}=await response.json();
    list.replaceChildren(...sources.map(source=>{
      const box=document.createElement('article');
      const link=document.createElement('a');link.textContent=source.title;link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';
      box.append(link,line(source.excerpt));return box;
    }));
    if(!sources.length){list.append(line('ምንጭ አልተገኘም።'));return}
    list.append(button('ምንጮቹን ወደ ውይይት አያይዝ',()=>{
      const input=$('attachment');
      if(input.files.length && !confirm('ያለው አባሪ በምንጮቹ ይተካ?'))return;
      const contents=sources.map((s,i)=>'['+(i+1)+'] '+s.title+'\n'+s.url+'\n'+s.excerpt).join('\n\n');
      const selection=new DataTransfer();selection.items.add(new File([contents],'sources.txt',{type:'text/plain'}));
      input.files=selection.files;
      const prompt=$('message');
      if(!prompt.value.trim())prompt.value='አባሪውን አንብብ፤ ምንጮቹን በማጣቀስ ዋና ዋና ነጥቦቹን አጠቃልል።';
      prompt.dispatchEvent(new Event('input'));$('work').close();prompt.focus();
    }));
  }catch{list.replaceChildren(line('ፍለጋው አልተሳካም። ግንኙነቱንና የአጋዡን ሁኔታ ያረጋግጡ።'))}
  finally{go.disabled=false}
};
const projectPicker=$('project-picker');
const projectFile=$('project-file');
let projectFiles=[];
projectPicker.onchange=async()=>{
  const selection=projectPicker.files;
  const head=Array.from(selection).find(f=>f.webkitRelativePath.split('/').slice(1).join('/')==='.git/HEAD' && f.size<=512);
  $('project-branch').textContent='';
  const excluded=new Set(['node_modules','.git','.runtime','venv','__pycache__','dist','build','vendor','target']);
  projectFiles=Array.from(projectPicker.files).filter(file=>{
    const parts=file.webkitRelativePath.split('/').slice(1);
    return file.size<=16384 && parts.every(p=>!p.startsWith('.')&&!excluded.has(p.toLowerCase())) &&
      /\.(js|mjs|jsx|ts|tsx|py|html|css|cs|go|rs|java|c|cpp|h|rb|kt|swift|sql|md)$/i.test(file.name);
  }).sort((a,b)=>a.webkitRelativePath.localeCompare(b.webkitRelativePath));
  projectFile.replaceChildren(...projectFiles.map((file,i)=>new Option(file.webkitRelativePath,String(i))));
  projectFile.disabled=$('review-file').disabled=!projectFiles.length;
  message(projectFiles.length+' ለክለሳ የሚሆኑ ፋይሎች · እስከ 16 KiB');
  if(head){
    try{
      const ref=(await head.text()).trim();
      const branch=/^ref: refs\/heads\/([^\s\x00-\x1f]{1,220})$/.exec(ref)?.[1] ?? (/^[0-9a-f]{40,64}$/i.test(ref)?ref.slice(0,12):'');
      if(branch && projectPicker.files===selection)$('project-branch').textContent='Git · '+branch;
    }catch{}
  }
};
$('review-file').onclick=()=>{
  const file=projectFiles[projectFile.selectedIndex];
  if(!file)return;
  const input=$('attachment');
  if(input.files.length && !confirm('ያለው አባሪ በኮዱ ይተካ?'))return;
  const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;
  const prompt=$('message');
  if(!prompt.value.trim())prompt.value='የተያያዘውን ኮድ አንብብ። ሊኖሩ የሚችሉ ችግሮችን፣ የማስተካከያ ሐሳብና የፈተና ዕቅድ አቅርብ።';
  prompt.dispatchEvent(new Event('input'));$('work').close();prompt.focus();
};
$('screen-read').disabled=!navigator.mediaDevices?.getDisplayMedia;
$('screen-read').onclick=async()=>{
  const output=$('screen-result');const b=$('screen-read');
  if(stopped){output.textContent='አጋዡ ቆሟል።';return}
  b.disabled=true;$('screen-review').hidden=true;
  let stream;
  try{
    stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
    const video=document.createElement('video');video.muted=true;video.srcObject=stream;await video.play();
    const scale=Math.min(1,1600/Math.max(video.videoWidth,video.videoHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(video.videoWidth*scale));canvas.height=Math.max(1,Math.floor(video.videoHeight*scale));
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    stream.getTracks().forEach(t=>t.stop());video.srcObject=null;
    output.textContent='ጽሑፉን በዚህ ኮምፒውተር በማንበብ ላይ…';
    const response=await fetch('/api/screen/read',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({image:canvas.toDataURL('image/png').split(',')[1]})});
    if(!response.ok)throw Error();
    const result=await response.json();$('screen-text').value=result.text;
    output.textContent=result.text ? 'Windows OCR · '+result.language : 'ጽሑፍ አልተገኘም።';
    $('screen-review').hidden=!result.text;
  }catch(e){output.textContent=e.name==='NotAllowedError'?'ፈቃድ አልተሰጠም።':'ጽሑፉን ማንበብ አልተቻለም።'}
  finally{stream?.getTracks().forEach(t=>t.stop());b.disabled=false}
};
$('screen-attach').onclick=()=>{
  const text=$('screen-text').value.trim();if(!text)return;
  const file=new File([text],'screen-text.txt',{type:'text/plain'});
  if(file.size>16384){$('screen-result').textContent='ጽሑፉን ወደ 16 KiB ያሳጥሩ።';return}
  if($('attachment').files.length&&!confirm('ያለው አባሪ በጽሑፉ ይተካ?'))return;
  const dt=new DataTransfer();dt.items.add(file);$('attachment').files=dt.files;
  $('work').close();$('message').focus();
};
let codeFile=null;
async function mcpAction(name,id){
  try{await action(name,{id});message('ተጠናቋል።');}catch(e){message(e.message)}await refresh();
}
$('mcp-add').onsubmit=async e=>{
  e.preventDefault();try{await action('mcp.add',{name:$('mcp-name').value,url:$('mcp-url').value});e.target.reset();await refresh();}
  catch(err){message(err.message)}
};
function loadCode(snapshot){
  codeFile=snapshot;
  $('code-target').textContent=snapshot.target;
  $('code-content').value=snapshot.text;
  $('code-edit').hidden=false;
}
$('code-pick').onclick=async()=>{
  const b=$('code-pick');b.disabled=true;
  try{const s=await action('code.pick');if(!s.cancelled){loadCode(s);await refresh();}}
  catch(e){message(e.message)}finally{b.disabled=false}
};
$('code-revoke').onclick=async()=>{try{await action('code.close');await refresh()}catch(e){message(e.message)}};
$('code-undo').onclick=async()=>{try{await action('code.undo',{grant:codeFile.id??codeFile.grant});await refresh();$('approval-list').scrollIntoView()}catch(e){message(e.message)}};
$('code-check').onclick=async()=>{
  if(!codeFile)return;
  try{
    const result=await action('code.check',{grant:codeFile.grant,text:$('code-content').value});
    message(result.valid?'Syntax ✓':'Syntax ✗ '+(result.line?' · መስመር '+result.line:''));
  }catch(e){message(e.message)}
};
$('code-propose').onclick=async()=>{
  if(!codeFile)return;
  let text=$('code-content').value;
  if(!codeFile.text.replaceAll('\r\n','').includes('\n') && codeFile.text.includes('\r\n'))text=text.replace(/\r?\n/g,'\r\n');
  if(codeFile.text.startsWith('\ufeff')&&!text.startsWith('\ufeff'))text='\ufeff'+text;
  try{await action('code.propose',{grant:codeFile.grant,before:codeFile.text,text});await refresh();$('approval-list').scrollIntoView();}
  catch(e){message(e.message)}
};
$('code-generate').onclick=async()=>{
  const file=codeFile, instruction=$('code-instruction').value.trim();
  if(!file || !instruction){message('የሚፈለገውን ለውጥ ይጻፉ።');return}
  if(new Blob([file.text]).size>16384){message('ሞዴሉ የሚቀበለው ፋይል እስከ 16 KiB ነው።');return}
  const b=$('code-generate');b.disabled=true;message('ለውጡን በማዘጋጀት ላይ…');
  try{
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json','X-Text-Attachment':'1'},
      body:JSON.stringify({provider:currentProvider(),attachment:{name:file.target.split(/[\\/]/).pop(),text:file.text},
        message:'Read the attached source with read_attached_text. Apply this requested edit. Return the complete replacement file in one fenced code block. Preserve unrelated code. Request: '+instruction,conversation:null})});
    if(!r.ok)throw Error();
    const result=await r.json();
    if(result.tool!=='read_attached_text'||file!==codeFile)throw Error();
    const match=/^\s*`{3}[^\n]*\n([\s\S]*?)\r?\n`{3}\s*$/.exec(result.reply);
    if(!match)throw Error();
    $('code-content').value=match[1]+(file.text.endsWith('\n')?'\n':'');
    message('የታቀደውን ይዘት ይገምግሙ።');
  }catch{message('የተሟላ ለውጥ አልተገኘም። እንደገና ይሞክሩ ወይም በእጅ ያርሙ።')}
  finally{b.disabled=false}
};
$('desktop-enabled').onchange=async e=>{
  try{await action(e.target.checked?'desktop.enable':'desktop.disable');}catch(err){message(err.message)}await refresh();
};
$('desktop-list').onclick=async()=>{
  try{const result=await action('desktop.list');
    $('desktop-window').replaceChildren(...result.windows.map(w=>new Option(w.process+' · '+w.title,w.id)));
    $('desktop-propose').disabled=!result.windows.length;
  }catch(e){message(e.message)}
};
$('desktop-propose').onclick=async()=>{
  try{await action('desktop.propose',{window:$('desktop-window').value,operation:$('desktop-operation').value});await refresh();$('approval-list').scrollIntoView();}
  catch(e){message(e.message)}
};
