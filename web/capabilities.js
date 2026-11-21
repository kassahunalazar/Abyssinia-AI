import { tools, skills } from './capability-catalog.js';
import { currentProvider, providerLabel } from './settings.js';
const field=id=>document.getElementById(id);
const dialog=field('capabilities');
let selection={};
export function selectedCapability(){return {...selection};}
export function selectCapability(next){
  selection=next;
  const chip=field('active-scope');
  chip.hidden=!next.scope&&!next.skill;
  chip.textContent=[tools[next.scope?.name]?.label,skills[next.skill]?.label ?? next.skill?.split('/').at(-1)].filter(Boolean).join(' · ')+' ×';
}
field('active-scope').onclick=()=>selectCapability({});
function button(label,click){
  const element=document.createElement('button');
  element.type='button';element.textContent=label;element.onclick=click;return element;
}
function line(text){
  const element=document.createElement('p');element.textContent=text;return element;
}
function choose(next){
  selectCapability(next);
  dialog.close();
  field('message').focus();
}
field('capabilities-open').onclick=async()=>{
  dialog.showModal();
  field('cap-provider').textContent=providerLabel(currentProvider());
  field('cap-skills').replaceChildren(...Object.entries(skills).map(([skill,item])=>
    button(item.label,()=>choose({...selection,skill}))));
  field('cap-tools').replaceChildren(
    button(tools.source.label,()=>openWorkspace(null,'code-pick')),
    button(tools.specialist.label,()=>choose({...selection,scope:{name:'specialist'}})),
    button(tools.research.label,()=>choose({...selection,scope:{name:'research'}})),
    button(tools.browser.label,()=>openWorkspace('browser-panel','browser-url')),
    button('ጽሑፍ አያይዝ',()=>{dialog.close();field('attachment').focus();field('attachment').click()}),
    button('ማስታወሻ ቀጠሮ',()=>{dialog.close();field('work-open').click();field('reminder-title').focus()}));
  try{
    const response=await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"status"}'});
    if(!response.ok)throw Error();
    const {connections,desktopEnabled,paused}=await response.json();
    field('cap-desktop-status').textContent=desktopEnabled&&!paused?'እርምጃ በፈቃድ ብቻ':'ቁጥጥር ጠፍቷል · የማያ ገጽ ንባብ አለ';
    field('cap-connections').replaceChildren(...connections.map(connection=>{
      const item=document.createElement('div');
      item.append(line(connection.name+' · '+(!connection.enabled?'ተሰናክሏል':connection.error?'ግንኙነት አልተሳካም':connection.checked?'ተገናኝቷል':'ገና አልተፈተሸም')));
      if(connection.enabled&&connection.tools?.includes('get_current_time')){
        item.append(button(tools.clock.label,()=>choose({...selection,scope:{name:'clock',target:connection.id}})));
      }
      return item;
    }));
    if(!connections.length)field('cap-connections').append(line('ግንኙነት የለም።'));
  }catch{field('cap-connections').textContent='ግንኙነቶችን መጫን አልተቻለም።';}
};
function openWorkspace(panel, focus){
  dialog.close();
  field('work-open').click();
  if(panel)field(panel).open=true;
  field(focus).focus();
}
field('cap-providers').onclick=()=>{dialog.close();field('settings-open').click();field('provider-kind').focus();};
field('cap-connectors').onclick=()=>openWorkspace('connections-panel','mcp-name');
field('cap-desktop').onclick=()=>openWorkspace('desktop-panel','desktop-enabled');
field('cap-observe').onclick=()=>openWorkspace(null,'screen-read');
field('capabilities-close').onclick=()=>dialog.close();
let catalog=[];
function describeSkill(){
  const row=catalog.find(item=>skillId(item)===field('native-skill').value);
  field('skill-description').textContent=row?.description??'';
  field('choose-skill').disabled=!row;
}
function skillId(item){return 'hermes/'+(item.category??'')+'/'+item.name;}
function filterSkills(){
  const term=field('skill-filter').value.trim().toLocaleLowerCase();
  const matches=catalog.filter(item=>[item.category,item.name,item.description].join(' ').toLocaleLowerCase().includes(term));
  field('native-skill').replaceChildren(...matches.map(item=>new Option([item.category,item.name].filter(Boolean).join(' / '),skillId(item))));
  field('skills-status').textContent=matches.length+' ክህሎቶች';
  describeSkill();
}
field('load-skills').onclick=async()=>{
  field('load-skills').disabled=true;
  field('skills-status').textContent='በመጫን ላይ…';
  try{
    const result=await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'skills.native'})});
    if(!result.ok)throw Error();
    catalog=(await result.json()).skills;
    field('native-library').hidden=false;
    filterSkills();
  }catch{field('skills-status').textContent='ክህሎቶቹን መጫን አልተቻለም። እንደገና ይሞክሩ።';}
  finally{field('load-skills').disabled=false;}
};
field('skill-filter').oninput=filterSkills;
field('native-skill').onchange=describeSkill;
field('choose-skill').onclick=()=>choose({...selection,skill:field('native-skill').value});
field('desktop-chat').onclick=()=>{
  const target=field('desktop-window').value;
  if(!target)return;
  selectCapability({...selection,scope:{name:'desktop',target}});
  field('work').close();
  field('message').focus();
};

field('desktop-control-chat').onclick=()=>{
  const control=field('desktop-control').value;
  const target=field('desktop-window').value;
  if(!control || !target)return;
  selectCapability({...selection,scope:{name:'desktopControl',target,control}});
  field('work').close();
  field('message').focus();
};
