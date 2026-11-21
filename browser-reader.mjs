const maxResponse = 1024 * 1024;

function pageUrl(host, title) {
  const name = title.replaceAll(' ', '_');
  if (!name || name.length > 260 || /^[._]+$/u.test(name) || /[:/?#%|{}<>\[\]\\\p{C}]/u.test(name)) throw Error('invalid');
  return 'https://' + host + '/wiki/' + encodeURIComponent(name);
}

export function wikiArticle(value) {
  if (typeof value !== 'string' || value.length > 2048 || /\s|\\/u.test(value)) throw Error('invalid');
  const match = /^https:\/\/(am\.wikipedia\.org|en\.wikipedia\.org)\/wiki\/([^/?#]+)$/i.exec(value);
  if (!match) throw Error('invalid');
  try {
    return pageUrl(match[1].toLowerCase(), decodeURIComponent(match[2]));
  } catch {
    throw Error('invalid');
  }
}

async function responseJson(response) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body)
    throw Error('upstream');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxResponse) throw Error('upstream');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

export async function readWikiArticle(value, signal, request = fetch) {
  const url = wikiArticle(value);
  const article = new URL(url);
  const title = decodeURIComponent(article.pathname.slice('/wiki/'.length)).replaceAll('_', ' ');
  const endpoint = new URL('/w/api.php', article.origin);
  endpoint.search = new URLSearchParams({
    action:'query', format:'json', formatversion:'2', titles:title,
    prop:'info|extracts|links', explaintext:'1', exintro:'1', exchars:'1200', plnamespace:'0', pllimit:'12',
  });
  const response = await request(endpoint, {
    redirect:'error', credentials:'omit',
    signal:AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    headers:{'User-Agent':'AbyssiniaAI/1.0 (https://github.com/kassahunalazar/amharic-hermes)', Accept:'application/json'},
  });
  const data = await responseJson(response);
  const pages = data.query?.pages;
  const page = Array.isArray(pages) && pages.length === 1 ? pages[0] : null;
  if (!page || data.error || page.missing || page.redirect || page.ns !== 0 || typeof page.title !== 'string' ||
      pageUrl(article.hostname, page.title) !== url || typeof page.extract !== 'string') throw Error('upstream');
  const links = [];
  for (const link of Array.isArray(page.links) ? page.links.slice(0, 12) : []) {
    if (link?.ns !== 0 || typeof link.title !== 'string') continue;
    try { links.push({ title:link.title, url:pageUrl(article.hostname, link.title) }); } catch {}
  }
  return { url, title:page.title, text:page.extract.slice(0, 1600), links };
}
