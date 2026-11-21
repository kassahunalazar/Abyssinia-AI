export const speechScript='ሰላም፣ ነገ ጠዋት ስብሰባ አለኝ። እባክህ የፕሮጀክቱን update በአምስት ደቂቃ አቅርብ።';
export const candidates=['gemini-3.8-flash-tts','gemini-3.8-flash-lite-tts'];
export const voices=['Kore','Puck'];
export function validVoice(model,voice){return candidates.includes(model)&&voices.includes(voice);}
export async function synthesize(text,model,voice,signal,key=process.env.ABYSSINIA_TTS_KEY,request=fetch){
  if(!key||!validVoice(model,voice)||typeof text!=='string'||!text.trim()||text.length>2000)throw Error('unavailable');
  const response=await request('https://generativelanguage.googleapis.com/v1beta/interactions',{
    method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(90000)]),
    headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({
      model,input:[{type:'user_input',content:[{type:'text',text}]}],response_format:{type:'audio'},
      generation_config:{speech_config:[{voice}]},store:false,
    })
  });
  if(!response.ok){await response.body?.cancel();throw Error('provider')}
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>12000000)throw Error('limit');chunks.push(chunk)}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const audio=data.steps?.filter(s=>s.type==='model_output').flatMap(s=>s.content??[]).filter(p=>p.type==='audio').at(-1);
  if(typeof audio?.data!=='string')throw Error('audio');
  const bytes=Buffer.from(audio.data,'base64');
  if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('audio');
  return bytes.toString('base64');
}
