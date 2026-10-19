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
const lang=()=>({JP:'ja',US:'en',KR:'ko',GB:'en',TW:'zh-Hant'}[region()]||'en');
const hash=s=>{let h=5381;for(const c of s)h=(h*33^c.charCodeAt(0))>>>0;return h.toString(36)};
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
    /* 検索・人気チャートは端末に数時間キャッシュ（APIの割り当てを節約） */
    const ttl=ep==='search'?6*36e5:(ep==='videos'&&params.chart)?2*36e5:0,pk=ttl&&'pc.'+hash(ep+JSON.stringify(params));
    if(ttl){const c=Store.get(pk,null);if(c&&Date.now()-c.t<ttl){this.cache.set(ck,c.v);return c.v}}
    const r=await fetch(u),j=await r.json();
    if(!r.ok)throw new Error(j.error?.message||r.status);
    this.cache.set(ck,j);if(ttl)this.persist(pk,j);return j;
  },
  persist(pk,j){
    try{
      const v=JSON.parse(JSON.stringify(j));
      (v.items||[]).forEach(i=>{if(i.snippet){i.snippet.description=(i.snippet.description||'').slice(0,600);delete i.snippet.localized;delete i.snippet.tags}});
      Store.set(pk,{t:Date.now(),v});this.prune();
    }catch{this.prune(true)}
  },
  prune(force){
    const ks=Object.keys(localStorage).filter(k=>k.startsWith('atv.pc.')),lim=force?8:40;
    if(ks.length>lim)ks.map(k=>{let t=0;try{t=JSON.parse(localStorage[k]).t}catch{}return[k,t]}).sort((a,b)=>a[1]-b[1]).slice(0,ks.length-Math.floor(lim*.7)).forEach(([k])=>localStorage.removeItem(k));
  },
  async videos(p,all){const L=(await this.call('videos',{part:'snippet,contentDetails,statistics',regionCode:region(),...p})).items.map(norm),b=new Set(Store.get('blk',[]).map(c=>c.id));return all||!b.size?L:L.filter(v=>!b.has(v.cid))},
  trending(cat,n=30){return this.videos({chart:'mostPopular',maxResults:n,...(cat?{videoCategoryId:cat}:{})})},
  async vsearch(p){
    const s=await this.call('search',{part:'snippet',type:'video',maxResults:24,regionCode:region(),relevanceLanguage:lang(),safeSearch:'moderate',...p});
    return this.videos({id:s.items.map(i=>i.id.videoId).join(',')},!!p.channelId);
  },
  search(q){return this.vsearch({q})},
  async chInfo(ids){return(await this.call('channels',{part:'snippet,statistics,contentDetails,brandingSettings',id:ids,maxResults:50})).items.map(nch)},
  async channels(q){const s=await this.call('search',{part:'snippet',type:'channel',maxResults:20,relevanceLanguage:lang(),q});return this.chInfo(s.items.map(i=>i.id.channelId).join(','))},
  async feed(chs){
    const pls=await Promise.all(chs.map(c=>this.call('playlistItems',{part:'contentDetails',playlistId:'UU'+c.id.slice(2),maxResults:4})
      .then(j=>j.items.map(i=>({id:i.contentDetails.videoId,at:i.contentDetails.videoPublishedAt||''}))).catch(()=>[])));
    const items=pls.flat().sort((a,b)=>b.at.localeCompare(a.at)).slice(0,48);
    if(!items.length)return[];
    const m=new Map((await this.videos({id:items.map(i=>i.id).join(','),maxResults:50})).map(v=>[v.id,v]));
    return items.map(i=>m.get(i.id)).filter(Boolean);
  },
  async uploads(pl,n){const j=await this.call('playlistItems',{part:'contentDetails',playlistId:pl,maxResults:n});return this.videos({id:j.items.map(i=>i.contentDetails.videoId).join(',')},true)}
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
  const mute=h(`<button class="mutebtn glass" aria-label="ミュート切替" hidden>${icon('mute')}</button>`);el.append(mute);
  let pv=null,pvT=0,muted=true,pvMsg=null;
  const unpv=()=>{clearTimeout(pvT);if(pvMsg)removeEventListener('message',pvMsg);pvMsg=null;pv?.remove();pv=null;mute.hidden=true};
  mute.addEventListener('click',()=>{muted=!muted;$('iframe',pv)?.contentWindow.postMessage(JSON.stringify({event:'command',func:muted?'mute':'unMute',args:[]}),'*');mute.innerHTML=icon(muted?'mute':'sound')});
  const preview=()=>{   // ヒーローの無音プレビュー再生（Apple TVアプリ風）
    unpv();if(!Store.get('pv',true)||document.hidden)return;
    pvT=setTimeout(()=>{
      const slide=$$('.slide',el)[i],v=list[i];if(!slide||!v||(Player.v&&!Player.isMini))return;
      const r=el.getBoundingClientRect(),w=Math.max(r.width,r.height*16/9)*1.15,hh=w*9/16;
      pv=h(`<div class="pvw"><iframe src="https://www.youtube.com/embed/${v.id}?autoplay=1&mute=1&controls=0&playsinline=1&loop=1&playlist=${v.id}&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}" allow="autoplay;encrypted-media" tabindex="-1" style="width:${w}px;height:${hh}px"></iframe></div>`);
      const f=$('iframe',pv),mine=pv;   // 再生が始まったときだけ表示（埋め込み不可の動画のエラー画面を出さない）
      pvMsg=e=>{if(e.source!==f.contentWindow)return;let d=e.data;try{d=typeof d==='string'?JSON.parse(d):d}catch{return}
        if((d.event==='onStateChange'&&d.info===1)||(d.event==='infoDelivery'&&d.info?.playerState===1)){mine.classList.add('on');removeEventListener('message',pvMsg)}};
      addEventListener('message',pvMsg);
      f.addEventListener('load',()=>f.contentWindow.postMessage(JSON.stringify({event:'listening',id:1,channel:'widget'}),'*'));
      setTimeout(()=>{if(pv===mine&&!mine.classList.contains('on'))unpv()},9000);
      $('img',slide).after(pv);muted=true;mute.innerHTML=icon('mute');mute.hidden=false;
    },1500);
  };
  const set=n=>{i=(n+list.length)%list.length;$$('.slide',el).forEach((s,k)=>s.classList.toggle('on',k===i));$$('i',dots).forEach((d,k)=>d.classList.toggle('on',k===i));preview()};
  set(0);clearInterval(heroTimer);heroTimer=setInterval(()=>set(i+1),Store.get('pv',true)?11000:7000);
  dots.addEventListener('click',e=>{const d=e.target.closest('[data-dot]');if(d){set(+d.dataset.dot);clearInterval(heroTimer)}});
  let sx=null;el.addEventListener('pointerdown',e=>{sx=e.clientX});
  el.addEventListener('pointerup',e=>{if(sx==null)return;const d=e.clientX-sx;sx=null;if(Math.abs(d)>50){set(i+(d<0?1:-1));clearInterval(heroTimer)}});
  const px=()=>{if(!el.isConnected)return removeEventListener('scroll',px);const y=Math.min(scrollY,700);el.style.setProperty('--py',y*.32+'px');el.style.setProperty('--ho',Math.max(0,1-y/520))};
  addEventListener('scroll',px,{passive:true});
  return el;
}
function card(v,i,o={}){
  const p=o.progress&&v.d?Math.min(1,v.t/v.d):0;
  return h(`<article class="card" tabindex="0" data-id="${v.id}" style="--i:${Math.min(i,10)}"><div class="thumb"><img loading="lazy" alt="" src="${v.thumb}" onload="this.classList.add('in')"><button class="more glass" data-act="menu" data-id="${v.id}" aria-label="メニュー">${icon('more')}</button>
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
/* ---------- 日本語コンテンツの優先 / 視聴傾向にもとづくおすすめ（すべて端末内で計算） ---------- */
const KW=/[ァ-ヶー]{3,}|[一-龠々]{2,}|[A-Za-z0-9]{3,}/g;
const isJa=v=>/[\u3040-\u30ff]/.test((v.title||'')+(v.channel||''));
const Taste={
  p:null,pt:-1,
  profile(){
    const hist=Store.get('hist',[]),wl=Store.get('wl',[]),fol=Store.get('fol',[]),q=Store.get('queue',[]),rec=Store.get('recent',[]);
    const cat={},ch={},kw={},up=(o,k,w)=>{o[k]=(o[k]||0)+w};
    const add=(v,w)=>{if(v.cat)up(cat,v.cat,w);if(v.cid)up(ch,v.cid,w);(v.title||'').match(KW)?.forEach(k=>up(kw,k.toLowerCase(),w))};
    hist.forEach(v=>add(v,1+(v.d?Math.min(1,v.t/v.d):0)*2));          // 最後まで観たものほど重い
    wl.forEach(v=>add(v,3));q.forEach(v=>add(v,2));fol.forEach(c=>up(ch,c.id,5));
    rec.forEach(s=>s.match(KW)?.forEach(k=>up(kw,k.toLowerCase(),2)));
    return{cat,ch,kw,n:hist.length+wl.length+fol.length+q.length};
  },
  get(){return this.pt===token&&this.p?this.p:(this.pt=token,this.p=this.profile())},
  top(o,n){return Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,n)},
  score(v,p){
    let s=(p.cat[v.cat]||0)*.6+(p.ch[v.cid]||0)*1.2;
    (v.title||'').match(KW)?.forEach(k=>s+=(p.kw[k.toLowerCase()]||0)*.5);
    return s;
  },
  rows(list){const p=this.get();return Store.get('pers',true)?list.slice().sort((a,b)=>(p.cat[b[1]]||0)-(p.cat[a[1]]||0)):list},
  async recommend(){
    if(!Store.get('pers',true))return null;
    const p=this.profile();if(p.n<2)return null;
    const chs=this.top(p.ch,6).map(([id])=>({id})),cats=this.top(p.cat,2).map(([c])=>c),kws=this.top(p.kw,3).map(([k])=>k);
    const[feed,...cv]=await Promise.all([API.feed(chs).catch(()=>[]),...cats.map(c=>API.trending(c,30).catch(()=>[]))]);
    const kv=kws.length&&Store.get('rks',true)?await API.vsearch({q:kws.join(' ')}).catch(()=>[]):[];
    const seen=new Set(Store.get('hist',[]).filter(x=>x.d&&x.t>x.d*.85).map(x=>x.id)),pool=new Map();
    [...feed,...cv.flat(),...kv].forEach(v=>{if(!seen.has(v.id))pool.set(v.id,v)});
    const ja=Store.get('ja',true);
    const list=[...pool.values()].map(v=>[v,this.score(v,p)+(ja&&isJa(v)?3:0)+Math.random()*.6]).sort((a,b)=>b[1]-a[1]).slice(0,24).map(x=>x[0]);
    const names=cats.map(c=>CATS.find(x=>x[0]===c)?.[1]).filter(Boolean).concat(kws.slice(0,2));
    return{list,why:names.length?`「${names.join('・')}」などの視聴傾向にもとづいています`:''};
  }
};
function arr(items){
  const pers=Store.get('pers',true),ja=Store.get('ja',true);
  if(!pers&&!ja)return items;
  const P=Taste.get();
  return items.map((v,i)=>[v,(pers?Taste.score(v,P):0)+(ja&&isJa(v)?3:0)-i*.04]).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
}
const head=t=>h(`<div class="head"><h1>${esc(t)}</h1></div>`);
const continueList=()=>Store.get('hist',[]).filter(x=>x.d&&x.t>5&&x.t<x.d*.95);

/* ---------- Views ---------- */
const main=$('#main'),state={view:'home',cat:'all',stack:[]};let token=0,sub=0;
const TITLES={home:'ホーム',hot:'話題',live:'ライブ',subs:'登録',lib:'ライブラリ',search:'検索'};
function setTitle(v,arg){$('#ptitle').textContent=(v==='lib'&&arg)||v==='channel'?'':(TITLES[v]||'');document.body.dataset.view=v}
const CATS=[['all','すべて'],['live','ライブ'],['10','ミュージック'],['20','ゲーム'],['24','エンタメ'],['17','スポーツ'],['23','コメディ'],['25','ニュース'],['28','サイエンス']];
const ROWS=[['ミュージック',10],['ゲーム',20],['エンタメ',24],['スポーツ',17],['ニュース',25],['アニメ・映画',1],['人物・ブログ',22],['コメディ',23],['教育',27],['ハウツー・スタイル',26],['ペット',15],['旅行',19],['サイエンス・テクノロジー',28],['自動車',2]];
const VIEWS={
  async home(my){
    const body=h('<div class="catbody"></div>');
    const fill=async()=>{
      const c=state.cat,t=++sub;clearInterval(heroTimer);body.replaceChildren();
      try{
        const hot=c==='live'?await API.vsearch({eventType:'live',order:'viewCount'}):await API.trending(c==='all'?null:c,24);if(my!==token||t!==sub)return;
        const hs=arr(hot);hot.forEach(reg);body.append(hero(hs.slice(0,6)));
        const rows=h('<div class="rows"></div>');body.append(rows);
        if(c==='all'){
          const hist=continueList(),wl=Store.get('wl',[]),fol=Store.get('fol',[]);
          if(hist.length)rows.append(row('続きを観る',hist,{progress:1}));
          const rslot=h('<div></div>');rows.append(rslot);
          Taste.recommend().then(r=>{if(!r||!r.list.length||my!==token||t!==sub)return;const rr=row('あなたへのおすすめ',r.list);
            if(r.why)$('h2',rr).after(h(`<p class="rsub">${esc(r.why)}</p>`));rslot.append(rr)}).catch(()=>{});
          if(wl.length)rows.append(row('次に観る',wl));
          if(fol.length)rows.append(chRow('フォロー中のチャンネル',fol));
        }
        rows.append(row(c==='all'?'トップ10：話題':'トップ10：'+CATS.find(x=>x[0]===c)[1],hot.slice(0,10),{rank:1}),row('話題の動画',hs.slice(6)));
        if(c==='all')Taste.rows(ROWS).forEach(([n,k])=>{const slot=h('<div></div>');rows.append(slot);
          API.trending(k).then(v=>{if(my===token&&t===sub)slot.append(row(n,arr(v)))}).catch(()=>{})});
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
  async hot(my){const v=await API.trending(null,50);if(my!==token)return;main.append(head('話題の動画'),grid(arr(v),{}))},
  async lib(my,arg){
    const wl=Store.get('wl',[]),hist=Store.get('hist',[]),fol=Store.get('fol',[]),q=Store.get('queue',[]);
    const data={wl:['ウォッチリスト',wl,'bookmark'],hist:['視聴履歴',hist,'clock'],fol:['フォロー中のチャンネル',fol,'people'],queue:['キュー',q,'queue']};
    if(arg&&data[arg]){
      const[t,l]=data[arg];
      main.append(h(`<div class="shd"><button class="back glass" data-act="back" aria-label="戻る">${icon('chev')}</button><h1>${t}</h1></div>`));
      if(!l.length)return main.append(h('<p class="msg">まだ何もありません。</p>'));
      if(arg==='fol'){const g=h('<div class="grid chg"></div>');l.forEach(c=>CH.set(c.id,c));g.append(...l.map(chCard));return main.append(g)}
      return main.append(grid(l,arg==='hist'?{progress:1}:{}));
    }
    if(phone()){   // iPhone: アイコン付きのリスト + シェブロン
      return main.append(h(`<div class="plist">${Object.entries(data).map(([k,[t,l,ic]])=>`<button class="pl" data-lib="${k}">${icon(ic)}<span>${t}</span><em>${l.length||''}</em>${chv}</button>`).join('')}</div>`));
    }
    main.append(head('ライブラリ'));
    if(!wl.length&&!hist.length&&!fol.length)return main.append(h('<p class="msg">フォローしたチャンネル、ウォッチリスト、視聴履歴がここに表示されます。</p>'));
    const body=h('<div class="rows"></div>');main.append(body);
    if(fol.length)body.append(chRow('フォロー中のチャンネル',fol));
    if(wl.length)body.append(row('次に観る',wl));
    if(hist.length)body.append(row('視聴履歴',hist,{progress:1}));
  },
  async search(){
    main.append(head('検索'));
    let mode='v';
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    const f=h(`<form class="sbar glass">${icon('search')}<input type="search" placeholder="動画・チャンネルを検索" enterkeyhint="search">${SR?`<button type="button" class="mic" aria-label="音声検索">${icon('mic')}</button>`:''}</form>`),
      res=h('<div></div>'),inp=$('input',f),rec=h('<div class="chips"></div>'),tiles=h('<div class="tiles"></div>');
    const drawRec=()=>{rec.innerHTML=Store.get('recent',[]).map(q=>`<button data-q="${esc(q)}">${esc(q)}</button>`).join('')};
    const run=async()=>{
      const q=inp.value.trim();if(!q)return;
      tiles.hidden=true;
      Store.set('recent',[q,...Store.get('recent',[]).filter(x=>x!==q)].slice(0,8));drawRec();
      res.replaceChildren(h('<p class="msg">検索中…</p>'));
      try{
        const m=q.match(/(?:youtu\.be\/|[?&]v=|shorts\/)([\w-]{11})/);
        if(m){const[v]=await API.videos({id:m[1]},true);res.replaceChildren();if(v){reg(v);Player.open(v)}return}
        if(mode==='v')res.replaceChildren(grid(await API.search(q),{}));
        else{const cs=await API.channels(q),g=h('<div class="grid chg"></div>');cs.forEach(c=>CH.set(c.id,c));g.append(...cs.map(chCard));res.replaceChildren(g)}
      }catch(err){res.replaceChildren(h(`<p class="msg">${esc(err.message)}</p>`))}
    };
    /* カテゴリタイル（iPhoneのApple TVアプリの検索画面風） */
    const CT=[['10','ミュージック','#ff5f6d','#ffc371'],['20','ゲーム','#5b7cfa','#8be9fd'],['24','エンタメ','#c471ed','#f64f59'],['17','スポーツ','#11998e','#38ef7d'],
      ['23','コメディ','#f7971e','#ffd200'],['25','ニュース','#314755','#26a0da'],['28','サイエンス','#4e54c8','#8f94fb'],['live','ライブ','#cb2d3e','#ef473a'],
      ['1','映画・アニメ','#7b4397','#dc2430'],['2','自動車','#434343','#9a9a9a'],['15','ペット','#f2994a','#f2c94c'],['19','旅行','#00b4db','#0083b0'],
      ['26','ハウツー','#56ab2f','#a8e063'],['27','教育','#396afc','#2948ff'],['22','人物・ブログ','#ee0979','#ff6a00']];
    tiles.append(...CT.map(([id,t,a,b])=>{
      const el=h(`<button class="tile" type="button" style="--g:linear-gradient(160deg,${a},${b})"><b>${t}</b></button>`);
      el.addEventListener('click',async()=>{
        tiles.hidden=true;rec.hidden=true;res.replaceChildren(h('<p class="msg">読み込み中…</p>'));
        try{
          const v=id==='live'?await API.vsearch({eventType:'live',order:'viewCount'}):await API.trending(id,30);
          const back=h(`<button type="button" class="chips-b">‹ すべてのカテゴリ</button>`);
          back.onclick=()=>{res.replaceChildren();tiles.hidden=false;rec.hidden=false};
          res.replaceChildren(back,h(`<div class="head sub"><h1>${t}</h1></div>`),grid(v,{}));
        }catch(err){res.replaceChildren(h(`<p class="msg">${esc(err.message)}</p>`))}
      });
      return el;
    }));
    const tabs=seg([['v','動画'],['c','チャンネル']],'v',k=>{mode=k;if(inp.value.trim())run()},'smode');
    f.addEventListener('submit',e=>{e.preventDefault();run()});
    inp.addEventListener('input',()=>{if(!inp.value){res.replaceChildren();tiles.hidden=false;rec.hidden=false}});
    rec.addEventListener('click',e=>{const b=e.target.closest('[data-q]');if(b){inp.value=b.dataset.q;run()}});
    const mic=$('.mic',f);
    if(mic)mic.addEventListener('click',()=>{const r=new SR();r.lang='ja-JP';r.interimResults=false;mic.classList.add('on');
      r.onresult=e=>{inp.value=e.results[0][0].transcript;run()};r.onend=()=>mic.classList.remove('on');try{r.start()}catch{}});
    drawRec();main.append(f,tabs,rec,tiles,res);
    if(!phone())inp.focus();
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
const notice=(t,p,btn)=>h(`<div class="empty"><h1>${t}</h1><p>${esc(p)}</p>${btn?`<button class="btn-play" data-act="setup" data-page="key">${btn}</button>`:''}</div>`);
async function render(view,arg,back){
  const my=++token;
  if(!back&&state.ready&&(view!==state.view||arg!==state.arg))state.stack=[...state.stack,[state.view,state.arg]].slice(-20);
  state.ready=1;state.view=view;state.arg=arg;markNav(view);setTitle(view,arg);closeSide();clearInterval(heroTimer);scrollTo(0,0);main.replaceChildren();
  if(!Store.get('key',''))return main.append(notice('APIキーを設定','YouTube Data API v3 のキーを登録すると、動画を表示できます。','設定を開く'));
  try{await VIEWS[view](my,arg)}catch(e){if(my===token)main.append(notice('読み込めませんでした',e.message,'APIキーを確認'))}
}

/* ---------- Navigation ---------- */
function markNav(v){
  $$('[data-view]').forEach(b=>b.dataset.view===v?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  mark($('#nav'));
}
const wide=()=>matchMedia('(min-width:900px)').matches,phone=()=>matchMedia('(max-width:700px)').matches;
function applyLayout(){document.body.dataset.layout=wide()&&Store.get('layout','tab')==='side'?'side':'tab';requestAnimationFrame(()=>markNav(state.view))}
const closeSide=()=>{$('#side').classList.remove('open');$('#scrim').classList.remove('on')};
const toggleSide=()=>{$('#side').classList.toggle('open');$('#scrim').classList.toggle('on')};
function layoutBtn(){
  if(!wide())return toggleSide();
  const to=document.body.dataset.layout==='side'?'tab':'side';Store.set('layout',to);applyLayout();
  (to==='side'?$('#side'):$('#nav')).animate([to==='side'?{opacity:0,scale:.92,translate:'-30px 0'}:{opacity:0,scale:.85}],{duration:560,easing:'cubic-bezier(.3,1.3,.5,1)'});   // タブバー⇄サイドバーのモーフ風アニメーション
}
const goBack=()=>{const p=state.stack.pop();if(p)render(p[0],p[1],true)};
const share=async v=>{const u='https://youtu.be/'+v.id;try{navigator.share?await navigator.share({title:v.title,url:u}):await navigator.clipboard.writeText(u)}catch{}};
function sideCh(){renderSide()}
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
    this.save();$$('.pvw').forEach(e=>e.remove());this.v=v;this.recs=[];this.el.style.cssText='';this.el.classList.remove('mini');this.el.classList.add('on');
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
    const L=arr(list);this.recs=L;
    $('.rd',box).append(...L.map(x=>{const c=card(reg(x),0);c.classList.add('rl');return c}));
  },
  async comments(v){
    if(!Store.get('cm',true))return;
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
const det=$('#detail');
const slim=v=>({id:v.id,title:v.title,channel:v.channel,cid:v.cid,cat:v.cat,thumb:v.thumb,hi:v.hi,dur:v.dur});
function toast(t){const e=h(`<div class="toast glass">${esc(t)}</div>`);document.body.append(e);setTimeout(()=>e.classList.add('out'),1700);setTimeout(()=>e.remove(),2200)}
document.addEventListener('click',e=>{
  const a=e.target.closest('[data-act],[data-view],[data-ch],[data-lib],.card');if(!a)return;
  if(det.open&&(a.dataset.ch||a.dataset.act==='play'))det.close();
  if(a.dataset.view)return render(a.dataset.view);
  if(a.dataset.lib)return render('lib',a.dataset.lib);
  if(a.dataset.ch){if(Player.v&&!Player.isMini)Player.mini();return render('channel',a.dataset.ch)}
  if(a.matches('.card'))return Player.open(VID.get(a.dataset.id));
  const v=VID.get(a.dataset.id);
  ({side:toggleSide,layout:layoutBtn,back:goBack,close:()=>Player.close(),play:()=>Player.open(v),info:()=>detail(v),menu:()=>{const r=a.getBoundingClientRect();Menu.open(v,r.left+r.width/2,r.bottom)},share:()=>share(v),
    add:()=>{Lib.toggle(v);syncAdd();toast(Lib.has(v.id)?'ウォッチリストに追加しました':'ウォッチリストから削除しました')},
    follow:()=>{const c=CH.get(a.dataset.id);if(c){Fol.toggle(c);syncFollow()}},
    clear:()=>{Store.set('hist',[]);toast('視聴履歴を消去しました')},
    queue:()=>{Store.set('queue',[...Store.get('queue',[]).filter(x=>x.id!==v.id),slim(v)]);toast('キューに追加しました');if(Player.v)Player.recsFor(Player.v)},
    mini:()=>Player.mini(),expand:()=>Player.expand(),pp:()=>Player.toggle(),full:()=>Player.full(),rate:()=>Player.nextRate(),sleep:()=>Player.nextSleep(),
    loop:()=>{Player.loop=!Player.loop;Player.acts()},auto:()=>{Player.auto=!Player.auto;Store.set('auto',Player.auto);Player.acts()},
    wladd:()=>{Lib.toggle(v);Player.acts();syncAdd();toast(Lib.has(v.id)?'ウォッチリストに追加しました':'ウォッチリストから削除しました')},desc:()=>a.classList.toggle('open'),
    setup:()=>{closeSide();Settings.open(a.dataset.page)}})[a.dataset.act]?.();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&Menu.el)return Menu.close();
  if(e.key==='Escape'&&Settings.on)return Settings.pop();
  if(e.key==='Escape'&&Player.v&&!Player.isMini)Player.mini();
  if(e.key==='Enter'&&e.target.matches('.card'))Player.open(VID.get(e.target.dataset.id));
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

/* ---------- Liquid Glass：Snellの法則による屈折 + SVG変位マップ（kube.io の手法） ---------- */
const NS='http://www.w3.org/2000/svg',XL='http://www.w3.org/1999/xlink';
const LG={
  enabled:Store.get('lg','1')==='1',n:0,panels:[],defs:null,strength:Store.get('lgstr',1),
  chromium:!!navigator.userAgentData?.brands?.some(b=>/Chromium/.test(b.brand)),   // backdrop-filter:url() が使えるのはChromiumのみ
  el(tag,a={}){const e=document.createElementNS(NS,tag);for(const k in a)e.setAttribute(k,a[k]);return e},
  start(){
    if(!this.enabled)return;
    const s=this.el('svg',{width:0,height:0,'aria-hidden':'true'});s.style.cssText='position:absolute;width:0;height:0;pointer-events:none';
    this.defs=this.el('defs');s.append(this.defs);document.body.prepend(s);this.scan();
    let t;new MutationObserver(m=>{if(m.every(x=>this.defs.contains(x.target)))return;clearTimeout(t);t=setTimeout(()=>this.scan(),250)})
      .observe(document.body,{childList:true,subtree:true});
  },
  /* 凸スクワークル面 y=(1-(1-x)^4)^(1/4) の高さ→入射角→屈折角→横方向のずれ(px) */
  profile(bezel,thick,N=128,n=1.5,shape){
    const cv=x=>Math.pow(1-Math.pow(1-x,4),.25),sm=x=>x*x*x*(x*(x*6-15)+10);
    /* lip = mix(Convex, Concave, Smootherstep): 縁は凸（内向き屈折）、中央は凹（外向き） */
    const f=shape==='lip'?x=>{const s=sm(x);return cv(x)*(1-s)+(1-cv(x))*s}:cv,out=new Float32Array(N),dl=.001;
    for(let i=0;i<N;i++){
      const x=(i+.5)/N,slope=(f(Math.min(1,x+dl))-f(Math.max(0,x-dl)))/(2*dl)*(thick/bezel);
      const t1=Math.atan(slope),t2=Math.asin(Math.sin(t1)/n);
      out[i]=thick*f(x)*Math.tan(t1-t2);
    }
    return out;
  },
  /* 変位マップ(R=x,G=y, 128=無変位) と スペキュラ(縁のハイライト)を同時に生成 */
  maps(w,h,r,bezel,thick,rim=2.4,shape){
    const N=128,mags=this.profile(bezel,thick,N,1.5,shape),max=Math.max(...mags.map(Math.abs))||1;
    const mk=()=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c.getContext('2d')};
    const cm=mk(),cs=mk(),dm=cm.createImageData(w,h),ds=cs.createImageData(w,h),A=dm.data,B=ds.data;
    const hw=w/2,hh=h/2,la=-Math.PI/3,lx=Math.cos(la),ly=Math.sin(la);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const px=x+.5-hw,py=y+.5-hh,qx=Math.abs(px)-(hw-r),qy=Math.abs(py)-(hh-r),sx=px<0?-1:1,sy=py<0?-1:1;
      let sd,nx,ny;
      if(qx>0&&qy>0){const l=Math.hypot(qx,qy);sd=l-r;nx=sx*qx/l;ny=sy*qy/l}
      else if(qx>qy){sd=qx-r;nx=sx;ny=0}else{sd=qy-r;nx=0;ny=sy}
      const d=-sd,i=(y*w+x)*4;let vx=0,vy=0;
      if(d>=0&&d<bezel){const m=mags[Math.min(N-1,d/bezel*N|0)]/max;vx=-nx*m;vy=-ny*m}   // 内向きにサンプル
      A[i]=128+vx*127;A[i+1]=128+vy*127;A[i+2]=128;A[i+3]=255;
      if(d>=0&&d<rim){const a=Math.pow(Math.abs(nx*lx+ny*ly),1.3)*(1-d/rim)*.95;B[i]=B[i+1]=B[i+2]=255;B[i+3]=a*255}
    }
    cm.putImageData(dm,0,0);cs.putImageData(ds,0,0);
    return{map:cm.canvas.toDataURL(),spec:cs.canvas.toDataURL(),max};
  },
  /* disp=true: R/G/Bを少しずつ違う強さで変位→分光（色収差） */
  filter(id,w,h,map,scale,disp){
    const f=this.el('filter',{id,x:0,y:0,width:w,height:h,filterUnits:'userSpaceOnUse','color-interpolation-filters':'sRGB'});
    const im=this.el('feImage',{x:0,y:0,width:w,height:h,preserveAspectRatio:'none',result:'m'});
    im.setAttribute('href',map);im.setAttributeNS(XL,'xlink:href',map);f.append(im);
    const dm=(s,res)=>this.el('feDisplacementMap',{in:'SourceGraphic',in2:'m',scale:s,xChannelSelector:'R',yChannelSelector:'G',...(res?{result:res}:{})});
    if(!disp)f.append(dm(scale));
    else{
      const mat=i=>{const a=Array(20).fill(0);a[i*6]=1;a[18]=1;return a.join(' ')},k=[.96,1,1.05];
      'RGB'.split('').forEach((c,i)=>f.append(dm(scale*k[i],'d'+c),this.el('feColorMatrix',{in:'d'+c,type:'matrix',values:mat(i),result:'c'+c})));
      f.append(this.el('feBlend',{in:'cR',in2:'cG',mode:'screen',result:'rg'}),this.el('feBlend',{in:'rg',in2:'cB',mode:'screen',result:'bl'}),this.el('feGaussianBlur',{in:'bl',stdDeviation:.45}));
    }
    this.defs.append(f);return f;
  },
  lens(w,h){
    const m=this.maps(w,h,h/2,h*.28,h*.3,2.6),id='lgl'+(++this.n),k=m.max*2*this.strength;   // 縁だけをわずかに曲げる（最大約9px）
    this.filter(id,w,h,m.map,k,true);                                     // レンズ内の文字: 分光つき屈折
    let bid='';if(this.chromium){bid='lgb'+(++this.n);this.filter(bid,w,h,m.map,k,false)}   // 背景そのものの屈折(Chromium)
    return{id,bid,spec:m.spec};
  },
  setStrength(x){this.strength=x;this.panels.forEach(p=>p.dm&&p.dm.setAttribute('scale',p.base*x))},
  drop(id){$('#'+id,this.defs)?.remove()},
  attach(el){
    if(el.dataset.lg)return;el.dataset.lg=1;
    const id='lgp'+(++this.n),rec={el,id};this.panels.push(rec);
    if(getComputedStyle(el).position==='static')el.style.position='relative';
    const upd=()=>{
      const w=el.offsetWidth,h=el.offsetHeight;if(w<8||h<8)return;
      const r=Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius)||0,w/2,h/2),bezel=Math.min(Math.min(w,h)/2,Math.max(r*.9,12));
      const m=this.maps(w,h,r,bezel,bezel*1.5,2.2,el.dataset.shape);el.style.setProperty('--spec',`url(${m.spec})`);
      if(this.chromium){this.drop(id);rec.base=m.max*2*.7;rec.dm=this.filter(id,w,h,m.map,rec.base*this.strength,false).querySelector('feDisplacementMap');
        el.style.backdropFilter=el.style.webkitBackdropFilter=`blur(6px) url(#${id}) saturate(1.8) brightness(1.08)`}
    };
    rec.ro=new ResizeObserver(()=>{clearTimeout(rec.t);rec.t=setTimeout(upd,120)});rec.ro.observe(el);upd();
  },
  scan(){
    if(!this.defs)return;
    $$('.nav,.seg,.side,.sbar,.btn-add,.x,.knob,.pv,.sl-wide,.back,#avatar,.cmenu,.mutebtn').forEach(e=>this.attach(e));
    this.panels=this.panels.filter(p=>{if(p.el.isConnected)return true;p.ro.disconnect();this.drop(p.id);return false});
  }
};
/* ---------- UI部品：スイッチ / スライダー（ガラスのノブ） ---------- */
const SWS={
  auto:{get:()=>Player.auto,set:v=>{Player.auto=v;Store.set('auto',v);Player.acts()}},
  cm:{get:()=>Store.get('cm',true),set:v=>Store.set('cm',v)},
  lg:{get:()=>Store.get('lg','1')==='1',set:v=>{Store.set('lg',v?'1':'0');toast('ガラス品質は再読み込み後に反映されます')}}
};
SWS.bold={get:()=>Store.get('bold',false),set:v=>{Store.set('bold',v);applyPrefs()}};
SWS.rm={get:()=>Store.get('rm',false),set:v=>{Store.set('rm',v);applyPrefs()}};
for(const[k,d]of[['ja',true],['pers',true],['rks',true],['pv',true]])SWS[k]={get:()=>Store.get(k,d),set:v=>{Store.set(k,v);Settings.dirty=true}};
const syncSw=()=>$$('[data-sw]').forEach(b=>b.setAttribute('aria-checked',SWS[b.dataset.sw].get()));
document.addEventListener('click',e=>{const b=e.target.closest('[data-sw]');if(!b)return;const s=SWS[b.dataset.sw];s.set(!s.get());syncSw()});
function initSl(el){
  const k=el.dataset.sl,min=+el.dataset.min,max=+el.dataset.max,step=+el.dataset.step,out=el.parentElement.querySelector('output');
  const set=(x,save)=>{x=Math.min(max,Math.max(min,Math.round(x/step)*step));el.style.setProperty('--p',(x-min)/(max-min));if(out)out.textContent=Math.round(x*100)+'%';
    if(save)Store.set(k,x);if(k==='lgstr')LG.setStrength(x);if(k==='lgspec')document.documentElement.style.setProperty('--specA',x);if(k==='tint')document.documentElement.style.setProperty('--tint',x)};
  const at=e=>{const r=$('.sl-t',el).getBoundingClientRect();return min+(max-min)*Math.min(1,Math.max(0,(e.clientX-r.left)/r.width))};
  el.addEventListener('pointerdown',e=>{el.setPointerCapture(e.pointerId);el.classList.add('press');set(at(e),true)});
  el.addEventListener('pointermove',e=>{if(el.classList.contains('press'))set(at(e),true)});
  ['pointerup','pointercancel'].forEach(t=>el.addEventListener(t,()=>el.classList.remove('press')));
  set(Store.get(k,+el.dataset.def));
}
/* ---------- 設定画面（iPadの設定アプリ風：グループ化リスト / プッシュ遷移） ---------- */
const REGIONS=[['JP','日本'],['US','アメリカ'],['KR','韓国'],['GB','イギリス'],['TW','台湾']];
const ACCENTS=[['#41a0ff','ブルー'],['#ff5c8a','ピンク'],['#30d158','グリーン'],['#ff9f0a','オレンジ'],['#bf7bff','パープル']];
const TINTS=['クリア','よりクリア','標準','やや色合い','色合い調整'];
const swt=k=>`<button type="button" class="swt" role="switch" data-sw="${k}"><i class="knob glass" data-shape="lip"></i></button>`;
const slr=(k,min,max,step,def,label)=>`<div class="rw"><span>${label}</span><div class="sl" data-sl="${k}" data-min="${min}" data-max="${max}" data-step="${step}" data-def="${def}"><i class="sl-t"><b class="sl-f"></b></i><i class="sl-k knob glass"></i></div><output></output></div>`;
const chv='<svg class="ic chv"><use href="#i-chev"/></svg>';
function applyPrefs(){
  const r=document.documentElement;
  r.style.setProperty('--accent',Store.get('accent','#41a0ff'));r.style.setProperty('--tint',Store.get('tint',.25));r.style.setProperty('--specA',Store.get('lgspec',.9));
  r.classList.toggle('bold',!!Store.get('bold',false));r.classList.toggle('rm',!!Store.get('rm',false));
}
const SET={
  root:()=>({title:'設定',html:`
    <div class="grp"><button class="rw prof" data-go="profile"><span class="pav big">${esc(prof().emoji)}</span><span class="pn"><b>${esc(prof().name)}</b><small>プロフィールを編集</small></span>${chv}</button></div>
    <p class="ft"></p>
    <div class="grp">
      <button class="rw" data-go="key"><span>APIキー</span><em>${Store.get('key','')?'設定済み':'未設定'}</em>${chv}</button>
      <button class="rw" data-go="region"><span>地域</span><em>${REGIONS.find(r=>r[0]===region())[1]}</em>${chv}</button>
    </div>
    <p class="ft">YouTube Data API v3 のキーは、この端末のブラウザ内にだけ保存されます。</p>
    <div class="grp">
      <button class="rw" data-go="liquid"><span>Liquid Glass</span><em>${TINTS[Math.round(Store.get('tint',.25)*4)]}</em>${chv}</button>
      <button class="rw" data-go="accent"><span>アクセントカラー</span><i class="dot" style="background:${Store.get('accent','#41a0ff')}"></i>${chv}</button>
      <button class="rw" data-go="nav"><span>ナビゲーション</span><em>${Store.get('layout','tab')==='side'?'サイドバー':'タブバー'}</em>${chv}</button>
    </div>
    <p class="ft">Liquid Glassは、背後の映像に合わせて見え方が変わります。</p>
    <p class="hd">再生</p>
    <div class="grp"><div class="rw"><span>自動再生</span>${swt('auto')}</div><div class="rw"><span>ヒーローのプレビュー再生</span>${swt('pv')}</div><div class="rw"><span>コメントを表示</span>${swt('cm')}</div><button class="rw" data-go="keys"><span>キーボードショートカット</span>${chv}</button></div>
    <p class="ft">自動再生をオンにすると、動画の終了後にキュー、またはおすすめの動画へ進みます。</p>
    <p class="hd">おすすめ</p>
    <div class="grp"><div class="rw"><span>日本のコンテンツを優先</span>${swt('ja')}</div><div class="rw"><span>視聴履歴からおすすめ</span>${swt('pers')}</div><div class="rw"><span>検索を使ったおすすめ</span>${swt('rks')}</div></div>
    <p class="ft">視聴履歴、ウォッチリスト、フォロー、検索履歴は、この端末の中だけで使われ、外部には送られません。検索を使ったおすすめは、YouTube APIの割り当てを多く消費します（結果は数時間キャッシュされます）。</p>
    <p class="hd">アクセシビリティオプション</p>
    <div class="grp"><div class="rw"><span>文字を太くする</span>${swt('bold')}</div><div class="rw"><span>視差効果を減らす</span>${swt('rm')}</div></div>
    <p class="ft">視差効果を減らすと、画面の動きやアニメーションが最小限になります。</p>
    <p class="hd">データ</p>
    <div class="grp"><button class="rw" data-go="blocked"><span>表示しないチャンネル</span><em>${Store.get('blk',[]).length||''}</em>${chv}</button></div>
    <p class="ft"></p>
    <div class="grp">
      <button class="rw red" data-do="hist"><span>視聴履歴を消去</span></button>
      <button class="rw red" data-do="recent"><span>検索履歴を消去</span></button>
      <button class="rw red" data-do="queue"><span>キューを空にする</span></button>
    </div>`}),
  key:()=>({title:'APIキー',html:`
    <div class="grp"><label class="rw fld"><span>キー</span><input id="sk" type="password" autocomplete="off" placeholder="AIza…" value="${esc(Store.get('key',''))}"></label></div>
    <p class="ft">Google Cloud Consoleでキーを作成し、HTTPリファラー制限にこのサイトのURLを設定すると安全です。</p>
    <div class="grp"><a class="rw lnk" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener"><span>APIキーを取得する…</span></a></div>`}),
  region:()=>({title:'地域',html:`
    <div class="grp">${REGIONS.map(([c,n])=>`<button class="rw" data-opt="region:${c}"><span>${n}</span>${region()===c?icon('check'):''}</button>`).join('')}</div>
    <p class="ft">話題の動画やライブの取得に使う地域です。</p>`}),
  accent:()=>({title:'アクセントカラー',html:`
    <div class="grp">${ACCENTS.map(([c,n])=>`<button class="rw" data-opt="accent:${c}"><i class="dot" style="background:${c}"></i><span>${n}</span>${Store.get('accent','#41a0ff')===c?icon('check'):''}</button>`).join('')}</div>`}),
  nav:()=>{
    const cur=Store.get('layout','tab'),card=(k,t,m)=>`<button class="pk" data-opt="layout:${k}"><div class="pv-mock ${k}">${m}</div><span>${t}</span><i class="rd${cur===k?' on':''}">${cur===k?icon('check'):''}</i></button>`;
    return{title:'ナビゲーション',html:`
      <div class="grp pkr">${card('tab','タブバー','<b class="m-nav"></b><b class="m-hero"></b><b class="m-row"></b>')}${card('side','サイドバー','<b class="m-side"></b><b class="m-hero"></b><b class="m-row"></b>')}</div>
      <p class="ft">サイドバーは、画面幅900px以上のiPadで使えます。幅が狭いときは、タブバーで表示されます。</p>`};
  },
  profile:()=>{
    const p=prof(),E=['🍳','🎧','🎮','🐱','🐶','🚃','🌸','⚽','🎬','🚀','☕','🌙'];
    return{title:'プロフィール',html:`
      <div class="pcard"><span class="pav big">${esc(p.emoji)}</span></div>
      <div class="grp"><label class="rw fld"><span>名前</span><input id="pn" value="${esc(p.name)}" maxlength="20"></label></div>
      <p class="hd">アイコン</p>
      <div class="grp egrid">${E.map(e=>`<button class="eb${e===p.emoji?' on':''}" data-opt="emoji:${e}">${e}</button>`).join('')}</div>
      <p class="ft">名前とアイコンは、この端末のサイドバーなどに表示されます。</p>`};
  },
  blocked:()=>{
    const b=Store.get('blk',[]);
    return{title:'表示しないチャンネル',html:b.length
      ?`<div class="grp">${b.map(c=>`<div class="rw"><span>${esc(c.name)}</span><button class="lnkb" data-opt="unblock:${c.id}">解除</button></div>`).join('')}</div><p class="ft">「興味なし」にしたチャンネルの動画は、おすすめや一覧に表示されません。</p>`
      :'<p class="ft">表示しないチャンネルはありません。動画の「…」メニューから「このチャンネルは興味なし」を選ぶと、ここに追加されます。</p>'};
  },
  keys:()=>({title:'キーボードショートカット',html:`
    <div class="grp">${[['/','検索を開く'],['1 – 5','ホーム・話題・登録・ライブラリ・検索'],['Space / K','再生 / 一時停止'],['← →','10秒戻る / 進む'],['F','全画面'],['M','ミニプレーヤーの切り替え'],['N','次の動画'],['Esc','ミニ化 / 戻る']].map(([k,t])=>`<div class="rw"><span>${t}</span><kbd>${k}</kbd></div>`).join('')}</div>
    <p class="ft">外付けキーボードを接続したiPadで使えます。入力欄にカーソルがあるときは無効です。</p>`}),
  liquid:()=>({title:'Liquid Glass',html:`
    <div class="pvc"><div class="pvs"><b class="pv glass round">${icon('menu')}</b><b class="pv glass pill">${icon('search')}<u>検索</u></b></div>
      <div class="pvt"><h3>ようこそ</h3><h4>Liquid Glass のプレビュー</h4><p>ガラスの透明度や屈折の強さを変えると、上のボタンの見え方がすぐに変わります。</p></div></div>
    <div class="sl-wide glass">${icon('clear')}<div class="sl" data-sl="tint" data-min="0" data-max="1" data-step="0.25" data-def="0.25"><i class="sl-t"><b class="sl-f"></b></i><i class="sl-k knob glass"></i></div>${icon('tint')}</div>
    <p class="ft">「クリア」にすると透明度が高くなり、「色合い調整」にすると不透明度が上がって、文字やボタンのコントラストが強くなります。</p>
    <div class="grp">${slr('lgstr',0,1.5,.05,1,'屈折の強さ')}${slr('lgspec',0,1.2,.05,.9,'ハイライト')}<div class="rw"><span>高品質ガラス（屈折）</span>${swt('lg')}</div></div>
    <p class="ft">屈折の強さは、Chromium系のブラウザでは背後の映像にも反映されます。高品質ガラスの切り替えは、再読み込み後に反映されます。</p>`})
};
const Settings={
  el:$('#settings'),stack:[],dirty:false,
  get on(){return this.el.classList.contains('on')},
  build(n){const p=SET[n](),el=h(`<div class="sp" data-p="${n}"><div class="sp-in">${p.html}</div></div>`);el.dataset.title=p.title;this.bind(el);return el},
  bind(el){$$('[data-sl]',el).forEach(initSl);syncSw();LG.scan()},
  head(el){$('.sv-title',this.el).textContent=el.dataset.title;$('.back',this.el).classList.toggle('x',this.stack.length<2)},
  open(page){
    this.stack=[];$('.stk',this.el).replaceChildren();this.el.classList.add('on');document.body.classList.add('lock');
    this.push('root',true);if(page&&page!=='root')this.push(page);
  },
  push(n,first){
    const el=this.build(n),prev=this.stack.at(-1),ease='cubic-bezier(.3,1,.4,1)';
    this.stack.push(el);$('.stk',this.el).append(el);this.head(el);
    if(first)return;
    prev.animate([{transform:'none',opacity:1},{transform:'translateX(-28%)',opacity:.4}],{duration:480,easing:ease,fill:'forwards'});
    el.animate([{transform:'translateX(100%)'},{transform:'none'}],{duration:480,easing:ease});
  },
  pop(){
    if(this.stack.length<2)return this.close();
    const el=this.stack.pop(),prev=this.stack.at(-1),ease='cubic-bezier(.3,1,.4,1)';
    prev.getAnimations().forEach(a=>a.cancel());this.refresh(prev);this.head(prev);
    prev.animate([{transform:'translateX(-28%)',opacity:.4},{transform:'none',opacity:1}],{duration:440,easing:ease});
    el.animate([{transform:'none'},{transform:'translateX(100%)'}],{duration:440,easing:ease}).onfinish=()=>el.remove();
  },
  refresh(el){el=el||this.stack.at(-1);$('.sp-in',el).innerHTML=SET[el.dataset.p]().html;this.bind(el)},
  close(){
    this.el.classList.remove('on');if(!Player.v||Player.isMini)document.body.classList.remove('lock');
    if(this.dirty){this.dirty=false;API.cache.clear();render(state.view,state.arg)}
  }
};
Settings.el.addEventListener('click',e=>{
  const t=e.target,g=t.closest('[data-go]'),b=t.closest('[data-back]'),o=t.closest('[data-opt]'),d=t.closest('[data-do]');
  if(g)return Settings.push(g.dataset.go);
  if(b)return Settings.pop();
  if(o){
    const[k,v]=o.dataset.opt.split(':');
    if(k==='region'){Store.set('region',v);Settings.dirty=true}
    if(k==='accent'){Store.set('accent',v);applyPrefs()}
    if(k==='layout'){Store.set('layout',v);applyLayout()}
    if(k==='emoji'){Store.set('prof',{...prof(),emoji:v});applyProf()}
    if(k==='unblock'){Store.set('blk',Store.get('blk',[]).filter(c=>c.id!==v));API.cache.clear();Settings.dirty=true}
    return Settings.refresh();
  }
  if(d){
    const k=d.dataset.do;Store.set(k==='recent'?'recent':k,[]);
    toast({hist:'視聴履歴を消去しました',recent:'検索履歴を消去しました',queue:'キューを空にしました'}[k]);
  }
});
Settings.el.addEventListener('input',e=>{if(e.target.id==='pn'){Store.set('prof',{...prof(),name:e.target.value||'ゲスト'});applyProf()}
  if(e.target.id==='sk'){Store.set('key',e.target.value.trim());API.cache.clear();Settings.dirty=true}});
