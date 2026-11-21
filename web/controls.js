import './voice.js';
import { currentProvider } from './settings.js';
import { chooseBrowserArticle, initializeBrowserReader, showBrowserPage } from './browser-reader.js';
const $ = id => document.getElementById(id);
let stopped = false;
let displayedApprovals;
let codeFile = null;
let project = null;
let projectBusy = false;
export const paused = () => stopped;
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
    if(failure.error==='stale' && action.startsWith('memory.'))throw Error('ማስታወሻው ተቀይሯል። እንደገና ይምረጡት።');
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
    if (result.browserPage) showBrowserPage(result.browserPage);
    else if(result.tests){
      const {passed,rows,error}=result.tests;
      $('project-test-output').textContent=[passed?'PASS':'FAIL',error,...rows.map(row=>(row.passed?'✓ ':'✗ ')+row.name+(row.error?' · '+row.error:''))].filter(Boolean).join('\n');
      $('project-test-output').scrollIntoView({block:'center'});
    }
    else if(decision==='approve'&&codeFile){const s=await action('code.read');if(s.grant===codeFile?.grant&&s.text!==codeFile.text)loadCode(s);}
  }
  catch(e) { message(e.message); }
  await refresh();await listDocuments();
}
const labels = { chat:'ውይይት', 'file.create':'ፋይል መፍጠር','provider.test':'አቅራቢ መፈተሽ','attachment.read':'አባሪ ማንበብ',agent:'አጋዥ',
  'memory.create':'ማስታወሻ ተቀምጧል','memory.update':'ማስታወሻ ታርሟል','memory.delete':'ማስታወሻ ተሰርዟል','memory.import':'ማስታወሻ ገብቷል',
  completed:'ተጠናቋል', requested:'ተጠይቋል', approved:'ተፈቅዷል',rejected:'ውድቅ ሆኗል',created:'ተፈጥሯል',failed:'አልተሳካም',expired:'ጊዜው አልፏል',paused:'ቆሟል',resumed:'ቀጥሏል',cancelled:'ተሰርዟል',interrupted:'ተቋርጧል' };
