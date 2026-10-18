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

const CH=new Map();
const Fol={has:id=>Store.get('fol',[]).some(c=>c.id===id),
  toggle(c){const l=Store.get('fol',[]);Store.set('fol',this.has(c.id)?l.filter(x=>x.id!==c.id):[{id:c.id,name:c.name,avatar:c.avatar,subs:c.subs},...l])}};
const fmtN=n=>n>=1e8?(n/1e8).toFixed(1)+'億':n>=1e4?(n/1e4).toFixed(n>=1e5?0:1)+'万':String(n);
const region=()=>Store.get('region','JP');
/* ---------- YouTube Data API ---------- */
const nch=c=>{const s=c.snippet,t=c.statistics||{};return{id:c.id,name:s.title,handle:s.customUrl||'',avatar:(s.thumbnails.medium||s.thumbnails.default).url,
  banner:c.brandingSettings?.image?.bannerExternalUrl,subs:t.hiddenSubscriberCount?null:+t.subscriberCount,count:+t.videoCount||0,desc:s.description||'',uploads:c.contentDetails.relatedPlaylists.uploads}};
const iso=d=>{const m=/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d)||[];return(+m[1]||0)*3600+(+m[2]||0)*60+(+m[3]||0)};
const norm=i=>{const s=i.snippet,t=s.thumbnails;return{id:i.id,title:s.title,channel:s.channelTitle,cid:s.channelId,desc:s.description||'',
  thumb:(t.high||t.medium||t.default).url,hi:(t.maxres||t.standard||t.high||t.default).url,dur:iso(i.contentDetails.duration),cat:s.categoryId,views:+i.statistics?.viewCount||0,pub:s.publishedAt}};
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
  async videos(p){return(await this.call('videos',{part:'snippet,contentDetails,statistics',regionCode:region(),...p})).items.map(norm)},
  trending(cat,n=24){return this.videos({chart:'mostPopular',maxResults:n,...(cat?{videoCategoryId:cat}:{})})},
  async vsearch(p){
    const s=await this.call('search',{part:'snippet',type:'video',maxResults:24,regionCode:region(),safeSearch:'moderate',...p});
    return this.videos({id:s.items.map(i=>i.id.videoId).join(',')});
  },
  search(q){return this.vsearch({q})},
  async chInfo(ids){return(await this.call('channels',{part:'snippet,statistics,contentDetails,brandingSettings',id:ids,maxResults:50})).items.map(nch)},
  async channels(q){const s=await this.call('search',{part:'snippet',type:'channel',maxResults:20,q});return this.chInfo(s.items.map(i=>i.id.channelId).join(','))},
  async feed(chs){
    const pls=await Promise.all(chs.map(c=>this.call('playlistItems',{part:'contentDetails',playlistId:'UU'+c.id.slice(2),maxResults:4})
      .then(j=>j.items.map(i=>({id:i.contentDetails.videoId,at:i.contentDetails.videoPublishedAt||''}))).catch(()=>[])));
    const items=pls.flat().sort((a,b)=>b.at.localeCompare(a.at)).slice(0,48);
    if(!items.length)return[];
    const m=new Map((await this.videos({id:items.map(i=>i.id).join(','),maxResults:50})).map(v=>[v.id,v]));
    return items.map(i=>m.get(i.id)).filter(Boolean);
  },
  async uploads(pl,n){const j=await this.call('playlistItems',{part:'contentDetails',playlistId:pl,maxResults:n});return this.videos({id:j.items.map(i=>i.contentDetails.videoId).join(',')})}
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
    <div class="btns"><button class="btn-play" data-act="play" data-id="${v.id}">${icon('play')}再生</button>${addBtn(v)}<button class="btn-add glass" data-act="info" data-id="${v.id}" aria-label="詳細">${icon('info')}</button></div></div></div>`)));
  const dots=h(`<div class="dots">${list.map((_,i)=>`<i data-dot="${i}"></i>`).join('')}</div>`);el.append(dots);
  let i=0;
  const set=n=>{i=(n+list.length)%list.length;$$('.slide',el).forEach((s,k)=>s.classList.toggle('on',k===i));$$('i',dots).forEach((d,k)=>d.classList.toggle('on',k===i))};
  set(0);clearInterval(heroTimer);heroTimer=setInterval(()=>set(i+1),7000);
  dots.addEventListener('click',e=>{const d=e.target.closest('[data-dot]');if(d){set(+d.dataset.dot);clearInterval(heroTimer)}});
  let sx=null;el.addEventListener('pointerdown',e=>{sx=e.clientX});
  el.addEventListener('pointerup',e=>{if(sx==null)return;const d=e.clientX-sx;sx=null;if(Math.abs(d)>50){set(i+(d<0?1:-1));clearInterval(heroTimer)}});
  return el;
}
function card(v,i,o={}){
  const p=o.progress&&v.d?Math.min(1,v.t/v.d):0;
  return h(`<article class="card" tabindex="0" data-id="${v.id}" style="--i:${Math.min(i,10)}"><div class="thumb"><img loading="lazy" alt="" src="${v.thumb}" onload="this.classList.add('in')"><button class="more glass" data-act="info" data-id="${v.id}" aria-label="詳細">${icon('more')}</button>
    ${o.rank?`<span class="rank">${i+1}</span>`:''}
    ${p?`<span class="bar" style="--p:${p*100}%"><i></i></span>`:`<span class="dur">${fmt(v.dur)}</span>`}</div>
    <div class="meta"><b>${esc(v.title)}</b><span${v.cid?` data-ch="${v.cid}"`:''}>${esc(v.channel)}${p?` · 残り${Math.ceil((v.d-v.t)/60)}分`:''}</span></div></article>`);
}
const IO=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.remove('pre');IO.unobserve(e.target)}}),{rootMargin:'0px 0px -6% 0px'});
function row(title,items,o={}){
  const s=h(`<section class="row"><h2>${esc(title)}${icon('chev')}</h2><div class="rail"></div></section>`);
  $('.rail',s).append(...items.map((v,i)=>card(reg(v),i,o)));s.classList.add('pre');IO.observe(s);return s;
}
const grid=(items,o)=>{const g=h('<div class="grid"></div>');g.append(...items.map((v,i)=>card(reg(v),i,o)));return g};
const chCard=c=>h(`<button class="chc" data-ch="${c.id}"><img src="${c.avatar}" alt=""><b>${esc(c.name)}</b>${c.subs!=null?`<span>登録者 ${fmtN(c.subs)}人</span>`:''}</button>`);
const chRow=(t,l)=>{const s=h(`<section class="row"><h2>${esc(t)}${icon('chev')}</h2><div class="rail chr"></div></section>`);$('.rail',s).append(...l.map(chCard));return s};
/* Liquid Glass セグメント（レンズ型インジケータ） */
const mark=(el,now)=>{const b=$('[aria-current]',el),i=$('.ind',el);if(!b||!i)return;
  const L=b.offsetLeft+'px',moved=!now&&i.style.left&&i.style.left!==L;
  if(now)i.style.transition='none';i.style.left=L;i.style.width=b.offsetWidth+'px';if(now){i.offsetWidth;i.style.transition=''}
  if(moved){i.classList.remove('jelly');void i.offsetWidth;i.classList.add('jelly')}};
function seg(items,cur,cb,cls=''){
  const el=h(`<div class="seg glass ${cls}"><span class="ind"></span>${items.map(([k,t])=>`<button data-k="${k}"${k===cur?' aria-current="true"':''}>${esc(t)}</button>`).join('')}</div>`);
  el.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
    $$('button',el).forEach(x=>x.removeAttribute('aria-current'));b.setAttribute('aria-current','true');mark(el);
    b.scrollIntoView?.({inline:'center',block:'nearest',behavior:'smooth'});cb(b.dataset.k)});
  requestAnimationFrame(()=>mark(el,true));return el;
}
const head=t=>h(`<div class="head"><h1>${esc(t)}</h1></div>`);
const continueList=()=>Store.get('hist',[]).filter(x=>x.d&&x.t>5&&x.t<x.d*.95);

/* ---------- Views ---------- */
const main=$('#main'),state={view:'home',cat:'all',stack:[]};let token=0,sub=0;
const CATS=[['all','すべて'],['10','ミュージック'],['20','ゲーム'],['24','エンタメ'],['17','スポーツ'],['23','コメディ'],['25','ニュース'],['28','サイエンス']];
const ROWS=[['ミュージック',10],['ゲーム',20],['エンタメ',24],['スポーツ',17],['ニュース',25]];
const VIEWS={
  async home(my){
    const body=h('<div class="catbody"></div>');
    const fill=async()=>{
      const c=state.cat,t=++sub;clearInterval(heroTimer);body.replaceChildren();
      try{
        const hot=await API.trending(c==='all'?null:c,24);if(my!==token||t!==sub)return;
        hot.forEach(reg);body.append(hero(hot.slice(0,6)));
        const rows=h('<div class="rows"></div>');body.append(rows);
        if(c==='all'){
          const hist=continueList(),wl=Store.get('wl',[]),fol=Store.get('fol',[]);
          if(hist.length)rows.append(row('続きを観る',hist,{progress:1}));
          if(wl.length)rows.append(row('次に観る',wl));
          if(fol.length)rows.append(chRow('フォロー中のチャンネル',fol));
        }
        rows.append(row(c==='all'?'トップ10：話題':'トップ10：'+CATS.find(x=>x[0]===c)[1],hot.slice(0,10),{rank:1}),row('話題の動画',hot.slice(10)));
        if(c==='all')ROWS.forEach(([n,k])=>{const slot=h('<div></div>');rows.append(slot);
          API.trending(k).then(v=>{if(my===token&&t===sub)slot.append(row(n,v))}).catch(()=>{})});
      }catch(e){if(my===token&&t===sub)body.append(notice('読み込めませんでした',e.message,'APIキーを確認'))}
    };
    main.append(seg(CATS,state.cat,k=>{state.cat=k;fill()},'cats'),body);
    await fill();
  },
  async live(my){
    const v=await API.vsearch({eventType:'live',order:'viewCount'});if(my!==token)return;
    main.append(head('ライブ'),v.length?grid(v,{}):h('<p class="msg">現在ライブ配信は見つかりませんでした。</p>'));
  },
  async subs(my){
    main.append(head('登録チャンネル'));
    const fol=Store.get('fol',[]);
    if(!fol.length)return main.append(h('<p class="msg">チャンネルをフォローすると、最新の動画がここにまとまります。検索の「チャンネル」から追加できます。</p>'));
    main.append(chRow('フォロー中',fol));
    const slot=h('<p class="msg">最新の動画を読み込み中…</p>');main.append(slot);
    const v=await API.feed(fol.slice(0,15));if(my!==token)return;
    slot.replaceWith(h('<div class="head sub"><h1>新着</h1></div>'),grid(v,{}));
  },
  async hot(my){const v=await API.trending(null,50);if(my!==token)return;main.append(head('話題の動画'),grid(v,{}))},
  async lib(my){
    main.append(head('ライブラリ'));
    const wl=Store.get('wl',[]),hist=Store.get('hist',[]),fol=Store.get('fol',[]);
    if(!wl.length&&!hist.length&&!fol.length)return main.append(h('<p class="msg">フォローしたチャンネル、ウォッチリスト、視聴履歴がここに表示されます。</p>'));
    const body=h('<div class="rows"></div>');main.append(body);
    if(fol.length)body.append(chRow('フォロー中のチャンネル',fol));
    if(wl.length)body.append(row('次に観る',wl));
    if(hist.length)body.append(row('視聴履歴',hist,{progress:1}));
  },
  async search(){
    main.append(head('検索'));
    let mode='v';
    const f=h(`<form class="sbar glass">${icon('search')}<input type="search" placeholder="動画・チャンネルを検索" enterkeyhint="search" autofocus></form>`),
      res=h('<div></div>'),inp=$('input',f),rec=h('<div class="chips"></div>');
    const drawRec=()=>{rec.innerHTML=Store.get('recent',[]).map(q=>`<button data-q="${esc(q)}">${esc(q)}</button>`).join('')};
    const run=async()=>{
      const q=inp.value.trim();if(!q)return;
      Store.set('recent',[q,...Store.get('recent',[]).filter(x=>x!==q)].slice(0,8));drawRec();
      res.replaceChildren(h('<p class="msg">検索中…</p>'));
      try{
        const m=q.match(/(?:youtu\.be\/|[?&]v=|shorts\/)([\w-]{11})/);
        if(m){const[v]=await API.videos({id:m[1]});res.replaceChildren();if(v){reg(v);Player.open(v)}return}
        if(mode==='v')res.replaceChildren(grid(await API.search(q),{}));
        else{const cs=await API.channels(q),g=h('<div class="grid chg"></div>');cs.forEach(c=>CH.set(c.id,c));g.append(...cs.map(chCard));res.replaceChildren(g)}
      }catch(err){res.replaceChildren(h(`<p class="msg">${esc(err.message)}</p>`))}
    };
    const tabs=seg([['v','動画'],['c','チャンネル']],'v',k=>{mode=k;if(inp.value.trim())run()},'smode');
    f.addEventListener('submit',e=>{e.preventDefault();run()});
    rec.addEventListener('click',e=>{const b=e.target.closest('[data-q]');if(b){inp.value=b.dataset.q;run()}});
    drawRec();main.append(f,tabs,rec,res);
  },
  async channel(my,id){
    const c=(await API.chInfo(id))[0];if(my!==token)return;if(!c)throw new Error('チャンネルが見つかりません');
    CH.set(c.id,c);
    main.append(h(`<header class="chh"${c.banner?` style="--bn:url('${c.banner}')"`:''}><button class="back glass" data-act="back" aria-label="戻る">${icon('chev')}</button>
      <img class="chav" src="${c.avatar}" alt=""><div class="chi"><h1>${esc(c.name)}</h1>
      <p>${[c.handle,c.subs!=null&&'登録者 '+fmtN(c.subs)+'人','動画 '+c.count.toLocaleString()+'本'].filter(Boolean).map(esc).join(' · ')}</p>
      <p class="desc">${esc(c.desc)}</p><div class="btns"><button class="btn-play" data-act="follow" data-id="${c.id}"></button></div></div></header>`));
    syncFollow();
    const list=h('<div></div>');
    const load=async k=>{
      list.replaceChildren(h('<p class="msg">読み込み中…</p>'));
      try{const v=k==='new'?await API.uploads(c.uploads,36):await API.vsearch({channelId:c.id,order:'viewCount'});if(my!==token)return;list.replaceChildren(grid(v,{}))}
      catch(e){list.replaceChildren(h(`<p class="msg">${esc(e.message)}</p>`))}
    };
    main.append(seg([['new','最新'],['pop','人気']],'new',load,'smode'),list);load('new');
  }
};
const notice=(t,p,btn)=>h(`<div class="empty"><h1>${t}</h1><p>${esc(p)}</p>${btn?`<button class="btn-play" data-act="setup">${btn}</button>`:''}</div>`);
async function render(view,arg,back){
  const my=++token;
  if(!back&&state.ready&&(view!==state.view||arg!==state.arg))state.stack=[...state.stack,[state.view,state.arg]].slice(-20);
  state.ready=1;state.view=view;state.arg=arg;markNav(view);closeSide();clearInterval(heroTimer);scrollTo(0,0);main.replaceChildren();
  if(!Store.get('key',''))return main.append(notice('APIキーを設定','YouTube Data API v3 のキーを登録すると、動画を表示できます。','設定を開く'));
  try{await VIEWS[view](my,arg)}catch(e){if(my===token)main.append(notice('読み込めませんでした',e.message,'APIキーを確認'))}
}

/* ---------- Navigation ---------- */
function markNav(v){
  $$('[data-view]').forEach(b=>b.dataset.view===v?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  mark($('#nav'));
}
const wide=()=>matchMedia('(min-width:900px)').matches;
function applyLayout(){document.body.dataset.layout=wide()&&Store.get('layout','tab')==='side'?'side':'tab';requestAnimationFrame(()=>markNav(state.view))}
const closeSide=()=>{$('#side').classList.remove('open');$('#scrim').classList.remove('on')};
const toggleSide=()=>{$('#side').classList.toggle('open');$('#scrim').classList.toggle('on')};
function layoutBtn(){if(!wide())return toggleSide();Store.set('layout',document.body.dataset.layout==='side'?'tab':'side');applyLayout()}
const goBack=()=>{const p=state.stack.pop();if(p)render(p[0],p[1],true)};
const share=async v=>{const u='https://youtu.be/'+v.id;try{navigator.share?await navigator.share({title:v.title,url:u}):await navigator.clipboard.writeText(u)}catch{}};
function sideCh(){const l=Store.get('fol',[]).slice(0,8);
  $('#sideCh').innerHTML=l.length?'<p class="lbl">フォロー中</p>'+l.map(c=>`<button data-ch="${c.id}"><img class="av" src="${c.avatar}" alt="">${esc(c.name)}</button>`).join(''):''}
function syncFollow(){$$('[data-act=follow]').forEach(b=>{const on=Fol.has(b.dataset.id);b.innerHTML=icon(on?'check':'plus')+(on?'フォロー中':'フォロー');b.classList.toggle('on',on)});sideCh()}
function detail(v){
  det.innerHTML=`<img class="dimg" src="${v.hi}" alt="" onerror="this.onerror=null;this.src='${v.thumb}'"><h2>${esc(v.title)}</h2>
  <p class="by">${v.cid?`<button data-ch="${v.cid}">${esc(v.channel)}</button>`:esc(v.channel)} · ${fmt(v.dur)}</p><p class="ds">${esc(v.desc)}</p>
  <div class="acts"><button class="btn-sub" data-act="share" data-id="${v.id}">共有</button><button class="btn-sub" data-act="queue" data-id="${v.id}">キュー</button>${addBtn(v)}<button class="btn-play" data-act="play" data-id="${v.id}">${icon('play')}再生</button></div>`;
  det.showModal();
}
const syncAdd=()=>$$('[data-act=add]').forEach(b=>b.innerHTML=icon(Lib.has(b.dataset.id)?'check':'plus'));

/* ---------- Player (IFrame API) ---------- */
const Player={
  el:$('#player'),p:null,v:null,tick:null,ready:null,recs:[],spd:1,loop:false,sleep:0,sleepT:null,auto:Store.get('auto',true),
  sdk(){return this.ready??=new Promise(r=>{if(window.YT?.Player)return r();window.onYouTubeIframeAPIReady=r;
    const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';document.head.append(s)})},
  get isMini(){return this.el.classList.contains('mini')},
  async open(v){
    this.save();this.v=v;this.recs=[];this.el.style.cssText='';this.el.classList.remove('mini');this.el.classList.add('on');
    document.body.classList.add('lock');$('.wp',this.el).scrollTop=0;
    this.info(v);this.session(v);
    const t=Math.floor(Store.get('hist',[]).find(x=>x.id===v.id)?.t||0),st=t>10?t-3:0;
    await this.sdk();if(this.v!==v)return;
    $('#ytp-wrap .fail')?.remove();
    if(this.p?.loadVideoById)this.p.loadVideoById({videoId:v.id,startSeconds:st});
    else{
      $('#ytp-wrap').innerHTML='<div id="ytp"></div>';
      this.p=new YT.Player('ytp',{videoId:v.id,playerVars:{autoplay:1,playsinline:1,rel:0,fs:1,start:st,origin:location.origin},
        events:{onReady:e=>{e.target.setPlaybackRate(this.spd);e.target.playVideo()},onStateChange:e=>this.state(e.data),onError:()=>this.fail()}});
    }
    clearInterval(this.tick);this.tick=setInterval(()=>this.save(),4000);
    this.recsFor(v);this.comments(v);
  },
  state(s){
    $('.mbar [data-act=pp]').innerHTML=icon(s===1?'pause':'play');
    if(s!==0)return;
    if(this.loop){this.p.seekTo(0);this.p.playVideo()}
    else if(this.auto){const n=this.nextUp();if(n)this.open(n)}
  },
  fail(){$('#ytp-wrap').append(h(`<div class="fail"><p>この動画はアプリ内で再生できません。</p><a class="btn-play" href="https://youtu.be/${this.v.id}" target="_blank" rel="noopener">YouTubeで開く</a></div>`))},
  info(v){
    const date=v.pub?new Date(v.pub).toLocaleDateString('ja-JP'):'';
    $('.winfo',this.el).innerHTML=`<h2>${esc(v.title)}</h2>
      <p class="wstat">${[v.views?fmtN(v.views)+'回視聴':'',date,fmt(v.dur)].filter(Boolean).join(' · ')}</p>
      <div class="wch"><img id="wav" alt=""><div class="nm"><b>${v.cid?`<button data-ch="${v.cid}">${esc(v.channel)}</button>`:esc(v.channel)}</b><span id="wsub"></span></div>
        ${v.cid?`<button class="btn-play" data-act="follow" data-id="${v.cid}" hidden></button>`:''}</div>
      <div class="wact"></div><div class="wdesc" data-act="desc">${esc(v.desc||'説明はありません')}</div>
      <div class="wcm" hidden><h3>コメント</h3><div id="wcl"></div></div>`;
    this.acts();
    if(v.cid)API.chInfo(v.cid).then(r=>{const c=r[0];if(!c||this.v!==v)return;CH.set(c.id,c);
      $('#wav').src=c.avatar;$('#wsub').textContent=c.subs!=null?'登録者 '+fmtN(c.subs)+'人':'';$('.wch .btn-play').hidden=false;syncFollow()}).catch(()=>{});
  },
  acts(){
    const v=this.v,box=$('.wact',this.el);if(!v||!box)return;const wl=Lib.has(v.id);
    box.innerHTML=`<button class="glass${wl?' on':''}" data-act="wladd" data-id="${v.id}">${icon(wl?'check':'plus')}ウォッチリスト</button>
      <button class="glass" data-act="share" data-id="${v.id}">共有</button>
      <button class="glass" data-act="queue" data-id="${v.id}">${icon('queue')}キューに追加</button>
      <button class="glass" data-act="full">${icon('full')}全画面</button>
      <button class="glass" data-act="mini">${icon('pip')}ミニ再生</button>
      <button class="glass${this.spd!==1?' on':''}" data-act="rate">速度 ${this.spd}x</button>
      <button class="glass${this.loop?' on':''}" data-act="loop">${icon('repeat')}ループ</button>
      <button class="glass${this.auto?' on':''}" data-act="auto">自動再生</button>
      <button class="glass${this.sleep?' on':''}" data-act="sleep">${icon('moon')}${this.sleep?this.sleep+'分後に停止':'スリープタイマー'}</button>`;
  },
  async recsFor(v){
    const box=$('.wrec',this.el);const q=Store.get('queue',[]);
    box.innerHTML=(q.length?'<h3>キュー</h3><div class="qd"></div>':'')+'<h3>おすすめ</h3><div class="rd"></div>';
    if(q.length)$('.qd',box).append(...q.map(x=>{const c=card(reg(x),0);c.classList.add('rl');return c}));
    const [a,b]=await Promise.all([v.cid?API.uploads('UU'+v.cid.slice(2),10).catch(()=>[]):[],API.trending(v.cat&&v.cat!=='0'?v.cat:null,20).catch(()=>[])]);
    if(this.v!==v)return;
    const seen=new Set([v.id]),list=[];
    for(let i=0;i<Math.max(a.length,b.length);i++)for(const x of [a[i],b[i]])if(x&&!seen.has(x.id)){seen.add(x.id);list.push(x)}
    this.recs=list;
    $('.rd',box).append(...list.map(x=>{const c=card(reg(x),0);c.classList.add('rl');return c}));
  },
  async comments(v){
    try{
      const j=await API.call('commentThreads',{part:'snippet',videoId:v.id,maxResults:20,order:'relevance',textFormat:'plainText'});
      if(this.v!==v||!j.items.length)return;
      $('.wcm',this.el).hidden=false;
      $('#wcl').innerHTML=j.items.map(i=>{const s=i.snippet.topLevelComment.snippet;
        return `<div class="cm"><img src="${esc(s.authorProfileImageUrl)}" alt=""><div><b>${esc(s.authorDisplayName)}</b><p>${esc(s.textDisplay)}</p></div></div>`}).join('');
    }catch{}
  },
  session(v){
    const m=navigator.mediaSession;if(!m)return;
    m.metadata=new MediaMetadata({title:v.title,artist:v.channel,artwork:[{src:v.thumb,sizes:'480x360'}]});
    m.setActionHandler('play',()=>this.p?.playVideo());m.setActionHandler('pause',()=>this.p?.pauseVideo());
    m.setActionHandler('nexttrack',()=>{const n=this.nextUp();if(n)this.open(n)});
  },
  nextUp(){const q=Store.get('queue',[]);if(q.length){Store.set('queue',q.slice(1));return q[0]}return this.recs[0]},
  flip(fn){
    const el=this.el,a=el.getBoundingClientRect();fn();const b=el.getBoundingClientRect();
    el.animate([{transformOrigin:'0 0',transform:`translate(${a.left-b.left}px,${a.top-b.top}px) scale(${a.width/b.width},${a.height/b.height})`},
      {transformOrigin:'0 0',transform:'none'}],{duration:560,easing:'cubic-bezier(.3,1.3,.5,1)'});
  },
  mini(){this.flip(()=>{this.el.style.translate='';this.el.style.opacity='';this.el.classList.add('mini');document.body.classList.remove('lock')})},
  expand(){this.flip(()=>{this.el.style.cssText='';this.el.classList.remove('mini');document.body.classList.add('lock')})},
  toggle(){this.p?.getPlayerState?.()===1?this.p.pauseVideo():this.p?.playVideo()},
  full(){const w=$('#ytp-wrap'),f=w.requestFullscreen||w.webkitRequestFullscreen;if(f)f.call(w);else $('iframe',w)?.webkitEnterFullscreen?.()},
  nextRate(){const R=[1,1.25,1.5,2,.5,.75];this.spd=R[(R.indexOf(this.spd)+1)%R.length];this.p?.setPlaybackRate(this.spd);this.acts()},
  nextSleep(){const S=[0,15,30,60];this.sleep=S[(S.indexOf(this.sleep)+1)%S.length];clearTimeout(this.sleepT);
    if(this.sleep)this.sleepT=setTimeout(()=>{this.p?.pauseVideo();this.sleep=0;this.acts()},this.sleep*60000);this.acts()},
  save(){
    const p=this.p;if(!p?.getCurrentTime||!this.v)return;
    const t=p.getCurrentTime(),d=p.getDuration();if(!(d>0)||t<3)return;
    const{id,title,channel,cid,cat,thumb,hi,dur}=this.v;
    Store.set('hist',[{id,title,channel,cid,cat,thumb,hi,dur,t,d,at:Date.now()},...Store.get('hist',[]).filter(x=>x.id!==id)].slice(0,30));
  },
  close(){
    const full=!this.isMini;this.save();clearInterval(this.tick);clearTimeout(this.sleepT);this.sleep=0;
    try{this.p?.destroy()}catch{}
    this.p=this.v=null;this.el.style.cssText='';this.el.classList.remove('on','mini');document.body.classList.remove('lock');
    if(document.fullscreenElement)document.exitFullscreen?.();
    if(navigator.mediaSession)navigator.mediaSession.metadata=null;
    if(full&&(state.view==='home'||state.view==='lib'))render(state.view,state.arg);
  }
};
/* ミニプレーヤーのドラッグ移動 */
(()=>{const g=$('.mbar .grab'),el=Player.el;let d=null;
  g.addEventListener('pointerdown',e=>{const r=el.getBoundingClientRect();d={x:e.clientX-r.left,y:e.clientY-r.top};g.setPointerCapture(e.pointerId)});
  g.addEventListener('pointermove',e=>{if(!d)return;el.style.inset='auto';
    el.style.left=Math.min(Math.max(0,e.clientX-d.x),innerWidth-el.offsetWidth)+'px';el.style.top=Math.min(Math.max(0,e.clientY-d.y),innerHeight-el.offsetHeight)+'px'});
  ['pointerup','pointercancel'].forEach(t=>g.addEventListener(t,()=>d=null))})();
/* 視聴ページを下へスワイプしてミニ化 */
(()=>{const wp=$('.wp',Player.el),el=Player.el;let y0=null,dy=0;
  wp.addEventListener('touchstart',e=>{y0=wp.scrollTop<=0&&!Player.isMini?e.touches[0].clientY:null;dy=0},{passive:true});
  wp.addEventListener('touchmove',e=>{if(y0==null)return;dy=e.touches[0].clientY-y0;
    if(dy>0){el.style.translate='0 '+dy*.6+'px';el.style.opacity=1-Math.min(dy/700,.5)}else y0=null},{passive:true});
  wp.addEventListener('touchend',()=>{if(y0==null)return;y0=null;
    if(dy>130)return Player.mini();
    el.style.transition='translate .5s cubic-bezier(.3,1.4,.5,1),opacity .3s';el.style.translate='';el.style.opacity='';setTimeout(()=>el.style.transition='',520)})})();

/* ---------- Events ---------- */
const dlg=$('#setup'),det=$('#detail');
const slim=v=>({id:v.id,title:v.title,channel:v.channel,cid:v.cid,cat:v.cat,thumb:v.thumb,hi:v.hi,dur:v.dur});
function toast(t){const e=h(`<div class="toast glass">${esc(t)}</div>`);document.body.append(e);setTimeout(()=>e.classList.add('out'),1700);setTimeout(()=>e.remove(),2200)}
document.addEventListener('click',e=>{
  const a=e.target.closest('[data-act],[data-view],[data-ch],.card');if(!a)return;
  if(det.open&&(a.dataset.ch||a.dataset.act==='play'))det.close();
  if(a.dataset.view)return render(a.dataset.view);
  if(a.dataset.ch){if(Player.v&&!Player.isMini)Player.mini();return render('channel',a.dataset.ch)}
  if(a.matches('.card'))return Player.open(VID.get(a.dataset.id));
  const v=VID.get(a.dataset.id);
  ({side:toggleSide,layout:layoutBtn,back:goBack,close:()=>Player.close(),play:()=>Player.open(v),info:()=>detail(v),share:()=>share(v),
    add:()=>{Lib.toggle(v);syncAdd();toast(Lib.has(v.id)?'ウォッチリストに追加しました':'ウォッチリストから削除しました')},
    follow:()=>{const c=CH.get(a.dataset.id);if(c){Fol.toggle(c);syncFollow()}},
    clear:()=>{Store.set('hist',[]);toast('視聴履歴を消去しました')},
    queue:()=>{Store.set('queue',[...Store.get('queue',[]).filter(x=>x.id!==v.id),slim(v)]);toast('キューに追加しました');if(Player.v)Player.recsFor(Player.v)},
    mini:()=>Player.mini(),expand:()=>Player.expand(),pp:()=>Player.toggle(),full:()=>Player.full(),rate:()=>Player.nextRate(),sleep:()=>Player.nextSleep(),
    loop:()=>{Player.loop=!Player.loop;Player.acts()},auto:()=>{Player.auto=!Player.auto;Store.set('auto',Player.auto);Player.acts()},
    wladd:()=>{Lib.toggle(v);Player.acts();syncAdd();toast(Lib.has(v.id)?'ウォッチリストに追加しました':'ウォッチリストから削除しました')},desc:()=>a.classList.toggle('open'),
    setup:()=>{$('#key').value=Store.get('key','');$('#region').value=region();$('#accent').value=Store.get('accent','#41a0ff');closeSide();dlg.showModal()}})[a.dataset.act]?.();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&Player.v&&!Player.isMini)Player.mini();
  if(e.key==='Enter'&&e.target.matches('.card'))Player.open(VID.get(e.target.dataset.id));
});
dlg.addEventListener('close',()=>{
  if(dlg.returnValue==='ok'){Store.set('key',$('#key').value.trim());Store.set('region',$('#region').value);Store.set('accent',$('#accent').value);document.documentElement.style.setProperty('--accent',$('#accent').value);API.cache.clear();render(state.view,state.arg)}
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

/* ---------- Liquid Glass レンズ: 選択中タブを長押し→ドラッグで移動 ---------- */
const Lens=(()=>{
  let S=null,raf=0,block=false;
  const cx=b=>b.offsetLeft+b.offsetWidth/2;
  const tabsOf=bar=>$$('button[data-view],button[data-k]',bar).filter(b=>b.offsetParent);
  const paint=()=>{const w=S.base+Math.min(Math.abs(S.v)*.05,28);   // 速いほど横に伸びる
    S.lens.style.setProperty('--lw',w+'px');S.lens.style.setProperty('--lx',(S.x-w/2)+'px')};
  function activate(){
    const{bar,btn}=S,r=bar.getBoundingClientRect(),tabs=tabsOf(bar);
    Object.assign(S,{on:true,tabs,min:cx(tabs[0]),max:cx(tabs[tabs.length-1]),base:Math.max(btn.offsetWidth+30,88),x:cx(btn),v:0});
    S.target=S.x;S.off=S.x-(S.sx-r.left+bar.scrollLeft);
    const html=[...bar.children].filter(c=>c.tagName==='BUTTON').map(b=>b.outerHTML).join('');
    const lens=h(`<div class="lens" aria-hidden="true">${['a','b'].map(k=>`<div class="lw ${k}"><div class="lc">${html}</div></div>`).join('')}</div>`);
    lens.style.setProperty('--bw',bar.scrollWidth+'px');lens.style.setProperty('--bh',bar.clientHeight+'px');
    S.lens=lens;bar.append(lens);paint();
    requestAnimationFrame(()=>bar.classList.add('lens-on'));
    bar.setPointerCapture?.(S.id);navigator.vibrate?.(6);
    S.last=performance.now();raf=requestAnimationFrame(loop);
  }
  function loop(t){
    const dt=Math.min((t-S.last)/1000,1/30);S.last=t;
    const a=300*(S.target-S.x)-17*S.v;           // 減衰不足のバネ（弾む）
    S.v+=a*dt;S.x+=S.v*dt;paint();
    if(S.released&&Math.abs(S.target-S.x)<.4&&Math.abs(S.v)<8)return end();
    raf=requestAnimationFrame(loop);
  }
  function end(){
    const{bar,lens,x,base}=S;S=null;const i=$('.ind',bar);
    i.style.transition='none';i.style.left=(x-base/2)+'px';i.style.width=base+'px';i.offsetWidth;i.style.transition='';
    bar.classList.remove('lens-on');
    requestAnimationFrame(()=>{mark(bar);i.classList.remove('jelly');i.classList.add('settle');setTimeout(()=>i.classList.remove('settle'),700)});
    setTimeout(()=>lens.remove(),520);
  }
  document.addEventListener('pointerdown',e=>{
    const b=e.target.closest?.('.nav button[aria-current],.seg button[aria-current]');
    if(!b||S||!e.isPrimary)return;
    S={bar:b.closest('.nav,.seg'),btn:b,id:e.pointerId,sx:e.clientX,sy:e.clientY,on:false,timer:setTimeout(activate,260)};
  });
  document.addEventListener('pointermove',e=>{
    if(!S||e.pointerId!==S.id)return;
    if(!S.on){if(Math.hypot(e.clientX-S.sx,e.clientY-S.sy)>8){clearTimeout(S.timer);S=null}return}
    const r=S.bar.getBoundingClientRect();
    S.target=Math.min(Math.max(e.clientX-r.left+S.bar.scrollLeft+S.off,S.min),S.max);
  });
  const up=e=>{
    if(!S||e.pointerId!==S.id)return;
    clearTimeout(S.timer);if(!S.on){S=null;return}
    const t=S.tabs.reduce((a,b)=>Math.abs(cx(b)-S.target)<Math.abs(cx(a)-S.target)?b:a);
    S.target=cx(t);S.released=true;block=true;
    setTimeout(()=>{block=false;if(t!==S?.btn&&!t.matches('[aria-current]'))t.click()},0);
  };
  ['pointerup','pointercancel'].forEach(t=>document.addEventListener(t,up));
  document.addEventListener('click',e=>{if(block){e.stopPropagation();e.preventDefault()}},true);
  document.addEventListener('touchmove',e=>{if(S?.on)e.preventDefault()},{passive:false});
  document.addEventListener('contextmenu',e=>{if(e.target.closest?.('.nav,.seg'))e.preventDefault()});
})();
matchMedia('(min-width:900px)').addEventListener('change',applyLayout);
document.documentElement.style.setProperty('--accent',Store.get('accent','#41a0ff'));
applyLayout();sideCh();render('home');
if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
