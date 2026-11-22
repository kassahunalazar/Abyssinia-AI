import {selectedCapability,selectCapability} from './capabilities.js';
import {listsReminders,relativeReminder} from './reminders.js';
import { currentProvider, providerLabel } from './settings.js';
import { proposeDocument, paused } from './controls.js';
const form = document.querySelector('#composer');
const attachmentInput = document.querySelector('#attachment');
const input = document.querySelector('#message');
const send = document.querySelector('#send');
const messages = document.querySelector('#messages');
const status = document.querySelector('#status');
const welcome = document.querySelector('#welcome');
const suggestions = document.querySelector('#suggestions');
const workspace = document.querySelector('#workspace');
const chatTitle = document.querySelector('#chat-title');
const chatList = document.querySelector('#chat-list');
const emptyHistory = document.querySelector('#empty-history');
const search = document.querySelector('#search');
const toggle = document.querySelector('#sidebar-toggle');
const narrow = matchMedia('(max-width: 580px)');
const chats = [];
try {
  const saved = JSON.parse(localStorage.getItem('abyssinia-chats') ?? '[]');
  if (Array.isArray(saved)) chats.push(...saved.filter(c=>typeof c?.title==='string' && typeof c.conversation==='string' &&
    Array.isArray(c.entries) && c.entries.every(e=>['assistant','user'].includes(e?.role) && typeof e.text==='string')).slice(0,32));
} catch {}
function saveChats() {
  try { localStorage.setItem('abyssinia-chats',JSON.stringify(chats.filter(c=>c.conversation).slice(0,32).map(c=>({
    title:c.title,conversation:c.conversation,provider:c.provider,entries:c.entries.slice(-40),draft:'',error:'',
  })))); } catch { status.textContent='ውይይቱን በአሳሹ ማስቀመጥ አልተቻለም።'; }
}
const newChat = () => ({ title: '', entries: [], draft: '', error: '' });
let active = newChat();
let pending = null;

function showSidebar(show) {
  document.body.classList.toggle('sidebar-hidden', !show);
  toggle.setAttribute('aria-expanded', String(show));
}

function updateSend() {
  send.disabled = paused() || Boolean(pending) || !input.value.trim();
}

function renderHistory() {
  const query = search.value.trim().toLocaleLowerCase();
  const matches = chats.filter(chat => chat.title.toLocaleLowerCase().includes(query));
  emptyHistory.textContent = query ? 'ተዛማጅ ውይይት የለም' : 'እስካሁን ውይይት የለም';
  emptyHistory.hidden = matches.length > 0;
  chatList.replaceChildren(...matches.map(chat => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = chat.title;
    button.title = chat.title;
    if (chat === active) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => select(chat));
    return button;
  }));
}

function makeMessage(role, text, reminder, sources, approval, delegated) {
  const card = document.createElement('article');
  const heading = document.createElement('strong');
  const content = document.createElement('p');
  card.className = role;
  heading.textContent = role === 'user' ? 'እርስዎ' : 'Abyssinia AI';
  content.textContent = text;
  card.append(heading, content);
  if (role === 'assistant') {
    if(reminder){
      const review=document.createElement('button');
      review.textContent='ማስታወሻውን ገምግም · Review reminder';
      review.onclick=()=>{
        document.getElementById('work-open').click();
        const date=new Date(reminder.next);
        document.getElementById('schedule-kind').value='reminder';
        document.getElementById('schedule-language').hidden=true;
        document.getElementById('reminder-title').value=reminder.title;
        document.getElementById('reminder-time').value=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,19);
        document.getElementById('reminder-repeat').value=reminder.weekly?'weekly':reminder.daily?'daily':'once';
        document.getElementById('reminder-form').dataset.draft=reminder.id;
        document.getElementById('reminder-title').focus();
      };
      card.append(review);
    }
    if(delegated){const note=document.createElement('small');note.textContent='የHermes ባለሙያ ረዳት · '+delegated;card.append(note);}
    if(sources?.length){
      const list=document.createElement('ul');
      for(const source of sources){
        const url=URL.parse(source.url);
        if(url?.protocol!=='https:')continue;
        const item=document.createElement('li');
        const link=document.createElement('a');link.href=url.href;link.textContent=source.title;link.target='_blank';link.rel='noreferrer';
        const description=document.createElement('p');description.textContent=source.excerpt;
        item.append(link,description);list.append(item);
      }
      card.append(list);
    }
    if(approval){
      const review=document.createElement('button');review.textContent='ፈቃድ ገምግም';
      review.onclick=()=>{document.getElementById('work-open').click();document.getElementById('approval-list').scrollIntoView();};
      card.append(review);
    }
    const save = document.createElement('button');
    save.textContent = 'በፋይል አስቀምጥ';
    save.onclick = () => proposeDocument(text);
    card.append(save);

  }
  return card;
}

function render() {
  document.querySelector('.engine').textContent = providerLabel(active.provider ?? currentProvider());
  const waiting = pending?.chat === active;
  const inChat = active.entries.length > 0 || waiting;
  welcome.hidden = inChat;
  messages.hidden = !inChat;
  suggestions.hidden = inChat;
  workspace.classList.toggle('in-chat', inChat);
  chatTitle.textContent = inChat ? active.title : '';
  status.textContent = waiting ? pending.activity ?? 'መልስ በማዘጋጀት ላይ…' : active.error;
  messages.replaceChildren(...active.entries.map(({ role, text, reminder, sources, approval, delegated }) => makeMessage(role, text, reminder, sources, approval, delegated)));
  if (waiting) messages.append(makeMessage('user', pending.text));
  if(waiting && pending.partial) {
    const draft=document.createElement('article');draft.className='assistant';
    const p=document.createElement('p');p.textContent=pending.partial;draft.append(p);messages.append(draft);
  }
  renderHistory();
  document.querySelector('#forget-chat').hidden=!chats.includes(active)||pending?.chat===active;
  updateSend();
}

