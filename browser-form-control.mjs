import { randomUUID } from 'node:crypto';
import { edgeUrl, openEdgeForm } from './edge-browser.mjs';

export function browserFormControl({ open = openEdgeForm, normalize = edgeUrl } = {}) {
  let browser;
  let page;
  let last;
  const status = () => ({active:!!browser, page, last});

  async function close() {
    const opened = browser;
    browser = page = last = undefined;
    if (opened) await opened.close();
  }

  async function scan(signal) {
    if (!browser) throw Error('unavailable');
    page = undefined;
    const snapshot = await browser.snapshot(signal);
    page = {...snapshot,id:randomUUID()};
    return status();
  }

  function select(id, control) {
    const field = page?.controls.find(item=>item.id===control);
    if (!browser || !page || id!==page.id || !field) throw Error('stale');
    return field;
  }

  return {
    status, close, scan, select,
    proposeOpen(url) {
      const target = normalize(url);
      return {tool:'browserForm.open',target,logTarget:new URL(target).origin,
        text:'ይህን ገጽ በተለየ የEdge መስኮት ክፈት።',risk:'isolated browser navigation'};
    },
    async proposeAction({id,control,value},signal) {
      const field = select(id,control);
      if (typeof value!=='string') throw Error('invalid');
      let payload;
      let preview;
      switch (field.operation) {
      case 'fill':
        if (value.length>1000 || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)) throw Error('invalid');
        payload=value;
        preview=value;
        break;
      case 'check':
        if (!['true','false'].includes(value)) throw Error('invalid');
        payload=value==='true';
        preview=payload?'ምልክት አድርግ':'ምልክቱን አንሳ';
        break;
      case 'select': {
        const option = field.options.find(item=>!item.disabled && String(item.index)===value);
        if (!option) throw Error('invalid');
        payload=option.index;
        preview=option.label;
        break;
      }
      case 'submit':
        if (value!=='') throw Error('invalid');
        payload=await browser.preview(field,signal);
        preview=[field.method+' '+field.destination,...payload.map(([name,value])=>JSON.stringify(name)+' = '+JSON.stringify(value))].join('\n');
        break;
      default: throw Error('invalid');
      }
      return {tool:'browserForm.action',target:page.url,logTarget:new URL(page.url).origin,
        text:[field.operation+' · '+field.label,preview].join('\n'),risk:field.operation==='submit'?'submit browser form':'isolated browser control',
        formPage:id,formControl:control,payload};
    },
    async run(item,signal) {
      if (item.tool==='browserForm.open') {
        await close();
        const opened = await open(item.target,signal);
        try { signal.throwIfAborted(); } catch(error) { await opened.close(); throw error; }
        browser = opened;
        try { await scan(signal); } catch(error) { await close(); throw error; }
      } else {
        const field = select(item.formPage,item.formControl);
        last = await browser.apply(field,item.payload,item.target,signal);
        signal.throwIfAborted();
        if (field.operation==='submit') await scan(signal);
      }
      return status();
    },
  };
}
