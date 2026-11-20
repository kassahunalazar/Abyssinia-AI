const presets = {
  omniroute: 'http://127.0.0.1:20128/v1',
  ollama: 'http://127.0.0.1:11434/v1',
};

export function resolveProvider(choice = { kind: 'startup' }, env = process.env) {
  if (choice?.kind === 'none') return null;
  const startup = choice?.kind === 'startup';
  if (!startup && choice?.kind !== 'custom' && !Object.hasOwn(presets, choice?.kind)) {
    throw Error('Unknown provider');
  }
  const endpoint = startup ? env.ASSISTANT_MODEL_URL : presets[choice.kind] ?? choice.url;
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
  return { base, model: model.trim(), key };
}
