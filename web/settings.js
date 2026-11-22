import { providerCatalog } from './provider-catalog.js';
const $ = id => document.getElementById(id);
const defaults = { omniroute: 'kc/openrouter/free', ollama: '', custom: '' };
let selected = { kind: 'startup' };
try { selected = JSON.parse(localStorage.getItem('abyssinia-provider')) ?? selected; } catch {}
export const currentProvider = () => ({ ...selected });
export const providerLabel = p => ((providerCatalog[p.kind]?.label ?? { custom: 'Custom', startup: 'Server default', none: 'No provider' }[p.kind] ?? 'Provider') + (p.model ? ' · ' + p.model : ''));

for (const [id, provider] of Object.entries(providerCatalog)) {
  $('known-providers').append(new Option(provider.label, id));
}
const kind = $('provider-kind');
const model = $('provider-model');
const url = $('provider-url');
const result = $('provider-result');
function fields() {
  $('router-models').hidden = kind.value !== 'omniroute';
  if (kind.value === 'omniroute') model.setAttribute('list','router-model-list');
  else model.removeAttribute('list');
  const preset = providerCatalog[kind.value];
  const needsModel = Boolean(preset) || kind.value === 'custom';
  const help = $('provider-help');
  help.hidden = !preset;
  help.textContent = preset ? [preset.base, preset.keys.length ? 'Server .env · ' + preset.keys.join(' / ') : 'Local endpoint'].join(' · ') : '';
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

$('router-models').onclick = async () => {
  const button = $('router-models');
  button.disabled = true;
  try {
    const response = await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'provider.routerModels'})});
    if (!response.ok) throw Error();
    const {models} = await response.json();
    $('router-model-list').replaceChildren(...models.map(id=>new Option(id,id)));
    if (kind.value === 'omniroute') {
      result.textContent = models.length + ' ሞዴሎች · Enter or select a model ID.';
      model.focus();
    }
  } catch {
    if (kind.value === 'omniroute') result.textContent = 'OmniRoute catalog unavailable. Enter a model ID manually.';
  } finally { button.disabled = false; }
};
