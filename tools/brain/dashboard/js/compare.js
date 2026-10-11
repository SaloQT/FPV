import { TopDown } from './topdown.js';
const $ = id => document.getElementById(id);
let state, geometry, lastResponse;
const frame = {chain:[],layers:{path:true,obstacles:true,colliders:false}};
const view = new TopDown($('compareMap'), $('compareTip'), {worlds:[],selectWorld:()=>{},selectedWorld:()=>geometry, requestMap:()=>view.draw(frame)});
new ResizeObserver(()=>{if(geometry)view.draw(frame);}).observe($('compareMap'));
const num = id => Number($(id).value);
const options = preview => ({preview,style:$('compareStyle').value,seed:num('compareSeed'),gateCount:num('compareGates'),difficulty:num('compareDifficulty')/100,laps:num('compareLaps'),runs:num('compareRuns'),seconds:num('compareSeconds'),wind:num('compareWind'),brains:[...$('compareBrains').querySelectorAll('input:checked')].map(e=>e.value)});
async function json(path, opts) { const r=await fetch(path,opts); const b=await r.json();if(!r.ok)throw Error(b.error||r.status);return b; }
async function refresh() {
  try {
    const picked = new Set([...$('compareBrains').querySelectorAll('input:checked')].map(e=>e.value));
    const files=await json('/api/compare/brains');
    $('compareBrains').replaceChildren(...files.map(f=>{const l=document.createElement('label'),i=document.createElement('input');i.type='checkbox';i.value=f;i.checked=picked.size?picked.has(f):true;l.append(i,document.createTextNode(f.replace(/\.json$/,'')));return l;}));
  } catch(e){$('compareStatus').textContent=e.message;}
}
function render(s) {
  state=s; $('compareStatus').textContent=s.error||s.message||s.status;
  const busy=s.status==='running';$('compareGenerate').disabled=busy;$('compareStart').disabled=busy;
  if(s.geometry && JSON.stringify(s.geometry)!==JSON.stringify(geometry)) {geometry=s.geometry;view.images.clear();view.cams.clear();view.draw(frame);}
  $('compareResults').replaceChildren(...(s.results||[]).map(r=>{
    const tr=document.createElement('tr');
    for(const v of [r.name,`${r.completed}/${r.attempts}`,r.meanLap==null?'—':`${r.meanLap.toFixed(3)} s`,r.bestLap==null?'—':`${r.bestLap.toFixed(3)} s`,r.crashes,r.stalls,r.notes.join(' ')]){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}return tr;
  }));
  $('compareReport').value=JSON.stringify(s,null,2);
  $('compareCopy').disabled=!s.settings; $('compareExport').disabled=!s.track;
}
async function start(preview) {
  try {render(await json('/api/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(options(preview))}));}
  catch(e){$('compareStatus').textContent=e.message;}
}
$('compareGenerate').onclick=()=>start(true);$('compareStart').onclick=()=>start(false);$('compareRefresh').onclick=refresh;
$('compareCopy').onclick=async()=>{try{await navigator.clipboard.writeText($('compareReport').value);$('compareStatus').textContent='Run report copied';}catch{$('compareReport').focus();$('compareReport').select();$('compareStatus').textContent='Select report and press Ctrl+C';}};
$('compareExport').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(state.track)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=`compare-track-${state.settings.seed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
setInterval(async()=>{if($('comparePanel').hidden)return;try{const s=await json('/api/compare');const response=JSON.stringify(s);if(s.status!=='idle' && response!==lastResponse){lastResponse=response;render(s);}}catch(e){$('compareStatus').textContent=e.message;}},1500);
// The run page shows this panel as a tab: refresh the brain list each time it opens.
$('comparePanel').addEventListener('panel-shown',()=>{void refresh();if(geometry)view.draw(frame);});


