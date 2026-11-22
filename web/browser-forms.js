import { selectCapability } from './capabilities.js';

const get = id => document.getElementById(id);
const label = {fill:'ጽሑፍ ሙላ',check:'ምልክት',select:'ምርጫ',click:'ቁልፍ ጫን',submit:'ቅጽ አስገባ'};
let page;
const selected = () => page?.controls.find(control=>control.id===get('edge-field').value);

function fieldChanged() {
  const control = selected();
  for (const [id,operation] of [['edge-text-label','fill'],['edge-check-label','check'],['edge-choice-label','select']])
    get(id).hidden = control?.operation!==operation;
  get('edge-endpoint').textContent = control?.destination ? control.method+' '+control.destination : '';
  if (control?.operation==='select') get('edge-choice').replaceChildren(...control.options.map(item=>{
    const option = new Option(item.label,String(item.index));
    option.disabled = item.disabled;
    return option;
  }));
  get('edge-text').value = '';
  get('edge-checked').checked = true;
  get('edge-request-action').disabled = get('edge-chat').disabled = !control;
}

export function showBrowserForm(state) {
  const oldPage = page?.id;
  page = state.page;
  get('edge-active').hidden = !state.active;
  if (oldPage!==page?.id) {
    get('edge-field').replaceChildren(...(page?.controls??[]).map(control=>new Option(label[control.operation]+' · '+control.label,control.id)));
    get('edge-page').textContent = page ? [page.title,page.url].filter(Boolean).join(' · ') : '';
    fieldChanged();
  }
  get('edge-status').textContent = state.last ?
    (state.last.applied ? 'እርምጃ ተከናውኗል · ' : 'ለውጡን ገጹ አልተቀበለም · ')+state.last.label :
    page && !page.controls.length ? 'የሚደገፍ የቅጽ መስክ አልተገኘም።' : '';
}

export function initializeBrowserForms(action, review) {
  const status = get('edge-status');
  const panel = get('edge-panel');
  async function perform(button, execute) {
    button.disabled = true;
    try { await execute(); } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  }
  async function propose(name, params) {
    await action(name,params);
    status.textContent = 'የቀረበውን እርምጃ በፈቃድ ጥያቄዎች ውስጥ ይገምግሙ።';
    await review();
  }
  const refresh = () => action('browserForm.status');
  panel.ontoggle = () => {
    if (panel.open) refresh().then(showBrowserForm).catch(error=>{status.textContent=error.message;});
  };
  get('edge-open-form').onsubmit = event => {
    event.preventDefault();
    void perform(get('edge-request-open'),()=>propose('browserForm.open',{url:get('edge-url').value.trim()}));
  };
  for (const [button,name] of [['edge-scan','browserForm.scan'],['edge-close','browserForm.close']]) {
    get(button).onclick = () => perform(get(button),async()=>{showBrowserForm(await action(name));await review(false);});
  }
  get('edge-field').onchange = fieldChanged;
  get('edge-request-action').onclick = () => {
    const control = selected();
    if (!control) return;
    const value = control.operation==='fill' ? get('edge-text').value : control.operation==='check' ? String(get('edge-checked').checked) :
      control.operation==='select' ? get('edge-choice').value : '';
    void perform(get('edge-request-action'),()=>propose('browserForm.action',{page:page.id,control:control.id,value}));
  };
  get('edge-chat').onclick = () => {
    const control = selected();
    if (!control) return;
    selectCapability({scope:{name:'browserForm',target:page.id,control:control.id}});
    get('work').close();
    get('message').focus();
  };
  document.addEventListener('controlchange',()=>{
    if (panel.open && page) refresh().then(state=>{
      if (!state.active && page) showBrowserForm(state);
    }).catch(()=>{});
  });
}
