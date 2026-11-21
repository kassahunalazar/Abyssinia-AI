import { selectCapability } from './capabilities.js';

const field = id => document.getElementById(id);
let snapshot;
let localSelection = 0;

function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

export function showBrowserPage(page) {
  snapshot = page;
  const result = field('browser-result');
  result.replaceChildren(element('strong', page.title), element('pre', page.text));
  if (page.url) {
    const original = element('a', 'ዋናውን ገጽ ክፈት');
    original.href = page.url;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    result.append(original);
  }
  if (page.links.length) {
    const list = document.createElement('ul');
    for (const link of page.links) {
      const item = document.createElement('li');
      const next = element('button', link.title);
      next.type = 'button';
      next.onclick = () => {
        field('browser-url').value = link.url;
        field('browser-propose').focus();
      };
      item.append(next);
      list.append(item);
    }
    result.append(list);
  }
  field('browser-panel').open = true;
  field('browser-attach').disabled = false;
  field('browser-status').textContent = 'የገጹ ጽሑፍ ዝግጁ ነው።';
  result.scrollIntoView({block:'nearest'});
}

export function chooseBrowserArticle(url) {
  field('browser-panel').open = true;
  field('browser-url').value = url;
  field('browser-propose').focus();
}

export function initializeBrowserReader(propose) {
  const url = field('browser-url');
  const status = field('browser-status');
  field('browser-form').onsubmit = async event => {
    event.preventDefault();
    const go = field('browser-propose');
    go.disabled = true;
    try {
      await propose(url.value.trim());
      status.textContent = 'የገጹን አድራሻ በፈቃድ ጥያቄዎች ውስጥ ያረጋግጡ።';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      go.disabled = false;
    }
  };
  field('browser-chat').onclick = () => {
    if (!url.reportValidity()) return;
    selectCapability({scope:{name:'browser',target:url.value.trim()}});
    field('work').close();
    const prompt = field('message');
    if (!prompt.value.trim()) prompt.value = 'የመረጥኩትን የዊኪፔዲያ ገጽ ለማንበብ ጠይቅ።';
    prompt.dispatchEvent(new Event('input'));
    prompt.focus();
  };
  field('browser-local').onchange = async event => {
    const token = ++localSelection;
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.html?$/i.test(file.name) || file.size > 1024*1024) {
      status.textContent = 'እስከ 1 MB የሚሆን HTML ፋይል ይምረጡ።';
      return;
    }
    try {
      // Template contents remain inert. Only extracted text leaves this fragment.
      const template = document.createElement('template');
      template.innerHTML = new TextDecoder('utf-8', {fatal:true}).decode(await file.arrayBuffer());
      if (token !== localSelection) return;
      const content = template.content;
      const title = content.querySelector('title')?.textContent.trim().slice(0,200) || file.name;
      for (const node of content.querySelectorAll('base,script,style,template,noscript,iframe,object,embed,svg,title,meta,link,[hidden]')) node.remove();
      for (const node of content.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,br,td,tr,article,section')) node.after(document.createTextNode('\n'));
      const text = content.textContent.replace(/[^\S\n]+/gu,' ').replace(/ *\n */gu,'\n').replace(/\n{3,}/gu,'\n\n').trim().slice(0,3500);
      if (!text) throw Error('empty');
      showBrowserPage({title,text,links:[]});
    } catch {
      if (token === localSelection) status.textContent = 'የHTML ፋይሉን ጽሑፍ ማንበብ አልተቻለም።';
    }
  };
  field('browser-attach').onclick = () => {
    if (!snapshot) return;
    const attachment = field('attachment');
    if (attachment.files.length && !confirm('ያለው አባሪ በገጹ ጽሑፍ ይተካ?')) return;
    const shown = [snapshot.title,snapshot.url,snapshot.text].filter(Boolean).join('\n\n');
    const selection = new DataTransfer();
    selection.items.add(new File([shown], 'page.txt', {type:'text/plain'}));
    attachment.files = selection.files;
    attachment.dispatchEvent(new Event('change'));
    selectCapability({});
    field('work').close();
    const prompt = field('message');
    if (!prompt.value.trim()) prompt.value = 'የተያያዘውን የገጽ ጽሑፍ አንብብና አጠቃልል።';
    prompt.dispatchEvent(new Event('input'));
    prompt.focus();
  };
}