/* ---------- プロフィール / サイドバー（iPadOS 26風：編集・折りたたみ・プロフィール） ---------- */
const prof=()=>Store.get('prof',{name:'ゲスト',emoji:'🍳'});
function applyProf(){$('#avatar').innerHTML=`<span class="pav">${esc(prof().emoji)}</span>`;renderSide()}
const SIDE=[['search','検索','search'],['home','ホーム','home'],['hot','話題','flame'],['live','ライブ','live'],['subs','登録チャンネル','subs']];
const Side={edit:false};
function renderSide(){
  const hide=Store.get('sidehide',[]),fold=Store.get('sidefold',{}),fol=Store.get('fol',[]),p=prof();
  const cnt={wl:Store.get('wl',[]).length,hist:Store.get('hist',[]).length,queue:Store.get('queue',[]).length,fol:fol.length};
  const item=([v,t,ic])=>{const off=hide.includes(v);if(off&&!Side.edit)return'';
    return `<button class="si${off?' off':''}" data-view="${v}" data-item="${v}">${Side.edit?`<i class="eck${off?'':' on'}">${off?'':icon('check')}</i>`:''}${icon(ic)}<span>${t}</span></button>`};
  const sec=(k,t,inner)=>inner?`<div class="ss"><button class="sh${fold[k]?' closed':''}" data-fold="${k}">${t}${chv}</button><div class="sg${fold[k]?' fold':''}"><div>${inner}</div></div></div>`:'';
  $('#sideNav').innerHTML=SIDE.map(item).join('')
    +sec('ch','チャンネル',fol.slice(0,12).map(c=>`<button class="si" data-ch="${c.id}"><img class="av" src="${c.avatar}" alt=""><span>${esc(c.name)}</span></button>`).join(''))
    +sec('lib','ライブラリ',[['wl','ウォッチリスト','bookmark'],['hist','視聴履歴','clock'],['queue','キュー','queue'],['fol','フォロー中','people']].map(([k,t,ic])=>`<button class="si" data-lib="${k}">${icon(ic)}<span>${t}</span><em>${cnt[k]||''}</em></button>`).join(''));
  $('#sideEdit').textContent=Side.edit?'完了':'編集';
  $('#sideProf').innerHTML=`<span class="pav">${esc(p.emoji)}</span><span>${esc(p.name)}</span>`;
  $$('#side [data-view]').forEach(b=>b.dataset.view===state.view&&!state.arg&&b.setAttribute('aria-current','page'));
}
$('#side').addEventListener('click',e=>{
  const f=e.target.closest('[data-fold]');
  if(f){const k=f.dataset.fold,o=Store.get('sidefold',{});o[k]=!o[k];Store.set('sidefold',o);f.nextElementSibling.classList.toggle('fold',o[k]);f.classList.toggle('closed',o[k]);return}
  if(e.target.closest('#sideEdit')){Side.edit=!Side.edit;renderSide();return}
  if(e.target.closest('#sideProf')){closeSide();Settings.open('profile');return}
  const it=e.target.closest('[data-item]');
  if(Side.edit&&it){e.stopPropagation();const hd=Store.get('sidehide',[]);Store.set('sidehide',hd.includes(it.dataset.item)?hd.filter(x=>x!==it.dataset.item):[...hd,it.dataset.item]);renderSide()}
},true);
/* ---------- コンテキストメニュー（Liquid Glassのポップオーバー）+ 「興味なし」 ---------- */
const Menu={
  el:null,suppress:false,
  open(v,x,y){
    if(!v)return;this.close();const wl=Lib.has(v.id);
    const it=[['play','再生','play'],['wl',wl?'ウォッチリストから削除':'ウォッチリストに追加',wl?'check':'plus'],['queue','キューに追加','queue'],['share','共有','share'],'-',
      ...(v.cid?[['ch','チャンネルを表示','people'],['nope','このチャンネルは興味なし','nope',1]]:[]),['info','詳細を表示','info']];
    const el=h(`<div class="cmenu glass" role="menu">${it.map(r=>r==='-'?'<hr>':`<button class="${r[3]?'red':''}" data-m="${r[0]}">${r[1]}${icon(r[2])}</button>`).join('')}</div>`);
    document.body.append(el);this.el=el;
    const w=el.offsetWidth,hh=el.offsetHeight,L=Math.min(Math.max(12,x-w/2),innerWidth-w-12),down=y+hh+20<innerHeight,T=down?y+10:Math.max(12,y-hh-10);
    el.style.left=L+'px';el.style.top=T+'px';el.style.transformOrigin=`${x-L}px ${down?0:hh}px`;
    el.animate([{opacity:0,scale:.55},{opacity:1,scale:1}],{duration:440,easing:'cubic-bezier(.3,1.4,.5,1)'});
    el.addEventListener('click',e=>{const b=e.target.closest('[data-m]');if(b){this.close();this.run(b.dataset.m,v)}});
    setTimeout(()=>{this.off=e=>{if(this.el&&!el.contains(e.target))this.close()};document.addEventListener('pointerdown',this.off,true)},0);
    LG.scan();
  },
  close(){if(!this.el)return;const e=this.el;this.el=null;document.removeEventListener('pointerdown',this.off,true);e.animate([{opacity:1},{opacity:0,scale:.9}],{duration:160}).onfinish=()=>e.remove()},
  run(k,v){
    if(k==='play')Player.open(v);
    if(k==='wl'){Lib.toggle(v);syncAdd();toast(Lib.has(v.id)?'ウォッチリストに追加しました':'ウォッチリストから削除しました')}
    if(k==='queue'){Store.set('queue',[...Store.get('queue',[]).filter(x=>x.id!==v.id),slim(v)]);toast('キューに追加しました');renderSide()}
    if(k==='share')share(v);
    if(k==='info')detail(v);
    if(k==='ch'){if(Player.v&&!Player.isMini)Player.mini();render('channel',v.cid)}
    if(k==='nope'){const b=Store.get('blk',[]);if(!b.some(c=>c.id===v.cid))Store.set('blk',[...b,{id:v.cid,name:v.channel}]);
      API.cache.clear();toast(`「${v.channel}」の動画を表示しません`);render(state.view,state.arg,true)}
  }
};
document.addEventListener('contextmenu',e=>{const c=e.target.closest?.('.card');if(!c||e.target.closest('.more'))return;e.preventDefault();Menu.open(VID.get(c.dataset.id),e.clientX,e.clientY)});
document.addEventListener('click',e=>{if(Menu.suppress){e.stopPropagation();e.preventDefault()}},true);
(()=>{let lp=null;   // タッチの長押しでメニュー
  document.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse')return;const c=e.target.closest?.('.card');if(!c||e.target.closest('.more'))return;
    const s={x:e.clientX,y:e.clientY};s.t=setTimeout(()=>{s.done=true;Menu.suppress=true;navigator.vibrate?.(8);Menu.open(VID.get(c.dataset.id),s.x,s.y)},480);lp=s});
  document.addEventListener('pointermove',e=>{if(lp&&!lp.done&&Math.hypot(e.clientX-lp.x,e.clientY-lp.y)>8){clearTimeout(lp.t);lp=null}});
  ['pointerup','pointercancel'].forEach(t=>document.addEventListener(t,()=>{if(!lp)return;clearTimeout(lp.t);if(lp.done)setTimeout(()=>Menu.suppress=false,450);lp=null}));
})();
/* ---------- キーボードショートカット（外付けキーボード） ---------- */
document.addEventListener('keydown',e=>{
  if(e.target.matches?.('input,textarea,select')||e.metaKey||e.ctrlKey||e.altKey)return;
  const P=Player,go=v=>{if(P.v&&!P.isMini)P.mini();render(v)};
  if(e.key==='/'){e.preventDefault();go('search')}
  else if('12345'.includes(e.key)&&e.key)go(['home','hot','subs','lib','search'][+e.key-1]);
  else if(!P.v)return;
  else if(e.key===' '||e.key==='k'){e.preventDefault();P.toggle()}
  else if(e.key==='ArrowRight'&&P.p)P.p.seekTo(P.p.getCurrentTime()+10,true);
  else if(e.key==='ArrowLeft'&&P.p)P.p.seekTo(Math.max(0,P.p.getCurrentTime()-10),true);
  else if(e.key==='f'&&!P.isMini)P.full();
  else if(e.key==='m')P.isMini?P.expand():P.mini();
  else if(e.key==='n'){const n=P.nextUp();if(n)P.open(n)}
});
/* ---------- タブバーのミニマイズ（スマホ：下へスクロールで縮む） ---------- */
(()=>{let ly=0;const nav=$('#nav');
  addEventListener('scroll',()=>{
    if(!phone())return;const y=scrollY,d=y-ly;if(Math.abs(d)<8)return;ly=y;
    const min=d>0&&y>90;if(nav.classList.contains('min')===min)return;
    nav.classList.toggle('min',min);if(!min)setTimeout(()=>mark(nav,true),540);
  },{passive:true});
  nav.addEventListener('click',e=>{if(!nav.classList.contains('min'))return;e.stopPropagation();e.preventDefault();nav.classList.remove('min');setTimeout(()=>mark(nav,true),540)},true);
})();
/* ---------- Liquid Glass レンズ: 選択中タブを長押し→ドラッグで移動 ---------- */
const Lens=(()=>{
  let S=null,raf=0,block=false;
  const cx=b=>b.offsetLeft+b.offsetWidth/2;
  const tabsOf=bar=>$$('button[data-view],button[data-k]',bar).filter(b=>b.offsetParent);
  const paint=()=>{const st=Math.min(Math.abs(S.v)*.0004,.12),l=S.lens.style;   // 速いほど伸びる（ぷるん）
    const lx=(S.x-S.base/2)+'px';l.setProperty('--lx',lx);S.bar.style.setProperty('--lx',lx);l.setProperty('--sx',1+st);l.setProperty('--sy',1-st*.6)};
  function activate(){
    const{bar,btn}=S,r=bar.getBoundingClientRect(),tabs=tabsOf(bar);
    Object.assign(S,{on:true,tabs,min:cx(tabs[0]),max:cx(tabs[tabs.length-1]),base:Math.max(btn.offsetWidth+12,72),x:cx(btn),v:0});
    S.target=S.x;S.off=S.x-(S.sx-r.left+bar.scrollLeft);
    const html=[...bar.children].filter(c=>c.tagName==='BUTTON').map(b=>b.outerHTML).join('');
    const bleed=parseFloat(getComputedStyle(bar).getPropertyValue('--bleed'))||0,
      L=LG.enabled?LG.lens(S.base,bar.clientHeight+2*bleed):{id:'',spec:''};
    S.fid=L.id;S.bid=L.bid;
    const lens=h(`<div class="lens" aria-hidden="true"><div class="lr"${L.id?` style="filter:url(#${L.id})"`:''}><div class="lc">${html}</div></div>${L.spec?`<div class="lspec" style="background-image:url(${L.spec})"></div>`:''}</div>`);
    lens.style.setProperty('--lw',S.base+'px');
    lens.style.setProperty('--bw',bar.scrollWidth+'px');lens.style.setProperty('--bh',bar.clientHeight+'px');
    lens.classList.add(bar.matches('.nav')?'ln':'ls');const ls=lens.style;ls.setProperty('--bx',r.left+'px');ls.setProperty('--by',r.top+'px');ls.setProperty('--bsl',bar.scrollLeft+'px');
    ls.setProperty('--bleed',bleed+'px');ls.setProperty('--lh',(bar.clientHeight+2*bleed)+'px');
    if(L.bid)ls.backdropFilter=ls.webkitBackdropFilter=`blur(1px) url(#${L.bid}) saturate(1.7) brightness(1.2)`;
    bar.style.setProperty('--lw',S.base+'px');[...bar.children].forEach(c=>c.tagName==='BUTTON'&&c.style.setProperty('--bl',c.offsetLeft+'px'));
    S.lens=lens;document.body.append(lens);paint();
    requestAnimationFrame(()=>{bar.classList.add('lens-on','lens-hide');lens.classList.add('on')});
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
    const{bar,lens,x,base,fid,bid}=S;S=null;const i=$('.ind',bar);
    i.style.transition='none';i.style.left=(x-base/2)+'px';i.style.width=base+'px';i.offsetWidth;i.style.transition='';
    bar.classList.remove('lens-on');lens.classList.remove('on');setTimeout(()=>bar.classList.remove('lens-hide'),340);
    requestAnimationFrame(()=>{mark(bar);i.classList.remove('jelly');i.classList.add('settle');setTimeout(()=>i.classList.remove('settle'),700)});
    setTimeout(()=>{lens.remove();if(fid)LG.drop(fid);if(bid)LG.drop(bid)},520);
  }
  document.addEventListener('pointerdown',e=>{
    const b=e.target.closest?.('.nav button[aria-current],.seg button[aria-current]');
    if(!b||S||!e.isPrimary||b.closest('.nav.min'))return;
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
matchMedia('(max-width:700px)').addEventListener('change',()=>{applyLayout();render(state.view,state.arg,true)});
document.documentElement.style.setProperty('--accent',Store.get('accent','#41a0ff'));
applyPrefs();LG.start();applyLayout();applyProf();render('home');
if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
