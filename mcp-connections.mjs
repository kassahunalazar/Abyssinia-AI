const version = '2025-06-18';
const arithmeticFields = { a: 'number', b: 'number' };
const callable = {
  get_current_time: { timezone: 'timezone' },
  convert_time: { source_tz: 'timezone', target_tz: 'timezone', time: 'clock' },
  add: arithmeticFields,
  subtract: arithmeticFields,
  multiply: arithmeticFields,
  divide: arithmeticFields,
};

export function callableMcpTools(names) {
  return [...new Set(names)].filter(name => Object.hasOwn(callable, name)).map(name => ({ name, fields: callable[name] }));
}

export function mcpCapability(name) {
  const fieldSchema = {
    number: { type:'number', minimum:-1e12, maximum:1e12 },
    timezone: { type:'string', description:'An IANA timezone such as Africa/Addis_Ababa', maxLength:80 },
    clock: { type:'string', pattern:'^([01]\\d|2[0-3]):[0-5]\\d$', description:'24-hour local time as HH:mm' },
  };
  return {
    name:'request_mcp_call',
    description:`Propose a call to the MCP tool ${name} on the connection selected by the user. The app requires approval before sending the call.`,
    properties:Object.fromEntries(Object.entries(callable[name]).map(([key,type])=>[key,fieldSchema[type]])),
  };
}

export function validateMcpCall(name, args) {
  if (typeof name !== 'string' || !Object.hasOwn(callable, name) || !args || Object.getPrototypeOf(args) !== Object.prototype) throw Error('invalid');
  const fields = Object.entries(callable[name]);
  if (Object.keys(args).length !== fields.length) throw Error('invalid');
  for (const [key, type] of fields) {
    const value = args[key];
    if (!Object.hasOwn(args, key)) throw Error('invalid');
    if (type === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e12)) throw Error('invalid');
    if (type === 'clock' && (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) throw Error('invalid');
    if (type === 'timezone') {
      if (typeof value !== 'string' || !value || value.length > 80) throw Error('invalid');
      try { new Intl.DateTimeFormat('en', { timeZone: value }); } catch { throw Error('invalid'); }
    }
  }
  if (name === 'divide' && args.b === 0) throw Error('invalid');
  return Object.fromEntries(fields.map(([key]) => [key, args[key]]));
}

export function mcpEndpoint(input) {
  const url = new URL(input);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
      url.search || url.hash || !url.port || url.pathname === '/') throw Error('invalid');
  return url.href;
}

// A response can contain server-initiated messages. Only the matching response is processed.
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

export function discoverMcp(endpoint, signal) { return sessionRequest(endpoint,signal); }

export function invokeMcpTool(endpoint, name, args, signal) {
  return sessionRequest(endpoint, signal, { name, arguments: validateMcpCall(name, args) });
}

async function sessionRequest(endpoint, signal, call) {
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
    if(call){
      if(!tools.includes(call.name))throw Error('unavailable');
      const reply=await send({id:++id,method:'tools/call',params:call});
      if(!reply.ok)throw Error('connection');
      const result=await rpcResult(reply,id);
      if(result.isError || !Array.isArray(result.content))throw Error('protocol');
      const text=result.content.filter(p=>p.type==='text' && typeof p.text==='string').map(p=>p.text).join('\n');
      if(!text || text.length>4096)throw Error('protocol');
      if(call.name!=='get_current_time')return { mcpResult:{ tool:call.name, text } };
      const value=JSON.parse(text);
      if(typeof value.datetime!=='string' || !/^\d{4}-\d\d-\d\dT[0-9:.+Z-]{5,32}$/.test(value.datetime) || !Number.isFinite(Date.parse(value.datetime)))throw Error('protocol');
      return {datetime:value.datetime,timezone:call.arguments.timezone};
    }
    return {tools,capabilities:Object.keys(info.capabilities??{}).slice(0,24)};
  } finally {
    if(session)await fetch(url,{method:'DELETE',headers,redirect:'error',signal:AbortSignal.timeout(2000)}).then(r=>r.body?.cancel()).catch(()=>{});
  }
}
