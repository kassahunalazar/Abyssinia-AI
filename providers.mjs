import { providerCatalog } from './web/provider-catalog.js';

export function resolveProvider(choice = { kind: 'startup' }, env = process.env) {
  if (choice?.kind === 'none') return null;
  const startup = choice?.kind === 'startup';
  if (!startup && choice?.kind !== 'custom' && !Object.hasOwn(providerCatalog, choice?.kind)) {
    throw Error('Unknown provider');
  }
  const preset = Object.hasOwn(providerCatalog, choice.kind) ? providerCatalog[choice.kind] : undefined;
  const endpoint = startup ? env.ASSISTANT_MODEL_URL : preset?.base ?? choice.url;
  const model = startup ? env.ASSISTANT_MODEL_ID : choice.model;
  if (startup && !endpoint && !model) return null;
  if (typeof model !== 'string' || !model.trim() || model.length > 256) throw Error('Invalid model');
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1'))) {
    throw Error('Invalid endpoint');
  }
  const base = url.href.replace(/\/+$/, '');
  // Bind the operator's credential to its exact configured base URL.
  const key = base === env.ASSISTANT_MODEL_URL?.replace(/\/+$/, '') ? env.ASSISTANT_MODEL_KEY : undefined;
  const presetKey = preset?.keys.map(name => env[name]).find(Boolean);
  return { base, model: model.trim(), key: presetKey || key,
    ...(preset && {mode:preset.mode}) };
}


export async function localRouterModels(signal) {
  const route = resolveProvider({kind:'omniroute', model:'catalog'});
  const response = await fetch(route.base + '/models', {
    headers: route.key ? {Authorization:'Bearer ' + route.key} : {},
    redirect:'error', signal:AbortSignal.any([signal, AbortSignal.timeout(60000)]),
  });
  if (!response.ok) throw Error('Model catalog unavailable');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 4194304) throw Error('Model catalog too large');
    chunks.push(chunk);
  }
  const {data} = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!Array.isArray(data)) throw Error('Invalid model catalog');
  return [...new Set(data.map(row => row?.id).filter(id =>
    typeof id === 'string' && id.length > 0 && id.length <= 256 && !/[\x00-\x1f\x7f]/u.test(id)))].sort();
}
