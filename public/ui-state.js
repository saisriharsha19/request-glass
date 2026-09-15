const pages={items:'records',planner:'calendar',insights:'insights'};
const defaults=()=>({workspace:'items',view:'all',filter:'all',query:'',sort:'deadline',category:'all',favorites:false,limit:30,scroll:{},calendar:{month:'',selected:'',filter:'upcoming',source:'all',limit:50}});
export function cleanState(raw){
 const value=raw&&typeof raw==='object'?raw:{},out=defaults();
 for(const [key,allowed] of Object.entries({workspace:Object.keys(pages),view:['all','soon','archived'],filter:['all','return','cancel','warranty','price','reminder'],sort:['deadline','name','recent']}))if(allowed.includes(value[key]))out[key]=value[key];
 for(const key of ['query','category'])if(typeof value[key]==='string')out[key]=value[key].slice(0,300);
 out.favorites=value.favorites===true;out.limit=Number.isInteger(value.limit)?Math.max(30,Math.min(3000,value.limit)):30;
 for(const key of Object.keys(pages))out.scroll[key]=Math.max(0,Math.min(1000000,Number(value.scroll?.[key])||0));
 const c=value.calendar||{};
 if(/^\d{4}-(0[1-9]|1[0-2])$/.test(c.month||''))out.calendar.month=c.month;
 if(/^\d{4}-\d{2}-\d{2}$/.test(c.selected||'')&&!isNaN(Date.parse(c.selected))&&new Date(c.selected).toISOString().slice(0,10)===c.selected)out.calendar.selected=c.selected;
 if(['upcoming','all','overdue','completed'].includes(c.filter))out.calendar.filter=c.filter;
 if(typeof c.source==='string'&&c.source.length<=100)out.calendar.source=c.source;
 out.calendar.limit=Number.isInteger(c.limit)?Math.max(50,Math.min(3000,c.limit)):50;
 return out;
}
export function createViewState(){
 history.scrollRestoration="manual";
 let owner=null,state=defaults();
 const key=()=>`tuckday:view:v1:${owner}`;
 const write=()=>{try{sessionStorage.setItem(key(),JSON.stringify(state));}catch{}};
 const pageFromURL=()=>Object.keys(pages).find(key=>pages[key]===location.hash.slice(1));
 function record(push=false){const hash='#'+pages[state.workspace];history[push?'pushState':'replaceState']({tuckday:1,owner,view:state},'',location.pathname+location.search+hash);}
 return {
  bind(id,useURL=false){owner=id||'guest';try{state=cleanState(JSON.parse(sessionStorage.getItem(key())||'null'));}catch{state=defaults();}if(useURL&&pageFromURL())state.workspace=pageFromURL();record();return structuredClone(state);},
  save(value,push=false){state=cleanState(value);write();record(push);},
  restoreHistory(){if(history.state?.tuckday===1&&history.state.owner===owner)state=cleanState(history.state.view);else {state=defaults();state.workspace=pageFromURL()||'items';}write();return structuredClone(state);},
 };
}
