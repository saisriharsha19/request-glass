// Shared by calendar ingestion and rendering. Never insert provider HTML into the DOM.
export function findLinks(value) {
  const text=String(value || '').replace(/&amp;/gi,'&').replace(/&#(?:0*38|x0*26);/gi,'&');
  return [...new Set((text.match(/(?:https?:\/\/|www\.)[^\s<>"'\x00-\x1f]+/gi)||[]).map(raw=>{
    let clean=raw.replace(/[.,;!]+$/,'');
    while(/[)\]}]$/.test(clean) && (clean.match(/[)\]}]/g)||[]).length>(clean.match(/[(\[{]/g)||[]).length)clean=clean.slice(0,-1);
    try {const url=new URL(/^www\./i.test(clean)?'https://'+clean:clean);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&url.href.length<=2048?url.href:null;}catch{return null;}
  }).filter(value => value !== null))].slice(0,16);
}
export function linkify(element,value) {
  const text=String(value || '').replace(/&amp;/gi,'&');
  let offset=0;
  for(const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"'\x00-\x1f]+/gi)) {
    element.append(document.createTextNode(text.slice(offset,match.index)));
    const href=findLinks(match[0])[0];
    if(href){const link=document.createElement('a');link.href=href;link.textContent=match[0];link.target='_blank';link.rel='noopener noreferrer';element.append(link);}
    else element.append(document.createTextNode(match[0]));
    offset=match.index+match[0].length;
  }
  element.append(document.createTextNode(text.slice(offset)));return element;
}
