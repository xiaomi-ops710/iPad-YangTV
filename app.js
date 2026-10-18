/* TV for YouTube — Apple TV風 YouTubeクライアント */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const h=html=>{const t=document.createElement('template');t.innerHTML=html.trim();return t.content.firstElementChild};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=n=>`<svg class="ic"><use href="#i-${n}"/></svg>`;
const fmt=s=>{if(!s)return 'ライブ';const H=s/3600|0,M=(s%3600)/60|0,S=s%60|0,p=n=>String(n).padStart(2,'0');return H?`${H}:${p(M)}:${p(S)}`:`${M}:${p(S)}`};

/* ---------- Store ---------- */
const Store={
  get:(k,d)=>{try{return JSON.parse(localStorage.getItem('atv.'+k))??d}catch{return d}},
  set:(k,v)=>localStorage.setItem('atv.'+k,JSON.stringify(v))
};
const Lib={
  has:id=>Store.get('wl',[]).some(v=>v.id===id),
  toggle(v){const l=Store.get('wl',[]);Store.set('wl',this.has(v.id)?l.filter(x=>x.id!==v.id):[v,...l])}
};

/* ---------- YouTube Data API ---------- */
const iso=d=>{const m=/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d)||[];return(+m[1]||0)*3600+(+m[2]||0)*60+(+m[3]||0)};
const norm=i=>{const s=i.snippet,t=s.thumbnails;return{id:i.id,title:s.title,channel:s.channelTitle,desc:s.description||'',
  thumb:(t.high||t.medium||t.default).url,hi:(t.maxres||t.standard||t.high||t.default).url,dur:iso(i.contentDetails.duration)}};
const API={
  cache:new Map(),
  async call(ep,params){
    const key=Store.get('key','');if(!key)throw new Error('NO_KEY');
    const u=new URL('https://www.googleapis.com/youtube/v3/'+ep);
    Object.entries({...params,key}).forEach(([k,v])=>u.searchParams.set(k,v));
    const ck=u.href;if(this.cache.has(ck))return this.cache.get(ck);
    const r=await fetch(u),j=await r.json();
    if(!r.ok)throw new Error(j.error?.message||r.status);
    this.cache.set(ck,j);return j;
  },
  async videos(p){return(await this.call('videos',{part:'snippet,contentDetails',regionCode:'JP',...p})).items.map(norm)},
  trending(cat,n=24){return this.videos({chart:'mostPopular',maxResults:n,...(cat?{videoCategoryId:cat}:{})})},
  async search(q){
    const s=await this.call('search',{part:'snippet',type:'video',maxResults:24,q,regionCode:'JP',safeSearch:'moderate'});
    return this.videos({id:s.items.map(i=>i.id.videoId).join(',')});
  }
};

/* ---------- Components ---------- */
const VID=new Map(), reg=v=>(VID.set(v.id,v),v);
const addBtn=v=>`<button class="btn-add glass" data-act="add" data-id="${v.id}" aria-label="ウォッチリスト">${icon(Lib.has(v.id)?'check':'plus')}</button>`;
let heroTimer;

function hero(list){
  const el=h(`<header class="hero"></header>`);
  list.forEach((v,i)=>el.append(h(`<div class="slide${i?'':' on'}"><img alt="" src="${v.hi}" onerror="this.onerror=null;this.src='${v.thumb}'">
    <div class="hero-body"><h1>${esc(v.title)}</h1><p class="sub">YouTube · ${esc(v.channel)} · ${fmt(v.dur)}</p>
    <p class="desc">${esc(v.desc)}</p>
    <div class="btns"><button class="btn-play" data-act="play" data-id="${v.id}">${icon('play')}再生</button>${addBtn(v)}</div></div></div>`)));
  const dots=h(`<div class="dots">${list.map((_,i)=>`<i data-dot="${i}"></i>`).join('')}</div>`);el.append(dots);
  let i=0;
  const set=n=>{i=(n+list.length)%list.length;$$('.slide',el).forEach((s,k)=>s.classList.toggle('on',k===i));$$('i',dots).forEach((d,k)=>d.classList.toggle('on',k===i))};
  set(0);clearInterval(heroTimer);heroTimer=setInterval(()=>set(i+1),7000);
  dots.addEventListener('click',e=>{const d=e.target.closest('[data-dot]');if(d){set(+d.dataset.dot);clearInterval(heroTimer)}});
  return el;
}
function card(v,i,o={}){
  const p=o.progress&&v.d?Math.min(1,v.t/v.d):0;
  return h(`<article class="card" tabindex="0" data-id="${v.id}"><div class="thumb"><img loading="lazy" alt="" src="${v.thumb}">
    ${o.rank?`<span class="rank">${i+1}</span>`:''}
    ${p?`<span class="bar" style="--p:${p*100}%"><i></i></span>`:`<span class="dur">${fmt(v.dur)}</span>`}</div>
    <div class="meta"><b>${esc(v.title)}</b><span>${esc(v.channel)}${p?` · 残り${Math.ceil((v.d-v.t)/60)}分`:''}</span></div></article>`);
}
function row(title,items,o={}){
  const s=h(`<section class="row"><h2>${esc(title)}${icon('chev')}</h2><div class="rail"></div></section>`);
  $('.rail',s).append(...items.map((v,i)=>card(reg(v),i,o)));return s;
}
const grid=(items,o)=>{const g=h('<div class="grid"></div>');g.append(...items.map((v,i)=>card(reg(v),i,o)));return g};
const head=t=>h(`<div class="head"><h1>${esc(t)}</h1></div>`);
const continueList=()=>Store.get('hist',[]).filter(x=>x.d&&x.t>5&&x.t<x.d*.95);

