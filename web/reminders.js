const scheduleRequest = /\bremind me\b|\b(?:set|create|schedule) (?:me )?(?:a |an )?(?:daily |weekly )?(?:reminder|alarm)\b|አስታውሰኝ|አስታውሺኝ|አስታውሱኝ|አስታውስኝ|ማስታወሻ (?:ያዝ|አስቀምጥ)/iu;
export function wantsReminder(text) { return typeof text==='string' && scheduleRequest.test(text); }
export function listsReminders(text) {
  return /^(?:(?:show|list)(?: me)? (?:my )?(?:reminders|schedules?)|(?:የእኔን?\s+)?(?:ማስታወሻዎቼን?|ቀጠሮዎቼን?|መርሃ ግብሬን)\s+(?:አሳየኝ|አሳይ))[.!?።፧]?$/iu.test(String(text).trim());
}

const words = {አንድ:1,ሁለት:2,ሶስት:3,ሦስት:3,አራት:4,አምስት:5,አስር:10,አሥር:10,ሰላሳ:30};
export function relativeReminder(text,now) {
  const en=/^remind me in (\d+) (minutes?|hours?) to (.+?)[.!]?$/i.exec(text);
  const am=/^(?:ከ|በ)?(\d+|[ሀ-ፐ]+)\s*(ደቂቃ|ሰዓት)\s*(?:በኋላ|በኋላም)\s*[፣,]?\s*(.+?)\s+አስታው(?:ሰኝ|ስኝ|ሺኝ|ሱኝ)[።.!]?$/u.exec(text);
  const match=en??am;
  if(!match)return;
  const amount=Number(match[1])||words[match[1]];
  const minutes=amount*(/hour|ሰዓት/.test(match[2])?60:1);
  if(!Number.isSafeInteger(minutes)||minutes<=0||minutes>525600||match[3].length>160)return;
  return {title:match[3],next:now+minutes*60000,daily:false};
}

export function validateDraft(draft,now){
  if(!draft || typeof draft.title!=='string' || !draft.title.trim() || draft.title.length>160 ||
     typeof draft.daily!=='boolean' || typeof draft.when!=='string' ||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)$/.test(draft.when))return;
  const next=Date.parse(draft.when);
  if((draft.weekly!=null && typeof draft.weekly!=='boolean') || (draft.weekly && draft.daily))return;
  if(!Number.isSafeInteger(next)||next<=now||next-now>315576000000)return;
  return {title:draft.title.trim(),next,daily:draft.daily,weekly:!!draft.weekly};
}
