(() => {
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const S = {region:'All', day:0, sel:null, basis:'blend', w:{age:30, urb:20, size:20, land:30}, cities:[], meta:null, brief:null};
const BOUNDS = {All:[[-25,5],[95,71]], 'South Asia':[[59,5],[93,38]], Europe:[[-25,34],[45,71]]};
const BKEY = {All:'all', 'South Asia':'south_asia', Europe:'europe'};
const RAMP = [0,'#fff3b0',15,'#fdc24b',30,'#f78b2d',45,'#e5441f',60,'#a4161a',80,'#5b0a14'];
const SYS = 'You are a climate-adaptation analyst for policymakers. Answer only from the supplied data; if it cannot answer, say so. Never invent numbers or events. Use British English and keep to 120 words.';
const clamp = (x,a=0,b=1) => Math.max(a, Math.min(b, x));
const cat = t => t>=54?'Extreme danger':t>=41?'Danger':t>=32?'Extreme caution':t>=27?'Caution':'Lower concern';
const tcol = t => t>=41?'#a4161a':t>=32?'#e5441f':t>=27?'#f78b2d':'#9db2c6';
const rcol = r => r>=60?'#a4161a':r>=45?'#e5441f':r>=30?'#f78b2d':r>=15?'#fdc24b':'#fff3b0';
const n0 = v => v==null?'n/a':Math.round(v).toLocaleString('en-GB');
const wd = (d,o) => new Date(d).toLocaleDateString('en-GB',{timeZone:'UTC',...o});
const sg = v => (v>0?'+':'') + v.toFixed(1);
const inReg = c => S.region==='All' || c.reg===S.region;
const live_ = () => S.cities.filter(c => inReg(c) && c.risk!=null);
const cur = () => S.cities.find(x => x.id===S.sel);

const map = new maplibregl.Map({container:'map', style:'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json', bounds:BOUNDS.All, fitBoundsOptions:{padding:20}});
map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'top-left');
const ready = new Promise(r => map.on('load', r));

function pct(key,out){
  const v = S.cities.map(c => c[key]).filter(x => x!=null).sort((a,b) => a-b);
  S.cities.forEach(c => { c[out] = c[key]==null ? null : v.filter(x => x<c[key]).length / v.length; });
}
function calc(){
  S.cities.forEach(c => {
    const T = c.at[S.day];
    if (T==null) { c.risk = null; return; }
    const dep = c.an ? c.an[S.day] : null;
    const Ha = clamp((T-24)/22), Hr = dep==null ? null : clamp(dep/10)*clamp((T-20)/10);
    c.T = T; c.dep = dep;
    c.H = S.basis==='abs' || Hr==null ? Ha : S.basis==='rel' ? Hr : (Ha+Hr)/2;
    const w = S.w, p = [[c.A,w.age],[c.U,w.urb],[c.C,w.size],[c.L,w.land]].filter(([v,k]) => v!=null && k>0);
    const sw = p.reduce((a,[,k]) => a+k, 0);
    c.V = sw ? p.reduce((a,[v,k]) => a+v*k, 0)/sw : 0.5;
    c.risk = Math.round(100*c.H*(0.4+0.6*c.V));
  });
}
const geo = () => ({type:'FeatureCollection', features: live_().map(c => ({type:'Feature', geometry:{type:'Point', coordinates:[c.lon,c.lat]}, properties:{id:c.id, name:c.name, risk:c.risk, r:Math.min(14, 4+10*Math.sqrt(c.pop/2e7))}}))});
const box = c => { const a = 5/111.32; return [a, a/Math.cos(c.lat*Math.PI/180)]; };
function hood(c){
  const f = [];
  if (c && c.gb) {
    const [a,o] = box(c);
    for (let i=0;i<8;i++) for (let j=0;j<8;j++) {
      const k = i*8+j; if (c.gb[k]<0) continue;
      const n = c.lat+a-i*a/4, s = n-a/4, w = c.lon-o+j*o/4, e = w+o/4;
      f.push({type:'Feature', geometry:{type:'Polygon', coordinates:[[[w,n],[e,n],[e,s],[w,s],[w,n]]]}, properties:{p:c.gb[k]-c.gt[k]}});
    }
  }
  return {type:'FeatureCollection', features:f};
}
function fitBox(c){ const [a,o] = box(c); map.fitBounds([[c.lon-o,c.lat-a],[c.lon+o,c.lat+a]], {padding:60}); }

function summary(){
  const L = live_(); if (!L.length) return;
  const hot = L.filter(c => c.T>=32), top = [...L].sort((a,b) => b.T-a.T)[0];
  const dv = L.filter(c => c.dep!=null).sort((a,b) => b.dep-a.dep)[0];
  $('#sum').innerHTML = `<p class="big"><b>${hot.length}</b> of ${L.length} cities reach an apparent temperature of 32 °C or more on ${wd(L[0].d[S.day],{weekday:'long', day:'numeric', month:'short'})}.</p><p class="sub">Hottest: ${esc(top.name)}, ${esc(top.cn)}, at ${top.T.toFixed(0)} °C apparent (${cat(top.T).toLowerCase()}).${dv ? ` Largest departure from the local normal maximum: ${esc(dv.name)}, ${esc(dv.cn)} (${sg(dv.dep)} °C).` : ''}</p>`;
}
function rank(){
  const L = live_().sort((a,b) => b.risk-a.risk || b.T-a.T).slice(0,10);
  $('#rank').innerHTML = L.map((c,i) => `<li data-id="${c.id}"${c.id===S.sel?' class="on"':''}><span>${i+1}</span><div><b>${esc(c.name)}</b><small>${esc(c.cn)}, ${c.T.toFixed(0)} °C apparent${c.dep==null ? '' : `, ${sg(c.dep)} °C vs normal`}</small></div><em style="background:${rcol(c.risk)};color:${c.risk>=45?'#fff':'#14202b'}">${c.risk}</em></li>`).join('');
}
function brief(){
  const t = S.brief && S.brief.text[BKEY[S.region]];
  $('#brief').hidden = $('#bmeta').hidden = !t;
  if (t) { $('#brief').textContent = t; $('#bmeta').textContent = `Written by ${S.brief.model} from the figures in the latest build. Check it against the map before relying on it.`; }
}
const nowTxt = (a,l) => a && a[1]!=null ? `Now (${l}): ${a[0]} °C, feels like ${a[1]} °C, humidity ${a[2]}%.` : '';
async function live(c){
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m&timezone=auto`);
    const x = (await r.json()).current;
    if (x && S.sel===c.id && $('#live')) $('#live').textContent = nowTxt([x.temperature_2m, x.apparent_temperature, x.relative_humidity_2m], 'live');
  } catch (e) { /* keep build-time values */ }
}
function detail(){
  const c = cur(), el = $('#detail');
  if (!c || c.risk==null) { el.hidden = true; return; }
  el.hidden = false;
  const bars = c.at.map((t,i) => `<div class="bar${i===S.day?' on':''}"><em>${t==null?'–':t.toFixed(0)}</em><i style="height:${t==null?0:Math.round(clamp((t-10)/40)*70)}px;background:${tcol(t)}"></i><span>${wd(c.d[i],{weekday:'short'})}</span></div>`).join('');
  const row = (k,v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
  el.innerHTML = `<h2>${esc(c.name)}, ${esc(c.cn)}</h2><p class="sub">${cat(c.T)} on ${wd(c.d[S.day],{weekday:'long'})}. Heat-risk index <b>${c.risk}</b> out of 100.</p><div class="bars" role="img" aria-label="Seven-day maximum apparent temperature in degrees Celsius">${bars}</div><p class="sub" id="live">${nowTxt(c.now,'at last build')}</p><table>${row('Departure from normal maximum', c.dep==null?'n/a':sg(c.dep)+' °C')}${row('Aged 65+ (national)', c.p65==null?'n/a':c.p65+'%')}${row('Urban population (national)', c.urb==null?'n/a':c.urb+'%')}${row('City population', n0(c.pop))}${row('Built-up surface within 5 km', c.b==null?'n/a':c.b+'%')}${row('Tree cover within 5 km', c.t==null?'n/a':c.t+'%')}${row('Elevation', c.elev==null?'n/a':c.elev+' m')}</table>${c.gb ? '<p class="sub">The grid on the map splits 10 km around the centre into 1.25 km cells: red is mostly built-up, green mostly tree cover. It is a land-cover proxy for heat retention, not measured temperature.</p><button class="btn zoom" id="zoom">Zoom to the grid</button>' : ''}`;
  live(c);
}
function update(){
  calc();
  if (map.getSource('c')) map.getSource('c').setData(geo());
  if (map.getSource('hood')) map.getSource('hood').setData(hood(cur()));
  if (map.getLayer('sel')) map.setFilter('sel', ['==', ['get','id'], S.sel ?? -1]);
  summary(); rank(); detail(); brief();
  history.replaceState(null, '', `#${encodeURIComponent(S.region)}/${S.day}/${S.sel ?? ''}`);
}
const select = id => { S.sel = id; update(); };
const sync = () => {
  document.querySelectorAll('#reg button').forEach(b => b.classList.toggle('on', b.dataset.r===S.region));
  document.querySelectorAll('#days button').forEach(b => b.classList.toggle('on', +b.dataset.d===S.day));
  document.querySelectorAll('#basis button').forEach(b => b.classList.toggle('on', b.dataset.b===S.basis));
};
function csv(){
  const rows = [['city','country','region','lat','lon','population','apparent_temp_max_c','departure_from_normal_c','built_up_pct','tree_cover_pct','risk_index','category']];
  live_().forEach(c => rows.push([c.name,c.cn,c.reg,c.lat,c.lon,c.pop,c.T,c.dep,c.b,c.t,c.risk,cat(c.T)]));
  const text = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type:'text/csv'}));
  a.download = `heatequity_${S.region.replace(' ','_')}_${S.cities[0].d[S.day]}.csv`;
  a.click();
}
const facts = c => ({city:c.name, country:c.cn, date:c.d[S.day], population:c.pop, apparent_max_c:c.T, departure_from_normal_c:c.dep, risk_index:c.risk, aged_65_plus_pct:c.p65, urban_pct:c.urb, built_up_pct:c.b, tree_cover_pct:c.t, apparent_max_next_7_days:c.at});
async function ask(){
  const key = $('#gk').value.trim(), q = $('#q').value.trim(), c = cur();
  if (!key || !q) { $('#ans').textContent = 'Add your Groq key and a question.'; return; }
  const ctx = JSON.stringify(c ? facts(c) : live_().sort((a,b) => b.risk-a.risk).slice(0,12).map(facts));
  $('#ans').textContent = 'Thinking…';
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+key}, body:JSON.stringify({model:'llama-3.3-70b-versatile', temperature:0.2, messages:[{role:'system', content:SYS}, {role:'user', content:`Data:\n${ctx}\n\nQuestion: ${q}`}]})});
    const j = await r.json();
    $('#ans').textContent = (j.choices && j.choices[0].message.content) || (j.error && j.error.message) || 'No answer returned.';
  } catch (e) { $('#ans').textContent = 'The request failed. Check the key and your connection.'; }
}