/* ---------- Views ---------- */
const main=$('#main'),state={view:'home'};let token=0;
const ROWS=[{t:'ミュージック',c:10},{t:'ゲーム',c:20},{t:'エンタメ',c:24},{t:'スポーツ',c:17},{t:'ニュース',c:25}];
const VIEWS={
  async home(my){
    const hot=await API.trending(null,24);if(my!==token)return;
    hot.forEach(reg);main.append(hero(hot.slice(0,6)));
    const body=h('<div class="rows"></div>');main.append(body);
    const hist=continueList();if(hist.length)body.append(row('続きを観る',hist,{progress:1}));
    const wl=Store.get('wl',[]);if(wl.length)body.append(row('次に観る',wl));
    body.append(row('トップ10：話題',hot.slice(0,10),{rank:1}),row('話題の動画',hot.slice(10)));
    ROWS.forEach(r=>{const slot=h('<div></div>');body.append(slot);
      API.trending(r.c).then(v=>{if(my===token)slot.append(row(r.t,v))}).catch(()=>{})});
  },
  async hot(my){const v=await API.trending(null,50);if(my!==token)return;main.append(head('話題の動画'),grid(v,{}))},
  async lib(my){
    main.append(head('ライブラリ'));
    const wl=Store.get('wl',[]),hist=Store.get('hist',[]);
    if(!wl.length&&!hist.length)return main.append(h('<p class="msg">ウォッチリストに追加した動画や視聴履歴がここに表示されます。</p>'));
    const body=h('<div class="rows"></div>');main.append(body);
    if(wl.length)body.append(row('次に観る',wl));
    if(hist.length)body.append(row('視聴履歴',hist,{progress:1}));
  },
  async search(){
    main.append(head('検索'));
    const f=h(`<form class="sbar glass">${icon('search')}<input type="search" placeholder="動画を検索" enterkeyhint="search" autofocus></form>`),res=h('<div></div>');
    main.append(f,res);
    f.addEventListener('submit',async e=>{e.preventDefault();const q=$('input',f).value.trim();if(!q)return;
      res.replaceChildren(h('<p class="msg">検索中…</p>'));
      try{res.replaceChildren(grid(await API.search(q),{}))}catch(err){res.replaceChildren(h(`<p class="msg">${esc(err.message)}</p>`))}});
  }
};
const notice=(t,p,btn)=>h(`<div class="empty"><h1>${t}</h1><p>${esc(p)}</p>${btn?`<button class="btn-play" data-act="setup">${btn}</button>`:''}</div>`);
async function render(view){
  const my=++token;state.view=view;markNav(view);closeSide();clearInterval(heroTimer);scrollTo(0,0);main.replaceChildren();
  if(!Store.get('key',''))return main.append(notice('APIキーを設定','YouTube Data API v3 のキーを登録すると、動画を表示できます。','設定を開く'));
  try{await VIEWS[view](my)}catch(e){if(my===token)main.append(notice('読み込めませんでした',e.message,'APIキーを確認'))}
}

