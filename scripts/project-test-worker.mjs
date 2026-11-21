import createVM from '../vendor/quickjs/runtime.cjs';

// Only these in-memory modules and the explicitly selected files exist in the guest.
const assertions = `
  export function ok(value,message){if(!value)throw Error(message??'Expected a truthy value');}
  export function strictEqual(actual,expected,message){if(!Object.is(actual,expected))throw Error(message??'Values differ');}
  export {strictEqual as equal};
  export default Object.assign(ok,{ok,strictEqual,equal:strictEqual});
`;
const tests = `
  const results=[];
  export function test(name,fn){
    if(typeof name!=='string'||typeof fn!=='function'||arguments.length!==2||results.length>=100)
      throw Error('Expected a named synchronous test');
    try{
      const value=fn();
      if(value && typeof value.then==='function')throw Error('Async tests are unsupported');
      results.push({name:name.slice(0,160),passed:true});
    }catch(error){results.push({name:name.slice(0,160),passed:false,error:String(error).slice(0,240)});}
  }
  export default test;
  export function report(){return JSON.stringify(results);}
`;
async function main(){
  let input='';
  for await(const chunk of process.stdin){input+=chunk;if(input.length>100000)throw Error('Input too large');}
  const files=JSON.parse(input);
  const modules=new Map(files.map(({path,text})=>[path,text]));
  modules.set('node:test',tests);
  modules.set('node:assert/strict',assertions);
  const engine=await createVM();
  const runtime=engine.newRuntime();
  runtime.setMemoryLimit(16*1024*1024);
  runtime.setMaxStackSize(256*1024);
  const deadline=Date.now()+2000;
  runtime.setInterruptHandler(()=>Date.now()>=deadline);
  runtime.setModuleLoader(name=>{
    if(!modules.has(name))throw Error('Module unavailable in this selection');
    return modules.get(name);
  });
  const context=runtime.newContext();
  try{
    const entries=files.filter(file=>/\.test\.m?js$/i.test(file.path));
    const imports=entries.map(file=>'import '+JSON.stringify('./'+file.path)+';').join('\n');
    const result=context.unwrapResult(context.evalCode(imports+"\nexport {report} from 'node:test';",'abyssinia:runner',{type:'module'}));
    try{
      const report=context.getProp(result,'report');
      try{
        const json=context.unwrapResult(context.callFunction(report,context.undefined));
        try{
          const rows=JSON.parse(context.getString(json));
          return {passed:rows.length>0&&rows.every(row=>row.passed),rows};
        }finally{json.dispose();}
      }finally{report.dispose();}
    }finally{result.dispose();}
  }finally{context.dispose();runtime.dispose();}
}
try{process.stdout.write(JSON.stringify(await main()));}
catch(error){process.stdout.write(JSON.stringify({passed:false,rows:[],error:String(error.message??error).slice(0,240)}));}