async function init(){
  let d;
  try { const r = await fetch('data/cities.json'); if (!r.ok) throw new Error(r.status); d = await r.json(); }
  catch (e) { $('#msg').hidden = false; $('#msg').textContent = 'The data file is missing. Run the "Build and deploy" workflow in GitHub Actions to create it.'; $('#sum').innerHTML = ''; return; }
  S.meta = d.meta; S.cities = d.cities; S.brief = d.briefing || null;
  S.cities.forEach(c => { c.lc = c.b==null ? null : c.b - c.t; });
  pct('p65','A'); pct('urb','U'); pct('pop','C'); pct('lc','L');
  const [r,dy,s] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (BOUNDS[r]) S.region = r;
  if (+dy>=0 && +dy<7) S.day = +dy;
  if (s && S.cities.some(c => c.id===+s)) S.sel = +s;
  $('#days').innerHTML = S.cities[0].d.map((x,i) => `<button data-d="${i}">${i ? wd(x,{weekday:'short'}) : 'Today'}</button>`).join('');
  const age = (Date.now() - new Date(S.meta.generated)) / 36e5;
  $('#stamp').innerHTML = `Forecasts built ${new Date(S.meta.generated).toLocaleString('en-GB',{dateStyle:'medium', timeStyle:'short'})} and refreshed every six hours. ${S.meta.cities} cities in ${S.meta.countries} countries.` + (age>24 ? ' <b class="warn">This data is more than a day old.</b>' : '');
  calc(); sync();
  await ready;
  map.addSource('c', {type:'geojson', data:geo()});
  map.addSource('hood', {type:'geojson', data:hood(cur())});
  map.addLayer({id:'cities', type:'circle', source:'c', layout:{'circle-sort-key':['get','risk']}, paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],2,['get','r'],8,['*',['get','r'],2.2]],
    'circle-color':['interpolate',['linear'],['get','risk'],...RAMP],
    'circle-opacity':0.85, 'circle-stroke-color':'#ffffff', 'circle-stroke-width':1}});
  map.addLayer({id:'hood', type:'fill', source:'hood', paint:{
    'fill-color':['interpolate',['linear'],['get','p'],-60,'#2e7d32',-10,'#d9e8a8',20,'#fff3b0',50,'#f78b2d',80,'#a4161a'],
    'fill-opacity':0.6, 'fill-outline-color':'rgba(255,255,255,0.6)'}}, 'cities');
  map.addLayer({id:'sel', type:'circle', source:'c', filter:['==',['get','id'],-1], paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],2,['+',['get','r'],3],8,['+',['*',['get','r'],2.2],3]],
    'circle-color':'rgba(0,0,0,0)', 'circle-stroke-color':'#14202b', 'circle-stroke-width':2.5}});
  const pop = new maplibregl.Popup({closeButton:false, closeOnClick:false, offset:10});
  map.on('mousemove','cities', e => { map.getCanvas().style.cursor = 'pointer'; const f = e.features[0]; pop.setLngLat(f.geometry.coordinates).setHTML(`<b>${esc(f.properties.name)}</b><br>Risk index ${f.properties.risk}`).addTo(map); });
  map.on('mouseleave','cities', () => { map.getCanvas().style.cursor = ''; pop.remove(); });
  map.on('click','cities', e => select(e.features[0].properties.id));
  if (S.region!=='All') map.fitBounds(BOUNDS[S.region], {padding:20, duration:0});
  $('#reg').onclick = e => { const r = e.target.dataset.r; if (!r) return; S.region = r; map.fitBounds(BOUNDS[r], {padding:20}); sync(); update(); };
  $('#days').onclick = e => { const x = e.target.dataset.d; if (x==null) return; S.day = +x; sync(); update(); };
  $('#basis').onclick = e => { const b = e.target.dataset.b; if (!b) return; S.basis = b; sync(); update(); };
  $('#rank').onclick = e => { const li = e.target.closest('li'); if (!li) return; const c = S.cities.find(x => x.id===+li.dataset.id); select(c.id); map.flyTo({center:[c.lon,c.lat], zoom:Math.max(map.getZoom(),5)}); };
  $('#detail').onclick = e => { if (e.target.id==='zoom' && cur()) fitBox(cur()); };
  ['age','urb','size','land'].forEach(k => { $('#w-'+k).oninput = e => { S.w[k] = +e.target.value; $('#o-'+k).textContent = e.target.value; update(); }; });
  $('#ask').onclick = ask;
  $('#csv').onclick = csv;
  $('#how').onclick = () => $('#dlg').showModal();
  update();
}
init();
})();
