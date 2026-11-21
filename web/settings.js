const $ = id => document.getElementById(id);
const defaults = { omniroute: 'kc/openrouter/free', ollama: '', custom: '' };
let selected = { kind: 'startup' };
try { selected = JSON.parse(localStorage.getItem('abyssinia-provider')) ?? selected; } catch {}
export const currentProvider = () => ({ ...selected });
export const providerLabel = p => ({ omniroute: 'OmniRoute', ollama: 'Ollama', custom: 'Custom', startup: 'Server default', none: 'No provider' }[p.kind] + (p.model ? ' · ' + p.model : ''));

const kind = $('provider-kind');
const model = $('provider-model');
const url = $('provider-url');
const result = $('provider-result');
function fields() {
  const needsModel = Object.hasOwn(defaults, kind.value);
  $('url-field').hidden = kind.value !== 'custom';
  $('model-field').hidden = !needsModel;
  model.required = needsModel;
  url.required = kind.value === 'custom';
  url.disabled = !url.required;
  model.disabled = !needsModel;
  model.value = selected.kind === kind.value ? selected.model ?? '' : defaults[kind.value] ?? '';
  url.value = selected.kind === kind.value ? selected.url ?? '' : '';
  $('provider-test').disabled = kind.value === 'none';
  $('provider-test-tools').disabled = kind.value === 'none';
  result.textContent = '';
}
function draft() {
  return { kind: kind.value, ...(!model.disabled && { model: model.value.trim() }),
    ...(!url.disabled && { url: url.value.trim() }) };
}
kind.onchange = fields;
$('settings-open').onclick = () => { kind.value = selected.kind; fields(); $('settings').showModal(); };
$('settings-close').onclick = () => $('settings').close();
$('provider-form').onsubmit = event => {
  event.preventDefault();
  const choice = draft();
  if (choice.kind === 'custom') {
    const endpoint = new URL(choice.url);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        !(endpoint.protocol === 'https:' || endpoint.origin.startsWith('http://127.0.0.1:') || endpoint.origin === 'http://127.0.0.1')) {
      result.textContent = 'Use HTTPS or HTTP on 127.0.0.1, without credentials or query parameters.'; return;
    }
  }
  selected = choice;
  try { localStorage.setItem('abyssinia-provider', JSON.stringify(selected)); } catch {}
  document.dispatchEvent(new Event('providerchange'));
  $('settings').close();
};
async function testProvider(mode) {
  if (!$('provider-form').reportValidity()) return;
  const choice = draft();
  const buttons=[$('provider-test'),$('provider-test-tools')];
  buttons.forEach(button=>{button.disabled=true;});
  result.textContent = 'በመፈተሽ ላይ…';
  try {
    const response = await fetch('/api/provider/test', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: choice, mode }) });
    const data = await response.json();
    if(data.error==='tool_not_used'){result.textContent='ሞዴሉ መሣሪያውን አልጠራም።';return;}
    if (!response.ok) throw Error();
    result.textContent = (mode==='tools'?'መሣሪያው ተጠርቷል · ':'ተገናኝቷል · ') + data.model;
  } catch { result.textContent = 'ሙከራው አልተሳካም · Check the endpoint, model and server credentials.'; }
  finally { buttons.forEach(button=>{button.disabled=kind.value==='none';}); }
}
$('provider-test').onclick = () => testProvider('chat');
$('provider-test-tools').onclick = () => testProvider('tools');
