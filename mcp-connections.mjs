const version = '2025-06-18';

export function mcpEndpoint(input) {
  const url = new URL(input);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
      url.search || url.hash || !url.port || url.pathname === '/') throw Error('invalid');
  return url.href;
}

// Discover metadata only. Server-initiated requests and tool calls are never dispatched.
async function rpcResult(response, id) {
  const mime=response.headers.get('content-type')?.split(';')[0].trim();
  if(!response.body || !['application/json','text/event-stream'].includes(mime))throw Error('transport');
  const reader=response.body.getReader(), decoder=new TextDecoder();
  let buffer='',bytes=0;
  function check(raw) {
    const msg=JSON.parse(raw);
    if(msg.jsonrpc!=='2.0'||msg.id!==id||!msg.result||msg.error)throw Error('protocol');
    return msg.result;
  }
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done){buffer+=decoder.decode();break}
      bytes+=value.length;if(bytes>262144)throw Error('limit');
      buffer+=decoder.decode(value,{stream:true});
      if(mime==='text/event-stream'){
        let separator;
        while((separator=/\r?\n\r?\n/.exec(buffer))){
          const frame=buffer.slice(0,separator.index);
          buffer=buffer.slice(separator.index+separator[0].length);
          const raw=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
          if(raw && JSON.parse(raw).id===id)return check(raw);
        }
      }
    }
    if(mime==='application/json')return check(buffer);
    throw Error('protocol');
  } finally {await reader.cancel().catch(()=>{});}
}

export async function discoverMcp(endpoint, signal) {
  const url=mcpEndpoint(endpoint);
  const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(12000)]);
  const send=(msg)=>fetch(url,{method:'POST',headers,redirect:'error',signal:deadline,body:JSON.stringify({jsonrpc:'2.0',...msg})});
  let id=1;
  const init=await send({id,method:'initialize',params:{protocolVersion:version,capabilities:{},clientInfo:{name:'abyssinia-ai',version:'1'}}});
  if(!init.ok)throw Error('connection');
  const info=await rpcResult(init,id);
  if(info.protocolVersion!==version)throw Error('version');
  const session=init.headers.get('Mcp-Session-Id');
  if(session)headers['Mcp-Session-Id']=session;
  headers['MCP-Protocol-Version']=version;
  try{
    const ready=await send({method:'notifications/initialized'});
    if(!ready.ok)throw Error('connection');
    await ready.body?.cancel();
    const tools=[];let cursor;
    if(info.capabilities?.tools){
      do{
        if(id>=9)throw Error('limit');
        const response=await send({id:++id,method:'tools/list',params:cursor?{cursor}:{}});
        if(!response.ok)throw Error('connection');
        const list=await rpcResult(response,id);
        if(!Array.isArray(list.tools)||tools.length+list.tools.length>256)throw Error('limit');
        for(const item of list.tools){
          if(typeof item.name!=='string'||item.name.length>128)throw Error('protocol');
          tools.push(item.name);
        }
        cursor=list.nextCursor;
      }while(cursor);
    }
    return {tools,capabilities:Object.keys(info.capabilities??{}).slice(0,24)};
  } finally {
    if(session)await fetch(url,{method:'DELETE',headers,redirect:'error',signal:AbortSignal.timeout(2000)}).then(r=>r.body?.cancel()).catch(()=>{});
  }
}
