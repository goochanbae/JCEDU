/* JC EDU 마케팅 WBS — GitHub Pages + Supabase
 * 데이터: items(업무), item_history(변경 이력), members(팀원·권한)
 * 권한: members 테이블에 등록된 이메일만 조회 가능, role=admin|member 편집, admin만 삭제 (RLS)
 */
(() => {
const CFG = window.JC_CONFIG || {};
if(!window.supabase){ document.body.innerHTML = '<p style="padding:24px;font-family:Pretendard,sans-serif">필요한 모듈(Supabase)을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.</p>'; return; }
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

const STATUS = ['In Progress','Planned','On Hold','Completed','Canceled'];
const ST_KO = {'In Progress':'진행 중','Planned':'예정','On Hold':'보류','Completed':'완료','Canceled':'취소'};
const ST_CLS = {'In Progress':'ip','Planned':'pl','On Hold':'oh','Completed':'co','Canceled':'ca'};
const BRANDS = ['공통','메디원','유프관','메디원&유프관','아임이그잼','인노트','제이콘','기타'];
const CYCLES = ['일간','주간','월간','분기','반기','연간','행사별','수시','단발'];
const FIELDS = ['cat','task','output','link','brand','cyc','pic','bak','st','prog','start_date','end_date','note','memo','kpi_target','kpi_actual','kpi_month','kpi_memo','req_date','due_date','req_text','done_date','feedback'];
const LABELS = {cat:'Category',task:'Task',output:'Output',link:'산출물 링크',brand:'브랜드',cyc:'주기',pic:'PIC',bak:'Backup',st:'진행 상태',prog:'progress',start_date:'Start',end_date:'End',note:'비고',memo:'최근 메모',kpi_target:'월 목표',kpi_actual:'월 실적',kpi_month:'기준월',kpi_memo:'실적 메모',req_date:'요청일',due_date:'보고 기한',req_text:'요청 원문',done_date:'보고 완료일',feedback:'대표님 피드백'};
const DAY = 864e5;
const today = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();

let items = [], byId = {}, PEOPLE = ['전원'], STAFF = [], MEMBERS = [], CHECKS = {}, me = null, selId = null;
const ui = {
  wbs:{q:'',pic:'',st:'',brand:'',chk:'',mine:false,collapsed:new Set()},
  req:{q:'',pic:'',st:'',brand:'',chk:'',mine:false,collapsed:new Set()},
  my:{view:(()=>{ try{ return localStorage.getItem('jcwbs-myview')==='board'?'board':'list'; }catch(e){ return 'list'; } })(), filter:'', done:false},
  weeklyBase:null, ganttSheet:'WBS', ganttZoom:'mid', ganttMine:false, ganttScrolled:false,
  cal:{y:null, m:null, sheet:'', who:'', brand:'', scope:'event'}
};
const $ = id => document.getElementById(id);

// ---------------- helpers
const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pd = s => { if(!s) return null; const [y,m,d] = String(s).slice(0,10).split('-').map(Number); return new Date(y,m-1,d); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const fmt = s => { const d = pd(s); return d ? `${String(d.getFullYear()).slice(2)}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}` : ''; };
const fmtD = d => d ? `${d.getMonth()+1}/${d.getDate()}` : '';
const pct = v => v==null||isNaN(v) ? '–' : Math.round(v*100)+'%';
const ddTxt = d => d==null ? '' : d===0 ? 'D-day' : d>0 ? 'D-'+d : 'D+'+(-d);
const isTask = r => r.lvl==='T' || r.lvl==='C';
const canEdit = () => me && (me.role==='admin' || me.role==='member');
// 이 업무를 고칠 수 있는가: 관리자 전체, 팀원은 내가 PIC·Backup·등록자이거나 '전원' 업무 (DB 트리거와 같은 규칙)
const owns = r => !!me && !!r && (me.role==='admin' || (me.role==='member' && (r.pic===me.name || r.bak===me.name || r.created_by===me.name || r.pic==='전원')));
const kids = id => items.filter(r => r.parent===id);
function desc(id){ const out=[]; for(const k of kids(id)){ out.push(k); out.push(...desc(k.id)); } return out; }
function index(){ items.sort((a,b)=>a.sort_order-b.sort_order); byId = Object.fromEntries(items.map(r=>[r.id,r])); }
function dday(r){ if(!isTask(r)) return null; const e=pd(r.end_date); if(!e||r.st==='Completed'||r.st==='Canceled') return null; return Math.round((e-today)/DAY); }
function check(r){
  if(!isTask(r)) return '';
  if(r.st==='Completed') return (r.prog==null||r.prog<1) ? '⚠ 진척률 확인' : '완료';
  if(r.st==='Canceled') return '취소';
  const e=pd(r.end_date), s=pd(r.start_date);
  if(!e) return r.cyc==='단발' ? '⚠ 종료일 없음' : '';
  if(e<today) return '지연';
  if((e-today)/DAY<=3) return '임박';
  if(s && s>today) return '예정';
  return '진행';
}
function must(r){ const s=pd(r.start_date), e=pd(r.end_date); if(!s||!e) return null; if(s>today) return 0; if(e<=today) return 1; const t=(e-s)/DAY; return t===0?1:((Math.min(today,e)-s)/DAY)/t; }
function chkChip(c){ if(!c) return ''; const cls = c==='지연'?'k-late':c==='임박'?'k-soon':c.startsWith('⚠')?'k-warn':(c==='완료'||c==='취소')?'k-ok':c==='예정'?'k-plan':'k-run'; return `<span class="chip ${cls}">${esc(c)}</span>`; }
function stChip(s){ return s ? `<span class="chip c-${ST_CLS[s]||'ca'}">${esc(ST_KO[s]||s)}</span>` : ''; }
function mini(v,m){ return `<div class="mini"><div class="pbar"><i style="width:${Math.max(0,Math.min(1,v||0))*100}%"></i>${m!=null?`<b style="left:calc(${Math.min(1,m)*100}% - 1px)"></b>`:''}</div><span>${pct(v)}</span></div>`; }
function groupAgg(g){
  const ts = desc(g.id).filter(isTask);
  const ss = ts.map(t=>pd(t.start_date)).filter(Boolean), es = ts.map(t=>pd(t.end_date)).filter(Boolean);
  const pr = ts.filter(t=>t.prog!=null).map(t=>Number(t.prog));
  return {start:ss.length?new Date(Math.min(...ss)):null, end:es.length?new Date(Math.max(...es)):null, prog:pr.length?pr.reduce((a,b)=>a+b,0)/pr.length:null, n:ts.length};
}
function sheetStats(sheet){
  const ts = items.filter(r=>r.sheet===sheet && isTask(r));
  const actual = ts.reduce((a,r)=>a+(Number(r.w)||0)*(Number(r.prog)||0),0);
  const plan = ts.reduce((a,r)=>a+(Number(r.w)||0)*(must(r)||0),0);
  const chk = ts.map(check);
  return {ts, actual, plan, late:chk.filter(c=>c==='지연').length, soon:chk.filter(c=>c==='임박').length, warn:chk.filter(c=>c.startsWith('⚠')).length};
}
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('on'),2600); }
function showOnly(id){ for(const v of ['loginView','deniedView','appView']) $(v).classList.toggle('hidden', v!==id); }

// ---------------- auth
async function boot(){
  if(!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('YOUR-PROJECT')){
    showOnly('loginView'); $('loginMsg').className='msg err'; $('loginMsg').textContent='config.js에 Supabase 주소와 키가 아직 입력되지 않았습니다.'; $('loginBtn').disabled=true; return;
  }
  const { data:{ session } } = await sb.auth.getSession();
  if(session) await enter(session); else showOnly('loginView');
  sb.auth.onAuthStateChange(async (ev, s) => {
    if(ev==='SIGNED_IN' && s && !me) await enter(s);
    if(ev==='SIGNED_OUT'){ me=null; showOnly('loginView'); }
  });
}
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('loginEmail').value.trim(), pw = $('loginPw').value;
  $('loginBtn').disabled = true; $('loginMsg').className='msg'; $('loginMsg').textContent = '로그인 중…';
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  $('loginBtn').disabled = false;
  if(error){ $('loginMsg').className='msg err'; $('loginMsg').textContent = /confirm/i.test(error.message) ? '가입 확인이 끝나지 않은 계정입니다. 관리자에게 문의하세요.' : '로그인하지 못했습니다. 이메일과 비밀번호를 확인하세요.'; }
});
// 회원가입: 계정을 만들고 승인 요청을 남김 (메일 발송 없음 — Supabase에서 Confirm email이 꺼져 있어야 함)
const swap = toSignup => { $('loginForm').classList.toggle('hidden',toSignup); $('signupForm').classList.toggle('hidden',!toSignup); };
$('toSignup').onclick = () => { swap(true); $('suEmail').value = $('loginEmail').value; $('suName').focus(); };
$('toLogin').onclick = () => swap(false);
$('signupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name=$('suName').value.trim(), email=$('suEmail').value.trim().toLowerCase(), pw=$('suPw').value, pw2=$('suPw2').value, msg=$('suMsg');
  msg.className='msg err';
  if(!name){ msg.textContent='이름을 입력하세요.'; return; }
  if(pw.length<8){ msg.textContent='비밀번호는 8자 이상으로 정하세요.'; return; }
  if(pw!==pw2){ msg.textContent='두 비밀번호가 다릅니다.'; return; }
  $('suBtn').disabled=true; msg.className='msg'; msg.textContent='가입 요청 중…';
  const { data, error } = await sb.auth.signUp({ email, password: pw, options:{ data:{ name } } });
  $('suBtn').disabled=false;
  if(error){ msg.className='msg err'; msg.textContent = /registered|exists/i.test(error.message) ? '이미 가입된 이메일입니다. 로그인하세요.' : /rate|limit/i.test(error.message) ? '요청이 많습니다. 잠시 후 다시 시도하세요.' : '가입하지 못했습니다: '+error.message; return; }
  // 이미 가입된 이메일이면 Supabase가 오류 없이 빈 identities를 돌려줌
  if(data.user && Array.isArray(data.user.identities) && data.user.identities.length===0){ msg.className='msg err'; msg.textContent='이미 가입된 이메일입니다. 로그인하세요.'; return; }
  $('suPw').value=''; $('suPw2').value='';
  if(!data.session){ swap(false); $('loginMsg').className='msg'; $('loginMsg').textContent='가입 요청을 접수했습니다. 관리자가 승인한 뒤 로그인하세요.'; }
  // 세션이 있으면 onAuthStateChange → enter()가 승인 대기 화면을 보여줌
});
$('deniedLogout').addEventListener('click', ()=>sb.auth.signOut());
$('deniedRetry').addEventListener('click', async ()=>{ const { data:{ session } } = await sb.auth.getSession(); if(session) await enter(session); else showOnly('loginView'); });
$('logoutBtn').addEventListener('click', ()=>sb.auth.signOut());
$('accountBtn').addEventListener('click', ()=>openAccount());

async function enter(session){
  const email = session.user.email;
  const { data: mem, error } = await sb.from('members').select('email,name,role').order('name');
  if(error){ showOnly('deniedView'); $('deniedTitle').textContent='접근 권한이 없습니다'; $('deniedMsg').textContent='팀원 정보를 불러오지 못했습니다: '+error.message; return; }
  me = (mem||[]).find(m => m.email.toLowerCase()===email.toLowerCase());
  if(!me){
    const { data:req } = await sb.from('signup_requests').select('name,requested_at').eq('email',email.toLowerCase()).maybeSingle();
    showOnly('deniedView'); $('deniedRetry').classList.toggle('hidden', !req);
    $('deniedTitle').textContent = req ? '가입 승인 대기 중' : '접근 권한이 없습니다';
    $('deniedMsg').textContent = req
      ? `${req.name} 님(${email})의 가입 요청이 관리자 승인을 기다리고 있습니다. 승인되면 바로 사용할 수 있습니다.`
      : `${email} 계정은 승인 요청 기록이 없습니다. 관리자에게 문의하세요.`;
    return;
  }
  MEMBERS = mem;
  await loadStaff();
  $('meName').textContent = me.name; $('meRole').textContent = me.role==='admin'?'관리자':me.role==='viewer'?'보기 전용':'';
  ui.wbs.mine = false;
  showOnly('appView');
  if(me.role==='admin') loadRequests();
  await loadItems();
  await Promise.all([loadChecks(), loadCommentTimes()]);
  seenLoad();
  subscribe();
  await loadMissed();
  rerender();
  rerender();
}
async function loadItems(){
  const { data, error } = await sb.from('items').select('*').order('sort_order');
  if(error){ toast('업무를 불러오지 못했습니다: '+error.message); return; }
  items = data.map(norm); index(); refreshPeople();
  $('nW').textContent = items.filter(r=>r.sheet==='WBS'&&r.lvl!=='L1').length;
  $('nR').textContent = items.filter(r=>r.sheet==='REQ'&&r.lvl!=='L1').length;
}
let REQUESTS = [];
async function loadRequests(){
  const { data, error } = await sb.from('signup_requests').select('*').order('requested_at');
  REQUESTS = error ? [] : (data||[]).filter(r=>!MEMBERS.some(m=>m.email.toLowerCase()===r.email.toLowerCase()));
  const at=$('adminTab'); if(at) at.innerHTML = '관리자' + (REQUESTS.length?` <span class="chip k-soon" style="margin-left:4px">가입 요청 ${REQUESTS.length}</span>`:'');
  return REQUESTS;
}
// 담당자 목록 = DB staff 테이블의 활성 담당자 (관리자가 '담당자 관리'에서 편집). '전원'은 맨 뒤.
async function loadStaff(){
  const { data, error } = await sb.from('staff').select('*').order('sort_order');
  if(error){ toast('담당자 목록을 불러오지 못했습니다: '+error.message); STAFF=[]; } else STAFF = data;
  refreshPeople();
}
function refreshPeople(){
  PEOPLE = [...STAFF.filter(x=>x.active).map(x=>x.name), '전원'];
  const at = $('adminTab'); if(at) at.classList.toggle('hidden', !(me && me.role==='admin'));
}
function norm(r){ for(const k of ['w','prog','kpi_target','kpi_actual','sort_order']) if(r[k]!=null) r[k]=Number(r[k]); return r; }
function subscribe(){
  sb.channel('items-live').on('postgres_changes', {event:'*', schema:'public', table:'items'}, p => {
    if(p.eventType==='DELETE'){ items = items.filter(r=>r.id!==p.old.id); }
    else { const n = norm(p.new); const i = items.findIndex(r=>r.id===n.id); if(i>=0) items[i]=n; else items.push(n); }
    index(); refreshPeople();
    if(p.eventType==='INSERT') onItemInsert(byId[p.new.id]);
    if(selId && p.new && p.new.id===selId) markSeen(selId, true);
    newsTabs();
    if(selId && p.new && p.new.id===selId && p.new.updated_by!==me.name) toast(`${p.new.updated_by||'다른 팀원'}님이 이 업무를 방금 수정했습니다.`);
    if(!$('drawer').classList.contains('on')) rerender();
  }).on('postgres_changes', {event:'INSERT', schema:'public', table:'item_comments'}, p => onCommentInsert(p.new))
  .subscribe(st => { const el=$('syncState'); el.textContent = st==='SUBSCRIBED'?'실시간 반영 중':'연결 중'; el.classList.toggle('live', st==='SUBSCRIBED'); });
}