function select(chat) {
  attachmentInput.value = '';
  active.draft = input.value;
  active = chat;
  input.value = chat.draft;
  if (narrow.matches) showSidebar(false);
  render();
  input.focus();
}

showSidebar(!narrow.matches);
narrow.addEventListener('change', event => showSidebar(!event.matches));
toggle.addEventListener('click', () => showSidebar(toggle.getAttribute('aria-expanded') !== 'true'));
document.querySelector('#new-chat').addEventListener('click', () => {
  search.value = '';
  select(newChat());
});
search.addEventListener('input', renderHistory);
document.querySelector('#forget-chat').onclick=()=>{
  if(!chats.includes(active)||pending?.chat===active||!confirm('ይህ ውይይት ከአሳሹ ይሰረዝ?'))return;
  chats.splice(chats.indexOf(active),1);select(newChat());saveChats();
};
input.addEventListener('input', updateSend);
suggestions.addEventListener('click', event => {
  const card = event.target.closest('button[data-prompt]');
  if (!card) return;
  input.value = card.dataset.prompt;
  updateSend();
  input.focus();
});
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && !send.disabled) {
    event.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const chat = active;
  const text = input.value.trim();
  if (!text || pending || paused()) return;
  const provider = chat.provider ?? currentProvider();
  if (provider.kind === 'none' && !listsReminders(text) && !relativeReminder(text,Date.now())) { chat.error = 'በቅንብሮች ውስጥ አቅራቢ ይምረጡ። · Choose a provider in Settings.'; render(); return; }
  const file = attachmentInput.files[0];
  const capability=selectedCapability();
  if (file && capability.scope) { chat.error='አባሪውን ወይም የተመረጠውን መሣሪያ ያስወግዱ።';render();return; }
  if (file?.size > 16384) { chat.error = 'ፋይሉ ከ16 KB በላይ ነው።'; render(); return; }
  if (!chat.title) {
    chat.title = text.split(/\r?\n/, 1)[0].slice(0, 70);
    chats.unshift(chat);
  }
  pending = { chat, text };
  chat.error = '';
  chat.draft = '';
  input.value = '';
  render();

  try {
    const attachment = file ? { name: file.name, text: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) } : undefined;
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept:'application/x-ndjson', ...(file && { 'X-Text-Attachment': '1' }) },
      body: JSON.stringify({ message: text, conversation: chat.conversation ?? null, provider, attachment,...capability }),
    });
    if (response.status === 410) throw new Error('expired');
    if (response.status === 423) throw new Error('paused');
    if (!response.ok) throw new Error('Chat failed');
    let result;
    if(response.headers.get('content-type')?.includes('application/x-ndjson')){
      const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer='';
      while(true){
        const {value,done}=await reader.read();if(done)break;buffer+=value;
        let changed=false;
        for(let end;(end=buffer.indexOf('\n'))!==-1;){
          const event=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
          if(typeof event.delta==='string'){pending.partial=(pending.partial??'')+event.delta;changed=true;}
          else if(event.activity){
            pending.activity=(event.activity.phase==='started'?'መሣሪያ በመጠቀም ላይ · ':'መሣሪያ · ')+event.activity.name;
            changed=true;
          }else if(event.status)result=event;
        }
        if(changed && active===chat)render();
      }
      if(result?.status===423)throw Error('paused');
      if(result?.error==='attachment_unread')throw Error('attachment_unread');
      if(result?.status!==200)throw Error('Incomplete stream');
    }else result=await response.json();
    const { reply, conversation, tool } = result;
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('Empty reply');
    const activity = tool === 'read_attached_text' ? '\n📄 አንብቧል · Read ' + file.name : '';
    chat.entries.push({ role: 'user', text: text + activity }, { role: 'assistant', text: reply, reminder:result.reminder, sources:result.sources, approval:result.approval, delegated:result.delegated });
    if (active === chat && attachmentInput.files[0] === file) attachmentInput.value = '';
    chat.provider = provider;
    chat.conversation = conversation;
    selectCapability({});
    saveChats();
  } catch (error) {
    chat.error = error.message === 'attachment_unread' ? 'ሞዴሉ አባሪውን አላነበበም። መሣሪያ መጠቀም የሚችል ሞዴል ይምረጡ።' : error.message === 'paused' ? 'ሥራው ቆሟል። ለመቀጠል አጋዡን ያስጀምሩ።' : error.message === 'expired'
      ? 'ይህን ውይይት መቀጠል አይቻልም። እባክዎ አዲስ ውይይት ይጀምሩ።'
      : 'መልስ ማግኘት አልተቻለም። እባክዎ እንደገና ይሞክሩ።';
    if (active === chat && !input.value) input.value = text;
    else if (active !== chat && !chat.draft) chat.draft = text;
  } finally {
    pending = null;
    render();
    if (active === chat) {
      messages.lastElementChild?.scrollIntoView({ block: 'nearest' });
    }
  }
});

document.addEventListener('providerchange', render);

document.addEventListener('controlchange', updateSend);
render();