/* ---------- Navigation ---------- */
function markNav(v){
  $$('[data-view]').forEach(b=>b.dataset.view===v?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  const b=$('#nav [aria-current]'),i=$('.ind');
  if(b){i.style.left=b.offsetLeft+'px';i.style.width=b.offsetWidth+'px'}
}
const closeSide=()=>{$('#side').classList.remove('open');$('#scrim').classList.remove('on')};
const toggleSide=()=>{$('#side').classList.toggle('open');$('#scrim').classList.toggle('on')};
const syncAdd=()=>$$('[data-act=add]').forEach(b=>b.innerHTML=icon(Lib.has(b.dataset.id)?'check':'plus'));

/* ---------- Player (IFrame API) ---------- */
const Player={
  el:$('#player'),p:null,v:null,tick:null,idle:null,ready:null,
  sdk(){return this.ready??=new Promise(r=>{if(window.YT?.Player)return r();window.onYouTubeIframeAPIReady=r;
    const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';document.head.append(s)})},
  poke(){this.el.classList.remove('idle');clearTimeout(this.idle);this.idle=setTimeout(()=>this.el.classList.add('idle'),3000)},
  async open(v){
    this.v=v;this.el.classList.add('on');$('.t',this.el).textContent=v.title;this.poke();
    try{await this.el.requestFullscreen?.({navigationUI:'hide'})}catch{}
    const t=Math.floor(Store.get('hist',[]).find(x=>x.id===v.id)?.t||0);
    await this.sdk();if(this.v!==v)return;
    $('#ytp-wrap').innerHTML='<div id="ytp"></div>';
    this.p=new YT.Player('ytp',{videoId:v.id,playerVars:{autoplay:1,playsinline:1,rel:0,start:t>10?t-3:0,origin:location.origin},
      events:{onReady:e=>e.target.playVideo(),
        onError:()=>$('#ytp-wrap').innerHTML=`<div class="fail"><p>この動画はアプリ内で再生できません。</p><a class="btn-play" href="https://youtu.be/${v.id}" target="_blank" rel="noopener">YouTubeで開く</a></div>`}});
    clearInterval(this.tick);this.tick=setInterval(()=>this.save(),4000);
  },
  save(){
    const p=this.p;if(!p?.getCurrentTime||!this.v)return;
    const t=p.getCurrentTime(),d=p.getDuration();if(!(d>0)||t<3)return;
    const{id,title,channel,thumb,hi,dur}=this.v;
    Store.set('hist',[{id,title,channel,thumb,hi,dur,t,d,at:Date.now()},...Store.get('hist',[]).filter(x=>x.id!==id)].slice(0,30));
  },
  close(){
    this.save();clearInterval(this.tick);try{this.p?.destroy()}catch{}
    this.p=this.v=null;this.el.classList.remove('on');
    if(document.fullscreenElement)document.exitFullscreen?.();
    if(state.view==='home'||state.view==='lib')render(state.view);
  }
};
$('.zone').addEventListener('pointermove',()=>Player.poke());
$('.zone').addEventListener('pointerdown',()=>Player.poke());

/* ---------- Events ---------- */
const dlg=$('#setup');
document.addEventListener('click',e=>{
  const a=e.target.closest('[data-act],[data-view],.card');if(!a)return;
  if(a.dataset.view)return render(a.dataset.view);
  if(a.matches('.card'))return Player.open(VID.get(a.dataset.id));
  const v=VID.get(a.dataset.id);
  ({side:toggleSide,close:()=>Player.close(),
    play:()=>Player.open(v),
    add:()=>{Lib.toggle(v);syncAdd()},
    setup:()=>{$('#key').value=Store.get('key','');closeSide();dlg.showModal()}})[a.dataset.act]?.();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&Player.v)Player.close();
  if(e.key==='Enter'&&e.target.matches('.card'))Player.open(VID.get(e.target.dataset.id));
});
dlg.addEventListener('close',()=>{
  if(dlg.returnValue==='ok'){Store.set('key',$('#key').value.trim());API.cache.clear();render(state.view)}
});
/* tvOS風チルト */
document.addEventListener('pointermove',e=>{
  if(e.pointerType!=='mouse')return;
  const c=e.target.closest('.card');if(!c)return;
  const r=c.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;
  c.style.setProperty('--ry',x*9+'deg');c.style.setProperty('--rx',-y*9+'deg');
});
document.addEventListener('pointerout',e=>{const c=e.target.closest?.('.card');if(c){c.style.removeProperty('--rx');c.style.removeProperty('--ry')}});
addEventListener('resize',()=>markNav(state.view));

render('home');
if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
