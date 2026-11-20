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

function makeMessage(role, text) {
  const card = document.createElement('article');
  const heading = document.createElement('strong');
  const content = document.createElement('p');
  card.className = role;
  heading.textContent = role === 'user' ? 'እርስዎ' : 'Abyssinia AI';
  content.textContent = text;
  card.append(heading, content);
  if (role === 'assistant') {
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
  status.textContent = waiting ? 'መልስ በማዘጋጀት ላይ…' : active.error;
  messages.replaceChildren(...active.entries.map(({ role, text }) => makeMessage(role, text)));
  if (waiting) messages.append(makeMessage('user', pending.text));
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
  if (provider.kind === 'none') { chat.error = 'በቅንብሮች ውስጥ አቅራቢ ይምረጡ። · Choose a provider in Settings.'; render(); return; }
  const file = attachmentInput.files[0];
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
      headers: { 'Content-Type': 'application/json', ...(file && { 'X-Text-Attachment': '1' }) },
      body: JSON.stringify({ message: text, conversation: chat.conversation ?? null, provider, attachment }),
    });
    if (response.status === 410) throw new Error('expired');
    if (response.status === 423) throw new Error('paused');
    if (!response.ok) throw new Error('Chat failed');
    const { reply, conversation, tool } = await response.json();
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('Empty reply');
    const activity = tool === 'read_attached_text' ? '\n📄 አንብቧል · Read ' + file.name : '';
    chat.entries.push({ role: 'user', text: text + activity }, { role: 'assistant', text: reply });
    if (active === chat && attachmentInput.files[0] === file) attachmentInput.value = '';
    chat.provider = provider;
    chat.conversation = conversation;
    saveChats();
  } catch (error) {
    chat.error = error.message === 'paused' ? 'ሥራው ቆሟል። ለመቀጠል አጋዡን ያስጀምሩ።' : error.message === 'expired'
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
