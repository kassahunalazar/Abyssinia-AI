export async function referenceSearch(query, language, signal, request = fetch) {
  if (!['am','en'].includes(language) || typeof query !== 'string' || !query.trim() || query.length > 240) throw Error('invalid');
  const endpoint = new URL('https://' + language + '.wikipedia.org/w/api.php');
  endpoint.search = new URLSearchParams({action:'query',format:'json',formatversion:'2',generator:'search',
    gsrsearch:query.trim(),gsrlimit:'4',prop:'extracts|info',inprop:'url',exintro:'1',explaintext:'1',exchars:'800'});
  const response = await request(endpoint, { signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),redirect:'error',
    headers:{'User-Agent':'AbyssiniaAI/1.0 (https://github.com/kassahunalazar/amharic-hermes)'} });
  if (!response.ok) throw Error('upstream');
  const data = await response.json();
  if (data.error) throw Error('upstream');
  return (data.query?.pages ?? []).slice(0,4).sort((a,b)=>a.index-b.index).map(p=>({
    title:String(p.title).slice(0,200), excerpt:String(p.extract ?? '').slice(0,900),
    url:endpoint.origin+'/wiki/'+encodeURIComponent(String(p.title).replaceAll(' ','_')),
  }));
}