// ---------------- dashboard
function renderDashboard(){
  const W=sheetStats('WBS'), R=sheetStats('REQ'); const all=[...W.ts,...R.ts];
  const work = items.filter(r=>r.lvl!=='L1');
  const w0=new Date(today); w0.setDate(today.getDate()-((today.getDay()+6)%7)); const w1=new Date(w0); w1.setDate(w0.getDate()+6);
  const due = all.filter(r=>{const e=pd(r.end_date); return e&&e>=w0&&e<=w1;}).sort((a,b)=>pd(a.end_date)-pd(b.end_date));
  const tile=(k,v,s,cls,go)=>`<button class="tile ${cls||''}" type="button" data-go="${go}"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></button>`;
  const prog=(lab,S,go)=>`<button class="tile" type="button" data-go="${go}"><span class="k">${lab} 진척</span><span class="v">${pct(S.actual)}</span><div class="pbar"><i style="width:${S.actual*100}%"></i><b style="left:calc(${Math.min(1,S.plan)*100}% - 1px)"></b></div><span class="s">오늘까지 계획 ${pct(S.plan)} · ${S.actual>=S.plan?'계획 이상':'계획보다 '+Math.round((S.plan-S.actual)*100)+'%p 늦음'}</span></button>`;
  const OTHER='(목록에 없는 이름)';
  const ppl = [...PEOPLE,OTHER,'(미지정)'].map(p=>{ const mine=work.filter(r=>p==='(미지정)'?!r.pic:p===OTHER?(r.pic&&!PEOPLE.includes(r.pic)):r.pic===p); return {p, cnt:STATUS.map(s=>mine.filter(r=>r.st===s).length), none:mine.filter(r=>!STATUS.includes(r.st)).length, tot:mine.length, late:mine.filter(r=>check(r)==='지연').length, bak:work.filter(r=>p!=='(미지정)'&&p!==OTHER&&r.bak===p).length}; }).filter(x=>x.tot||x.bak||PEOPLE.includes(x.p));
  const max = Math.max(...ppl.map(x=>x.tot),1);
  $('v-dashboard').innerHTML = `<div class="band">
  <div class="grid-tiles">${prog('WBS',W,'wbs')}${prog('대표님 REQ',R,'req')}
    ${tile('지연',W.late+R.late,'종료일이 지났는데 완료되지 않음','bad','chk:지연')}
    ${tile('임박',W.soon+R.soon,'3일 이내 마감','warn','chk:임박')}
    ${tile('⚠ 확인 필요',W.warn+R.warn,'완료인데 진척률 미달 · 종료일 없음','caution','chk:⚠')}
    ${tile('이번 주 마감',due.length,`${fmtD(w0)} ~ ${fmtD(w1)}`,'','weekly')}
    ${(()=>{const n=items.filter(r=>r.parent&&/-INBOX$/.test(r.parent)).length; return n?tile('미분류함',n,'WBS 위치 정리가 필요한 새 업무','warn','wbs'):'';})()}
    ${(()=>{const n=items.filter(r=>r.delete_requested_at).length; return n?tile('삭제 대기',n,me.role==='admin'?'승인이 필요한 삭제 요청':'관리자 승인 대기 중','bad','chk:삭제 대기'):'';})()}</div></div>
  <div class="cols">
    <div class="panel"><h2 class="sec">담당자별 업무량</h2>
      <div class="people">${ppl.map(x=>`<div class="person" title="${esc(x.p)} · 담당 ${x.tot}건 (${STATUS.map((s,i)=>x.cnt[i]?ST_KO[s]+' '+x.cnt[i]:'').filter(Boolean).join(', ')}${x.none?', 상태 없음 '+x.none:''}) · Backup ${x.bak}건"><span class="nm">${esc(x.p)}</span><div class="stack" style="width:${Math.max(x.tot/max*100,2)}%">${x.cnt.map((c,i)=>c?`<span class="s-${ST_CLS[STATUS[i]]}" style="width:${c/x.tot*100}%"></span>`:'').join('')}${x.none?`<span style="width:${x.none/x.tot*100}%;background:var(--line)"></span>`:''}</div><span class="tot">${x.tot}${x.late?` <span style="color:var(--bad)">·${x.late}</span>`:''}</span></div>`).join('')}</div>
      <div class="legend">${STATUS.map(s=>`<span><i class="s-${ST_CLS[s]}"></i>${ST_KO[s]}</span>`).join('')}<span>PIC 기준 · 상시·단발 업무 모두 포함 (카테고리 제외) · 빨간 수 = 지연 건수 · 막대에 마우스를 올리면 상세</span></div></div>
    <div class="panel"><h2 class="sec">이번 주 마감 (${fmtD(w0)} ~ ${fmtD(w1)})</h2>
      ${due.length?`<table style="min-width:0"><thead><tr><th>ID</th><th>업무</th><th>PIC</th><th>상태</th><th>End</th><th></th></tr></thead><tbody>${due.map(r=>`<tr class="task" data-id="${r.id}"><td class="mono">${r.id}</td><td class="t-name"><span class="cat">${esc(r.cat)}</span><span class="tk">${esc(r.task)}</span></td><td class="nw">${esc(r.pic||'')}</td><td>${stChip(r.st)}</td><td class="mono">${fmtD(pd(r.end_date))}</td><td class="nw">${chkChip(check(r))}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">이번 주 마감 업무가 없습니다.</div>'}</div>
  </div>`;
}

// ---------------- WBS / REQ table
// 업무 뒤 열은 드래그로 순서를 바꿀 수 있고, 순서는 이 브라우저에 저장된다.
const MOVABLE = {
  brand:{label:'브랜드', cell:r=>esc(r.brand||'')},
  cyc:{label:'주기', cell:r=>esc(r.cyc||'')},
  pic:{label:'PIC / Backup', cls:'nw', cell:r=>`${esc(r.pic||'')}${r.bak?`<span style="color:var(--muted)"> / ${esc(r.bak)}</span>`:''}`},
  st:{label:'상태', cell:r=>stChip(r.st)},
  start:{label:'Start', cls:'mono', cell:(r,a)=>isTask(r)?fmt(r.start_date):(a&&a.start?fmt(iso(a.start)):''), g:a=>a.start?fmt(iso(a.start)):''},
  end:{label:'End', cls:'mono', cell:(r,a)=>isTask(r)?fmt(r.end_date):(a&&a.end?fmt(iso(a.end)):''), g:a=>a.end?fmt(iso(a.end)):''},
  dday:{label:'D-day', cls:'mono dday', cell:r=>{const d=dday(r); return `<span class="${d!=null&&d<0?'neg':''}">${ddTxt(d)}</span>`;}},
  chk:{label:'일정 체크', cls:'nw', cell:r=>chkChip(check(r))},
  prog:{label:'진척 · 실적', cell:(r,a)=>isTask(r)&&r.cyc==='단발'?mini(r.prog,must(r)):(a&&a.prog!=null?mini(a.prog):(r.kpi_target?`<span class="mono" style="color:var(--muted)">월 ${r.kpi_actual??'–'}/${r.kpi_target}</span>`:'')), g:a=>a.prog!=null?mini(a.prog):''}
};
const DEFAULT_COLS = Object.keys(MOVABLE);
let colOrder = (() => { try{ const s=JSON.parse(localStorage.getItem('jcwbs-cols')||'null'); if(Array.isArray(s) && s.length===DEFAULT_COLS.length && DEFAULT_COLS.every(k=>s.includes(k))) return s; }catch(e){} return [...DEFAULT_COLS]; })();
function saveCols(){ try{ localStorage.setItem('jcwbs-cols', JSON.stringify(colOrder)); }catch(e){} }
const delChip = r => r.delete_requested_at ? ` <span class="chip k-late" title="${esc(r.delete_requested_by||'')} 요청">삭제 대기</span>` : '';

function rowVisible(r,f){
  if(f.pic && r.pic!==f.pic && r.bak!==f.pic) return false;
  if(f.mine && r.pic!==me.name && r.bak!==me.name) return false;
  if(f.st && r.st!==f.st) return false;
  if(f.brand && r.brand!==f.brand) return false;
  if(f.news && !newsOf(r)) return false;
  if(f.chk==='삭제 대기'){ if(!r.delete_requested_at) return false; }
  else if(f.chk){ const c=check(r); if(f.chk==='⚠' ? !c.startsWith('⚠') : c!==f.chk) return false; }
  if(f.q){ const q=f.q.trim().toLowerCase(); if(q && ![r.cat,r.task].some(x=>x&&String(x).toLowerCase().includes(q))) return false; }   // 검색은 업무명·업무 내용에서만
  return true;
}
function renderTable(sheet, bodyOnly){
  const key = sheet==='WBS'?'wbs':'req', f = ui[key];
  const groups = items.filter(r=>r.sheet===sheet&&r.lvl==='L1');
  const filtering = f.q||f.pic||f.st||f.brand||f.chk||f.mine||f.news;
  const newsAll = items.filter(r=>r.sheet===sheet && r.lvl!=='L1' && newsOf(r));
  let shown=0,total=0,body='';
  for(const g of groups){
    const members = desc(g.id);
    const gHit = f.chk==='삭제 대기' && g.delete_requested_at;
    const vis = members.filter(r=> rowVisible(r,f) || (r.lvl==='P' && desc(r.id).some(k=>rowVisible(k,f))));
    total += members.length;
    if(filtering && !vis.length && !gHit) continue;
    shown += vis.length;
    const a = groupAgg(g), col = f.collapsed.has(g.id) && !filtering;
    const gNews = members.filter(r=>newsOf(r)).length;
    body += `<tr class="g1" data-g="${g.id}"><td><span class="tw">${col?'▸':'▾'}</span>${esc(g.num)}</td><td></td><td>${esc(g.cat)}${delChip(g)}${gNews?` <span class="nb nb-upd">새 소식 ${gNews}</span>`:''} <span style="font-weight:400;color:var(--muted)">· ${a.n}건</span>${canEdit()?`<button class="addbtn" type="button" data-add="${g.id}">+ 업무 추가</button><button class="addbtn" type="button" data-edit="${g.id}">편집</button>`:''}</td>${colOrder.map(k=>`<td class="${MOVABLE[k].cls||''}">${MOVABLE[k].g?MOVABLE[k].g(a):''}</td>`).join('')}</tr>`;
    if(col) continue;
    for(const r of vis){
      const a2 = r.lvl==='P' ? groupAgg(r) : null;
      body += `<tr class="task lvl-${r.lvl}${r.id===selId?' sel':''}" data-id="${r.id}">
        <td class="mono">${r.id}</td><td class="mono" style="color:var(--muted)">${esc(r.num)}</td>
        <td class="t-name"><span class="cat">${esc(r.cat||'')}${delChip(r)}${newsChip(r)}</span><span class="tk">${esc(r.task||'')}</span></td>
        ${colOrder.map(k=>`<td class="${MOVABLE[k].cls||''}">${MOVABLE[k].cell(r,a2)}</td>`).join('')}</tr>`;
    }
  }
  const pick=(arr,v,lab)=>`<option value="">${lab}</option>`+arr.map(x=>`<option ${x===v?'selected':''}>${esc(x)}</option>`).join('');
  const ncols = 3 + colOrder.length;
  const html = `
    <div class="toolbar">
      <input type="search" id="${key}-q" placeholder="업무명·업무 내용 검색" aria-label="업무명·업무 내용 검색" value="${esc(f.q)}">
      <select id="${key}-pic" aria-label="담당자">${pick(PEOPLE,f.pic,'담당자 전체')}</select>
      <select id="${key}-st" aria-label="진행 상태"><option value="">상태 전체</option>${STATUS.map(s=>`<option value="${s}" ${s===f.st?'selected':''}>${ST_KO[s]}</option>`).join('')}</select>
      <select id="${key}-brand" aria-label="브랜드">${pick(BRANDS,f.brand,'브랜드 전체')}</select>
      <select id="${key}-chk" aria-label="일정 체크">${pick(['지연','임박','⚠','진행','예정','완료','삭제 대기'],f.chk,'일정 체크 전체')}</select>
      <label><input type="checkbox" id="${key}-mine" ${f.mine?'checked':''}> 내 업무만</label>
      <label class="${newsAll.length?'news-on':''}"><input type="checkbox" id="${key}-news" ${f.news?'checked':''}> 새 소식만${newsAll.length?` (${newsAll.length})`:''}</label>
      ${newsAll.length?`<button class="btn" type="button" id="${key}-seen">새 소식 모두 확인</button>`:''}
      <button class="btn" type="button" id="${key}-fold">${f.collapsed.size?'모두 펼치기':'모두 접기'}</button>
      <button class="btn" type="button" id="${key}-reset">필터 초기화</button>
      ${canEdit()?`<button class="btn" type="button" id="${key}-addcat">+ 카테고리 추가</button>`:''}
      <span class="count">${filtering?`${shown} / ${total}행 표시`:`${total}행`} · <button class="linkbtn" type="button" id="${key}-colreset" title="열 제목을 끌어서 순서를 바꿀 수 있습니다">열 순서 초기화</button></span>
    </div>
    <div class="tablewrap"><table><thead><tr><th>ID</th><th>#</th><th>업무</th>${colOrder.map(k=>`<th draggable="true" data-col="${k}" class="dragcol" title="끌어서 좌우로 이동">${MOVABLE[k].label}</th>`).join('')}</tr></thead><tbody>${body||`<tr><td colspan="${ncols}" class="empty">조건에 맞는 업무가 없습니다.</td></tr>`}</tbody></table></div>`;
  const view = $('v-'+key);
  const on=(id,ev,fn)=>{ const el=$(id); if(el) el.addEventListener(ev,fn); };
  if(bodyOnly && $(`${key}-q`)){
    const tmp=document.createElement('div'); tmp.innerHTML=html;
    view.querySelector('.tablewrap').replaceWith(tmp.querySelector('.tablewrap'));
    view.querySelector('.toolbar .count').replaceWith(tmp.querySelector('.toolbar .count'));
    bindBody(); return;
  }
  view.innerHTML = html;
  // 검색창은 다시 만들지 않고 표만 갱신 (한글 입력 중 자모가 분리되지 않게)
  on(`${key}-q`,'input',e=>{ f.q=e.target.value; renderTable(sheet, true); });
  for(const k of ['pic','st','brand','chk']) on(`${key}-${k}`,'change',e=>{f[k]=e.target.value; renderTable(sheet);});
  on(`${key}-mine`,'change',e=>{f.mine=e.target.checked; renderTable(sheet);});
  on(`${key}-news`,'change',e=>{f.news=e.target.checked; renderTable(sheet);});
  on(`${key}-seen`,'click',()=>{ markSeenMany(newsAll); f.news=false; toast(`새 소식 ${newsAll.length}건을 확인 처리했어요.`); renderTable(sheet); });
  on(`${key}-fold`,'click',()=>{ if(f.collapsed.size) f.collapsed.clear(); else groups.forEach(g=>f.collapsed.add(g.id)); renderTable(sheet); });
  on(`${key}-reset`,'click',()=>{ Object.assign(f,{q:'',pic:'',st:'',brand:'',chk:'',mine:false,news:false}); renderTable(sheet); });
  on(`${key}-addcat`,'click',()=>addCategory(sheet));
  bindBody();
  function bindBody(){
  on(`${key}-colreset`,'click',()=>{ colOrder=[...DEFAULT_COLS]; saveCols(); renderTable(sheet); });
  // 열 드래그
  let dragKey=null;
  document.querySelectorAll(`#v-${key} th.dragcol`).forEach(th=>{
    th.addEventListener('dragstart',e=>{ dragKey=th.dataset.col; th.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; try{e.dataTransfer.setData('text/plain',dragKey);}catch(_){} });
    th.addEventListener('dragend',()=>th.classList.remove('dragging'));
    th.addEventListener('dragover',e=>{ e.preventDefault(); const r=th.getBoundingClientRect(); th.classList.toggle('drop-l', e.clientX<r.left+r.width/2); th.classList.toggle('drop-r', e.clientX>=r.left+r.width/2); });
    th.addEventListener('dragleave',()=>th.classList.remove('drop-l','drop-r'));
    th.addEventListener('drop',e=>{
      e.preventDefault(); const target=th.dataset.col; const r=th.getBoundingClientRect(); const after=e.clientX>=r.left+r.width/2;
      th.classList.remove('drop-l','drop-r');
      if(!dragKey||dragKey===target) return;
      colOrder=colOrder.filter(k=>k!==dragKey); const i=colOrder.indexOf(target); colOrder.splice(after?i+1:i,0,dragKey);
      saveCols(); renderTable(sheet);
    });
  });
  }
}

// ---------------- weekly
function weeklyData(base){
  const w0=new Date(base); w0.setDate(base.getDate()-((base.getDay()+6)%7)); const w1=new Date(w0); w1.setDate(w0.getDate()+6); const lw0=new Date(w0); lw0.setDate(w0.getDate()-7);
  const secs=[
    ['지연','k-late',r=>{const e=pd(r.end_date);return e&&e<base&&r.st!=='Completed'&&r.st!=='Canceled';},'종료일이 기준일보다 지났는데 완료·취소되지 않은 업무'],
    ['이번 주 마감','k-soon',r=>{const e=pd(r.end_date);return e&&e>=w0&&e<=w1;},'종료일이 이번 주(월~일)인 업무'],
    ['진행 중 (다음 주 이후 마감)','k-run',r=>{const s=pd(r.start_date),e=pd(r.end_date);return s&&e&&s<=w1&&e>w1&&r.st!=='Completed'&&r.st!=='Canceled';},'이번 주에 진행 중이고 마감은 다음 주 이후인 업무'],
    ['지난주 완료','k-ok',r=>{const e=pd(r.end_date);return r.st==='Completed'&&e&&e>=lw0&&e<w0;},'지난주에 종료일이 있고 완료 처리된 업무']];
  return {w0,w1,secs};
}
function renderWeekly(){
  const base = ui.weeklyBase || today; const {w0,w1,secs} = weeklyData(base);
  let html = `<div class="toolbar"><label for="wk-base">기준일</label><input type="date" id="wk-base" value="${iso(base)}"><span class="count">이번 주 ${fmtD(w0)} ~ ${fmtD(w1)}</span><button class="btn" type="button" id="wk-copy">보고 문구 복사</button></div>`;
  let text = `[주간 업무 보고] ${fmtD(w0)} ~ ${fmtD(w1)}\n`;
  for(const [sheet,lab] of [['REQ','대표님 REQ'],['WBS','WBS']]){
    html += `<div class="sheet-h">${lab}</div>`; text += `\n■ ${lab}\n`;
    for(const [t,cls,fn,sub] of secs){
      const rows = items.filter(r=>r.sheet===sheet&&isTask(r)&&fn(r)).sort((a,b)=>(pd(a.end_date)||0)-(pd(b.end_date)||0));
      html += `<div class="wk-sec"><h3><span class="chip ${cls}">${t}</span>${rows.length}건 <span style="font-weight:400;color:var(--muted);font-size:12px">${sub}</span></h3>${rows.length?`<div class="tablewrap" style="max-height:none"><table class="fixed"><colgroup><col style="width:76px"><col><col style="width:84px"><col style="width:84px"><col style="width:64px"><col style="width:64px"><col style="width:64px"><col style="width:30%"></colgroup><thead><tr><th>ID</th><th>업무</th><th>PIC</th><th>상태</th><th>Start</th><th>End</th><th>D-day</th><th>비고</th></tr></thead><tbody>${rows.map(r=>{const d=dday(r);return `<tr class="task" data-id="${r.id}"><td class="mono">${r.id}</td><td class="t-name"><span class="cat">${esc(r.cat)}</span><span class="tk">${esc(r.task)}</span></td><td class="nw">${esc(r.pic||'')}</td><td>${stChip(r.st)}</td><td class="mono">${fmtD(pd(r.start_date))}</td><td class="mono">${fmtD(pd(r.end_date))}</td><td class="mono dday ${d!=null&&d<0?'neg':''}">${ddTxt(d)}</td><td class="wrap">${esc(r.note||'')}</td></tr>`;}).join('')}</tbody></table></div>`:''}</div>`;
      text += `- ${t} ${rows.length}건\n` + rows.map(r=>`  · [${r.id}] ${r.cat} - ${r.task||''} (${r.pic||'미지정'}, ~${fmtD(pd(r.end_date))})`).join('\n') + (rows.length?'\n':'');
    }
  }
  $('v-weekly').innerHTML = html;
  $('wk-base').addEventListener('change',e=>{ui.weeklyBase=pd(e.target.value)||null; renderWeekly();});
  $('wk-copy').addEventListener('click',async()=>{ try{ await navigator.clipboard.writeText(text); toast('보고 문구를 복사했습니다. 메신저에 붙여넣으세요.'); }catch(e){ toast('복사하지 못했습니다. 브라우저 권한을 확인하세요.'); } });
}

// ---------------- 확인 창 (실수 방지). 확인이면 true
function confirmBox({title, what='', from, to, ok='변경', cancel='취소'}){
  return new Promise(res => {
    const back = document.createElement('div'); back.className='modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="cb-t"><h3 id="cb-t">${esc(title)}</h3>${what?`<div class="what">${esc(what)}</div>`:''}
      ${from?`<div class="cmp"><div><small>기존</small><b>${from}</b></div><span aria-hidden="true">→</span><div class="new"><small>변경</small><b>${to}</b></div></div>`:''}
      <div class="acts"><button class="btn" type="button" data-r="0">${esc(cancel)}</button><button class="btn primary" type="button" data-r="1">${esc(ok)}</button></div></div>`;
    const done = v => { document.removeEventListener('keydown', key, true); back.remove(); res(v); };
    const key = e => { if(e.key==='Escape'){ e.stopPropagation(); e.preventDefault(); done(false); } else if(e.key==='Enter'){ e.preventDefault(); done(true); } };
    back.addEventListener('click', e => { const b=e.target.closest('[data-r]'); if(b) done(b.dataset.r==='1'); else if(e.target===back) done(false); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(back); back.querySelector('[data-r="1"]').focus();
  });
}
const rangeTxt = (s,e,ms) => ms ? `◆ ${fmt(iso(e))}` : `${s?fmt(iso(s)):'–'} ~ ${fmt(iso(e))}${s?` (${Math.round((e-s)/DAY)+1}일)`:''}`;

// ---------------- gantt — 막대를 끌어 일정 이동, 양 끝을 끌어 시작·마감 조절 (수정 권한이 있는 업무만). ◆ = 마일스톤
const G_ZOOM = {wide:26, mid:12, narrow:5};   // 하루당 px
const addDays = (d,n) => new Date(d.getTime()+n*DAY);
function renderGantt(){
  const sheet = ui.ganttSheet, px = G_ZOOM[ui.ganttZoom]||12, onlyMine = ui.ganttMine;
  const vis = r => !onlyMine || r.pic===me.name || r.bak===me.name;
  const dated = items.filter(r=>r.sheet===sheet&&isTask(r)&&(r.start_date||r.end_date)&&vis(r));
  const ds = dated.flatMap(r=>[pd(r.start_date),pd(r.end_date)]).filter(Boolean);
  const minS = ds.length ? new Date(Math.min(...ds, today.getTime()-14*DAY)) : addDays(today,-14);
  const g0 = new Date(minS); g0.setDate(g0.getDate()-((g0.getDay()+6)%7));
  const maxE = ds.length ? new Date(Math.max(...ds, today.getTime())) : today;
  const weeks = Math.max(8, Math.ceil((maxE-g0)/DAY/7)+3);
  const days = weeks*7, W = days*px, X = d => Math.round((d-g0)/DAY*px);
  let head='', grid='', pm=-1;
  for(let k=0;k<weeks;k++){ const d=addDays(g0,k*7), m=d.getMonth(); head+=`<div class="${m!==pm?'m':''}" style="left:${k*7*px}px">${m!==pm?(m+1)+'월 ':''}${d.getDate()}</div>`; grid+=`<div style="left:${k*7*px}px"></div>`; pm=m; }
  if(px>=G_ZOOM.wide) for(let k=0;k<days;k++) if(k%7) grid+=`<div class="d" style="left:${k*px}px"></div>`;
  const tx = `<div class="g-today" style="left:${X(today)}px" title="오늘"></div>`;
  const bar = r => {
    const s = pd(r.start_date)||pd(r.end_date), e = pd(r.end_date)||s;
    const cls = check(r)==='지연' ? 'late' : ST_CLS[r.st]||'';
    const ed = owns(r) ? 'ed' : '';
    const tip = `${fmtD(s)} ~ ${fmtD(e)} · ${ST_KO[r.st]||''} · ${pct(r.prog)}${owns(r)?' · 끌어서 일정 변경':''}`;
    if(r.is_milestone) return `<div class="g-ms ${cls} ${ed}" data-gb="${r.id}" data-mode="move" style="left:${X(e)+px/2-8}px" title="◆ 마일스톤 ${fmtD(e)}${owns(r)?' · 끌어서 날짜 변경':''}"></div><span class="g-mlab" style="left:${X(e)+px/2+12}px">${fmtD(e)}</span>`;
    return `<div class="g-bar ${cls} ${ed}" data-gb="${r.id}" data-mode="move" style="left:${X(s)}px;width:${Math.max(px, X(addDays(e,1))-X(s))}px" title="${tip}">${r.prog?`<i style="width:${Math.min(1,r.prog)*100}%"></i>`:''}${ed?'<b class="h l" data-mode="start"></b><b class="h r" data-mode="end"></b>':''}</div>`;
  };
  let rows='';
  for(const g of items.filter(r=>r.sheet===sheet&&r.lvl==='L1')){
    const ts = desc(g.id).filter(r=>isTask(r)&&(r.start_date||r.end_date)&&vis(r));
    if(onlyMine && !ts.length) continue;
    const a=groupAgg(g);
    rows += `<div class="g-row g1"><div class="g-lab">${esc(g.num)}. ${esc(g.cat)}</div><div class="g-track"><div class="g-grid">${grid}</div>${tx}${a.start&&a.end?`<div class="g-bar grp" style="left:${X(a.start)}px;width:${Math.max(px,X(addDays(a.end,1))-X(a.start))}px"></div>`:''}</div></div>`;
    for(const r of ts){
      rows += `<div class="g-row" data-id="${r.id}"><div class="g-lab" title="${esc(titleOf(r))} · PIC ${esc(r.pic||'–')}"><span class="mono" style="color:var(--muted)">${r.id}</span><span class="g-nm">${newsOf(r)?'<i class="nb-dot" title="새 소식"></i>':''}${r.is_milestone?'◆ ':''}${esc(r.cat)}</span><span class="g-pic">${esc(r.pic||'')}</span></div><div class="g-track">${`<div class="g-grid">${grid}</div>`}${tx}${bar(r)}</div></div>`;
    }
  }
  $('v-gantt').innerHTML = `<div class="toolbar">
      <select id="g-sheet" aria-label="시트"><option value="WBS" ${sheet==='WBS'?'selected':''}>WBS</option><option value="REQ" ${sheet==='REQ'?'selected':''}>대표님 REQ</option></select>
      <div class="vt" role="group" aria-label="확대"><button type="button" data-gz="narrow" class="${ui.ganttZoom==='narrow'?'on':''}">분기</button><button type="button" data-gz="mid" class="${ui.ganttZoom==='mid'?'on':''}">월</button><button type="button" data-gz="wide" class="${ui.ganttZoom==='wide'?'on':''}">주</button></div>
      <label class="chk-inline"><input type="checkbox" id="g-mine" ${onlyMine?'checked':''}> 내 업무만</label>
      <button class="btn" type="button" id="g-today">오늘로</button>
      <div class="legend" style="margin:0"><span><i class="s-ip"></i>진행 중</span><span><i class="s-pl"></i>예정</span><span><i class="s-oh"></i>보류</span><span><i class="s-co"></i>완료</span><span><i style="background:var(--bad)"></i>지연</span><span>◆ 마일스톤 · 초록 세로선 = 오늘</span></div>
      <span class="count">막대를 끌면 일정 이동 · 양 끝을 끌면 시작·마감 조절 (내 업무만)</span></div>
    <div class="gantt" id="g-box"><div class="g-head" style="grid-template-columns:300px ${W}px;width:${300+W}px"><div class="g-lab">업무</div><div class="g-weeks">${head}</div></div>${rows.replace(/class="g-row/g,`style="grid-template-columns:300px ${W}px;width:${300+W}px" class="g-row`)||'<div class="empty">일정이 있는 업무가 없어요.</div>'}</div>
    <div class="g-tip hidden" id="g-tip"></div>`;
  $('g-sheet').onchange = e => { ui.ganttSheet=e.target.value; renderGantt(); };
  $('g-mine').onchange = e => { ui.ganttMine=e.target.checked; renderGantt(); };
  document.querySelectorAll('[data-gz]').forEach(b=>b.onclick=()=>{ ui.ganttZoom=b.dataset.gz; ui.ganttScrolled=false; renderGantt(); });
  const box = $('g-box');
  const scrollToday = () => { box.scrollLeft = Math.max(0, X(today) - (box.clientWidth-300)/3); };
  $('g-today').onclick = scrollToday;
  if(!ui.ganttScrolled){ scrollToday(); ui.ganttScrolled = true; }
  bindGanttDrag(box, px);
}
function bindGanttDrag(box, px){
  let drag = null;
  const tip = $('g-tip');
  box.addEventListener('pointerdown', e => {
    const el = e.target.closest('[data-gb].ed'); if(!el || e.button!==0) return;
    const r = byId[el.dataset.gb]; if(!r || !owns(r)) return;
    const mode = e.target.dataset.mode || 'move';
    const s = pd(r.start_date)||pd(r.end_date), en = pd(r.end_date)||s;
    drag = {el, r, mode, x0:e.clientX, s, e:en, left:el.offsetLeft, width:el.offsetWidth, dd:0, moved:false};
    el.setPointerCapture(e.pointerId); el.classList.add('dragging'); e.preventDefault();
  });
  box.addEventListener('pointermove', e => {
    if(!drag) return;
    const dd = Math.round((e.clientX-drag.x0)/px); if(Math.abs(e.clientX-drag.x0)>3) drag.moved = true;
    let s = drag.s, en = drag.e;
    if(drag.mode==='move'){ s = addDays(s,dd); en = addDays(en,dd); }
    else if(drag.mode==='start'){ s = addDays(s,dd); if(s>en) s = en; }
    else { en = addDays(en,dd); if(en<s) en = s; }
    drag.ns = s; drag.ne = en;
    const ms = drag.r.is_milestone;
    if(ms) drag.el.style.left = (drag.left + dd*px) + 'px';
    else { const L = drag.left + Math.round((s-drag.s)/DAY)*px; drag.el.style.left = L+'px'; drag.el.style.width = Math.max(px, drag.width + Math.round(((en-drag.e)-(s-drag.s))/DAY)*px)+'px'; }
    tip.textContent = ms ? `◆ ${fmt(iso(en))}` : `${fmt(iso(s))} ~ ${fmt(iso(en))} (${Math.round((en-s)/DAY)+1}일)`;
    tip.style.left = (e.clientX+14)+'px'; tip.style.top = (e.clientY+14)+'px'; tip.classList.remove('hidden');
  });
  const end = async e => {
    if(!drag) return; const d = drag; drag = null; tip.classList.add('hidden'); d.el.classList.remove('dragging');
    if(!d.moved || !d.ns){ return; }
    d.el.dataset.justDragged = '1'; setTimeout(()=>{ delete d.el.dataset.justDragged; }, 300);
    const patch = {};
    if(iso(d.ns)!==(d.r.start_date||'').slice(0,10) && d.r.start_date) patch.start_date = iso(d.ns);
    if(iso(d.ne)!==(d.r.end_date||'').slice(0,10)) patch.end_date = iso(d.ne);
    if(d.r.is_milestone && d.r.start_date) patch.start_date = iso(d.ne);
    if(!Object.keys(patch).length){ renderGantt(); return; }
    const ms = !!d.r.is_milestone, hasS = !!d.r.start_date;
    const yes = await confirmBox({title: ms?'마일스톤 날짜를 바꿀까요?':'일정을 변경할까요?', what: titleOf(d.r),
      from: rangeTxt(hasS?d.s:null, d.e, ms), to: rangeTxt(hasS?d.ns:null, d.ne, ms), ok:'변경'});
    if(!yes){ renderGantt(); toast('일정 변경을 취소했어요.'); return; }
    const ok = await quickUpdate(d.r, patch);
    if(ok) toast(`일정을 ${fmtD(pd(d.r.start_date))||''}${d.r.start_date?' ~ ':''}${fmtD(pd(d.r.end_date))}로 바꿨어요.`);
    renderGantt();
  };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  // 끌고 난 직후의 클릭은 상세 열기로 처리하지 않음
  box.addEventListener('click', e => { if(e.target.closest('[data-just-dragged]')) e.stopPropagation(); }, true);
}

// ---------------- 마케팅 캘린더 — 월 보기, 브랜드별 색, 여러 날 업무는 막대로 이어서 표시
const BRAND_CLS = {'메디원':'b1','유프관':'b2','메디원&유프관':'b3','아임이그잼':'b4','인노트':'b5','제이콘':'b6','공통':'b0','기타':'b0'};
const CAL_LANES = 4;
function calItems(){
  const f = ui.cal;
  // 기본: 단발·행사 업무와 마일스톤만 (몇 달씩 이어지는 상시 업무는 달력을 가려서 '전체'에서만)
  const evt = r => r.is_milestone || !r.cyc || r.cyc==='단발' || r.cyc==='행사별' || (()=>{ const s=pd(r.start_date), e=pd(r.end_date); return s&&e&&(e-s)/DAY<=31; })();
  return items.filter(r=>isTask(r) && (r.start_date||r.end_date) && r.st!=='Canceled' && (f.scope==='all' || evt(r))
    && (!f.sheet || r.sheet===f.sheet)
    && (!f.who || (f.who==='@me' ? (r.pic===me.name||r.bak===me.name) : r.pic===f.who))
    && (!f.brand || r.brand===f.brand));
}
function renderCal(){
  const f = ui.cal;
  if(f.y==null){ f.y = today.getFullYear(); f.m = today.getMonth(); }
  const first = new Date(f.y, f.m, 1), last = new Date(f.y, f.m+1, 0);
  const c0 = addDays(first, -((first.getDay()+6)%7));
  const nWeeks = Math.ceil(((last-c0)/DAY+1)/7);
  const list = calItems().map(r=>{ const s=pd(r.start_date)||pd(r.end_date), e=pd(r.end_date)||s; return {r, s: r.is_milestone?e:s, e: e<s?s:e}; });
  let weeksHtml = '';
  for(let w=0; w<nWeeks; w++){
    const w0 = addDays(c0, w*7), w1 = addDays(w0, 6);
    const segs = list.filter(x=>x.s<=w1 && x.e>=w0).map(x=>({...x, a:Math.max(0,Math.round((x.s-w0)/DAY)), b:Math.min(6,Math.round((x.e-w0)/DAY))}))
      .sort((p,q)=>(q.r.is_milestone?1:0)-(p.r.is_milestone?1:0) || p.a-q.a || (q.b-q.a)-(p.b-p.a));
    const lanes = [], more = Array(7).fill(0), placed = [];
    for(const sg of segs){
      let li = lanes.findIndex(end=>end < sg.a);
      if(li<0){ li = lanes.length; lanes.push(-1); }
      if(li >= CAL_LANES){ for(let d=sg.a; d<=sg.b; d++) more[d]++; continue; }
      lanes[li] = sg.b; placed.push({...sg, li});
    }
    let cells = '';
    for(let d=0; d<7; d++){
      const day = addDays(w0,d), out = day.getMonth()!==f.m, isT = +day===+today, we = d>=5;
      cells += `<div class="cal-d ${out?'out':''} ${isT?'today':''} ${we?'we':''}" style="grid-column:${d+1};grid-row:1 / span ${CAL_LANES+2}"><span class="dn">${day.getDate()}</span></div>`;
      if(more[d]) cells += `<button type="button" class="cal-more" data-day="${iso(day)}" style="grid-column:${d+1};grid-row:${CAL_LANES+2}">+${more[d]}건 더보기</button>`;
    }
    const bars = placed.map(sg=>{
      const r = sg.r, c = check(r);
      const cls = [BRAND_CLS[r.brand]||'b0', r.st==='Completed'?'done':'', c==='지연'?'late':'', sg.s<w0?'cont-l':'', sg.e>w1?'cont-r':'', r.is_milestone?'ms':''].join(' ');
      return `<button type="button" class="cal-bar ${cls}" data-open="${r.id}" style="grid-column:${sg.a+1} / ${sg.b+2};grid-row:${sg.li+2}" title="${esc(titleOf(r))} · ${esc(r.brand||'')} · PIC ${esc(r.pic||'–')} · ${fmtD(sg.s)}~${fmtD(sg.e)} · ${ST_KO[r.st]||''}">${r.is_milestone?'◆ ':''}${esc(r.cat||r.task||'')}${r.pic&&f.who!=='@me'?` <span class="who">${esc(r.pic)}</span>`:''}</button>`;
    }).join('');
    weeksHtml += `<div class="cal-w" style="grid-template-rows:24px repeat(${CAL_LANES},22px) 20px">${cells}${bars}</div>`;
  }
  const brands = [...new Set(items.filter(isTask).map(r=>r.brand).filter(Boolean))];
  const opt = (v,l,sel) => `<option value="${esc(v)}" ${v===sel?'selected':''}>${esc(l)}</option>`;
  $('v-cal').innerHTML = `
    <div class="toolbar">
      <button class="btn" type="button" data-cm="-1" aria-label="이전 달">‹</button>
      <b class="cal-title">${f.y}년 ${f.m+1}월</b>
      <button class="btn" type="button" data-cm="1" aria-label="다음 달">›</button>
      <button class="btn" type="button" data-cm="0">이번 달</button>
      <div class="vt" role="group" aria-label="표시 범위"><button type="button" data-cs="event" class="${f.scope!=='all'?'on':''}" title="단발·행사 업무, 한 달 이내 업무, 마일스톤">캠페인·행사</button><button type="button" data-cs="all" class="${f.scope==='all'?'on':''}" title="상시 업무 포함">전체</button></div>
      <select id="cal-sheet" aria-label="구분">${opt('','WBS + 대표님 REQ',f.sheet)}${opt('WBS','WBS',f.sheet)}${opt('REQ','대표님 REQ',f.sheet)}</select>
      <select id="cal-who" aria-label="담당">${opt('','전체 담당자',f.who)}${opt('@me','내 업무 (PIC·Backup)',f.who)}${PEOPLE.map(p=>opt(p,p,f.who)).join('')}</select>
      <select id="cal-brand" aria-label="브랜드">${opt('','전체 브랜드',f.brand)}${brands.map(b=>opt(b,b,f.brand)).join('')}</select>
      <div class="legend cal-leg" style="margin:0">${Object.entries(BRAND_CLS).filter(([b])=>b!=='기타').map(([b,c])=>`<span><i class="${c}"></i>${esc(b)}</span>`).join('')}<span>◆ 마일스톤</span><span><i class="late-i"></i>지연</span></div>
    </div>
    <div class="cal">
      <div class="cal-hd">${['월','화','수','목','금','토','일'].map((d,i)=>`<div class="${i>=5?'we':''}">${d}</div>`).join('')}</div>
      ${weeksHtml}
    </div>`;
  const el = $('v-cal');
  el.querySelectorAll('[data-cm]').forEach(b=>b.onclick=()=>{ const k=+b.dataset.cm; if(!k){ f.y=today.getFullYear(); f.m=today.getMonth(); } else { const d=new Date(f.y,f.m+k,1); f.y=d.getFullYear(); f.m=d.getMonth(); } renderCal(); });
  el.querySelectorAll('[data-cs]').forEach(b=>b.onclick=()=>{ f.scope=b.dataset.cs; renderCal(); });
  $('cal-sheet').onchange=e=>{ f.sheet=e.target.value; renderCal(); };
  $('cal-who').onchange=e=>{ f.who=e.target.value; renderCal(); };
  $('cal-brand').onchange=e=>{ f.brand=e.target.value; renderCal(); };
  el.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openDrawer(b.dataset.open));
  el.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>openDay(b.dataset.day));
}
function openDay(ds){
  const d = pd(ds); selId = null;
  const rs = calItems().filter(r=>{ const s=pd(r.start_date)||pd(r.end_date), e=pd(r.end_date)||s; return (r.is_milestone?e:s)<=d && e>=d; });
  drawer.innerHTML = `<header><div style="flex:1"><div class="id">${rs.length}건</div><h3>${d.getMonth()+1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})</h3></div><button class="btn" type="button" id="dy-close">닫기</button></header>
    <div class="body"><div class="side-list">${rs.map(r=>`<button type="button" data-open="${r.id}"><span><i class="cal-dot ${BRAND_CLS[r.brand]||'b0'}"></i>${r.is_milestone?'◆ ':''}${esc(titleOf(r))}</span><span class="hist" style="display:inline">${esc(r.brand||'')} · PIC ${esc(r.pic||'–')} · ${fmtD(pd(r.start_date))||''}~${fmtD(pd(r.end_date))||''} · ${ST_KO[r.st]||''}</span></button>`).join('')}</div></div>`;
  drawer.classList.add('on'); scrim.classList.add('on');
  $('dy-close').onclick = closeDrawer;
  drawer.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openDrawer(b.dataset.open));
}

// ---------------- 내 업무 (로그인 후 첫 화면) — 내가 PIC인 업무를 빠르게 확인·업데이트·등록
const STALE_DAYS = 7;
const PROG_STEPS = [0, .25, .5, .75, 1];
const DONE = s => s==='Completed' || s==='Canceled';
const stale = r => isTask(r) && r.st==='In Progress' && r.updated_at && (Date.now()-new Date(r.updated_at).getTime())/DAY >= STALE_DAYS;
const ckStat = id => { const a = CHECKS[id]||[]; return {n:a.length, done:a.filter(c=>c.done).length}; };
const titleOf = r => r.task && r.cat ? `${r.cat} · ${r.task}` : (r.cat || r.task || '(제목 없음)');
const ago = t => { const d = Math.floor((Date.now()-new Date(t).getTime())/DAY); return d<=0?'오늘':d===1?'어제':d+'일 전'; };
function weekRange(){ const w0=new Date(today); w0.setDate(today.getDate()-((today.getDay()+6)%7)); const w1=new Date(w0); w1.setDate(w0.getDate()+6); return [w0,w1]; }
function focusRank(r){
  const c = check(r), e = pd(r.end_date);
  if(DONE(r.st)) return [9, -(new Date(r.updated_at||0).getTime())];
  if(r.st==='On Hold') return [5, e?e.getTime():9e15];
  if(c==='지연') return [0, e.getTime()];
  return [e?1:3, e?e.getTime():9e15];
}
async function loadChecks(){
  const { data, error } = await sb.from('item_checks').select('*').order('sort_order');
  CHECKS = {};
  if(error) return;   // 005 마이그레이션 전이면 체크리스트 없이 동작
  for(const c of data){ (CHECKS[c.item_id] ||= []).push(c); }
}

// 목록에서 바로 바꾸기 (상태·진척률·메모). 변경 이력에 자동 기록
async function quickUpdate(r, patch){
  if(!owns(r)){ toast('담당자(PIC·Backup)나 등록한 사람만 수정할 수 있어요.'); return false; }
  const nextSt = patch.st!==undefined ? patch.st : r.st;
  if(isTask(r) && patch.st==='Completed' && (r.prog==null || r.prog<1) && !ckStat(r.id).n) patch.prog = 1;
  if(patch.prog!=null && patch.prog>0 && nextSt==='Planned' && patch.st===undefined) patch.st = 'In Progress';
  const changes = [];
  for(const k of Object.keys(patch)){
    const o = r[k]==null?null:r[k], v = patch[k];
    if(String(o)===String(v)){ delete patch[k]; continue; }
    changes.push(`${LABELS[k]}: ${k==='prog'?pct(o):k==='st'?(ST_KO[o]||o||'–'):(o??'–')} → ${k==='prog'?pct(v):k==='st'?(ST_KO[v]||v):(v??'–')}`);
  }
  if(!changes.length) return true;
  patch.updated_by = me.name; patch.updated_at = new Date().toISOString();
  const { data, error } = await sb.from('items').update(patch).eq('id',r.id).eq('updated_at',r.updated_at).select();
  if(error){ toast('저장하지 못했어요: '+error.message); return false; }
  if(!data.length){ await loadItems(); rerender(); toast('다른 사람이 먼저 수정했어요. 최신 내용으로 다시 불러왔어요.'); return false; }
  Object.assign(r, norm(data[0]));
  await sb.from('item_history').insert({item_id:r.id, changed_by:me.name, changes:changes.join(' / ')});
  return true;
}

function myRow(r){
  const c = check(r), d = dday(r), ck = ckStat(r.id), ed = owns(r);
  const sub = [r.brand, r.num && `${r.sheet==='REQ'?'REQ ':''}${r.num}`, d!=null && ddTxt(d), ck.n && `체크 ${ck.done}/${ck.n}`, CMT_N[r.id] && `댓글 ${CMT_N[r.id]}`].filter(Boolean).map(esc).join(' · ');
  const seg = PROG_STEPS.map(p=>`<button type="button" data-pg="${p}" class="${r.prog!=null && Math.round(r.prog*100)>=p*100 && (p>0||r.prog===0)?'on':''}" ${ed&&!ck.n?'':'disabled'} title="${ck.n?'체크리스트로 자동 계산':Math.round(p*100)+'%'}">${Math.round(p*100)}</button>`).join('');
  return `<div class="mrow" data-row="${r.id}">
    <div class="mt"><button type="button" class="t" data-open="${r.id}">${esc(titleOf(r))}</button>${newsChip(r)}
      <div class="sub">${sub}${c && c!=='진행' && c!=='예정' ? ' '+chkChip(c):''}${stale(r)?` <span class="chip k-warn">${ago(r.updated_at)} 업데이트</span>`:''}</div></div>
    <select data-st aria-label="진행 상태" ${ed?'':'disabled'}>${STATUS.map(s=>`<option value="${s}" ${s===r.st?'selected':''}>${ST_KO[s]}</option>`).join('')}${r.st?'':'<option value="" selected>상태 없음</option>'}</select>
    <div class="seg" role="group" aria-label="진척률">${seg}</div>
    <button type="button" class="iconbtn" data-memo aria-label="한 줄 메모" title="한 줄 메모" ${ed?'':'disabled'}>✎</button>
    ${r.memo?`<div class="memo">${esc(r.memo)}</div>`:''}
  </div>`;
}
function bCard(r){
  const d=dday(r), ck=ckStat(r.id);
  return `<div class="bcard" draggable="${owns(r)}" data-card="${r.id}"><button type="button" class="t" data-open="${r.id}">${esc(titleOf(r))}</button>${newsChip(r)}
    <div class="sub">${[r.brand, d!=null&&ddTxt(d), r.prog!=null&&pct(r.prog), ck.n&&`체크 ${ck.done}/${ck.n}`, CMT_N[r.id]&&`댓글 ${CMT_N[r.id]}`].filter(Boolean).map(esc).join(' · ')} ${check(r)==='지연'?chkChip('지연'):''}</div></div>`;
}

function renderMy(){
  const el = $('v-my'), f = ui.my;
  const [w0,w1] = weekRange();
  const mineAll = items.filter(r=>isTask(r) && r.pic===me.name);
  const open = mineAll.filter(r=>!DONE(r.st));
  const inWeek = r => { const e=pd(r.end_date); return e && e>=w0 && e<=w1; };
  const late = open.filter(r=>check(r)==='지연'), week = open.filter(inWeek), ip = open.filter(r=>r.st==='In Progress'), st = open.filter(stale);
  const todayN = open.filter(r=>{ const e=pd(r.end_date); return check(r)==='지연' || (e && e<=today); }).length;
  const FILTERS = {late:['지연',late], week:['이번 주 마감',week], ip:['진행 중',ip], stale:['업데이트 필요',st]};
  let list = f.filter && FILTERS[f.filter] ? FILTERS[f.filter][1] : (f.done ? mineAll : open);
  list = [...list].sort((a,b)=>{ const x=focusRank(a), y=focusRank(b); return x[0]-y[0] || x[1]-y[1]; });
  const tile = (k,label,arr,cls,sub) => `<button class="tile ${cls||''} ${f.filter===k?'on':''}" type="button" data-myf="${k}"><span class="k">${label}</span><span class="v">${arr.length}</span><span class="s">${sub}</span></button>`;
  const bak = items.filter(r=>isTask(r) && r.bak===me.name && !DONE(r.st));
  const all = items.filter(r=>isTask(r) && r.pic==='전원' && !DONE(r.st));
  const inbox = items.filter(r=>r.parent && /-INBOX$/.test(r.parent));
  const ed = canEdit();
  const board = () => `<div class="board">${['Planned','In Progress','On Hold','Completed'].map(s=>{
      let cs = mineAll.filter(r=>r.st===s);
      if(s==='Completed') cs = cs.sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at)).slice(0,12);
      else cs = cs.sort((a,b)=>{ const x=focusRank(a), y=focusRank(b); return x[0]-y[0] || x[1]-y[1]; });
      return `<div class="bcol" data-col="${s}"><div class="bh">${stChip(s)} <span class="mono">${cs.length}</span>${s==='Completed'?' <span class="hist" style="display:inline">최근</span>':''}</div>${cs.map(bCard).join('')||'<div class="hist" style="padding:6px 2px">여기로 끌어 놓으면 상태가 바뀌어요</div>'}</div>`;
    }).join('')}</div>`;
  el.innerHTML = `<div class="band">
    <div class="my-head">
      <h2>${esc(me.name)} 님, 오늘 챙길 업무 ${todayN}건</h2>
      <span class="hist" style="display:inline">${fmtD(w0)} ~ ${fmtD(w1)} 주 · 진행 중 ${ip.length}건</span>
      <div class="spacer"></div>
      <button class="btn" type="button" id="my-report">내 주간보고 복사</button>
      ${ed?'<button class="btn mint" type="button" id="my-add">+ 업무 등록</button>':''}
    </div>
    <div class="grid-tiles four">
      ${tile('late','지연',late,'bad','마감일이 지났어요')}
      ${tile('week','이번 주 마감',week,'warn',`${fmtD(w0)} ~ ${fmtD(w1)}`)}
      ${tile('ip','진행 중',ip,'','지금 하고 있는 업무')}
      ${tile('stale','업데이트 필요',st,'caution',`진행 중인데 ${STALE_DAYS}일 넘게 그대로`)}
    </div></div>
    <div class="my-grid">
      <div class="panel" style="padding:0">
        <div class="ph"><b>${f.filter?esc(FILTERS[f.filter][0]):'오늘 집중'}</b>
          <span class="hist" style="display:inline">${f.filter?`<button type="button" class="linkbtn" data-myf="">필터 해제</button>`:'지연 → 마감 가까운 순'}</span>
          <div class="spacer"></div>
          ${f.view==='list'&&!f.filter?`<label class="chk-inline"><input type="checkbox" id="my-done" ${f.done?'checked':''}> 완료 포함</label>`:''}
          <div class="vt" role="group" aria-label="보기"><button type="button" data-myv="list" class="${f.view==='list'?'on':''}">목록</button><button type="button" data-myv="board" class="${f.view==='board'?'on':''}">보드</button></div>
        </div>
        ${f.view==='board' ? `<div style="padding:12px">${board()}</div>` : (list.length ? `<div class="mylist">${list.map(myRow).join('')}</div>` : `<div class="empty">${mineAll.length?'해당하는 업무가 없어요.':'내가 PIC인 업무가 아직 없어요. 오른쪽 위 \'+ 업무 등록\'으로 시작하세요.'}</div>`)}
      </div>
      <div class="side">
        <div class="panel"><h2 class="sec">내가 백업인 업무 <span class="hist" style="display:inline">${bak.length}건</span></h2>
          <div class="side-list">${bak.slice(0,8).map(r=>`<button type="button" data-open="${r.id}"><span>${esc(titleOf(r))}${newsChip(r)}</span><span class="hist" style="display:inline">${esc(r.pic||'')}${dday(r)!=null?' · '+ddTxt(dday(r)):''}</span></button>`).join('')||'<div class="hist">없어요.</div>'}</div></div>
        ${all.length?`<div class="panel"><h2 class="sec">전원 업무 <span class="hist" style="display:inline">${all.length}건</span></h2>
          <div class="side-list">${all.slice(0,6).map(r=>`<button type="button" data-open="${r.id}"><span>${esc(titleOf(r))}${newsChip(r)}</span><span class="hist" style="display:inline">${stChip(r.st)}</span></button>`).join('')}</div></div>`:''}
        <div class="panel"><h2 class="sec">내 업무 소식 <span class="hist" style="display:inline">최근 14일 · 다른 사람이 바꾼 내용</span></h2><div class="hist" id="my-news"><div>불러오는 중…</div></div></div>
        ${me.role==='admin'&&inbox.length?`<div class="panel"><h2 class="sec">미분류함 <span class="hist" style="display:inline">${inbox.length}건 · WBS 위치 정리 필요</span></h2>
          <div class="side-list">${inbox.slice(0,6).map(r=>`<button type="button" data-open="${r.id}"><span>${esc(titleOf(r))}</span><span class="hist" style="display:inline">${esc(r.created_by||r.pic||'')}</span></button>`).join('')}</div></div>`:''}
      </div>
    </div>`;
  loadNews(mineAll.concat(bak).map(r=>r.id));
}
async function loadNews(ids){
  const box = () => $('my-news');
  if(!ids.length){ if(box()) box().innerHTML='<div>아직 소식이 없어요.</div>'; return; }
  const since = new Date(Date.now()-14*DAY).toISOString();
  const { data, error } = await sb.from('item_history').select('item_id,changed_at,changed_by,changes').in('item_id',ids.slice(0,200)).neq('changed_by',me.name).gte('changed_at',since).order('changed_at',{ascending:false}).limit(8);
  if(!box()) return;
  box().innerHTML = error ? '<div>소식을 불러오지 못했어요.</div>' : (data.length ? data.map(h=>`<div><button type="button" class="linkbtn" data-open="${esc(h.item_id)}">${esc(titleOf(byId[h.item_id]||{cat:h.item_id}))}</button><br>${esc(h.changed_by)} · ${ago(h.changed_at)} · ${esc(h.changes)}</div>`).join('') : '<div>최근 14일 동안 다른 사람이 바꾼 내용이 없어요.</div>');
}
function myReport(){
  const [w0,w1] = weekRange(); const p0=new Date(w0); p0.setDate(w0.getDate()-7);
  const mine = items.filter(r=>isTask(r) && r.pic===me.name);
  const doneLast = mine.filter(r=>r.st==='Completed' && new Date(r.updated_at)>=p0);
  const ipL = mine.filter(r=>r.st==='In Progress');
  const dueW = mine.filter(r=>!DONE(r.st) && (()=>{const e=pd(r.end_date); return e&&e>=w0&&e<=w1;})());
  const lateL = mine.filter(r=>check(r)==='지연');
  const line = (r,x) => `- ${titleOf(r)}${r.brand?` (${r.brand})`:''}${x?' · '+x:''}`;
  const sec = (t,arr,fn) => `■ ${t} (${arr.length})\n${arr.length?arr.map(fn).join('\n'):'- 없음'}`;
  return [`[${me.name} 주간 업무 · ${fmtD(w0)}~${fmtD(w1)}]`,
    sec('지난주 이후 완료', doneLast, r=>line(r)),
    sec('진행 중', ipL, r=>line(r, [r.prog!=null&&pct(r.prog), r.memo].filter(Boolean).join(' · '))),
    sec('이번 주 마감', dueW, r=>line(r, fmtD(pd(r.end_date)))),
    sec('지연', lateL, r=>line(r, `${ddTxt(dday(r))}${r.memo?' · '+r.memo:''}`))].join('\n\n');
}
function bindMy(){
  const el = $('v-my');
  el.addEventListener('click', async e => {
    const o = e.target.closest('[data-open]'); if(o){ openDrawer(o.dataset.open); return; }
    const fl = e.target.closest('[data-myf]'); if(fl){ ui.my.filter = ui.my.filter===fl.dataset.myf ? '' : fl.dataset.myf; if(ui.my.filter) ui.my.view='list'; renderMy(); return; }
    const vv = e.target.closest('[data-myv]'); if(vv){ ui.my.view = vv.dataset.myv; if(vv.dataset.myv==='board') ui.my.filter=''; try{localStorage.setItem('jcwbs-myview',ui.my.view);}catch(_){}; renderMy(); return; }
    if(e.target.id==='my-add'){ openQuickAdd(); return; }
    if(e.target.id==='my-report'){ const t=myReport(); try{ await navigator.clipboard.writeText(t); toast('내 주간보고를 복사했어요. 메신저나 메일에 붙여넣으세요.'); }catch(_){ openText('내 주간보고', t); } return; }
    const row = e.target.closest('[data-row]'); if(!row) return; const r = byId[row.dataset.row]; if(!r) return;
    const pg = e.target.closest('[data-pg]');
    if(pg && !pg.disabled){ if(await quickUpdate(r,{prog:Number(pg.dataset.pg)})) { toast(`진척률 ${pct(r.prog)}`); renderMy(); } return; }
    if(e.target.closest('[data-memo]')){
      if(row.querySelector('.memo-in')) return;
      row.insertAdjacentHTML('beforeend', `<form class="memo-in"><input maxlength="200" placeholder="오늘 한 일, 막힌 점, 다음 할 일" value="${esc(r.memo||'')}" aria-label="한 줄 메모"><button class="btn primary" type="submit">저장</button><button class="btn" type="button" data-x>취소</button></form>`);
      const fm = row.querySelector('.memo-in'), inp = fm.querySelector('input'); inp.focus(); inp.select();
      fm.querySelector('[data-x]').onclick = () => fm.remove();
      fm.onsubmit = async ev => { ev.preventDefault(); if(await quickUpdate(r,{memo:inp.value.trim()||null})){ toast('메모를 남겼어요.'); renderMy(); } };
    }
  });
  el.addEventListener('change', async e => {
    if(e.target.id==='my-done'){ ui.my.done = e.target.checked; renderMy(); return; }
    if(e.target.matches('[data-st]')){ const r = byId[e.target.closest('[data-row]').dataset.row]; if(await quickUpdate(r,{st:e.target.value})) toast(`${ST_KO[r.st]}(으)로 바꿨어요.`); renderMy(); }
  });
  // 보드: 카드를 다른 칸으로 끌어 놓으면 상태 변경
  el.addEventListener('dragstart', e => { const c=e.target.closest('[data-card]'); if(c){ e.dataTransfer.setData('text/plain', c.dataset.card); e.dataTransfer.effectAllowed='move'; } });
  el.addEventListener('dragover', e => { const col=e.target.closest('[data-col]'); if(col){ e.preventDefault(); col.classList.add('over'); } });
  el.addEventListener('dragleave', e => { const col=e.target.closest('[data-col]'); if(col && !col.contains(e.relatedTarget)) col.classList.remove('over'); });
  el.addEventListener('drop', async e => {
    const col=e.target.closest('[data-col]'); if(!col) return; e.preventDefault(); col.classList.remove('over');
    const r = byId[e.dataTransfer.getData('text/plain')]; if(!r || r.st===col.dataset.col) return;
    if(await quickUpdate(r,{st:col.dataset.col})) toast(`${ST_KO[r.st]}(으)로 옮겼어요.`); renderMy();
  });
}
function openText(title, text){
  selId=null;
  drawer.innerHTML = `<header><div style="flex:1"><h3>${esc(title)}</h3></div><button class="btn" type="button" id="tx-close">닫기</button></header><div class="body"><p class="hist" style="margin:0">아래 내용을 전체 선택해서 복사하세요.</p><textarea style="min-height:60vh;border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--bg)" readonly>${esc(text)}</textarea></div>`;
  drawer.classList.add('on'); scrim.classList.add('on'); $('tx-close').onclick=closeDrawer;
}

// ---- 빠른 업무 등록: 업무명 + 마감일만 있으면 등록. 위치를 비우면 미분류함
function placeOptions(sheet, sel){
  const inbox = items.find(x=>x.id===`${sheet}-INBOX`);
  const opts = items.filter(x=>x.sheet===sheet && x.id!==`${sheet}-INBOX` && (x.lvl==='L1' || x.lvl==='T' || x.lvl==='P'));
  return (inbox?`<option value="${inbox.id}" ${!sel||sel===inbox.id?'selected':''}>미분류함 (위치는 나중에 관리자가 정리)</option>`:'<option value="">위치를 고르세요</option>')
    + opts.map(x=>`<option value="${x.id}" ${x.id===sel?'selected':''}>${x.lvl==='L1'?'■ ':'　└ '}${esc(x.num)} ${esc(x.cat||'')}</option>`).join('');
}
function openQuickAdd(){
  if(!canEdit()) return; selId=null;
  drawer.innerHTML = `
    <header><div style="flex:1"><div class="id">PIC ${esc(me.name)}</div><h3>업무 등록</h3></div><button class="btn" type="button" id="qa-close">닫기</button></header>
    <form class="body" id="qa-form">
      <div class="fgrid">
        <div class="field full"><label for="qa-name">업무명 *</label><input id="qa-name" required maxlength="120" placeholder="11월 블로그 원고 4건 발행"></div>
        <div class="field"><label for="qa-start">시작일</label><input id="qa-start" type="date" value="${iso(today)}"></div>
        <div class="field"><label for="qa-end">마감일</label><input id="qa-end" type="date"></div>
        <div class="field"><label for="qa-sheet">구분</label><select id="qa-sheet"><option value="WBS">WBS</option><option value="REQ">대표님 REQ</option></select></div>
        <div class="field"><label for="qa-brand">브랜드</label><select id="qa-brand">${BRANDS.map(b=>`<option ${b==='공통'?'selected':''}>${esc(b)}</option>`).join('')}</select></div>
        <div class="field full"><label for="qa-parent">위치 (WBS 상위 항목)</label><select id="qa-parent">${placeOptions('WBS')}</select></div>
        <div class="field"><label for="qa-pic">PIC</label><select id="qa-pic">${PEOPLE.map(p=>`<option ${p===me.name?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
        <div class="field"><label for="qa-bak">Backup</label><select id="qa-bak"><option value=""></option>${PEOPLE.filter(p=>p!=='전원').map(p=>`<option>${esc(p)}</option>`).join('')}</select></div>
        <div class="field full"><label for="qa-checks">체크리스트 (선택, 한 줄에 하나 · 있으면 진척률 자동 계산)</label><textarea id="qa-checks" placeholder="원고 1&#10;원고 2&#10;원고 3&#10;원고 4"></textarea></div>
      </div>
      <div class="hist" id="qa-msg"></div>
    </form>
    <footer><button class="btn" type="button" id="qa-cancel">취소</button><button class="btn primary" type="submit" form="qa-form" id="qa-save">등록</button></footer>`;
  drawer.classList.add('on'); scrim.classList.add('on');
  $('qa-close').onclick = $('qa-cancel').onclick = closeDrawer;
  $('qa-sheet').onchange = e => { $('qa-parent').innerHTML = placeOptions(e.target.value); };
  $('qa-name').focus();
  $('qa-form').onsubmit = async e => {
    e.preventDefault();
    const name=$('qa-name').value.trim(), parent=$('qa-parent').value, s=$('qa-start').value||null, en=$('qa-end').value||null;
    if(!name){ $('qa-msg').textContent='업무명을 입력하세요.'; return; }
    if(!parent){ $('qa-msg').textContent='위치를 고르세요.'; return; }
    if(s && en && en<s){ $('qa-msg').textContent='마감일이 시작일보다 빨라요.'; return; }
    const lines = $('qa-checks').value.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,50);
    $('qa-save').disabled = true;
    const id = await insertUnder(parent, {cat:name, brand:$('qa-brand').value, pic:$('qa-pic').value||me.name, bak:$('qa-bak').value||null, start_date:s, end_date:en, prog:lines.length?0:null}, '업무 등록');
    if(!id){ $('qa-save').disabled=false; return; }
    if(lines.length){
      const { error } = await sb.from('item_checks').insert(lines.map((t,i)=>({item_id:id, text:t, sort_order:i+1})));
      if(error) toast('체크리스트는 저장하지 못했어요: '+error.message); else await loadChecks();
    }
    closeDrawer(); toast(`${id} 업무를 등록했어요.`);
  };
}
// 상위 항목 아래에 새 업무 추가 (번호·순서·계층 자동). 성공하면 새 id
async function insertUnder(parentId, fields, label){
  const p = byId[parentId]; if(!p){ toast('위치를 찾지 못했어요. 새로고침 후 다시 시도하세요.'); return null; }
  const sheet = p.sheet, pref = sheet==='WBS'?'W':'R';
  const nums = items.filter(r=>r.sheet===sheet && r.id.startsWith(pref+'-')).map(r=>parseInt(r.id.slice(2),10)).filter(n=>!isNaN(n));
  const id = `${pref}-${String((nums.length?Math.max(...nums):0)+1).padStart(3,'0')}`;
  const sib = kids(parentId);
  const lastNum = sib.length ? Math.max(...sib.map(s=>parseInt(String(s.num).split('.').pop(),10)||0)) : 0;
  const tail = [p, ...desc(parentId)].reduce((a,b)=>b.sort_order>a.sort_order?b:a);
  const next = items.find(x=>x.sort_order>tail.sort_order);
  const row = {id, sheet, num:`${p.num}.${lastNum+1}`, lvl:p.lvl==='L1'?'T':'C', parent:parentId, cyc:'단발', st:'Planned', w:0,
    sort_order: next ? (tail.sort_order+next.sort_order)/2 : tail.sort_order+1, updated_by:me.name, updated_at:new Date().toISOString(), ...fields};
  if(!row.pic) row.pic = me.name; if(!row.brand) row.brand = p.brand||'공통';
  const { data, error } = await sb.from('items').insert(row).select();
  if(error){ toast('등록하지 못했어요: '+error.message); return null; }
  if(p.lvl==='T'){ await sb.from('items').update({lvl:'P', updated_by:me.name, updated_at:new Date().toISOString()}).eq('id',p.id); p.lvl='P'; }
  await sb.from('item_history').insert({item_id:id, changed_by:me.name, changes:`${label||'업무 추가'} (${p.cat} 하위)`});
  items.push(norm(data[0])); index();
  return id;
}

// ---- 체크리스트 (업무 상세 안). 체크 비율 = 진척률
function checksHtml(r){
  const a = CHECKS[r.id]||[], ed = owns(r);
  return `<div class="subhead">체크리스트 ${a.length?`<span class="hist" style="display:inline;font-weight:400">${a.filter(c=>c.done).length}/${a.length} · 진척률 자동 계산</span>`:''}</div>
    <div class="checks" id="d-checks">${a.map(c=>`<div class="ck" data-ck="${c.id}"><input type="checkbox" ${c.done?'checked':''} ${ed?'':'disabled'} aria-label="${esc(c.text)} 완료"><span class="${c.done?'done':''}">${esc(c.text)}</span>${ed?`<button type="button" class="iconbtn sm" data-ckdel aria-label="${esc(c.text)} 삭제">×</button>`:''}</div>`).join('')}
    ${ed?`<form class="ck-add" id="d-ckadd"><input maxlength="120" placeholder="할 일 추가 후 Enter" aria-label="체크리스트 항목 추가"><button class="btn" type="submit">추가</button></form>`:(a.length?'':'<div class="hist">없음</div>')}</div>`;
}
async function syncProgFromChecks(r, note){
  const a = CHECKS[r.id]||[];
  const prog = a.length ? Math.round(a.filter(c=>c.done).length/a.length*100)/100 : r.prog;
  const ok = await quickUpdate(r, {prog});
  if(note) await sb.from('item_history').insert({item_id:r.id, changed_by:me.name, changes:note});
  return ok;
}
function bindChecks(r){
  const box = $('d-checks'); if(!box) return;
  box.addEventListener('change', async e => {
    const row = e.target.closest('[data-ck]'); if(!row) return;
    const c = (CHECKS[r.id]||[]).find(x=>String(x.id)===row.dataset.ck); if(!c) return;
    const { error } = await sb.from('item_checks').update({done:e.target.checked}).eq('id',c.id);
    if(error){ toast('저장하지 못했어요: '+error.message); e.target.checked=!e.target.checked; return; }
    c.done = e.target.checked;
    await syncProgFromChecks(r, `체크리스트: ${c.text} ${c.done?'완료':'완료 취소'}`);
    openDrawer(r.id);
  });
  box.addEventListener('click', async e => {
    const del = e.target.closest('[data-ckdel]'); if(!del) return;
    const row = del.closest('[data-ck]'); const c = (CHECKS[r.id]||[]).find(x=>String(x.id)===row.dataset.ck);
    const { error } = await sb.from('item_checks').delete().eq('id',c.id);
    if(error){ toast('삭제하지 못했어요: '+error.message); return; }
    CHECKS[r.id] = CHECKS[r.id].filter(x=>x!==c);
    if(!CHECKS[r.id].length) delete CHECKS[r.id];
    await syncProgFromChecks(r, `체크리스트 삭제: ${c.text}`);
    openDrawer(r.id);
  });
  const add = $('d-ckadd');
  if(add) add.onsubmit = async e => {
    e.preventDefault(); const inp = add.querySelector('input'); const t = inp.value.trim(); if(!t) return;
    const a = CHECKS[r.id]||[];
    const { data, error } = await sb.from('item_checks').insert({item_id:r.id, text:t, sort_order:(a.length?Math.max(...a.map(x=>x.sort_order)):0)+1}).select();
    if(error){ toast('추가하지 못했어요: '+error.message); return; }
    (CHECKS[r.id] ||= []).push(data[0]);
    await syncProgFromChecks(r, `체크리스트 추가: ${t}`);
    openDrawer(r.id);
    setTimeout(()=>{ const i=$('d-ckadd'); if(i) i.querySelector('input').focus(); }, 30);
  };
}

// ---------------- 알림: 새 업무 등록 · 나를 멘션한 댓글 · 내 업무에 달린 댓글 (실시간)
// 접속하지 않았던 동안 생긴 알림은 다음 로그인 때 모아 보여줌. 알림 목록은 각자 브라우저에 저장
let NOTIFS = [];
const nKey = k => `jcwbs-${k}-${(me&&me.email||'').toLowerCase()}`;
const N_LABEL = {new:'새 업무', mention:'멘션', comment:'댓글'};
function nSave(){ try{ localStorage.setItem(nKey('notifs'), JSON.stringify(NOTIFS.slice(0,80))); }catch(e){} }
function nLoad(){ try{ NOTIFS = JSON.parse(localStorage.getItem(nKey('notifs'))||'[]').map(x=>({kind:'new', key:'n'+x.item, ...x})); }catch(e){ NOTIFS=[]; } }
function nBadge(){
  const n = NOTIFS.filter(x=>!x.read).length, b=$('bellN');
  b.textContent = n>99?'99+':n; b.classList.toggle('hidden', !n);
  $('bellBtn').setAttribute('aria-label', n?`알림 ${n}건 읽지 않음`:'알림');
}
function nMsg(x, r){
  if(x.kind==='mention') return [`${x.by} 님이 나를 언급했어요`, `${titleOf(r)} · "${x.text||''}"`];
  if(x.kind==='comment') return [`내 업무에 ${x.by} 님의 댓글`, `${titleOf(r)} · "${x.text||''}"`];
  return [r.pic===me.name?'나에게 새 업무가 배정됐어요':'새 업무가 등록됐어요', `${titleOf(r)} · ${x.by}`];
}
function pushNotif(x, live){
  if(NOTIFS.some(n=>n.key===x.key)) return;
  NOTIFS.unshift({...x, read:false}); nSave(); nBadge();
  if(current()==='my') rerender();
  if(!live) return;
  // 표에서 '+ 업무 추가'로 만든 직후엔 이름이 '새 업무'라서, 잠시 뒤 실제 이름으로 알림
  const r0 = byId[x.item];
  setTimeout(()=>{
    const r = byId[x.item]; if(!r) return;
    const [t, b] = nMsg(x, r);
    toast(`${t}: ${titleOf(r)}`);
    if(document.hidden && 'Notification' in window && Notification.permission==='granted'){
      try{ const n = new Notification(t, {body:b, tag:'jcwbs-'+x.key});
        n.onclick = () => { window.focus(); openDrawer(x.item); markRead(x.key); n.close(); }; }catch(e){}
    }
  }, x.kind==='new' && r0 && r0.cat==='새 업무' ? 15000 : 300);
}
function markRead(key){ const x=NOTIFS.find(n=>n.key===key); if(x && !x.read){ x.read=true; nSave(); nBadge(); } }
function onItemInsert(r){
  if(!me || !r || r.lvl==='L1') return;
  const by = r.created_by || r.updated_by;
  if(!by || by===me.name) return;
  pushNotif({key:'n'+r.id, kind:'new', item:r.id, by, at:r.updated_at || new Date().toISOString()}, true);
}
async function loadMissed(){
  nLoad();
  let last; try{ last = localStorage.getItem(nKey('seen')); }catch(e){}
  const since = last || new Date(Date.now()-3*DAY).toISOString();   // 처음 쓰는 사람은 최근 3일치
  const [{ data:hs }, { data:cs }] = await Promise.all([
    sb.from('item_history').select('item_id,changed_at,changed_by,changes').like('changes','업무 %').neq('changed_by',me.name).gt('changed_at',since).order('changed_at',{ascending:true}).limit(100),
    sb.from('item_comments').select('*').neq('author',me.name).gt('created_at',since).order('created_at',{ascending:true}).limit(200)
  ]);
  for(const h of hs||[]) if(/^업무 (등록|추가) /.test(h.changes) && byId[h.item_id]) pushNotif({key:'n'+h.item_id, kind:'new', item:h.item_id, by:h.changed_by, at:h.changed_at}, false);
  for(const c of cs||[]){
    const r = byId[c.item_id]; if(!r) continue;
    const mentioned = (c.mentions||[]).includes(me.name), mine = r.pic===me.name || r.bak===me.name || r.created_by===me.name;
    if(mentioned || mine) pushNotif({key:'c'+c.id, kind:mentioned?'mention':'comment', item:c.item_id, by:c.author, at:c.created_at, text:c.body.slice(0,80)}, false);
  }
  try{ localStorage.setItem(nKey('seen'), new Date().toISOString()); }catch(e){}
  nBadge();
  const missed = NOTIFS.filter(x=>!x.read && x.at>since).length;
  if(missed) toast(`접속하지 않은 동안 알림 ${missed}건이 쌓였어요. 오른쪽 위 알림에서 확인하세요.`);
}
// 접속 중에는 마지막 확인 시각을 계속 갱신 (다음 로그인 때 중복 알림 방지)
setInterval(()=>{ if(me) try{ localStorage.setItem(nKey('seen'), new Date().toISOString()); }catch(e){} }, 60000);
function openNotifs(){
  selId=null;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const list = NOTIFS.filter(x=>byId[x.item]);
  drawer.innerHTML = `
    <header><div style="flex:1"><div class="id">새 업무 · 멘션 · 내 업무 댓글</div><h3>알림</h3></div><button class="btn" type="button" id="nt-close">닫기</button></header>
    <div class="body">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${list.some(x=>!x.read)?'<button class="btn" type="button" id="nt-all">모두 읽음</button>':''}
        ${perm==='default'?'<button class="btn" type="button" id="nt-perm">바탕화면 알림 켜기</button>':''}
      </div>
      <p class="hist" style="margin:0">${perm==='granted'?'바탕화면 알림이 켜져 있어요. 다른 창을 보고 있을 때도 알려드려요.':perm==='denied'?'바탕화면 알림이 브라우저에서 차단돼 있어요. 주소창 왼쪽 자물쇠 아이콘 → 알림 허용으로 바꿀 수 있어요.':perm==='unsupported'?'이 브라우저는 바탕화면 알림을 지원하지 않아요.':'켜 두면 이 사이트를 띄워 둔 채 다른 창을 보고 있을 때도 알려드려요.'}</p>
      <div class="side-list nlist">${list.map(x=>{ const r=byId[x.item]; return `<button type="button" data-nt="${esc(x.key)}" data-item="${x.item}" class="${x.read?'':'unread'}"><span>${x.read?'':'<i class="dot"></i>'}<em class="nk ${x.kind}">${N_LABEL[x.kind]||''}</em> ${esc(titleOf(r))}</span><span class="hist" style="display:inline">${x.text?`"${esc(x.text)}" · `:''}${esc(x.by)} · ${ago(x.at)}${x.kind==='new'?` · PIC ${esc(r.pic||'–')}${r.pic===me.name?' (나)':''}${r.parent&&/-INBOX$/.test(r.parent)?' · 미분류함':''}`:''}</span></button>`; }).join('') || '<div class="hist">아직 알림이 없어요. 새 업무 등록, 나를 언급한 댓글, 내 업무에 달린 댓글이 여기에 쌓여요.</div>'}</div>
    </div>`;
  drawer.classList.add('on'); scrim.classList.add('on');
  $('nt-close').onclick = closeDrawer;
  if($('nt-all')) $('nt-all').onclick = () => { NOTIFS.forEach(x=>x.read=true); nSave(); nBadge(); openNotifs(); };
  if($('nt-perm')) $('nt-perm').onclick = async () => { try{ await Notification.requestPermission(); }catch(e){} openNotifs(); };
  drawer.querySelectorAll('[data-nt]').forEach(b => b.onclick = () => { markRead(b.dataset.nt); openDrawer(b.dataset.item); });
}
$('bellBtn').addEventListener('click', openNotifs);

// ---------------- 새 소식 배지: 내가 마지막으로 열어 본 뒤 다른 사람이 등록·수정·댓글을 단 업무
// 업무를 열면 확인 처리. 기록은 각자 브라우저에 저장 (처음 쓰는 날 이후의 변경부터 표시)
let SEEN = {}, SEEN_BASE = 0, CMT_TIMES = {};
const ts = v => v ? new Date(v).getTime() : 0;
function seenLoad(){
  SEEN = {}; SEEN_BASE = 0;
  try{ const o = JSON.parse(localStorage.getItem(nKey('seenItems'))||'null'); if(o){ SEEN = o.items||{}; SEEN_BASE = o.base||0; } }catch(e){}
  if(!SEEN_BASE){ SEEN_BASE = Date.now(); seenSave(); }
}
function seenSave(){
  // 오래된 기록은 정리 (60일)
  const cut = Date.now()-60*DAY; for(const k in SEEN) if(SEEN[k]<cut) delete SEEN[k];
  try{ localStorage.setItem(nKey('seenItems'), JSON.stringify({base:SEEN_BASE, items:SEEN})); }catch(e){}
}
const seenAt = id => Math.max(SEEN[id]||0, SEEN_BASE);
function newsOf(r){
  if(!r || !me) return null;
  const t = seenAt(r.id);
  if(NOTIFS.some(x=>x.kind==='new' && x.item===r.id && ts(x.at)>t)) return {kind:'new', label:'새 업무'};
  const n = (CMT_TIMES[r.id]||[]).filter(x=>x>t).length;
  if(n) return {kind:'cmt', label:`새 댓글 ${n}`};
  if(r.updated_by && r.updated_by!==me.name && ts(r.updated_at)>t) return {kind:'upd', label:'수정됨', by:r.updated_by};
  return null;
}
const newsChip = r => { const x = newsOf(r); return x ? ` <span class="nb nb-${x.kind}" title="${x.by?esc(x.by)+' 님이 수정 · ':''}열어 보면 사라져요">${x.label}</span>` : ''; };
function markSeen(id, quiet){ if(!id) return; SEEN[id] = Date.now(); seenSave(); if(!quiet) newsTabs(); }
function markSeenMany(list){ const now = Date.now(); for(const r of list) SEEN[r.id] = now; seenSave(); newsTabs(); }
function newsTabs(){
  if(!me) return;
  const cnt = arr => arr.filter(r=>r.lvl!=='L1' && newsOf(r)).length;
  const set = (v, n) => { const a = document.querySelector(`#tabs a[data-v="${v}"]`); if(!a) return; let b = a.querySelector('.newc'); if(!b){ b = document.createElement('span'); b.className='newc'; a.appendChild(b); } b.textContent = n>99?'99+':n; b.hidden = !n; b.title = n?`새 소식 ${n}건`:''; };
  set('my', cnt(items.filter(r=>isTask(r) && (r.pic===me.name || r.bak===me.name))));
  set('wbs', cnt(items.filter(r=>r.sheet==='WBS')));
  set('req', cnt(items.filter(r=>r.sheet==='REQ')));
}
async function loadCommentTimes(){
  const { data, error } = await sb.from('item_comments').select('item_id,author,created_at').limit(10000);
  CMT_N = {}; CMT_TIMES = {}; if(error) return;
  for(const c of data){ CMT_N[c.item_id] = (CMT_N[c.item_id]||0)+1; if(c.author!==me.name) (CMT_TIMES[c.item_id] ||= []).push(ts(c.created_at)); }
}

// ---------------- 댓글 · @멘션 (업무 상세 안). 멘션된 사람과 업무 담당자에게 알림
let CMT_N = {};
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
function richText(t){
  let h = esc(t).replace(URL_RE, u=>`<a href="${u}" target="_blank" rel="noopener noreferrer">${u.length>60?u.slice(0,57)+'…':u}</a>`);
  const names = STAFF.map(s=>s.name).concat(['전원']).sort((a,b)=>b.length-a.length);
  for(const n of names) h = h.split('@'+esc(n)).join(`<span class="mention${n===me.name?' me':''}">@${esc(n)}</span>`);
  return h.replace(/\n/g,'<br>');
}
const mentionsIn = t => { const out = new Set(); for(const s of STAFF) if(s.active && t.includes('@'+s.name)) out.add(s.name); if(t.includes('@전원')) STAFF.filter(s=>s.active).forEach(s=>out.add(s.name)); return [...out]; };
function commentsHtml(r){
  return `<div class="subhead">댓글 <span class="hist" style="display:inline;font-weight:400" id="d-cn"></span></div>
    <div class="cmts" id="d-cmts"><div class="hist">불러오는 중…</div></div>
    ${canEdit()?`<form class="cmt-form" id="d-cform" autocomplete="off">
      <div class="cmt-wrap"><textarea id="d-cbody" maxlength="2000" placeholder="@이름으로 알림 보내기 · 링크(https://…)는 자동 연결 · Ctrl+Enter 등록" aria-label="댓글 입력"></textarea><div class="mention-box hidden" id="d-mbox" role="listbox"></div></div>
      <button class="btn primary" type="submit">댓글 등록</button></form>`:''}`;
}
async function loadComments(r){
  const { data, error } = await sb.from('item_comments').select('*').eq('item_id',r.id).order('created_at');
  const box = $('d-cmts'); if(!box || selId!==r.id) return;
  if(error){ box.innerHTML='<div class="hist">댓글을 불러오지 못했어요.</div>'; return; }
  CMT_N[r.id] = data.length; $('d-cn').textContent = data.length?data.length+'개':'';
  box.innerHTML = data.length ? data.map(c=>`<div class="cmt" data-cid="${c.id}"><div class="cmt-h"><b>${esc(c.author)}</b><span>${new Date(c.created_at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>${(c.author===me.name||me.role==='admin')?'<button type="button" class="linkbtn" data-cdel>삭제</button>':''}</div><div class="cmt-b">${richText(c.body)}</div></div>`).join('') : '<div class="hist">첫 댓글을 남겨 보세요. 진행 상황 공유, 질문, 산출물 링크 등.</div>';
}
function bindComments(r){
  const box=$('d-cmts'); if(!box) return;
  box.addEventListener('click', async e => {
    const d=e.target.closest('[data-cdel]'); if(!d) return;
    if(d.dataset.confirm!=='1'){ d.dataset.confirm='1'; d.textContent='한 번 더 누르면 삭제'; return; }
    const id=d.closest('[data-cid]').dataset.cid;
    const { error } = await sb.from('item_comments').delete().eq('id',id);
    if(error){ toast('삭제하지 못했어요: '+error.message); return; }
    loadComments(r);
  });
  const fm=$('d-cform'); if(!fm) return;
  const ta=$('d-cbody'), mb=$('d-mbox');
  let pick=0, cand=[];
  const close=()=>{ mb.classList.add('hidden'); cand=[]; };
  const at = () => { const m = ta.value.slice(0, ta.selectionStart).match(/@([^\s@]*)$/); return m; };
  const show = () => {
    const m = at(); if(!m){ close(); return; }
    cand = STAFF.filter(s=>s.active && s.name.includes(m[1])).map(s=>s.name).concat('전원'.includes(m[1])?['전원']:[]).slice(0,8);
    if(!cand.length){ close(); return; }
    pick = Math.min(pick, cand.length-1);
    mb.innerHTML = cand.map((n,i)=>`<button type="button" role="option" class="${i===pick?'on':''}" data-mn="${esc(n)}">@${esc(n)}${n==='전원'?' <span class="hist" style="display:inline">모든 담당자</span>':''}</button>`).join('');
    mb.classList.remove('hidden');
  };
  const insert = n => { const m = at(); if(!m) return; const p = ta.selectionStart - m[0].length; ta.value = ta.value.slice(0,p)+'@'+n+' '+ta.value.slice(ta.selectionStart); const c=p+n.length+2; ta.setSelectionRange(c,c); ta.focus(); close(); };
  ta.addEventListener('input', ()=>{ pick=0; show(); });
  ta.addEventListener('click', show);
  ta.addEventListener('keydown', e => {
    if(cand.length){
      if(e.key==='ArrowDown'){ e.preventDefault(); pick=(pick+1)%cand.length; show(); return; }
      if(e.key==='ArrowUp'){ e.preventDefault(); pick=(pick-1+cand.length)%cand.length; show(); return; }
      if(e.key==='Enter'||e.key==='Tab'){ e.preventDefault(); insert(cand[pick]); return; }
      if(e.key==='Escape'){ e.stopPropagation(); close(); return; }
    }
    if(e.key==='Enter' && (e.ctrlKey||e.metaKey)){ e.preventDefault(); fm.requestSubmit(); }
  });
  mb.addEventListener('mousedown', e => { const b=e.target.closest('[data-mn]'); if(b){ e.preventDefault(); insert(b.dataset.mn); } });
  fm.onsubmit = async e => {
    e.preventDefault(); const body = ta.value.trim(); if(!body) return;
    const btn = fm.querySelector('button[type=submit]'); btn.disabled = true;
    const mentions = mentionsIn(body).filter(n=>n!==me.name);
    const { error } = await sb.from('item_comments').insert({item_id:r.id, author:me.name, body, mentions});
    btn.disabled = false;
    if(error){ toast('댓글을 등록하지 못했어요: '+error.message); return; }
    ta.value=''; close(); await loadComments(r);
    if(mentions.length) toast(`${mentions.length>3?mentions.length+'명':mentions.join(', ')}에게 알림을 보냈어요.`);
  };
}
function onCommentInsert(c){
  if(!me) return;
  CMT_N[c.item_id] = (CMT_N[c.item_id]||0) + 1;
  if(c.author!==me.name){ (CMT_TIMES[c.item_id] ||= []).push(ts(c.created_at)); if(selId===c.item_id) markSeen(c.item_id); }
  if(selId===c.item_id && byId[c.item_id] && $('d-cmts')) loadComments(byId[c.item_id]);
  if(c.author===me.name) return;
  const r = byId[c.item_id]; if(!r) return;
  const mentioned = (c.mentions||[]).includes(me.name);
  const mine = r.pic===me.name || r.bak===me.name || r.created_by===me.name;
  if(mentioned || mine) pushNotif({key:'c'+c.id, kind:mentioned?'mention':'comment', item:c.item_id, by:c.author, at:c.created_at, text:c.body.slice(0,80)}, true);
  if(!$('drawer').classList.contains('on')) rerender(); else newsTabs();
}

// ---------------- drawer (상세·편집)
const drawer=$('drawer'), scrim=$('scrim');
async function openDrawer(id){
  const r=byId[id]; if(!r) return; selId=id; markSeen(id);
  const ro = !owns(r);
  const ck = ckStat(r.id);
  const opt=(arr,v,labels)=>`<option value=""></option>`+arr.map((x,i)=>`<option value="${esc(x)}" ${x===v?'selected':''}>${esc(labels?labels[i]:x)}</option>`).join('');
  const extraOpt=(arr,v)=> v && !arr.includes(v) ? `<option selected>${esc(v)}</option>` : '';
  const d=dday(r), c=check(r), m=must(r);
  const kpi = r.sheet==='WBS' && r.cyc!=='단발' && r.lvl!=='L1' ? `
    <div class="subhead">상시 업무 월 실적</div><div class="fgrid">
      <div class="field"><label for="f-kpi_target">월 목표</label><input id="f-kpi_target" type="number" min="0" value="${r.kpi_target??''}"></div>
      <div class="field"><label for="f-kpi_actual">월 실적</label><input id="f-kpi_actual" type="number" min="0" value="${r.kpi_actual??''}"></div>
      <div class="field"><label for="f-kpi_month">기준월</label><input id="f-kpi_month" type="month" value="${r.kpi_month??''}"></div>
      <div class="field"><label>달성률</label><input disabled value="${r.kpi_target&&r.kpi_actual!=null?pct(r.kpi_actual/r.kpi_target):''}"></div>
      <div class="field full"><label for="f-kpi_memo">실적 메모</label><input id="f-kpi_memo" value="${esc(r.kpi_memo||'')}"></div></div>` : '';
  const req = r.sheet==='REQ' && r.lvl!=='L1' ? `
    <div class="subhead">대표님 보고 관리</div><div class="fgrid">
      <div class="field"><label for="f-req_date">요청일</label><input id="f-req_date" type="date" value="${r.req_date||''}"></div>
      <div class="field"><label for="f-due_date">보고 기한</label><input id="f-due_date" type="date" value="${r.due_date||''}"></div>
      <div class="field full"><label for="f-req_text">요청 원문</label><textarea id="f-req_text">${esc(r.req_text||'')}</textarea></div>
      <div class="field"><label for="f-done_date">보고 완료일</label><input id="f-done_date" type="date" value="${r.done_date||''}"></div>
      <div class="field full"><label for="f-feedback">대표님 피드백</label><textarea id="f-feedback">${esc(r.feedback||'')}</textarea></div></div>` : '';
  const grp = r.lvl==='L1';
  drawer.innerHTML = `
    <header><div style="flex:1"><div class="id">${grp?'카테고리':r.id} · ${r.sheet==='WBS'?'WBS':'대표님 REQ'} · ${esc(r.num)}</div><h3>${esc(r.cat||'')}</h3>${r.updated_by?`<div class="id" style="margin-top:4px">마지막 수정 ${esc(r.updated_by)} · ${new Date(r.updated_at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div>`:''}</div><button class="btn" type="button" id="d-close">닫기</button></header>
    <div class="body">
      ${r.delete_requested_at?`<div class="calc"><div style="background:var(--bad-soft);color:var(--bad)">삭제 대기 · ${esc(r.delete_requested_by||'')} 요청 · ${new Date(r.delete_requested_at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}${me.role==='admin'?' · 아래에서 승인하거나 반려하세요':' · 관리자 승인 후 삭제됩니다'}</div></div>`:''}
      ${ro && canEdit()?`<div class="calc"><div style="background:var(--hold-soft)">${grp?'카테고리는 관리자나 만든 사람만 고칠 수 있어요.':`보기 전용이에요. 담당자(PIC·Backup)나 등록한 사람${r.created_by?`(${esc(r.created_by)})`:''}만 수정할 수 있어요.`}</div></div>`:''}
      ${isTask(r)?`<div class="calc"><div>D-day <b>${ddTxt(d)||'–'}</b></div><div>일정 체크 ${chkChip(c)||'–'}</div><div>오늘까지 계획 <b>${pct(m)}</b></div></div>`:''}
      ${isTask(r)?checksHtml(r):''}
      <fieldset ${ro?'disabled':''} style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:12px">
      <div class="fgrid">
        <div class="field full"><label for="f-cat">${grp?'카테고리 이름':'Category'}</label><input id="f-cat" value="${esc(r.cat||'')}"></div>
        ${grp?'':`
        <div class="field full"><label for="f-parent">상위 항목 (바꾸면 그 아래로 이동)</label><select id="f-parent">${parentOptions(r)}</select></div>
        <div class="field full"><label for="f-task">Task</label><textarea id="f-task">${esc(r.task||'')}</textarea></div>
        <div class="field"><label for="f-output">Output / Check</label><input id="f-output" value="${esc(r.output||'')}"></div>
        <div class="field"><label for="f-link">산출물 링크${/^https?:\/\//.test(r.link||'')?` · <a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">열기</a>`:''}</label><input id="f-link" placeholder="NAS 경로 또는 URL" value="${esc(r.link||'')}"></div>
        <div class="field"><label for="f-brand">브랜드</label><select id="f-brand">${opt(BRANDS,r.brand)}${extraOpt(BRANDS,r.brand)}</select></div>
        <div class="field"><label for="f-cyc">주기</label><input id="f-cyc" list="cyc-list" value="${esc(r.cyc||'')}"><datalist id="cyc-list">${CYCLES.map(x=>`<option value="${x}">`).join('')}</datalist></div>
        <div class="field"><label for="f-pic">PIC</label><select id="f-pic">${opt(PEOPLE,r.pic)}${extraOpt(PEOPLE,r.pic)}</select></div>
        <div class="field"><label for="f-bak">Backup</label><select id="f-bak">${opt(PEOPLE,r.bak)}${extraOpt(PEOPLE,r.bak)}</select></div>
        <div class="field"><label for="f-st">진행 상태</label><select id="f-st">${opt(STATUS,r.st,STATUS.map(s=>ST_KO[s]))}</select></div>
        <div class="field"><label for="f-prog">progress %${ck.n?' (체크리스트 자동)':''}</label><input id="f-prog" type="number" min="0" max="100" step="5" value="${r.prog!=null?Math.round(r.prog*100):''}" ${isTask(r)&&!ck.n?'':'disabled'}></div>
        <div class="field"><label for="f-start_date">Start</label><input id="f-start_date" type="date" value="${r.start_date||''}" ${isTask(r)?'':'disabled'}></div>
        <div class="field"><label for="f-end_date">End</label><input id="f-end_date" type="date" value="${r.end_date||''}" ${isTask(r)?'':'disabled'}></div>
        ${isTask(r)?`<div class="field full"><label class="chk-inline" style="font-size:12px;color:var(--ink)"><input type="checkbox" id="f-is_milestone" ${r.is_milestone?'checked':''}> 마일스톤 (행사일·런칭일처럼 하루짜리 기준일 · End 날짜에 ◆ 표시)</label></div>`:''}
        <div class="field full"><label for="f-memo">최근 메모 (오늘 한 일·막힌 점)</label><input id="f-memo" maxlength="200" value="${esc(r.memo||'')}"></div>
        <div class="field full"><label for="f-note">비고</label><textarea id="f-note">${esc(r.note||'')}</textarea></div>`}
      </div>${kpi}${req}</fieldset>
      ${!grp && canEdit() && r.lvl!=='C' ? `<button class="addbtn" type="button" id="d-addchild" style="align-self:flex-start;margin:0">+ 이 업무 아래에 하위 업무 추가</button>`:''}
      ${grp?'':commentsHtml(r)}
      <div class="subhead">변경 이력</div><div class="hist" id="d-hist"><div>불러오는 중…</div></div>
    </div>
    <footer>${delButtons(r)}<button class="btn" type="button" id="d-cancel">${ro?'닫기':'취소'}</button>${ro?'':'<button class="btn primary" type="button" id="d-save">저장</button>'}</footer>`;
  drawer.classList.add('on'); scrim.classList.add('on');
  $('d-close').onclick=closeDrawer; $('d-cancel').onclick=closeDrawer;
  if($('d-save')) $('d-save').onclick=()=>saveDrawer(r);
  if($('d-del')) $('d-del').onclick=()=>deleteItem(r);
  if($('d-req')) $('d-req').onclick=()=>requestDelete(r);
  if($('d-unreq')) $('d-unreq').onclick=()=>cancelDelete(r, me.role==='admin'?'반려':'요청 취소');
  if($('d-addchild')) $('d-addchild').onclick=()=>addItem(r.id);
  if(isTask(r)) bindChecks(r);
  if(!grp){ bindComments(r); loadComments(r); }
  rerender();
  const { data, error } = await sb.from('item_history').select('changed_at,changed_by,changes').eq('item_id',id).order('changed_at',{ascending:false}).limit(50);
  if(selId!==id) return;
  $('d-hist').innerHTML = error ? `<div>이력을 불러오지 못했습니다.</div>` : (data.length ? data.map(h=>`<div>${new Date(h.changed_at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} · ${esc(h.changed_by)} · ${esc(h.changes)}</div>`).join('') : '<div>아직 변경 이력이 없습니다.</div>');
}
function closeDrawer(){ if(selId) markSeen(selId); drawer.classList.remove('on'); scrim.classList.remove('on'); selId=null; rerender(); }
async function saveDrawer(r){
  const patch={}, changes=[];
  for(const k of FIELDS){
    const el=$('f-'+k); if(!el||el.disabled) continue;
    let v=el.value.trim(); if(v==='') v=null;
    if(k==='prog' && v!=null) v=Math.max(0,Math.min(100,Number(v)))/100;
    if((k==='kpi_target'||k==='kpi_actual') && v!=null) v=Number(v);
    const old = r[k]==null?null:r[k];
    if(String(old)!==String(v)){ patch[k]=v; changes.push(`${LABELS[k]}: ${k==='prog'?pct(old):old??'–'} → ${k==='prog'?pct(v):v??'–'}`); }
  }
  const msEl=$('f-is_milestone'); if(msEl && !msEl.disabled && !!msEl.checked!==!!r.is_milestone){ patch.is_milestone=msEl.checked; changes.push(`마일스톤: ${msEl.checked?'지정':'해제'}`); }
  const st = patch.st!==undefined ? patch.st : r.st, pr = patch.prog!==undefined ? patch.prog : r.prog;
  if(isTask(r) && st==='Completed' && (pr==null||pr<1)){ patch.prog=1; changes.push('progress: 완료 처리로 100% 자동 반영'); }
  const pSel=$('f-parent'); const newParent = pSel && !pSel.disabled ? pSel.value : r.parent;
  const moving = !!newParent && newParent!==r.parent;
  if(!changes.length && !moving){ toast('바뀐 내용이 없습니다.'); return; }
  if(!changes.length && moving){ if(await moveItem(r,newParent)) openDrawer(r.id); return; }
  patch.updated_by = me.name; patch.updated_at = new Date().toISOString();
  $('d-save').disabled = true;
  const { data, error } = await sb.from('items').update(patch).eq('id',r.id).eq('updated_at',r.updated_at).select();
  if(error){ $('d-save').disabled=false; toast('저장하지 못했습니다: '+error.message); return; }
  if(!data.length){
    await loadItems(); toast('다른 팀원이 먼저 수정했습니다. 최신 내용을 불러왔으니 다시 확인 후 저장하세요.'); openDrawer(r.id); return;
  }
  Object.assign(r, norm(data[0]));
  await sb.from('item_history').insert({item_id:r.id, changed_by:me.name, changes:changes.join(' / ')});
  if(moving) await moveItem(r,newParent);
  toast(`${changes.length}개 항목을 저장했습니다.`);
  openDrawer(r.id);
}
async function addItem(parentId){
  const p = byId[parentId]; if(!p) return;
  const id = await insertUnder(parentId, {cat:'새 업무', brand:p.brand||'공통', pic:me.name}, '업무 추가');
  if(!id) return;
  toast(`${id} 업무를 추가했습니다. 내용을 입력하고 저장하세요.`);
  openDrawer(id);
}
// ---- 상위 항목 이동
function parentOptions(r){
  const sub = new Set([r.id, ...desc(r.id).map(x=>x.id)]);
  const hasKids = desc(r.id).length > 0;
  const opts = items.filter(x => x.sheet===r.sheet && !sub.has(x.id) && (x.lvl==='L1' || (!hasKids && (x.lvl==='T'||x.lvl==='P'))));
  return opts.map(x => `<option value="${x.id}" ${x.id===r.parent?'selected':''}>${x.lvl==='L1'?'■ ':'　└ '}${esc(x.num)} ${esc(x.cat||'')}</option>`).join('');
}
async function moveItem(r, newParentId){
  const np = byId[newParentId]; if(!np) return false;
  const kidsAll = desc(r.id);
  if(np.lvl!=='L1' && kidsAll.length){ toast('하위 업무가 있는 항목은 카테고리 바로 아래로만 옮길 수 있습니다.'); return false; }
  const old = byId[r.parent];
  const subIds = new Set([r.id, ...kidsAll.map(x=>x.id)]);
  const sib = kids(np.id).filter(x=>!subIds.has(x.id));
  const last = sib.length ? Math.max(...sib.map(x=>parseInt(String(x.num).split('.').pop(),10)||0)) : 0;
  const num = `${np.num}.${last+1}`;
  const lvl = np.lvl==='L1' ? (kidsAll.length?'P':'T') : 'C';
  const block = [np, ...desc(np.id)].filter(x=>!subIds.has(x.id));
  const tail = block.reduce((a,b)=>b.sort_order>a.sort_order?b:a);
  const next = items.filter(x=>!subIds.has(x.id) && x.sort_order>tail.sort_order).sort((a,b)=>a.sort_order-b.sort_order)[0];
  const hi = next ? next.sort_order : tail.sort_order + kidsAll.length + 2;
  const step = (hi - tail.sort_order) / (kidsAll.length + 2);
  const stamp = {updated_by:me.name, updated_at:new Date().toISOString()};
  const ups = [{id:r.id, patch:{parent:np.id, lvl, num, sort_order:tail.sort_order+step, ...stamp}}];
  kidsAll.forEach((k,i)=>ups.push({id:k.id, patch:{num:`${num}.${i+1}`, sort_order:tail.sort_order+step*(i+2), ...stamp}}));
  if(np.lvl==='T') ups.push({id:np.id, patch:{lvl:'P', ...stamp}});
  if(old && old.lvl==='P' && kids(old.id).filter(x=>x.id!==r.id).length===0) ups.push({id:old.id, patch:{lvl:'T', ...stamp}});
  for(const u of ups){ const { error } = await sb.from('items').update(u.patch).eq('id',u.id); if(error){ toast('이동하지 못했습니다: '+error.message); await loadItems(); return false; } }
  await sb.from('item_history').insert({item_id:r.id, changed_by:me.name, changes:`상위 항목 이동: ${old?old.num+' '+old.cat:'–'} → ${np.num} ${np.cat} (새 번호 ${num})`});
  await loadItems();
  toast(`${np.cat} 아래로 옮겼습니다.`);
  return true;
}

// ---- 카테고리 추가
async function addCategory(sheet){
  const g = items.filter(r=>r.sheet===sheet && r.lvl==='L1');
  const maxNum = g.length ? Math.max(...g.map(x=>parseInt(x.num,10)||0)) : 0;
  const ids = items.filter(r=>r.id.startsWith(sheet+'-G')).map(r=>parseInt(r.id.slice(sheet.length+2),10)).filter(n=>!isNaN(n));
  const id = `${sheet}-G${(ids.length?Math.max(...ids):0)+1}`;
  const inSheet = items.filter(r=>r.sheet===sheet);
  const tail = inSheet.length ? inSheet.reduce((a,b)=>b.sort_order>a.sort_order?b:a) : null;
  const next = tail ? items.filter(x=>x.sort_order>tail.sort_order).sort((a,b)=>a.sort_order-b.sort_order)[0] : null;
  const sort_order = !tail ? 1 : next ? (tail.sort_order+next.sort_order)/2 : tail.sort_order+10;
  const row = {id, sheet, num:String(maxNum+1), lvl:'L1', parent:null, cat:'새 카테고리', w:0, sort_order, updated_by:me.name, updated_at:new Date().toISOString()};
  const { data, error } = await sb.from('items').insert(row).select();
  if(error){ toast('카테고리를 추가하지 못했습니다: '+error.message); return; }
  await sb.from('item_history').insert({item_id:id, changed_by:me.name, changes:'카테고리 추가'});
  items.push(norm(data[0])); index();
  toast('카테고리를 추가했습니다. 이름을 입력하고 저장하세요.');
  openDrawer(id);
}

// ---- 삭제: 관리자는 바로 삭제/승인, 팀원은 삭제 요청 → 관리자 승인
function delButtons(r){
  if(!owns(r)) return '';
  if(me.role==='admin'){
    return r.delete_requested_at
      ? '<button class="btn danger" type="button" id="d-del" style="margin-right:4px">삭제 승인</button><button class="btn" type="button" id="d-unreq" style="margin-right:auto">반려</button>'
      : '<button class="btn danger" type="button" id="d-del" style="margin-right:auto">삭제</button>';
  }
  return r.delete_requested_at
    ? '<button class="btn" type="button" id="d-unreq" style="margin-right:auto">삭제 요청 취소</button>'
    : '<button class="btn danger" type="button" id="d-req" style="margin-right:auto">삭제 요청</button>';
}
async function requestDelete(r){
  const btn=$('d-req'); const n=desc(r.id).length;
  if(btn.dataset.confirm!=='1'){ btn.dataset.confirm='1'; btn.textContent = n?`하위 ${n}건 포함 · 한 번 더 누르면 요청`:'한 번 더 누르면 삭제 요청'; return; }
  const { error } = await sb.from('items').update({delete_requested_by:me.name, delete_requested_at:new Date().toISOString(), updated_by:me.name, updated_at:new Date().toISOString()}).eq('id',r.id);
  if(error){ toast('삭제 요청을 보내지 못했습니다: '+error.message); return; }
  await sb.from('item_history').insert({item_id:r.id, changed_by:me.name, changes:'삭제 요청'});
  await loadItems(); toast('삭제 요청을 보냈습니다. 관리자가 승인하면 삭제됩니다.'); openDrawer(r.id);
}
async function cancelDelete(r, label){
  const { error } = await sb.from('items').update({delete_requested_by:null, delete_requested_at:null, updated_by:me.name, updated_at:new Date().toISOString()}).eq('id',r.id);
  if(error){ toast('처리하지 못했습니다: '+error.message); return; }
  await sb.from('item_history').insert({item_id:r.id, changed_by:me.name, changes:`삭제 ${label}`});
  await loadItems(); toast(`삭제 ${label} 처리했습니다.`); openDrawer(r.id);
}
async function deleteItem(r){
  if(me.role!=='admin'){ toast('삭제는 관리자만 할 수 있습니다. 삭제 요청을 이용하세요.'); return; }
  const sub = desc(r.id); const btn=$('d-del');
  if(btn.dataset.confirm!=='1'){ btn.dataset.confirm='1'; btn.textContent = sub.length?`하위 ${sub.length}건까지 함께 삭제 · 한 번 더 누르세요`:'한 번 더 누르면 삭제됩니다'; return; }
  const old = byId[r.parent];
  for(const x of [...sub].reverse().concat([r])){
    const { error } = await sb.from('items').delete().eq('id',x.id);
    if(error){ toast('삭제하지 못했습니다: '+error.message); await loadItems(); rerender(); return; }
    await sb.from('item_history').insert({item_id:x.id, changed_by:me.name, changes:`삭제${r.delete_requested_by?` (요청: ${r.delete_requested_by})`:''}: ${x.cat||''} / ${x.task||''}`});
  }
  if(old && old.lvl==='P' && kids(old.id).filter(x=>x.id!==r.id).length===0) await sb.from('items').update({lvl:'T', updated_by:me.name, updated_at:new Date().toISOString()}).eq('id',old.id);
  await loadItems(); toast(`${r.lvl==='L1'?'카테고리':r.id}를 삭제했습니다.`); closeDrawer();
}

// ---- 담당자 관리 (관리자 전용): staff 목록 + 로그인 계정(members) 연결
const ROLE_KO = {'':'로그인 없음', viewer:'보기 전용', member:'팀원(편집)', admin:'관리자'};
function openStaff(){
  if(!me || me.role!=='admin') return;
  selId = null;
  const roleOf = email => { const m = MEMBERS.find(x=>email && x.email.toLowerCase()===email.toLowerCase()); return m ? m.role : ''; };
  const used = n => items.filter(r=>r.pic===n||r.bak===n).length;
  const rows = STAFF.map((x,i)=>staffRow(x.id, x.name, x.email||'', roleOf(x.email), x.active, used(x.name))).join('');
  drawer.innerHTML = `
    <header><div style="flex:1"><div class="id">관리자 전용</div><h3>담당자 관리</h3></div><button class="btn" type="button" id="st-close">닫기</button></header>
    <div class="body">
      <p class="hist" style="margin:0">PIC·Backup 선택 목록과 업무량 집계에 쓰이는 담당자 목록입니다. 로그인 계정은 회원가입 → 관리자 승인으로만 연결됩니다. 이름을 바꾸면 기존 업무의 PIC·Backup도 함께 바뀝니다. 퇴사자는 삭제 대신 '사용'을 끄세요.</p>
      <div id="st-list" style="display:flex;flex-direction:column;gap:10px">${rows}</div>
      <button class="addbtn" type="button" id="st-add" style="align-self:flex-start;margin:0">+ 담당자 추가</button>
    </div>
    <footer><button class="btn" type="button" id="st-cancel">취소</button><button class="btn primary" type="button" id="st-save">저장</button></footer>`;
  drawer.classList.add('on'); scrim.classList.add('on');
  $('st-close').onclick=closeDrawer; $('st-cancel').onclick=closeDrawer;
  $('st-add').onclick=()=>{ $('st-list').insertAdjacentHTML('beforeend', staffRow('', '', '', '', true, 0)); };
  $('st-list').addEventListener('click', e=>{
    const mv=e.target.closest('[data-mv]'); if(!mv) return;
    const row=mv.closest('.staff-row'); const dir=mv.dataset.mv;
    if(dir==='up' && row.previousElementSibling) row.parentNode.insertBefore(row,row.previousElementSibling);
    if(dir==='down' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling,row);
  });
  $('st-save').onclick=saveStaff;
}
function staffRow(id, name, email, role, active, used){
  const self = me && email && email.toLowerCase()===me.email.toLowerCase();
  return `<div class="staff-row fgrid" data-id="${id}" data-orig="${esc(name)}" data-origemail="${esc(email)}" style="border:1px solid var(--line);border-radius:8px;padding:10px">
    <div class="field"><label>이름</label><input class="s-name" value="${esc(name)}" placeholder="예: 홍길동"></div>
    <div class="field"><label>로그인 계정</label><div class="hist" style="padding:7px 0">${email?`${esc(email)} · ${ROLE_KO[role]||'승인 전'}`:'없음'}</div></div>
    <div class="field" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" class="s-active" ${active?'checked':''} ${self?'disabled':''}> <label style="margin:0">사용</label><span class="hist" style="margin-left:6px">업무 ${used}건</span></div>
    <div class="field" style="flex-direction:row;justify-content:flex-end;gap:6px"><button class="btn" type="button" data-mv="up" aria-label="위로">▲</button><button class="btn" type="button" data-mv="down" aria-label="아래로">▼</button></div>
  </div>`;
}
async function saveStaff(){
  const rows=[...document.querySelectorAll('#st-list .staff-row')];
  const list=rows.map((el,i)=>({id:el.dataset.id?Number(el.dataset.id):null, orig:el.dataset.orig, origEmail:el.dataset.origemail,
    name:el.querySelector('.s-name').value.trim(), active:el.querySelector('.s-active').checked, sort_order:i+1})).filter(x=>x.name || x.id);
  const names=list.map(x=>x.name);
  if(list.some(x=>!x.name)){ toast('이름이 비어 있는 담당자가 있습니다.'); return; }
  if(names.some(n=>n==='전원')){ toast("'전원'은 이름으로 쓸 수 없습니다."); return; }
  if(new Set(names).size!==names.length){ toast('같은 이름이 두 번 있습니다.'); return; }
  $('st-save').disabled=true;
  const stamp={updated_by:me.name, updated_at:new Date().toISOString()};
  const log=[];
  try{
    for(const x of list){
      const row={name:x.name, active:x.active, sort_order:x.sort_order};
      if(x.id){ const { error } = await sb.from('staff').update(row).eq('id',x.id); if(error) throw error; }
      else { const { error } = await sb.from('staff').insert(row); if(error) throw error; log.push(`담당자 추가: ${x.name}`); }
      if(x.id && x.orig && x.orig!==x.name){
        for(const col of ['pic','bak']){ const { error } = await sb.from('items').update({[col]:x.name, ...stamp}).eq(col,x.orig); if(error) throw error; }
        log.push(`이름 변경: ${x.orig} → ${x.name}`);
      }
      // 이름이 바뀌면 연결된 로그인 계정의 표시 이름도 맞춤
      if(x.origEmail && x.orig && x.orig!==x.name){
        const { error } = await sb.from('members').update({name:x.name}).eq('email',x.origEmail); if(error) throw error;
        if(x.origEmail.toLowerCase()===me.email.toLowerCase()){ me.name=x.name; $('meName').textContent=x.name; }
      }
    }
    if(log.length) await sb.from('item_history').insert({item_id:'STAFF', changed_by:me.name, changes:log.join(' / ')});
    const { data:mem } = await sb.from('members').select('email,name,role').order('name'); MEMBERS = mem||MEMBERS;
    await loadStaff(); await loadItems();
    toast('담당자 목록을 저장했습니다.'); closeDrawer();
  }catch(e){
    toast('저장하지 못했습니다: '+(e.message||e)); $('st-save').disabled=false;
  }
}

// ---------------- 관리자 페이지 (회원 관리) — 관리자만 접근
async function renderAdmin(){
  const el = $('v-admin');
  if(!me || me.role!=='admin'){ el.innerHTML='<div class="empty">관리자만 볼 수 있는 페이지입니다.</div>'; return; }
  const [{ data:mem }, { data:hist }] = await Promise.all([
    sb.from('members').select('email,name,role').order('name'),
    sb.from('item_history').select('item_id,changed_at,changed_by,changes').order('changed_at',{ascending:false}).limit(30)
  ]);
  MEMBERS = mem || MEMBERS;
  await loadRequests();
  // 가입 요청자 ↔ 담당자 연결: 같은 이름의 담당자가 있으면 기본 선택, 없으면 새 담당자로 등록
  const staffOpts = q => { const hit = STAFF.find(s=>s.name===q.name && !s.email);
    return STAFF.filter(s=>s.active && !s.email).map(s=>`<option value="${esc(s.name)}" ${hit&&s.name===hit.name?'selected':''}>${esc(s.name)}</option>`).join('')
      + `<option value="" ${hit?'':'selected'}>새 담당자: ${esc(q.name)}</option>`; };
  const ago = t => new Date(t).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const roleSel = (v, dis) => `<select class="m-role" ${dis?'disabled title="본인 권한은 바꿀 수 없습니다"':''}>${['viewer','member','admin'].map(k=>`<option value="${k}" ${k===v?'selected':''}>${ROLE_KO[k]}</option>`).join('')}</select>`;
  const used = n => items.filter(r=>r.pic===n||r.bak===n).length;
  el.innerHTML = `
    <div class="cols" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
      <div class="panel">
        <h2 class="sec">가입 요청 <span style="font-weight:400;color:var(--muted);font-size:12px">· 승인해야 로그인 후 데이터를 볼 수 있습니다</span></h2>
        ${REQUESTS.length ? `<div class="tablewrap" style="max-height:none;margin-bottom:18px"><table class="fixed" style="min-width:640px"><colgroup><col style="width:16%"><col><col style="width:20%"><col style="width:16%"><col style="width:120px"></colgroup>
          <thead><tr><th>이름</th><th>이메일 · 요청 시각</th><th>담당자 연결</th><th>권한</th><th></th></tr></thead><tbody>
          ${REQUESTS.map(q=>`<tr data-req="${esc(q.email)}"><td><b>${esc(q.name)}</b></td><td style="white-space:normal"><span class="mono">${esc(q.email)}</span><div class="hist">${ago(q.requested_at)}</div></td>
            <td><select class="q-staff">${staffOpts(q)}</select></td>
            <td><select class="q-role">${['member','viewer','admin'].map(k=>`<option value="${k}">${ROLE_KO[k]}</option>`).join('')}</select></td>
            <td class="nw"><button class="btn primary" type="button" data-q="ok">승인</button> <button class="btn danger" type="button" data-q="no">거절</button></td></tr>`).join('')}
          </tbody></table></div>` : '<p class="hist" style="margin:0 0 18px">대기 중인 가입 요청이 없습니다.</p>'}
        <h2 class="sec">회원 관리 <span style="font-weight:400;color:var(--muted);font-size:12px">· 사이트에 로그인할 수 있는 계정 ${MEMBERS.length}명</span></h2>
        <div class="tablewrap" style="max-height:none"><table class="fixed" style="min-width:640px"><colgroup><col style="width:22%"><col><col style="width:18%"><col style="width:180px"></colgroup>
          <thead><tr><th>이름</th><th>이메일</th><th>권한</th><th></th></tr></thead><tbody>
          ${MEMBERS.map(m=>{ const self=m.email.toLowerCase()===me.email.toLowerCase(); return `<tr data-email="${esc(m.email)}">
            <td><b>${esc(m.name)}</b>${self?' <span class="chip c-pl">나</span>':''}</td><td class="mono" style="white-space:normal">${esc(m.email)}</td>
            <td>${roleSel(m.role, self)}</td>
            <td class="nw">${self?'':`<button class="btn" type="button" data-act="save">권한 저장</button> <button class="btn danger" type="button" data-act="remove" title="로그인 계정을 삭제합니다. 담당자와 업무 기록은 남습니다">계정 삭제</button>`}</td></tr>`; }).join('')}
          </tbody></table></div>
        <p class="hist" style="margin:10px 0 0">새 팀원은 로그인 화면의 '회원가입'으로 가입한 뒤 여기서 승인합니다. 승인 전에 본인이 가입한 게 맞는지 확인하세요. '계정 삭제'는 로그인 계정만 지우며 담당자와 업무 기록은 그대로 남습니다. 비밀번호를 잊은 팀원은 계정을 삭제한 뒤 다시 가입·승인하면 됩니다.</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="panel">
          <h2 class="sec">담당자 목록 <span style="font-weight:400;color:var(--muted);font-size:12px">· PIC·Backup 선택 목록</span></h2>
          <div class="people">${STAFF.map(s=>`<div class="person" style="grid-template-columns:80px 1fr 60px"><span class="nm" style="${s.active?'':'color:var(--muted);text-decoration:line-through'}">${esc(s.name)}</span><span class="hist">${s.email?esc(s.email):'로그인 없음'}</span><span class="tot">${used(s.name)}건</span></div>`).join('')}</div>
          <button class="btn" type="button" id="adm-staff" style="margin-top:12px">담당자 편집</button>
        </div>
        <div class="panel">
          <h2 class="sec">최근 변경 이력</h2>
          <div class="hist" style="max-height:360px;overflow:auto">${(hist||[]).map(h=>`<div>${new Date(h.changed_at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} · ${esc(h.changed_by)} · <span class="mono">${esc(h.item_id)}</span> · ${esc(h.changes)}</div>`).join('')||'<div>이력이 없습니다.</div>'}</div>
        </div>
      </div>
    </div>`;
  $('adm-staff').onclick = openStaff;
  el.querySelectorAll('tr[data-req] [data-q]').forEach(b => b.onclick = async () => {
    const tr=b.closest('tr'), q=REQUESTS.find(x=>x.email===tr.dataset.req); if(!q) return;
    if(b.dataset.q==='no'){
      if(b.dataset.confirm!=='1'){ b.dataset.confirm='1'; b.textContent='한 번 더'; return; }
      const { error } = await sb.rpc('admin_remove_account',{ p_email:q.email });
      if(error){ toast('거절 실패: '+error.message); return; }
      await sb.from('item_history').insert({item_id:'MEMBER', changed_by:me.name, changes:`가입 거절: ${q.name} (${q.email})`});
      toast(`${q.name} 님의 가입 요청을 거절했습니다.`); renderAdmin(); return;
    }
    const role=tr.querySelector('.q-role').value, pick=tr.querySelector('.q-staff').value, name=pick||q.name;
    tr.querySelectorAll('button').forEach(x=>x.disabled=true);
    try{
      const st = STAFF.find(s=>s.name===name);
      const r1 = st ? await sb.from('staff').update({email:q.email, active:true}).eq('id',st.id)
                    : await sb.from('staff').insert({name, email:q.email, active:true, sort_order:(STAFF.length?Math.max(...STAFF.map(s=>s.sort_order)):0)+1});
      if(r1.error) throw new Error('담당자 저장 실패: '+r1.error.message);
      const r2 = await sb.from('members').insert({email:q.email, name, role});
      if(r2.error) throw new Error('승인 실패: '+r2.error.message);
      await sb.from('signup_requests').delete().eq('email',q.email);
      await sb.from('item_history').insert({item_id:'MEMBER', changed_by:me.name, changes:`가입 승인: ${name} (${q.email}, ${ROLE_KO[role]})`});
      await loadStaff(); toast(`${name} 님을 ${ROLE_KO[role]}(으)로 승인했습니다.`); renderAdmin();
    }catch(err){ toast(err.message); tr.querySelectorAll('button').forEach(x=>x.disabled=false); }
  });
  el.querySelectorAll('tr[data-email] [data-act]').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr'), email = tr.dataset.email, m = MEMBERS.find(x=>x.email===email), act = b.dataset.act;
    if(act==='save'){
      const role = tr.querySelector('.m-role').value; if(role===m.role){ toast('바뀐 권한이 없습니다.'); return; }
      const { error } = await sb.from('members').update({role}).eq('email',email);
      if(error){ toast('저장 실패: '+error.message); return; }
      await sb.from('item_history').insert({item_id:'MEMBER', changed_by:me.name, changes:`권한 변경: ${m.name} ${ROLE_KO[m.role]} → ${ROLE_KO[role]}`});
      toast(`${m.name} 님 권한을 ${ROLE_KO[role]}(으)로 바꿨습니다.`); renderAdmin();
    } else if(act==='remove'){
      if(b.dataset.confirm!=='1'){ b.dataset.confirm='1'; b.textContent='한 번 더'; return; }
      const { error } = await sb.rpc('admin_remove_account',{ p_email:email });
      if(error){ toast('삭제 실패: '+error.message); return; }
      await sb.from('item_history').insert({item_id:'MEMBER', changed_by:me.name, changes:`계정 삭제: ${m.name} (${email})`});
      await loadStaff(); toast(`${m.name} 님의 로그인 계정을 삭제했습니다.`); renderAdmin();
    }
  });
}

// ---------------- 내 계정 (비밀번호 설정) — 모든 사용자
function openAccount(){
  selId = null;
  drawer.innerHTML = `
    <header><div style="flex:1"><div class="id">${esc(me.email)} · ${ROLE_KO[me.role]||me.role}</div><h3>내 계정</h3></div><button class="btn" type="button" id="ac-close">닫기</button></header>
    <form class="body" id="ac-form">
      <div class="subhead">비밀번호 변경</div>
      <p class="hist" style="margin:0">로그인 비밀번호를 바꿉니다. 8자 이상으로 정하세요.</p>
      <div class="field"><label for="ac-pw">새 비밀번호</label><input id="ac-pw" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="field"><label for="ac-pw2">새 비밀번호 확인</label><input id="ac-pw2" type="password" autocomplete="new-password" minlength="8" required></div>
      <button class="btn primary" type="submit" id="ac-save" style="align-self:flex-start">비밀번호 저장</button>
      <div class="hist" id="ac-msg"></div>
    </form>`;
  drawer.classList.add('on'); scrim.classList.add('on');
  $('ac-close').onclick = closeDrawer;
  $('ac-form').onsubmit = async e => {
    e.preventDefault();
    const a=$('ac-pw').value, b=$('ac-pw2').value;
    if(a.length<8){ $('ac-msg').textContent='8자 이상으로 입력하세요.'; return; }
    if(a!==b){ $('ac-msg').textContent='두 비밀번호가 다릅니다.'; return; }
    $('ac-save').disabled=true;
    const { error } = await sb.auth.updateUser({ password:a });
    $('ac-save').disabled=false;
    if(error){ $('ac-msg').textContent='저장하지 못했습니다: '+error.message; return; }
    $('ac-pw').value=''; $('ac-pw2').value='';
    toast('비밀번호를 변경했습니다.'); closeDrawer();
  };
}

scrim.addEventListener('click',closeDrawer);
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&drawer.classList.contains('on')) closeDrawer(); });

// ---------------- routing
const VIEWS=['my','dashboard','wbs','req','weekly','cal','gantt','admin'];
const current=()=>{ const h=location.hash.slice(1); return VIEWS.includes(h)?h:'my'; };
function rerender(){
  if(!me) return;
  newsTabs();
  const v=current();
  document.querySelectorAll('#tabs a').forEach(a=>a.classList.toggle('on',a.dataset.v===v));
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('on',s.id==='v-'+v));
  if(v==='admin' && me.role!=='admin'){ location.hash='my'; return; }
  if(v==='my') renderMy(); else if(v==='admin') renderAdmin(); else if(v==='dashboard') renderDashboard(); else if(v==='wbs'||v==='req') renderTable(v==='wbs'?'WBS':'REQ', document.activeElement && document.activeElement.id===v+'-q'); else if(v==='weekly') renderWeekly(); else if(v==='cal') renderCal(); else renderGantt();
}
window.addEventListener('hashchange',()=>{ if(location.hash.includes('access_token')) return; rerender(); });
document.querySelector('main').addEventListener('click',e=>{
  const add=e.target.closest('[data-add]'); if(add){ e.stopPropagation(); addItem(add.dataset.add); return; }
  const ed=e.target.closest('[data-edit]'); if(ed){ e.stopPropagation(); openDrawer(ed.dataset.edit); return; }
  const go=e.target.closest('[data-go]');
  if(go){ const t=go.dataset.go; if(t.startsWith('chk:')){ for(const k of ['wbs','req']) Object.assign(ui[k],{q:'',pic:'',st:'',brand:'',chk:t.slice(4),mine:false}); location.hash='wbs'; rerender(); } else location.hash=t; return; }
  const g=e.target.closest('tr.g1');
  if(g){ const f=ui[current()]; if(f&&f.collapsed){ f.collapsed.has(g.dataset.g)?f.collapsed.delete(g.dataset.g):f.collapsed.add(g.dataset.g); rerender(); } return; }
  const t=e.target.closest('[data-id]'); if(t) openDrawer(t.dataset.id);
});
bindMy();
$('todayLabel').textContent = `오늘 ${today.getFullYear()}.${today.getMonth()+1}.${today.getDate()} · ${'일월화수목금토'[today.getDay()]}요일`;

// ---------------- excel export
function sheetRows(sheet){
  return items.filter(r=>r.sheet===sheet).map(r=>{
    const a = (r.lvl==='L1'||r.lvl==='P') ? groupAgg(r) : null, d=dday(r);
    const base=[r.num, r.lvl==='L1'?'':r.id, r.cat||'', r.brand||'', r.task||'', r.output||'', r.link||'', r.cyc||'', r.pic||'', r.bak||'', r.st?ST_KO[r.st]:'',
      isTask(r)?(pd(r.start_date)||''):(a&&a.start||''), isTask(r)?(pd(r.end_date)||''):(a&&a.end||''), ddTxt(d), check(r)];
    const extra = sheet==='WBS' ? [r.kpi_target??'', r.kpi_actual??'', r.kpi_target&&r.kpi_actual!=null?r.kpi_actual/r.kpi_target:'', r.kpi_month||'', r.kpi_memo||'']
                                : [pd(r.req_date)||'', r.req_text||'', pd(r.due_date)||'', pd(r.done_date)||'', r.feedback||''];
    return {lvl:r.lvl, vals:[...base, ...extra, isTask(r)?(r.w??''):'', isTask(r)?(r.prog??''):(a&&a.prog!=null?a.prog:''), isTask(r)&&must(r)!=null?must(r):'', r.note||'']};
  });
}
$('xlsxBtn').addEventListener('click', async ()=>{
  if(!window.ExcelJS){ toast('엑셀 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.'); return; }
  const btn=$('xlsxBtn'); btn.disabled=true;
  try{
    const wb=new ExcelJS.Workbook(); wb.creator='JC EDU 마케팅 WBS';
    const H=['#','ID','Category','브랜드','Task','Output / Check','산출물 링크','주기','PIC','Backup','진행 상태','Start','End','D-day','일정 체크'];
    for(const [sheet,name] of [['WBS','WBS'],['REQ','대표님 REQ']]){
      const ws=wb.addWorksheet(name,{views:[{state:'frozen',xSplit:3,ySplit:2}]});
      const extra = sheet==='WBS'?['월 목표','월 실적','달성률','기준월','실적 메모']:['요청일','요청 원문','보고 기한','보고 완료일','대표님 피드백'];
      const head=[...H,...extra,'상세 가중치','progress %','Must Today','비고'];
      const S=sheetStats(sheet);
      ws.addRow([`${sheet==='WBS'?'JC EDU Marketing WBS':'JC EDU 대표님 REQ'}  ·  ${iso(today)} 기준  ·  실제 진척 ${pct(S.actual)} / 계획 ${pct(S.plan)}`]).font={bold:true,size:14};
      const hr=ws.addRow(head); hr.height=30;
      hr.eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF000000'}};c.alignment={vertical:'middle',horizontal:'center',wrapText:true};});
      for(const row of sheetRows(sheet)){
        const xr=ws.addRow(row.vals); xr.alignment={vertical:'middle',wrapText:true};
        if(row.lvl==='L1') xr.eachCell({includeEmpty:true},c=>{c.font={bold:true};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFECFFE0'}};});
        if(row.lvl==='C') xr.eachCell({includeEmpty:true},c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDEBF7'}};});
        const ck=xr.getCell(15).value; if(ck==='지연') xr.getCell(15).font={bold:true,color:{argb:'FFC00000'}}; else if(ck==='임박') xr.getCell(15).font={bold:true,color:{argb:'FFC65911'}};
      }
      [7,8,28,10,44,16,16,9,9,9,9,11,11,8,12,...(sheet==='WBS'?[8,8,8,9,18]:[11,28,11,11,28]),8,9,9,40].forEach((w,i)=>ws.getColumn(i+1).width=w);
      [12,13].forEach(i=>ws.getColumn(i).numFmt='yy.mm.dd');
      if(sheet==='REQ') [16,18,19].forEach(i=>ws.getColumn(i).numFmt='yy.mm.dd'); else ws.getColumn(18).numFmt='0%';
      [21,22,23].forEach(i=>ws.getColumn(i).numFmt='0%');
      ws.autoFilter={from:{row:2,column:1},to:{row:2,column:head.length}};
    }
    const { data:hist } = await sb.from('item_history').select('item_id,changed_at,changed_by,changes').order('changed_at',{ascending:false}).limit(2000);
    const hs=wb.addWorksheet('변경 이력');
    hs.addRow(['일시','ID','수정자','변경 내용']).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF000000'}};});
    for(const h of hist||[]) hs.addRow([new Date(h.changed_at), h.item_id, h.changed_by, h.changes]);
    hs.getColumn(1).numFmt='yy.mm.dd hh:mm'; [16,9,10,100].forEach((w,i)=>hs.getColumn(i+1).width=w);
    // 모든 셀 글꼴을 Pretendard로 (설치되지 않은 PC에서는 엑셀이 기본 글꼴로 대체)
    wb.eachSheet(ws=>ws.eachRow({includeEmpty:true},r=>r.eachCell({includeEmpty:true},c=>{ c.font={...(c.font||{}), name:'Pretendard'}; })));
    const buf=await wb.xlsx.writeBuffer();
    const url=URL.createObjectURL(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const a=document.createElement('a'); a.href=url; a.download=`JC_EDU_Marketing_WBS_${iso(today).replace(/-/g,'')}.xlsx`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
    toast('엑셀 파일을 내려받았습니다.');
  }catch(e){ toast('엑셀을 만들지 못했습니다: '+(e.message||e)); }
  finally{ btn.disabled=false; }
});

boot();
})();