async function refresh() {
  const s = await action('status');
  stopped = s.paused;
  $('agent-pause').textContent = stopped ? 'ቀጥል · Resume' : 'አቁም · Pause';
  document.dispatchEvent(new Event('controlchange'));
  $('quiet-hours').checked = s.quiet;
  $('code-undo').disabled=!s.canUndo || !codeFile;
  $('desktop-enabled').checked=s.desktopEnabled;
  $('desktop-list').disabled=!s.desktopEnabled;
  if(!s.desktopEnabled){$('desktop-window').replaceChildren();clearWindowControls();}
  $('desktop-scan').disabled=$('desktop-chat').disabled=$('desktop-propose').disabled=!s.desktopEnabled||!$('desktop-window').value;
  if(codeFile && codeFile.grant!==s.codeGrant) clearCode();
  if(!projectBusy && project?.repository!==s.repository){
    loadProject(s.repository ? { repository:s.repository, root:s.repositoryRoot, files:[] } : null);
    if(s.repository) await projectOperation(reloadProject);
  }
  projectButtons();
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
    const finished=r.job==='research' ? (r.jobResult?.status==='failed' ? 'ፍለጋው አልተሳካም።' : 'ተጠናቋል') : 'ደርሷል';
    const next=r.next ? new Date(r.next).toLocaleString()+(r.weekly?' · በየሳምንቱ':r.daily?' · በየቀኑ':'') : finished;
    box.append(line(r.title),line(r.status==='held'?'በጊዜያዊነት ቆሟል · '+next:next));
    if(r.job==='research'){
      box.append(line('የታቀደ የምንጭ ፍለጋ'+(r.last?' · '+new Date(r.last).toLocaleString():'')));
      if(r.jobResult){
        box.append(line(r.jobResult.status==='failed'?'ፍለጋው አልተሳካም።':r.jobResult.sources.length?'የተገኙ ምንጮች፦':'ምንጭ አልተገኘም።'));
        for(const source of r.jobResult.sources){
          const link=document.createElement('a');link.href=source.url;link.textContent=source.title;link.target='_blank';link.rel='noreferrer';
          const row=document.createElement('p');row.append(link);box.append(row);
        }
      }
    }
    if(r.status!=='delivered') box.append(button(r.status==='held'?'ቀጥል':'ለአፍታ አቁም',()=>changeReminder(r.status==='held'?'release':'hold',r.id)));
    box.append(button('ሰርዝ',()=>{if(confirm('ደወሉ ይሰረዝ?')) changeReminder('removeReminder',r.id)}));
    return box;
  }));
  const approvalIds=s.approvals.map(item=>item.id).join('/');
  if(approvalIds!==displayedApprovals){
    displayedApprovals=approvalIds;
    $('approval-list').replaceChildren(...s.approvals.map(item => {
      const box = document.createElement('article');
      const body = document.createElement('pre'); body.textContent = item.text;
      if(item.tool==='code.replace'||item.tool==='code.projectReplace'){
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
  }
  $('activity-list').replaceChildren(...s.events.map(e => {
    const li = document.createElement('li'); li.textContent = [new Date(e.time).toLocaleString(),labels[e.action] ?? e.action,labels[e.result] ?? e.result,e.target].filter(Boolean).join(' · '); return li;
  }));
  if($('schedule-history').open && $('work').open)await displayScheduleHistory();
}
$('agent-pause').onclick = async () => {
  try { await action(stopped ? 'resume':'pause'); await refresh(); }
  catch(e) { $('status').textContent=e.message; }
};
async function changeReminder(name,id) {
  try {await action(name,{id}); await refresh();} catch(e){message(e.message)}
}
let displayedRuns;
async function displayScheduleHistory(){
  try {
    const {runs}=await action('schedule.history');
    const key=JSON.stringify(runs);
    if(key===displayedRuns)return;
    displayedRuns=key;
    const list=$('schedule-run-list');
    list.replaceChildren(...runs.map(run=>{
      const box=document.createElement('article');
      const outcome={delivered:'ደርሷል',completed:'ተጠናቋል',failed:'አልተሳካም',interrupted:'ተቋርጧል'}[run.outcome];
      const kind=run.job==='research'?'የምንጭ ፍለጋ':'የማስታወሻ ደወል';
      box.append(line(run.title+' · '+kind),line(new Date(run.finished).toLocaleString()+' · '+outcome));
      if(run.failure==='research_unavailable')box.append(line('Wikipedia የምንጭ ፍለጋውን ማጠናቀቅ አልቻለም።'));
      if(run.failure==='cancelled')box.append(line('ፍለጋው ከመጠናቀቁ በፊት ተቋርጧል።'));
      if(run.job==='research' && run.outcome==='completed' && !run.sources.length)box.append(line('ምንጭ አልተገኘም።'));
      for(const source of run.sources){
        const link=document.createElement('a');
        link.href=source.url;link.textContent=source.title;link.target='_blank';link.rel='noopener noreferrer';
        const row=document.createElement('p');row.append(link);box.append(row);
      }
      return box;
    }));
    if(!runs.length)list.append(line('እስካሁን የተካሄደ ቀጠሮ የለም።'));
  }catch(e){message(e.message);}
}
$('schedule-history').ontoggle=()=>{if($('schedule-history').open)void displayScheduleHistory();};
$('quiet-hours').onchange=async e=>{
  try {await action('quiet',{enabled:e.target.checked}); await refresh();}catch(err){message(err.message)}
};
$('schedule-kind').onchange=()=>{$('schedule-language').hidden=$('schedule-kind').value!=='research';};
$('reminder-form').onsubmit=async e=>{
  e.preventDefault();
  try {
    await action('schedule',{draft:e.target.dataset.draft,...($('schedule-kind').value==='research'&&{job:'research',language:$('schedule-lang').value}),title:$('reminder-title').value,next:new Date($('reminder-time').value).getTime(),daily:$('reminder-repeat').value==='daily',weekly:$('reminder-repeat').value==='weekly'});
    delete e.target.dataset.draft; e.target.reset(); $('schedule-kind').onchange(); message('ደወሉ ተመዝግቧል።'); await refresh();
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
$('work-open').onclick = async () => {
  $('work').showModal();message('');displayMemos();
  await Promise.all([refreshMemos(),refresh().catch(e=>message(e.message))]);
};
$('work-close').onclick = () => $('work').close();
for(const shortcut of document.querySelectorAll('[data-work]')){
  shortcut.onclick=()=>{
    $('work-open').click();
    const destination=$(shortcut.dataset.work);
    destination.scrollIntoView({block:'center'});destination.focus({preventScroll:true});
  };
}
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
const legacyMemosKey='abyssinia-memos';
let memories=[];
let editingMemo;
let memoBusy=false;
const memoStatus=text=>{$('memo-status').textContent=text;};
function legacyMemos(){
  const saved=JSON.parse(localStorage.getItem(legacyMemosKey)??'[]');
  return Array.isArray(saved)?saved:[];
}
function resetMemoForm(){
  editingMemo=undefined;
  $('memo-form').reset();
  $('memo-cancel').hidden=true;
  $('memo-save').textContent='አስቀምጥ';
}
function useMemo(text){
  const field=$('message');
  const draft=[field.value,text].filter(Boolean).join('\n').trim();
  if(draft.length>field.maxLength){memoStatus('መልዕክቱ በጣም ረጅም ነው።');return;}
  field.value=draft;field.dispatchEvent(new Event('input'));$('work').close();field.focus();
}
function displayMemos(){
  const q=$('memo-search').value.normalize().toLocaleLowerCase();
  let legacy=[];
  try {legacy=legacyMemos();}catch{memoStatus('የአሳሽ ማስታወሻዎችን ማንበብ አልተቻለም።');}
  const storedIds=new Set(memories.map(m=>m.id));
  const rows=[...memories,...legacy.filter(m=>typeof m?.id==='string' && typeof m?.text==='string' && !storedIds.has(m.id))];
  $('memo-list').replaceChildren(...rows.filter(m=>m.text.normalize().toLocaleLowerCase().includes(q)).map(m=>{
    const box=document.createElement('article');
    const origin=m.source==='user'?'በእርስዎ የተቀመጠ':m.source==='browser-note'?'ከአሳሽ የገባ':'በአሳሽ ብቻ የተቀመጠ';
    const dates=new Date(m.created).toLocaleString()+(m.updated&&m.updated!==m.created?' · የዘመነ '+new Date(m.updated).toLocaleString():'');
    box.append(line(m.text),line(origin+' · '+dates),button('በውይይት ተጠቀም',()=>useMemo(m.text)),
      button('አርም',()=>{
        editingMemo=m;$('memo-text').value=m.text;$('memo-text').focus();
        $('memo-cancel').hidden=false;$('memo-save').textContent='ለውጡን አስቀምጥ';
      }),button('ሰርዝ',()=>{
        if(confirm('ይህ ማስታወሻ ይሰረዝ?'))void mutateMemo(async()=>{
          if(m.source){
            if(m.source==='browser-note')removeLegacyMemo(m);
            await action('memory.delete',{id:m.id,revision:m.revision,confirmed:true});
          }else removeLegacyMemo(m);
          if(editingMemo?.id===m.id)resetMemoForm();
        });
      }));
    if(!m.source)box.append(button('ወደ የሥራ ቦታ አስገባ',()=>{
      if(confirm('ይህን የአሳሽ ማስታወሻ በዚህ የሥራ ቦታ ማስቀመጥ ይፈልጋሉ?'))void mutateMemo(async()=>{
        await action('memory.import',{id:m.id,text:m.text,created:m.created,confirmed:true});
        removeLegacyMemo(m);
        if(editingMemo?.id===m.id)resetMemoForm();
      });
    }));
    return box;
  }));
}
function removeLegacyMemo(m){
  const list=legacyMemos();
  const next=list.filter(row=>row?.id!==m.id || row.created!==m.created);
  if(next.length!==list.length)localStorage.setItem(legacyMemosKey,JSON.stringify(next));
}
async function refreshMemos(){
  try{({memories}=await action('memory.list'));displayMemos();}catch(e){memoStatus(e.message);}
}
async function mutateMemo(change){
  if(memoBusy)return;
  memoBusy=true;$('memo-save').disabled=true;
  try {await change();memoStatus('ተጠናቋል።');}
  catch(e){memoStatus(e.message);}
  finally{await refreshMemos();memoBusy=false;$('memo-save').disabled=false;}
}
$('memo-search').oninput=displayMemos;
$('memo-cancel').onclick=resetMemoForm;
$('memo-form').onsubmit=e=>{
  e.preventDefault();
  const text=$('memo-text').value.trim();
  if(!text || !confirm('ይህን ማስታወሻ ማስቀመጥ ይፈልጋሉ?'))return;
  const memo=editingMemo;
  void mutateMemo(async()=>{
    if(!memo || memo.source){
      await action(memo?'memory.update':'memory.create',{id:memo?.id,revision:memo?.revision,text,confirmed:true});
    }else{
      const list=legacyMemos();
      localStorage.setItem(legacyMemosKey,JSON.stringify(list.map(row=>row?.id===memo.id?{...row,text}:row)));
    }
    if(editingMemo===memo && $('memo-text').value.trim()===text)resetMemoForm();
  });
};
refresh().catch(()=>{ $('agent-pause').title='ሁኔታውን መጫን አልተቻለም።'; });
initializeBrowserReader(async url => {
  await action('browser.propose',{url});
  await refresh();
  $('approval-list').scrollIntoView({block:'nearest'});
});
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
      box.append(link,line(source.excerpt),button('ገጹን ለማንበብ ምረጥ',()=>chooseBrowserArticle(source.url)));return box;
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
function selectedProjectFile(){
  return project?.files.find(file=>file.path===$('project-file').value);
}
function projectButtons(){
  const file=selectedProjectFile();
  const selected=Array.from($('project-file').selectedOptions,option=>project?.files.find(item=>item.path===option.value));
  $('project-chat').disabled=projectBusy||!selected.length||selected.length>4||selected.some(item=>!item?.editable)||selected.reduce((sum,item)=>sum+(item?.size??0),0)>16384;
  $('project-test').disabled=$('project-chat').disabled||!selected.some(item=>/\.test\.m?js$/i.test(item?.path))||selected.some(item=>!/\.m?js$/i.test(item?.path));
  $('project-picker').disabled=stopped||projectBusy;
  $('project-search').disabled=$('project-file').disabled=projectBusy;
  $('project-refresh').disabled=$('project-revoke').disabled=projectBusy||!project;
  $('preview-file').disabled=projectBusy||!file;
  $('open-project-file').disabled=projectBusy||!file?.editable;
  $('review-file').disabled=projectBusy||!file||file.size>16384;
}
function clearProjectPreview(){
  $('project-preview').textContent='';
  $('project-preview').hidden=true;
  projectButtons();
}
function filterProject(){
  const field=$('project-file');
  const selected=field.value;
  const query=$('project-search').value.normalize().toLocaleLowerCase();
  const matches=(project?.files??[]).filter(file=>file.path.normalize().toLocaleLowerCase().includes(query));
  field.replaceChildren(...matches.map(file=>new Option(file.path,file.path)));
  if(matches.some(file=>file.path===selected))field.value=selected;
  else field.selectedIndex=matches.length ? 0 : -1;
  clearProjectPreview();
}
function loadProject(result){
  if(result?.repository!==project?.repository)$('project-search').value='';
  project=result;
  $('project-browser').hidden=!project;
  $('project-root').textContent=project?.root??'';
  $('project-summary').textContent=project ? [project.files.length+' ፋይሎች',
    project.branch && 'Git · '+project.branch, project.truncated && 'የዝርዝሩ ከፊል ውጤት ነው።'].filter(Boolean).join(' · ') : '';
  filterProject();
}
async function projectOperation(operation){
  if(projectBusy)return;
  projectBusy=true;
  projectButtons();
  try{await operation();}catch(e){message(e.message);}
  finally{projectBusy=false;projectButtons();}
}
const reloadProject=async()=>loadProject(await action('code.repository',{repository:project.repository}));
const readProjectFile=(name,file)=>action(name,{repository:project.repository,path:file.path});
$('project-search').oninput=filterProject;
$('project-file').onchange=clearProjectPreview;
$('project-test').onclick=()=>projectOperation(async()=>{
  const paths=Array.from($('project-file').selectedOptions,option=>option.value);
  await action('code.test',{repository:project.repository,paths});await refresh();$('approval-list').scrollIntoView();
});
$('project-chat').onclick=async()=>{
  const paths=Array.from($('project-file').selectedOptions,option=>option.value);
  if(!project||!paths.length)return;
  const {selectCapability}=await import('./capabilities.js');
  selectCapability({scope:{name:'project',target:project.repository,paths}});
  $('work').close();$('message').focus();
};
$('project-picker').onclick=()=>projectOperation(async()=>{
  const result=await action('code.pickRepository');
  if(result.cancelled)return;
  clearCode();
  loadProject(result);
  await refresh();
});
$('project-refresh').onclick=()=>projectOperation(reloadProject);
$('project-revoke').onclick=()=>projectOperation(async()=>{
  await action('code.closeRepository',{repository:project.repository});
  loadProject(null);
  await refresh();
});
$('preview-file').onclick=()=>projectOperation(async()=>{
  const file=selectedProjectFile();
  if(!file)return;
  const data=await readProjectFile('code.preview',file);
  $('project-preview').textContent=data.text;
  $('project-preview').hidden=false;
});
$('open-project-file').onclick=()=>projectOperation(async()=>{
  const file=selectedProjectFile();
  if(!file?.editable)return;
  loadCode(await readProjectFile('code.open',file));
  await refresh();
  $('code-instruction').focus();
});
$('review-file').onclick=()=>projectOperation(async()=>{
  const file=selectedProjectFile();
  if(!file || file.size>16384)return;
  const input=$('attachment');
  if(input.files.length && !confirm('ያለው አባሪ በኮዱ ይተካ?'))return;
  const {text,size}=await readProjectFile('code.preview',file);
  if(size>16384){message('ሞዴሉ የሚቀበለው ፋይል እስከ 16 KiB ነው።');return;}
  const transfer=new DataTransfer();
  transfer.items.add(new File([text],file.path.split('/').at(-1),{type:'text/plain'}));
  input.files=transfer.files;
  const prompt=$('message');
  if(!prompt.value.trim())prompt.value='የተያያዘውን ኮድ አንብብ። ሊኖሩ የሚችሉ ችግሮችን፣ የማስተካከያ ሐሳብና የፈተና ዕቅድ አቅርብ።';
  prompt.dispatchEvent(new Event('input'));$('work').close();prompt.focus();
});
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
function clearCode(){
  codeFile=null;
  $('code-edit').hidden=true;
  $('code-target').textContent='';
  $('code-content').value='';
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
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({provider:currentProvider(),scope:{name:'source',target:file.grant},message:instruction,conversation:null})});
    if(!r.ok)throw Error();
    const result=await r.json();
    if(!result.approval||file!==codeFile)throw Error();
    message(result.reply);await refresh();$('approval-list').scrollIntoView();
  }catch{message('የተሟላ ለውጥ አልተገኘም። እንደገና ይሞክሩ ወይም በእጅ ያርሙ።')}
  finally{b.disabled=false}
};
$('desktop-enabled').onchange=async e=>{
  try{await action(e.target.checked?'desktop.enable':'desktop.disable');}catch(err){message(err.message)}await refresh();
};
$('desktop-list').onclick=async()=>{
  try{clearWindowControls();const result=await action('desktop.list');
    $('desktop-window').replaceChildren(...result.windows.map(w=>new Option(w.process+' · '+w.title,w.id)));
    $('desktop-scan').disabled=$('desktop-chat').disabled=$('desktop-propose').disabled=!result.windows.length;
  }catch(e){message(e.message)}
};
$('desktop-propose').onclick=async()=>{
  try{await action('desktop.propose',{window:$('desktop-window').value,operation:$('desktop-operation').value});await refresh();$('approval-list').scrollIntoView();}
  catch(e){message(e.message)}
};

function clearWindowControls(){
  $('desktop-controls').hidden=true;
  $('desktop-control').replaceChildren();
  $('desktop-text').value='';
}
$('desktop-window').onchange=clearWindowControls;
$('desktop-scan').onclick=async()=>{
  const window=$('desktop-window').value;
  clearWindowControls();
  try{
    const result=await action('desktop.controls',{window});
    if(window!==$('desktop-window').value)return;
    $('desktop-control').replaceChildren(...result.controls.map(control=>{
      const type=control.operation==='invoke'?'ጠቅ አድርግ':'ጽሑፍ አስገባ';
      const option=new Option(type+' · '+control.name,control.id);
      option.dataset.operation=control.operation;
      return option;
    }));
    $('desktop-controls').hidden=!result.controls.length;
    if(!result.controls.length)message('በዚህ መስኮት የሚሰራ ቁልፍ ወይም ሳጥን አልተገኘም።');
    updateControl();
  }catch(e){message(e.message);}
};
function updateControl(){
  const selection=$('desktop-control').selectedOptions[0];
  $('desktop-run-control').disabled=$('desktop-control-chat').disabled=!selection;
  $('desktop-typing').hidden=selection?.dataset.operation!=='setText';
  $('desktop-text').value='';
}
$('desktop-control').onchange=updateControl;
$('desktop-run-control').onclick=async()=>{
  try {
    const selection=$('desktop-control').selectedOptions[0];
    if(!selection)return;
    await action('desktop.propose',{window:$('desktop-window').value,control:selection.value,
      operation:selection.dataset.operation,text:$('desktop-text').value});
    await refresh();$('approval-list').scrollIntoView();
  }catch(e){message(e.message);}
};
