/* JC EDU 마케팅 WBS — GitHub Pages + Supabase
 * 데이터: items(업무), item_history(변경 이력), members(팀원·권한)
 * 권한: members 테이블에 등록된 이메일만 조회 가능, role=admin|member 편집, admin만 삭제 (RLS)
 */
(() => {
const CFG = window.JC_CONFIG || {};
if(!window.supabase){ document.body.innerHTML = '<p style="padding:24px;font-family:Pretendard,sans-serif">필요한 모듈(Supabase)을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.</p>'; return; }
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

const STATUS = ['In Progress','Planned','Review','On Hold','Completed','Canceled'];
const ST_KO = {'In Progress':'진행 중','Planned':'예정','Review':'컨펌 대기','On Hold':'보류','Completed':'완료','Canceled':'취소'};
const ST_CLS = {'In Progress':'ip','Planned':'pl','Review':'rv','On Hold':'oh','Completed':'co','Canceled':'ca'};
const BRANDS = ['공통','메디원','유프관','메디원&유프관','아임이그잼','인노트','제이콘','기타'];
const CYCLES = ['일간','주간','월간','분기','반기','연간','행사별','수시','단발'];
const FIELDS = ['kind','cat','task','output','link','brand','cyc','pic','bak','st','prog','start_date','end_date','note','memo','kpi_target','kpi_actual','kpi_month','kpi_memo','req_date','due_date','req_text','done_date','feedback'];
const LABELS = {cat:'Category',task:'Task',output:'Output',link:'산출물 링크',brand:'브랜드',cyc:'주기',pic:'PIC',bak:'Backup',st:'진행 상태',prog:'progress',start_date:'Start',end_date:'End',note:'비고',memo:'최근 메모',kind:'유형',kpi_target:'월 목표',kpi_actual:'월 실적',kpi_month:'기준월',kpi_memo:'실적 메모',req_date:'요청일',due_date:'보고 기한',req_text:'요청 원문',done_date:'보고 완료일',feedback:'대표님 피드백'};
const DAY = 864e5;
const today = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();

let items = [], byId = {}, PEOPLE = ['전원'], STAFF = [], MEMBERS = [], CHECKS = {}, me = null, selId = null;
const ui = {
  wbs:{q:'',pic:'',st:'',brand:'',chk:'',mine:false,collapsed:new Set()},
  req:{q:'',pic:'',st:'',brand:'',chk:'',mine:false,collapsed:new Set()},
  my:{view:(()=>{ try{ return localStorage.getItem('jcwbs-myview')==='board'?'board':'list'; }catch(e){ return 'list'; } })(), filter:'', done:false},
  weeklyBase:null, ganttSheet:'WBS', ganttZoom:'mid', ganttMine:false, ganttScrolled:false,
  cal:{y:null, m:null, sheet:'', who:'', brand:'', scope:'event'},
  daily:{mode:'write', date:null}
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
  if(!isTask(r) || r.kind==='goal') return '';   // 목표·R&R은 일정 체크 대상 아님
  if(r.st==='Review') return '진행';
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
  await loadFeed();
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
    if(selId && p.new && p.new.id===selId) markSeen(selId, true);
    newsTabs();
    if(selId && p.new && p.new.id===selId && p.new.updated_by!==me.name) toast(`${p.new.updated_by||'다른 팀원'}님이 이 업무를 방금 수정했습니다.`);
    if(!$('drawer').classList.contains('on')) rerender();
  }).on('postgres_changes', {event:'INSERT', schema:'public', table:'item_comments'}, p => onCommentInsert(p.new))
  .on('postgres_changes', {event:'*', schema:'public', table:'daily_reports'}, () => { if(current()==='daily' && ui.daily.mode==='team' && !$('drawer').classList.contains('on')) renderTeamDaily(); })
  .on('postgres_changes', {event:'INSERT', schema:'public', table:'item_history'}, p => { addFeed(fromHistory(p.new), true); if(!$('drawer').classList.contains('on')) rerender(); else newsTabs(); })
  .subscribe(st => { const el=$('syncState'); el.textContent = st==='SUBSCRIBED'?'실시간 반영 중':'연결 중'; el.classList.toggle('live', st==='SUBSCRIBED'); });
}

// ---------------- dashboard
function renderDashboard(){
  const W=sheetStats('WBS'), R=sheetStats('REQ'); const all=[...W.ts,...R.ts];
  const work = items.filter(r=>r.lvl!=='L1');
  const w0=new Date(today); w0.setDate(today.getDate()-((today.getDay()+6)%7)); const w1=new Date(w0); w1.setDate(w0.getDate()+6);
  const due = all.filter(r=>{const e=pd(r.end_date); return e&&e>=w0&&e<=w1;}).sort((a,b)=>pd(a.end_date)-pd(b.end_date));
  const dueOpen = due.filter(r=>!DONE(r.st));
  const doneRecent = items.filter(r=>isTask(r) && r.st==='Completed' && ts(r.updated_at) >= Date.now()-14*DAY).sort((a,b)=>ts(b.updated_at)-ts(a.updated_at));
  const tile=(k,v,s,cls,go)=>`<button class="tile ${cls||''}" type="button" data-go="${go}"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></button>`;
  const prog=(lab,S,go)=>`<button class="tile" type="button" data-go="${go}"><span class="k">${lab} 진척</span><span class="v">${pct(S.actual)}</span><div class="pbar"><i style="width:${S.actual*100}%"></i><b style="left:calc(${Math.min(1,S.plan)*100}% - 1px)"></b></div><span class="s">오늘까지 계획 ${pct(S.plan)} · ${S.actual>=S.plan?'계획 이상':'계획보다 '+Math.round((S.plan-S.actual)*100)+'%p 늦음'}</span></button>`;
  const OTHER='(목록에 없는 이름)';
  // 업무량은 진행 중인 업무만 (완료·취소는 오른쪽 '완료' 수로 따로)
  const OPEN_ST = STATUS.filter(s=>s!=='Completed' && s!=='Canceled');
  const ppl = [...PEOPLE,OTHER,'(미지정)'].map(p=>{ const all=work.filter(r=>p==='(미지정)'?!r.pic:p===OTHER?(r.pic&&!PEOPLE.includes(r.pic)):r.pic===p); const mine=all.filter(r=>!DONE(r.st)); return {p, cnt:OPEN_ST.map(s=>mine.filter(r=>r.st===s).length), none:mine.filter(r=>!STATUS.includes(r.st)).length, tot:mine.length, done:all.filter(r=>r.st==='Completed').length, late:mine.filter(r=>check(r)==='지연').length, bak:work.filter(r=>p!=='(미지정)'&&p!==OTHER&&r.bak===p&&!DONE(r.st)).length}; }).filter(x=>x.tot||x.bak||x.done||PEOPLE.includes(x.p));
  const max = Math.max(...ppl.map(x=>x.tot),1);
  $('v-dashboard').innerHTML = `<div class="band">
  <div class="grid-tiles">${prog('WBS',W,'wbs')}${prog('대표님 REQ',R,'req')}
    ${tile('지연',W.late+R.late,'종료일이 지났는데 완료되지 않음','bad','chk:지연')}
    ${tile('임박',W.soon+R.soon,'3일 이내 마감','warn','chk:임박')}
    ${tile('⚠ 확인 필요',W.warn+R.warn,'완료인데 진척률 미달 · 종료일 없음','caution','chk:⚠')}
    ${tile('이번 주 마감',dueOpen.length,`${fmtD(w0)} ~ ${fmtD(w1)} · 완료 ${due.length-dueOpen.length}건 제외`,'','weekly')}
    ${(()=>{const n=items.filter(r=>r.parent&&/-INBOX$/.test(r.parent)).length; return n?tile('미분류함',n,'WBS 위치 정리가 필요한 새 업무','warn','wbs'):'';})()}
    ${(()=>{const n=items.filter(r=>r.delete_requested_at).length; return n?tile('삭제 대기',n,me.role==='admin'?'승인이 필요한 삭제 요청':'관리자 승인 대기 중','bad','chk:삭제 대기'):'';})()}</div></div>
  <div class="cols">
    <div class="panel"><h2 class="sec">담당자별 업무량</h2>
      <div class="people">${ppl.map(x=>`<div class="person pdone" title="${esc(x.p)} · 진행 중인 담당 ${x.tot}건 (${OPEN_ST.map((s,i)=>x.cnt[i]?ST_KO[s]+' '+x.cnt[i]:'').filter(Boolean).join(', ')}${x.none?', 상태 없음 '+x.none:''}) · 완료 ${x.done}건 · Backup ${x.bak}건"><span class="nm">${esc(x.p)}</span><div class="stack" style="width:${Math.max(x.tot/max*100,2)}%">${x.cnt.map((c,i)=>c?`<span class="s-${ST_CLS[OPEN_ST[i]]}" style="width:${c/x.tot*100}%"></span>`:'').join('')}${x.none?`<span style="width:${x.none/x.tot*100}%;background:var(--line)"></span>`:''}</div><span class="tot">${x.tot}${x.late?` <span style="color:var(--bad)">·${x.late}</span>`:''}</span><span class="dn-n" title="완료">완료 ${x.done}</span></div>`).join('')}</div>
      <div class="legend">${OPEN_ST.map(s=>`<span><i class="s-${ST_CLS[s]}"></i>${ST_KO[s]}</span>`).join('')}<span>진행 중인 업무만 막대로 · 완료는 오른쪽에 따로 · PIC 기준 (카테고리 제외) · 빨간 수 = 지연</span></div></div>
    <div class="panel"><h2 class="sec">이번 주 마감 (${fmtD(w0)} ~ ${fmtD(w1)}) <span class="hist" style="display:inline">진행 중 ${dueOpen.length}건</span></h2>
      ${dueOpen.length?`<table style="min-width:0"><thead><tr><th>ID</th><th>업무</th><th>PIC</th><th>상태</th><th>End</th><th></th></tr></thead><tbody>${dueOpen.map(r=>`<tr class="task" data-id="${r.id}"><td class="mono">${r.id}</td><td class="t-name"><span class="cat">${esc(r.cat)}</span><span class="tk">${esc(r.task)}</span></td><td class="nw">${esc(r.pic||'')}</td><td>${stChip(r.st)}</td><td class="mono">${fmtD(pd(r.end_date))}</td><td class="nw">${chkChip(check(r))}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">이번 주에 남은 마감 업무가 없어요.</div>'}</div>
  </div>
  <div class="panel" style="margin-top:16px"><h2 class="sec">완료한 업무 <span class="hist" style="display:inline">최근 14일 · ${doneRecent.length}건</span></h2>
    ${doneRecent.length?`<table style="min-width:0"><thead><tr><th>ID</th><th>업무</th><th>PIC</th><th>마감</th><th>완료</th></tr></thead><tbody>${doneRecent.map(r=>`<tr class="task" data-id="${r.id}"><td class="mono">${r.id}</td><td class="t-name"><span class="cat">${esc(r.cat||'')}${newsChip(r)}</span>${r.task?`<span class="tk">${esc(r.task)}</span>`:''}</td><td class="nw">${esc(r.pic||'')}</td><td class="mono">${r.end_date?fmtD(pd(r.end_date)):'–'}</td><td class="nw hist" style="display:table-cell">${ago(r.updated_at)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">최근 14일 동안 완료한 업무가 없어요.</div>'}
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
// 방금 바꾼·옮긴 업무 줄을 잠깐 표시하고, 표 밖에 있으면 보이는 곳으로
let FLASH_ID = null;
function flashRow(view){
  if(!FLASH_ID) return; const tr = view.querySelector(`tr[data-id="${FLASH_ID}"]`); FLASH_ID = null; if(!tr) return;
  const tw = view.querySelector('.tablewrap'), a = tr.getBoundingClientRect(), b = tw ? tw.getBoundingClientRect() : {top:0,bottom:innerHeight};
  if(a.top < b.top+40 || a.bottom > b.bottom) tr.scrollIntoView({block:'center'});
  tr.classList.add('flash'); setTimeout(()=>tr.classList.remove('flash'), 1600);
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
    body += `<tr class="g1" data-g="${g.id}"><td><span class="tw">${col?'▸':'▾'}</span>${esc(g.num)}</td><td></td><td>${esc(g.cat)}${delChip(g)}${gNews?` <span class="nb nb-new" title="이 카테고리에 새 소식 ${gNews}건">NEW ${gNews}</span>`:''} <span style="font-weight:400;color:var(--muted)">· ${a.n}건</span>${canEdit()?`<button class="addbtn" type="button" data-add="${g.id}">+ 업무 추가</button><button class="addbtn" type="button" data-edit="${g.id}">편집</button>`:''}</td>${colOrder.map(k=>`<td class="${MOVABLE[k].cls||''}">${MOVABLE[k].g?MOVABLE[k].g(a):''}</td>`).join('')}</tr>`;
    if(col) continue;
    for(const r of vis){
      const a2 = r.lvl==='P' ? groupAgg(r) : null;
      body += `<tr class="task lvl-${r.lvl}${r.id===selId?' sel':''}" data-id="${r.id}" ${owns(r)?'draggable="true" title="끌어서 위치 옮기기"':''}>
        <td class="mono">${r.id}</td><td class="mono" style="color:var(--muted)">${esc(r.num)}</td>
        <td class="t-name"><span class="cat">${r.kind?`<span class="kt kt-${r.kind}">${r.kind==='goal'?'목표':r.kind}</span>`:''}${esc(r.cat||'')}${delChip(r)}${newsChip(r)}${cmtBtn(r,true)}</span><span class="tk">${esc(r.task||'')}</span></td>
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
  // 다시 그려도 보던 위치 그대로 (표 안 스크롤 + 화면 스크롤)
  const tw0 = view.querySelector('.tablewrap'), keep = {top: tw0?tw0.scrollTop:0, left: tw0?tw0.scrollLeft:0, win: window.scrollY};
  const restore = () => { const tw = view.querySelector('.tablewrap'); if(tw){ tw.scrollTop = keep.top; tw.scrollLeft = keep.left; } if(Math.abs(window.scrollY-keep.win)>1) window.scrollTo(0, keep.win); flashRow(view); };
  const on=(id,ev,fn)=>{ const el=$(id); if(el) el.addEventListener(ev,fn); };
  if(bodyOnly && $(`${key}-q`)){
    const tmp=document.createElement('div'); tmp.innerHTML=html;
    view.querySelector('.tablewrap').replaceWith(tmp.querySelector('.tablewrap'));
    view.querySelector('.toolbar .count').replaceWith(tmp.querySelector('.toolbar .count'));
    bindBody(); restore(); return;
  }
  view.innerHTML = html;
  restore();
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
  bindRowDrag(view.querySelector('.tablewrap tbody'));
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
  const sheet = ui.ganttSheet, px = ui.ganttPx || G_ZOOM[ui.ganttZoom] || 12, onlyMine = ui.ganttMine;
  { const ob = $('g-box'); ui.ganttKeep = ob && ui.ganttScrolled ? {left:ob.scrollLeft, top:ob.scrollTop} : null; }
  const vis = r => !onlyMine || r.pic===me.name || r.bak===me.name;
  const dated = items.filter(r=>r.sheet===sheet&&isTask(r)&&(r.start_date||r.end_date)&&vis(r));
  const ds = dated.flatMap(r=>[pd(r.start_date),pd(r.end_date)]).filter(Boolean);
  const minS = ds.length ? new Date(Math.min(...ds, today.getTime()-14*DAY)) : addDays(today,-14);
  const g0 = new Date(minS); g0.setDate(g0.getDate()-((g0.getDay()+6)%7));
  const maxE = ds.length ? new Date(Math.max(...ds, today.getTime())) : today;
  const weeks = Math.max(8, Math.ceil((maxE-g0)/DAY/7)+3);
  const days = weeks*7, W = days*px, X = d => Math.round((d-g0)/DAY*px);
  let head='', grid='', pm=-1;
  // 확대 정도에 따라 날짜 표시 간격 조절 (좁으면 몇 주마다, 넓으면 날마다)
  const step = px*7>=44 ? 1 : px*7>=22 ? 2 : 4;
  for(let k=0;k<weeks;k++){ const d=addDays(g0,k*7), m=d.getMonth(); const nm = m!==pm; if(k%step===0 || nm) head+=`<div class="${nm?'m':''}" style="left:${k*7*px}px">${nm?(m+1)+'월 ':''}${step>1&&!nm?'':d.getDate()}</div>`; grid+=`<div style="left:${k*7*px}px"></div>`; pm=m; }
  if(px>=18) for(let k=0;k<days;k++) if(k%7){ grid+=`<div class="d" style="left:${k*px}px"></div>`; if(px>=30) head+=`<div class="dd" style="left:${k*px}px">${addDays(g0,k).getDate()}</div>`; }
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
      rows += `<div class="g-row" data-id="${r.id}"><div class="g-lab" title="${esc(titleOf(r))} · PIC ${esc(r.pic||'–')}"><span class="mono" style="color:var(--muted)">${r.id}</span><span class="g-nm">${newsOf(r)?'<span class="nb nb-new nb-xs" title="새 소식">N</span>':''}${r.is_milestone?'◆ ':''}${esc(r.cat)}</span><span class="g-pic">${esc(r.pic||'')}</span></div><div class="g-track">${`<div class="g-grid">${grid}</div>`}${tx}${bar(r)}</div></div>`;
    }
  }
  $('v-gantt').innerHTML = `<div class="toolbar">
      <select id="g-sheet" aria-label="시트"><option value="WBS" ${sheet==='WBS'?'selected':''}>WBS</option><option value="REQ" ${sheet==='REQ'?'selected':''}>대표님 REQ</option></select>
      <div class="vt" role="group" aria-label="확대">${[['narrow','분기'],['mid','월'],['wide','주']].map(([k,l])=>`<button type="button" data-gz="${k}" class="${Math.abs(px-G_ZOOM[k])<.5?'on':''}">${l}</button>`).join('')}</div>
      <label class="chk-inline"><input type="checkbox" id="g-mine" ${onlyMine?'checked':''}> 내 업무만</label>
      <button class="btn" type="button" id="g-today">오늘로</button>
      <div class="legend" style="margin:0"><span><i class="s-ip"></i>진행 중</span><span><i class="s-pl"></i>예정</span><span><i class="s-oh"></i>보류</span><span><i class="s-co"></i>완료</span><span><i style="background:var(--bad)"></i>지연</span><span>◆ 마일스톤 · 초록 세로선 = 오늘</span></div>
      <span class="count">날짜 줄 위에서 휠 또는 Ctrl+휠: 기간 늘리기·줄이기 · 막대를 끌면 일정 이동 · 양 끝을 끌면 시작·마감 조절 (내 업무만)</span></div>
    <div class="gantt" id="g-box"><div class="g-head" style="grid-template-columns:300px ${W}px;width:${300+W}px"><div class="g-lab">업무</div><div class="g-weeks">${head}</div></div>${rows.replace(/class="g-row/g,`style="grid-template-columns:300px ${W}px;width:${300+W}px" class="g-row`)||'<div class="empty">일정이 있는 업무가 없어요.</div>'}</div>
    <div class="g-tip hidden" id="g-tip"></div>`;
  $('g-sheet').onchange = e => { ui.ganttSheet=e.target.value; renderGantt(); };
  $('g-mine').onchange = e => { ui.ganttMine=e.target.checked; renderGantt(); };
  document.querySelectorAll('[data-gz]').forEach(b=>b.onclick=()=>{ ui.ganttZoom=b.dataset.gz; ui.ganttPx=G_ZOOM[b.dataset.gz]; ui.ganttScrolled=false; renderGantt(); });
  const box = $('g-box');
  const scrollToday = () => { box.scrollLeft = Math.max(0, X(today) - (box.clientWidth-300)/3); };
  $('g-today').onclick = scrollToday;
  if(!ui.ganttAnchor && ui.ganttKeep){ box.scrollLeft = ui.ganttKeep.left; box.scrollTop = ui.ganttKeep.top; }
  if(ui.ganttAnchor){ const a = ui.ganttAnchor; ui.ganttAnchor = null; box.scrollLeft = Math.max(0, (a.day - (g0-a.g0)/DAY) * px - a.x); box.scrollTop = a.top; }
  else if(!ui.ganttScrolled){ scrollToday(); ui.ganttScrolled = true; }
  bindGanttDrag(box, px);
  // 마우스 휠로 기간 확대·축소: 날짜 줄 위에서는 그냥 휠, 그 외에서는 Ctrl(⌘)+휠 (트랙패드 핀치 포함). 가리킨 날짜를 기준으로
  box.addEventListener('wheel', e => {
    if(!(e.ctrlKey || e.metaKey || e.target.closest('.g-head'))) return;
    e.preventDefault();
    if(ui.ganttWheelBusy) { ui.ganttWheelAcc = (ui.ganttWheelAcc||0) + e.deltaY; return; }
    const rect = box.getBoundingClientRect(), x = Math.max(0, e.clientX - rect.left - 300);
    const dy = e.deltaY + (ui.ganttWheelAcc||0); ui.ganttWheelAcc = 0;
    const np = Math.min(48, Math.max(2, px * Math.exp(-dy * 0.0018)));
    if(Math.abs(np-px) < .05) return;
    ui.ganttAnchor = {day:(box.scrollLeft + x)/px, x, g0, top:box.scrollTop};
    ui.ganttPx = np; ui.ganttWheelBusy = true;
    requestAnimationFrame(()=>{ renderGantt(); ui.ganttWheelBusy = false; });
  }, {passive:false});
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
  const inScope = r => f.scope==='all' ? true : f.scope==='P' ? (r.kind==='P' || (!r.kind && r.cyc==='단발')) : f.scope==='R' ? r.kind==='R' : evt(r);
  return items.filter(r=>isTask(r) && (r.start_date||r.end_date) && r.st!=='Canceled' && inScope(r)
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
      cells += `<div class="cal-d ${out?'out':''} ${isT?'today':''} ${we?'we':''}" style="grid-column:${d+1};grid-row:1 / span ${CAL_LANES+2}"><div class="dh"><span class="dn">${day.getDate()}</span>${day.getDate()===1||(w===0&&d===0)?`<span class="dm">${day.getMonth()+1}월</span>`:''}${isT?'<span class="dt">오늘</span>':''}</div></div>`;
      if(more[d]) cells += `<button type="button" class="cal-more" data-day="${iso(day)}" style="grid-column:${d+1};grid-row:${CAL_LANES+2}">+${more[d]}건 더보기</button>`;
    }
    const bars = placed.map(sg=>{
      const r = sg.r, c = check(r);
      const cls = [BRAND_CLS[r.brand]||'b0', r.st==='Completed'?'done':'', c==='지연'?'late':'', sg.s<w0?'cont-l':'', sg.e>w1?'cont-r':'', r.is_milestone?'ms':''].join(' ');
      return `<button type="button" class="cal-bar ${cls}" data-open="${r.id}" style="grid-column:${sg.a+1} / ${sg.b+2};grid-row:${sg.li+2}" title="${esc(titleOf(r))} · ${esc(r.brand||'')} · PIC ${esc(r.pic||'–')} · ${fmtD(sg.s)}~${fmtD(sg.e)} · ${ST_KO[r.st]||''}">${r.is_milestone?'◆ ':''}${esc(r.cat||r.task||'')}${r.pic&&f.who!=='@me'?` <span class="who">${esc(r.pic)}</span>`:''}</button>`;
    }).join('');
    weeksHtml += `<div class="cal-w" style="grid-template-rows:40px repeat(${CAL_LANES},24px) 22px">${cells}${bars}</div>`;
  }
  const brands = [...new Set(items.filter(isTask).map(r=>r.brand).filter(Boolean))];
  const opt = (v,l,sel) => `<option value="${esc(v)}" ${v===sel?'selected':''}>${esc(l)}</option>`;
  $('v-cal').innerHTML = `
    <div class="toolbar">
      <button class="btn" type="button" data-cm="-1" aria-label="이전 달">‹</button>
      <b class="cal-title">${f.y}년 ${f.m+1}월</b>
      <button class="btn" type="button" data-cm="1" aria-label="다음 달">›</button>
      <button class="btn" type="button" data-cm="0">이번 달</button>
      <div class="vt" role="group" aria-label="표시 범위">${[['event','캠페인·행사','행사·단발 업무, 한 달 이내 업무, 마일스톤'],['P','단발 (P)','기간이 있는 프로젝트 업무'],['R','루틴 (R)','반복 업무 (SNS 업로드·리포트 등)'],['all','전체','목표·상시 업무 포함']].map(([k,l,t])=>`<button type="button" data-cs="${k}" class="${(f.scope||'event')===k?'on':''}" title="${t}">${l}</button>`).join('')}</div>
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
const stale = r => isTask(r) && r.kind!=='goal' && r.st==='In Progress' && r.updated_at && (Date.now()-new Date(r.updated_at).getTime())/DAY >= STALE_DAYS;
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
  const sub = [r.brand, r.num && `${r.sheet==='REQ'?'REQ ':''}${r.num}`, d!=null && ddTxt(d), ck.n && `체크 ${ck.done}/${ck.n}`].filter(Boolean).map(esc).join(' · ');
  const seg = PROG_STEPS.map(p=>`<button type="button" data-pg="${p}" class="${r.prog!=null && Math.round(r.prog*100)>=p*100 && (p>0||r.prog===0)?'on':''}" ${ed&&!ck.n?'':'disabled'} title="${ck.n?'체크리스트로 자동 계산':Math.round(p*100)+'%'}">${Math.round(p*100)}</button>`).join('');
  return `<div class="mrow" data-row="${r.id}">
    <div class="mt"><button type="button" class="t" data-open="${r.id}">${esc(titleOf(r))}</button>${newsChip(r)}
      <div class="sub">${sub}${cmtBtn(r,true)}${c && c!=='진행' && c!=='예정' ? ' '+chkChip(c):''}${stale(r)?` <span class="chip k-warn">${ago(r.updated_at)} 업데이트</span>`:''}</div></div>
    <select data-st aria-label="진행 상태" ${ed?'':'disabled'}>${STATUS.map(s=>`<option value="${s}" ${s===r.st?'selected':''}>${ST_KO[s]}</option>`).join('')}${r.st?'':'<option value="" selected>상태 없음</option>'}</select>
    <div class="seg" role="group" aria-label="진척률">${seg}</div>
    <button type="button" class="iconbtn" data-memo aria-label="한 줄 메모" title="한 줄 메모" ${ed?'':'disabled'}>✎</button>
    ${r.memo?`<div class="memo">${esc(r.memo)}</div>`:''}
  </div>`;
}
function bCard(r){
  const d=dday(r), ck=ckStat(r.id);
  return `<div class="bcard" draggable="${owns(r)}" data-card="${r.id}"><button type="button" class="t" data-open="${r.id}">${esc(titleOf(r))}</button>${newsChip(r)}
    <div class="sub">${[r.brand, d!=null&&ddTxt(d), r.prog!=null&&pct(r.prog), ck.n&&`체크 ${ck.done}/${ck.n}`].filter(Boolean).map(esc).join(' · ')} ${cmtBtn(r)}${check(r)==='지연'?chkChip('지연'):''}</div></div>`;
}

function renderMy(){
  const el = $('v-my'), f = ui.my;
  const [w0,w1] = weekRange();
  const mineAll = items.filter(r=>isTask(r) && r.kind!=='goal' && r.pic===me.name);
  const open = mineAll.filter(r=>!DONE(r.st));
  const inWeek = r => { const e=pd(r.end_date); return e && e>=w0 && e<=w1; };
  const late = open.filter(r=>check(r)==='지연'), week = open.filter(inWeek), ip = open.filter(r=>r.st==='In Progress'), st = open.filter(stale);
  const todayN = open.filter(r=>{ const e=pd(r.end_date); return check(r)==='지연' || (e && e<=today); }).length;
  const FILTERS = {late:['지연',late], week:['이번 주 마감',week], ip:['진행 중',ip], stale:['업데이트 필요',st]};
  let list = f.filter && FILTERS[f.filter] ? FILTERS[f.filter][1] : open;
  // 완료한 업무는 따로 (최근 30일, 최근 완료 순)
  const doneL = mineAll.filter(r=>r.st==='Completed' && ts(r.updated_at) >= Date.now()-30*DAY).sort((a,b)=>ts(b.updated_at)-ts(a.updated_at));
  list = [...list].sort((a,b)=>{ const x=focusRank(a), y=focusRank(b); return x[0]-y[0] || x[1]-y[1]; });
  const tile = (k,label,arr,cls,sub) => `<button class="tile ${cls||''} ${f.filter===k?'on':''}" type="button" data-myf="${k}"><span class="k">${label}</span><span class="v">${arr.length}</span><span class="s">${sub}</span></button>`;
  const bak = items.filter(r=>isTask(r) && r.kind!=='goal' && r.bak===me.name && !DONE(r.st));
  const all = items.filter(r=>isTask(r) && r.kind!=='goal' && r.pic==='전원' && !DONE(r.st));
  const inbox = items.filter(r=>r.parent && /-INBOX$/.test(r.parent));
  const ed = canEdit();
  const board = () => `<div class="board">${['Planned','In Progress','Review','On Hold','Completed'].map(s=>{
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
      ${canEdit()?'<a class="btn" href="#daily" id="my-daily">오늘 일일보고 <span class="dr-st" id="my-daily-st">확인 중</span></a>':''}
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
      <div class="my-maincol">
      <div class="panel" style="padding:0">
        <div class="ph"><b>${f.filter?esc(FILTERS[f.filter][0]):'오늘 집중'}</b>
          <span class="hist" style="display:inline">${f.filter?`<button type="button" class="linkbtn" data-myf="">필터 해제</button>`:'지연 → 마감 가까운 순'}</span>
          <div class="spacer"></div>

          <div class="vt" role="group" aria-label="보기"><button type="button" data-myv="list" class="${f.view==='list'?'on':''}">목록</button><button type="button" data-myv="board" class="${f.view==='board'?'on':''}">보드</button></div>
        </div>
        ${f.view==='board' ? `<div style="padding:12px">${board()}</div>` : (list.length ? `<div class="mylist">${list.map(myRow).join('')}</div>` : `<div class="empty">${mineAll.length?'해당하는 업무가 없어요.':'내가 PIC인 업무가 아직 없어요. 오른쪽 위 \'+ 업무 등록\'으로 시작하세요.'}</div>`)}
      </div>
      ${f.view==='list' ? `<div class="panel done-panel" style="padding:0">
        <button type="button" class="ph done-h" id="my-donetoggle" aria-expanded="${!!f.showDone}"><b>완료한 업무</b><span class="hist" style="display:inline">최근 30일 · ${doneL.length}건</span><div class="spacer"></div><span class="hist" style="display:inline">${f.showDone?'접기 ▴':'펼치기 ▾'}</span></button>
        ${f.showDone ? (doneL.length ? `<div class="mylist done-list">${doneL.map(r=>`<div class="mrow"><div class="mt"><button type="button" class="t" data-open="${r.id}">${esc(titleOf(r))}</button>${newsChip(r)}<div class="sub">${[r.brand, r.end_date&&'마감 '+fmtD(pd(r.end_date)), '완료 '+ago(r.updated_at)].filter(Boolean).map(esc).join(' · ')}${cmtBtn(r)}</div></div>${owns(r)?`<button type="button" class="btn" data-reopen="${r.id}">다시 진행</button>`:''}</div>`).join('')}</div>` : '<div class="empty">최근 30일 동안 완료한 업무가 없어요.</div>') : ''}
      </div>` : ''}
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
  if(canEdit()) sb.from('daily_reports').select('submitted_at').eq('author',me.name).eq('report_date',iso(today)).maybeSingle().then(({data})=>{ const e=$('my-daily-st'); if(e){ e.textContent = data ? (data.submitted_at?'제출됨':'임시 저장') : '작성 전'; e.className = 'dr-st '+(data&&data.submitted_at?'ok':'todo'); } });
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
  const mine = items.filter(r=>isTask(r) && r.kind!=='goal' && r.pic===me.name);
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
    const cb = e.target.closest('[data-cmt]'); if(cb){ openDrawer(cb.dataset.cmt,'cmt'); return; }
    const o = e.target.closest('[data-open]'); if(o){ openDrawer(o.dataset.open); return; }
    const fl = e.target.closest('[data-myf]'); if(fl){ ui.my.filter = ui.my.filter===fl.dataset.myf ? '' : fl.dataset.myf; if(ui.my.filter) ui.my.view='list'; renderMy(); return; }
    const vv = e.target.closest('[data-myv]'); if(vv){ ui.my.view = vv.dataset.myv; if(vv.dataset.myv==='board') ui.my.filter=''; try{localStorage.setItem('jcwbs-myview',ui.my.view);}catch(_){}; renderMy(); return; }
    if(e.target.id==='my-add'){ openQuickAdd(); return; }
    if(e.target.closest('#my-donetoggle')){ ui.my.showDone = !ui.my.showDone; renderMy(); return; }
    const ro = e.target.closest('[data-reopen]'); if(ro){ const r=byId[ro.dataset.reopen]; if(r && await quickUpdate(r,{st:'In Progress', prog:Math.min(r.prog??.9, .9)})) toast('다시 진행 중으로 바꿨어요.'); renderMy(); return; }
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
        <div class="field"><label for="qa-kind">유형</label><select id="qa-kind"><option value="P">P 프로젝트</option><option value="R">R 반복(루틴)</option></select></div>
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
    const id = await insertUnder(parent, {cat:name, kind:$('qa-kind').value, cyc:$('qa-kind').value==='R'?'반복':'단발', brand:$('qa-brand').value, pic:$('qa-pic').value||me.name, bak:$('qa-bak').value||null, start_date:s, end_date:en, prog:lines.length?0:null}, '업무 등록');
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
  const row = {id, sheet, num:`${p.num}.${lastNum+1}`, lvl:p.lvl==='L1'?'T':'C', parent:parentId, cyc:'단발', kind:'P', st:'Planned', w:0,
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

// ---------------- 알림 = 모든 변경 사항 피드 (변경 이력 + 댓글). 분류별로 걸러 보기
// 출처: item_history(등록·수정·이동·삭제·체크리스트 등 모든 기록) + item_comments(댓글·멘션). 최근 30일
// 읽음 상태는 각자 브라우저에 저장. 내가 한 변경은 목록에는 보이되 안 읽은 숫자에는 넣지 않음
let FEED = [], READ = {before:0, keys:{}}, feedFilter = {cat:'all', mineOnly:false, hideMine:false};
const nKey = k => `jcwbs-${k}-${(me&&me.email||'').toLowerCase()}`;
const CATS = [
  ['all','전체'], ['mention','멘션'], ['comment','댓글'], ['new','새 업무'], ['prog','상태·진척'],
  ['sched','일정'], ['edit','내용 수정'], ['move','이동'], ['del','삭제'], ['daily','일일보고'], ['admin','회원·담당자']
];
const CAT_KO = Object.fromEntries(CATS);
function catsOfHistory(h){
  if(h.item_id==='MEMBER' || h.item_id==='STAFF') return ['admin'];
  if(h.item_id==='DAILY') return (me && String(h.changes).includes('@'+me.name)) ? ['mention','daily'] : ['daily'];
  const t = h.changes||'', out = new Set();
  if(/^(업무 등록|업무 추가|카테고리 추가)/.test(t)) out.add('new');
  if(/진행 상태|progress|체크리스트/.test(t)) out.add('prog');
  if(/(^|\/ )(Start|End):|마일스톤/.test(t)) out.add('sched');
  if(/상위 항목 이동/.test(t)) out.add('move');
  if(/(^|\/ )삭제|삭제 요청|삭제 반려|삭제 요청 취소/.test(t) && !/체크리스트 삭제/.test(t)) out.add('del');
  // 위에 해당하지 않는 필드 변경(업무명·내용·담당자·메모·비고·링크 등)
  const parts = t.split(' / ').filter(p=>!/^(진행 상태|progress|체크리스트|Start|End|마일스톤|상위 항목 이동|업무 등록|업무 추가|카테고리 추가|삭제)/.test(p));
  if(parts.length || !out.size) out.add('edit');
  return [...out];
}
const fromHistory = h => ({key:'h'+(h.id||h.item_id+h.changed_at), src:'h', cats:catsOfHistory(h), item:h.item_id, by:h.changed_by, at:ts(h.changed_at), text:h.changes});
function fromComment(c){
  const cats = ['comment']; if(me && (c.mentions||[]).includes(me.name)) cats.unshift('mention');
  return {key:'c'+c.id, src:'c', cats, item:c.item_id, by:c.author, at:ts(c.created_at), text:c.body};
}
function readLoad(){
  READ = {before:0, keys:{}};
  try{ const o = JSON.parse(localStorage.getItem(nKey('read'))||'null'); if(o) READ = {before:o.before||0, keys:o.keys||{}}; }catch(e){}
  if(!READ.before){ READ.before = Date.now()-DAY; readSave(); }   // 처음 쓰는 사람은 최근 하루치만 안 읽음으로
}
function readSave(){
  for(const k in READ.keys) if(READ.keys[k] < READ.before) delete READ.keys[k];
  try{ localStorage.setItem(nKey('read'), JSON.stringify(READ)); }catch(e){}
}
const isRead = e => e.by===me.name || e.at<=READ.before || !!READ.keys[e.key];
const myItem = id => { const r = byId[id]; return !!r && (r.pic===me.name || r.bak===me.name || r.created_by===me.name); };
function markRead(key){ if(!READ.keys[key]){ READ.keys[key] = Date.now(); readSave(); nBadge(); } }
function markItemRead(id){ let ch=false; for(const e of FEED) if(e.item===id && !isRead(e)){ READ.keys[e.key]=Date.now(); ch=true; } if(ch){ readSave(); nBadge(); } }
function nBadge(){
  const n = FEED.filter(e=>!isRead(e) && (e.cats[0]!=='admin' || me.role==='admin')).length, b=$('bellN');
  b.textContent = n>99?'99+':n; b.classList.toggle('hidden', !n);
  $('bellBtn').setAttribute('aria-label', n?`알림 ${n}건 읽지 않음`:'알림');
}
function addFeed(e, live){
  if(FEED.some(x=>x.key===e.key)) return;
  FEED.unshift(e); FEED.sort((a,b)=>b.at-a.at); if(FEED.length>1500) FEED.length = 1500;
  nBadge();
  if($('drawer').classList.contains('on') && $('nt-list')) renderFeedList();
  if(!live || e.by===me.name) return;
  // 화면 아래 알림 + 바탕화면 알림: 멘션 · 내 업무 관련 · 새 업무 · 삭제
  const r = byId[e.item];
  const important = e.cats.includes('mention') || e.cats.includes('new') || myItem(e.item) || e.cats.includes('del');
  if(!important) return;
  setTimeout(()=>{
    const rr = byId[e.item]||r, title = rr ? titleOf(rr) : e.item;
    const head = e.cats.includes('mention') ? `${e.by} 님이 나를 언급했어요` : e.cats.includes('comment') ? `${e.by} 님의 댓글` : e.cats.includes('new') ? `${e.by} 님이 새 업무를 등록했어요` : myItem(e.item) ? `${e.by} 님이 내 업무를 변경했어요` : `${e.by} 님의 변경`;
    toast(`${head}: ${title}`);
    if(document.hidden && 'Notification' in window && Notification.permission==='granted'){
      try{ const n = new Notification(head, {body:`${title} · ${String(e.text).slice(0,80)}`, tag:'jcwbs-'+e.key});
        n.onclick = () => { window.focus(); if(byId[e.item]) openDrawer(e.item, e.src==='c'?'cmt':'info'); markRead(e.key); n.close(); }; }catch(_){}
    }
  }, e.cats.includes('new') && r && r.cat==='새 업무' ? 15000 : 300);
}
async function loadFeed(){
  readLoad();
  const since = new Date(Date.now()-30*DAY).toISOString();
  const [{ data:hs }, { data:cs }] = await Promise.all([
    sb.from('item_history').select('id,item_id,changed_at,changed_by,changes').gt('changed_at',since).order('changed_at',{ascending:false}).limit(1200),
    sb.from('item_comments').select('id,item_id,author,body,mentions,created_at').gt('created_at',since).order('created_at',{ascending:false}).limit(500)
  ]);
  FEED = [...(hs||[]).map(fromHistory), ...(cs||[]).map(fromComment)].sort((a,b)=>b.at-a.at);
  nBadge();
  const unread = FEED.filter(e=>!isRead(e) && (e.cats[0]!=='admin' || me.role==='admin')).length;
  if(unread) toast(`안 읽은 알림 ${unread}건이 있어요. 오른쪽 위 알림에서 분류별로 확인하세요.`);
}
function feedVisible(e){
  if(e.cats.includes('admin') && me.role!=='admin') return false;
  if(feedFilter.hideMine && e.by===me.name) return false;
  if(feedFilter.mineOnly && !myItem(e.item)) return false;
  return true;
}
function openNotifs(){
  selId=null;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  drawer.innerHTML = `
    <header><div style="flex:1"><div class="id">최근 30일 · 모든 변경 사항</div><h3>알림</h3></div><button class="btn" type="button" id="nt-close">닫기</button></header>
    <div class="nt-cats" id="nt-cats" role="tablist" aria-label="알림 분류"></div>
    <div class="nt-opts">
      <label class="chk-inline"><input type="checkbox" id="nt-mine" ${feedFilter.mineOnly?'checked':''}> 내 업무만</label>
      <label class="chk-inline"><input type="checkbox" id="nt-hide" ${feedFilter.hideMine?'checked':''}> 내 변경 숨기기</label>
      <div class="spacer"></div>
      <button class="linkbtn" type="button" id="nt-all">이 분류 모두 읽음</button>
      ${perm==='default'?'<button class="linkbtn" type="button" id="nt-perm">바탕화면 알림 켜기</button>':''}
    </div>
    <div class="body" style="padding-top:8px"><div id="nt-list"></div></div>`;
  drawer.classList.add('on'); scrim.classList.add('on');
  $('nt-close').onclick = closeDrawer;
  $('nt-mine').onchange = e => { feedFilter.mineOnly = e.target.checked; renderFeedList(); };
  $('nt-hide').onchange = e => { feedFilter.hideMine = e.target.checked; renderFeedList(); };
  $('nt-all').onclick = () => { const now=Date.now(); for(const e of FEED) if(feedVisible(e) && (feedFilter.cat==='all' || e.cats.includes(feedFilter.cat)) && !isRead(e)) READ.keys[e.key]=now; readSave(); nBadge(); renderFeedList(); };
  if($('nt-perm')) $('nt-perm').onclick = async () => { try{ await Notification.requestPermission(); }catch(e){} openNotifs(); };
  renderFeedList();
}
function renderFeedList(){
  const box = $('nt-list'), cbox = $('nt-cats'); if(!box) return;
  const base = FEED.filter(feedVisible);
  const cnt = c => base.filter(e=>(c==='all'||e.cats.includes(c)) && !isRead(e)).length;
  const tot = c => base.filter(e=>c==='all'||e.cats.includes(c)).length;
  cbox.innerHTML = CATS.filter(([c])=>c!=='admin' || me.role==='admin').map(([c,l])=>{ const u=cnt(c), t=tot(c); return `<button type="button" role="tab" data-fc="${c}" class="${feedFilter.cat===c?'on':''} ${t?'':'empty'}" aria-selected="${feedFilter.cat===c}">${l}${u?` <b>${u}</b>`:t?` <span>${t}</span>`:''}</button>`; }).join('');
  cbox.querySelectorAll('[data-fc]').forEach(b=>b.onclick=()=>{ feedFilter.cat=b.dataset.fc; renderFeedList(); });
  const list = base.filter(e=>feedFilter.cat==='all' || e.cats.includes(feedFilter.cat)).slice(0,300);
  const day = t => { const d=new Date(t); d.setHours(0,0,0,0); const diff=Math.round((today-d)/DAY); return diff===0?'오늘':diff===1?'어제':`${d.getMonth()+1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`; };
  let html='', last='';
  for(const e of list){
    const g = day(e.at); if(g!==last){ html += `<div class="nt-day">${g}</div>`; last=g; }
    const r = byId[e.item], rd = isRead(e);
    const title = r ? titleOf(r) : e.item==='DAILY' ? '일일보고' : (e.cats.includes('admin') ? (e.item==='MEMBER'?'회원 관리':'담당자 관리') : `${e.item} (삭제된 업무)`);
    html += `<button type="button" class="nt-item ${rd?'':'unread'}" data-k="${esc(e.key)}" data-item="${esc(e.item)}" data-src="${e.src}" ${r?'':'data-noopen="1"'}>
      <div class="nt-top">${rd?'':'<i class="dot"></i>'}${e.cats.map(c=>`<em class="nk ${c}">${CAT_KO[c]}</em>`).join('')}<span class="nt-t">${esc(title)}</span>${r&&myItem(e.item)?'<span class="nt-mine">내 업무</span>':''}</div>
      <div class="nt-txt">${e.src==='c'?richText(String(e.text).slice(0,200)):esc(String(e.text).slice(0,200))}</div>
      <div class="nt-meta">${esc(e.by)}${e.by===me.name?' (나)':''} · ${new Date(e.at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</div></button>`;
  }
  box.innerHTML = html || `<div class="cmt-empty">${feedFilter.cat==='all'?'최근 30일 동안 변경 사항이 없어요.':`'${CAT_KO[feedFilter.cat]}' 알림이 없어요.`}</div>`;
  box.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{ markRead(b.dataset.k); if(b.dataset.item==='DAILY'){ closeDrawer(); ui.daily.mode='team'; location.hash='daily'; lastView=null; rerender(); return; } if(b.dataset.noopen){ renderFeedList(); return; } openDrawer(b.dataset.item, b.dataset.src==='c'?'cmt':(b.dataset.src==='h'?'hist':'info')); });
}
$('bellBtn').addEventListener('click', openNotifs);

// ---------------- 새 소식 배지: 내가 마지막으로 열어 본 뒤 다른 사람이 등록·수정·댓글을 단 업무
// 업무를 열면 확인 처리. 기록은 각자 브라우저에 저장 (처음 쓰는 날 이후의 변경부터 표시)
let SEEN = {}, SEEN_BASE = 0, CMT_TIMES = {}, CMT_MINE = {};
const MINE_NEW_MS = DAY;   // 내가 바꾼 업무는 24시간 동안 NEW (열어 봐도 유지)
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
  if(FEED.some(x=>x.item===r.id && x.by!==me.name && x.cats.includes('new') && x.at>t)) return {kind:'new', label:'새 업무'};
  const n = (CMT_TIMES[r.id]||[]).filter(x=>x>t).length;
  if(n) return {kind:'cmt', label:`새 댓글 ${n}`};
  if(r.updated_by && r.updated_by!==me.name && ts(r.updated_at)>t) return {kind:'upd', label:'수정됨', by:r.updated_by};
  const now = Date.now(), hm = v => new Date(v).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  if(r.updated_by===me.name && now-ts(r.updated_at) < MINE_NEW_MS) return {kind:'mine', label:`내가 변경 · ${hm(r.updated_at)}`};
  if(CMT_MINE[r.id] && now-CMT_MINE[r.id] < MINE_NEW_MS) return {kind:'mine', label:`내 댓글 · ${hm(CMT_MINE[r.id])}`};
  return null;
}
const cmtBtn = (r, always) => { const n = CMT_N[r.id]||0; return (n||always) ? `<button type="button" class="cmtbtn${n?'':' zero'}" data-cmt="${r.id}" title="${n?`댓글 ${n}개 보기·쓰기`:'댓글 쓰기'}"><i aria-hidden="true"></i>${n||'댓글'}</button>` : ''; };
// 어떤 변화든 NEW 하나로 표시, 무엇이 바뀌었는지는 마우스를 올리면 보임
const newsChip = r => { const x = newsOf(r); return x ? ` <span class="nb nb-new" title="${esc(x.label)}${x.by?' · '+esc(x.by)+' 님':''} · ${x.kind==='mine'?'24시간 동안 표시':'열어 보면 사라져요'}">NEW</span>` : ''; };
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
  CMT_N = {}; CMT_TIMES = {}; CMT_MINE = {}; if(error) return;
  for(const c of data){ CMT_N[c.item_id] = (CMT_N[c.item_id]||0)+1; if(c.author!==me.name) (CMT_TIMES[c.item_id] ||= []).push(ts(c.created_at)); else CMT_MINE[c.item_id] = Math.max(CMT_MINE[c.item_id]||0, ts(c.created_at)); }
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
  return `<div class="cmts" id="d-cmts"><div class="hist">불러오는 중…</div></div>`;
}
function composerHtml(){
  return canEdit() ? `<form class="cmt-form" id="d-cform" autocomplete="off">
      <div class="cmt-wrap"><textarea id="d-cbody" maxlength="2000" rows="2" placeholder="댓글 입력 · @이름으로 알림 · Ctrl+Enter 등록" aria-label="댓글 입력"></textarea><div class="mention-box hidden" id="d-mbox" role="listbox"></div></div>
      <button class="btn primary" type="submit">등록</button></form>` : '<div class="hist" style="flex:1">보기 전용 계정은 댓글을 달 수 없어요.</div>';
}
async function loadComments(r){
  const { data, error } = await sb.from('item_comments').select('*').eq('item_id',r.id).order('created_at');
  const box = $('d-cmts'); if(!box || selId!==r.id) return;
  if(error){ box.innerHTML='<div class="hist">댓글을 불러오지 못했어요.</div>'; return; }
  CMT_N[r.id] = data.length; const cn=$('d-cn'); if(cn) cn.textContent = data.length||'';
  box.innerHTML = data.length ? data.map(c=>`<div class="cmt" data-cid="${c.id}"><div class="cmt-h"><b>${esc(c.author)}</b><span>${new Date(c.created_at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>${(c.author===me.name||me.role==='admin')?'<button type="button" class="linkbtn" data-cdel>삭제</button>':''}</div><div class="cmt-b">${richText(c.body)}</div></div>`).join('') : '<div class="cmt-empty">아직 댓글이 없어요.<br>진행 상황, 질문, 산출물 링크를 남겨 보세요.</div>';
  if(drawerTab==='cmt'){ const bd=drawer.querySelector('.body'); if(bd) bd.scrollTop = bd.scrollHeight; }
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
    ta.value=''; close(); CMT_MINE[r.id] = Date.now(); await loadComments(r);
    if(mentions.length) toast(`${mentions.length>3?mentions.length+'명':mentions.join(', ')}에게 알림을 보냈어요.`);
  };
}
function onCommentInsert(c){
  if(!me) return;
  CMT_N[c.item_id] = (CMT_N[c.item_id]||0) + 1;
  if(c.author!==me.name){ (CMT_TIMES[c.item_id] ||= []).push(ts(c.created_at)); if(selId===c.item_id) markSeen(c.item_id); }
  else CMT_MINE[c.item_id] = Math.max(CMT_MINE[c.item_id]||0, ts(c.created_at));
  if(selId===c.item_id && byId[c.item_id] && $('d-cmts')) loadComments(byId[c.item_id]);
  addFeed(fromComment(c), true);
  if(c.author===me.name) return;
  if(!$('drawer').classList.contains('on')) rerender(); else newsTabs();
}

// ---------------- 일일보고 — 전일 결과는 어제 금일 업무에서 자동, 금일은 내 업무에서 선택, 이번 주 계획은 업무 목록에서 자동
// 제출하면 업무 진척률·상태에 반영하고, 팀 양식 그대로 문구 복사 · 엑셀(팀 양식) 내려받기
const KIND_KO = {goal:'목표', P:'P', R:'R'};
const DR_ST = {'Planned':'예정','In Progress':'진행중','Review':'진행중','On Hold':'보류','Completed':'완료','Canceled':'완료'};
const isWork = r => isTask(r) && r.kind!=='goal';
const yymmdd = iso => iso ? String(iso).slice(2,10).replace(/-/g,'.') : '';
const p100 = v => v==null||v==='' ? '' : Math.round(Number(v)*100)+'%';
let DR = {date:null, report:null, done:[], today:[], issues:[], dirty:false};
let DR_TPL = null;
function weekOf(iso){ const d=pd(iso), w0=new Date(d); w0.setDate(d.getDate()-((d.getDay()+6)%7)); const w1=new Date(w0); w1.setDate(w0.getDate()+6); return [w0,w1]; }
// 이번 주 계획: 내 업무 중 (보고일이 속한 주에 마감) 또는 (아직 안 끝난 업무). 완료일 순
function planFor(author, dateIso){
  const [w0,w1] = weekOf(dateIso);
  return items.filter(r=>isWork(r) && r.pic===author && r.st!=='Canceled' && (()=>{ const e=pd(r.end_date); if(r.st==='Completed') return e && e>=w0 && e<=w1; return true; })())
    .sort((a,b)=>(pd(a.end_date)||new Date(9e15))-(pd(b.end_date)||new Date(9e15)))
    .map(r=>({item_id:r.id, kind:r.kind==='R'?'R':'P', title:r.cat||'', detail:r.task||'', due:r.end_date||null, status:DR_ST[r.st]||'예정', st:r.st}));
}
const myWorkOpen = name => items.filter(r=>isWork(r) && r.pic===name && r.st!=='Completed' && r.st!=='Canceled')
  .sort((a,b)=>(pd(a.end_date)||new Date(9e15))-(pd(b.end_date)||new Date(9e15)));
const entryFromItem = (r, prog) => ({item_id:r.id, kind:r.kind==='R'?'R':'P', title:r.cat||'', detail:'', prog: prog??(r.prog??0), note:''});

async function loadMyDaily(dateIso){
  DR = {date:dateIso, report:null, done:[], today:[], issues:[], dirty:false};
  const { data:rep } = await sb.from('daily_reports').select('*').eq('author',me.name).eq('report_date',dateIso).maybeSingle();
  if(rep){
    DR.report = rep; DR.issues = (rep.issues||[]).map(x=>({issue:x.issue||'', action:x.action||''}));
    const { data:es } = await sb.from('daily_entries').select('*').eq('report_id',rep.id).order('sort_order');
    for(const e of es||[]) if(e.section!=='plan') DR[e.section].push({item_id:e.item_id, kind:e.kind||'P', title:e.title, detail:e.detail||'', prog:e.prog, note:e.note||''});
  } else {
    // 전일 결과 = 가장 최근 내 보고의 '금일 업무' (진척률은 지금 업무 진척률로)
    const { data:prev } = await sb.from('daily_reports').select('id,report_date').eq('author',me.name).lt('report_date',dateIso).order('report_date',{ascending:false}).limit(1).maybeSingle();
    if(prev){
      const { data:es } = await sb.from('daily_entries').select('*').eq('report_id',prev.id).eq('section','today').order('sort_order');
      DR.done = (es||[]).map(e=>{ const r = e.item_id && byId[e.item_id]; return {item_id:e.item_id, kind:e.kind||'P', title:e.title, detail:e.detail||'', prog: r && r.prog!=null ? r.prog : e.prog, note: r && r.st==='Review' ? '컨펌 대기' : ''}; });
      DR.prevDate = prev.report_date;
    }
  }
  if(!DR.issues.length) DR.issues = [{issue:'', action:''}];
}
const PROG_OPTS = [0,.1,.2,.3,.4,.5,.6,.7,.8,.9,.95,1];
const progSel = (v, attr) => `<select ${attr} aria-label="진행률">${PROG_OPTS.map(p=>`<option value="${p}" ${v!=null && Math.abs(Number(v)-p)<.001?'selected':''}>${Math.round(p*100)}%</option>`).join('')}${v!=null && !PROG_OPTS.some(p=>Math.abs(Number(v)-p)<.001)?`<option value="${v}" selected>${Math.round(v*100)}%</option>`:''}</select>`;
const kindTag = k => `<span class="kt kt-${k||'P'}">${KIND_KO[k]||k||'P'}</span>`;

function renderDaily(){
  const el = $('v-daily'); const f = ui.daily;
  if(!f.date) f.date = iso(today);
  const tabs = `<div class="vt" role="group" aria-label="보기"><button type="button" data-dm="write" class="${f.mode==='write'?'on':''}">내 보고 작성</button><button type="button" data-dm="team" class="${f.mode==='team'?'on':''}">팀 일일보고</button></div>`;
  el.innerHTML = `<div class="band"><div class="my-head"><h2>일일보고</h2>${tabs}<input type="date" id="dr-date" value="${f.date}" aria-label="보고일"><button class="btn" type="button" id="dr-todaybtn">오늘</button><div class="spacer"></div><span class="hist" style="display:inline" id="dr-state"></span></div></div><div id="dr-body"><div class="empty">불러오는 중…</div></div>`;
  // 작성 중에 화면을 바꾸면 임시 저장부터
  const leave = async () => { if(f.mode==='write' && DR.dirty && DR.date) await saveDaily(false, true); };
  el.querySelectorAll('[data-dm]').forEach(b=>b.onclick=async()=>{ await leave(); f.mode=b.dataset.dm; renderDaily(); });
  $('dr-date').onchange = async e => { await leave(); f.date = e.target.value || iso(today); renderDaily(); };
  $('dr-todaybtn').onclick = async () => { await leave(); f.date = iso(today); renderDaily(); };
  if(f.mode==='team') renderTeamDaily(); else if(me.role==='viewer'){ f.mode='team'; renderTeamDaily(); } else loadMyDaily(f.date).then(renderWrite);
}

function renderWrite(){
  const box = $('dr-body'); if(!box || current()!=='daily' || ui.daily.mode!=='write') return;
  const f = ui.daily, sub = DR.report && DR.report.submitted_at;
  $('dr-state').textContent = sub ? `제출됨 · ${new Date(DR.report.submitted_at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} (다시 제출하면 덮어써요)` : DR.report ? '임시 저장됨' : '작성 전';
  const open = myWorkOpen(me.name);
  const chosen = new Set(DR.today.map(e=>e.item_id).filter(Boolean));
  const plan = planFor(me.name, f.date);
  const rd = pd(f.date);
  const row = (e,i,sec) => `<div class="dr-row" data-sec="${sec}" data-i="${i}">
      ${e.item_id&&byId[e.item_id] ? kindTag(e.kind) : `<select data-f="kind" class="dr-kind" aria-label="구분"><option ${e.kind!=='R'?'selected':''}>P</option><option ${e.kind==='R'?'selected':''}>R</option></select>`}<div class="dr-t">${e.item_id&&byId[e.item_id] ? `<b>${esc(e.title)}</b>` : `<input class="dr-title" data-f="title" value="${esc(e.title||'')}" placeholder="업무명 (업무 등록 없이 직접 입력)" aria-label="업무명">`}
        <input class="dr-detail" data-f="detail" value="${esc(e.detail||'')}" placeholder="세부 내용 (예: 칼럼 2부 연결 소재 업로드)" aria-label="세부 내용"></div>
      ${progSel(e.prog, 'data-f="prog"')}
      ${sec==='done'?`<select data-f="note" aria-label="완료 후 상태"><option value="" ${!e.note?'selected':''}>-</option><option ${e.note==='컨펌 대기'?'selected':''}>컨펌 대기</option></select>`:''}
      <button type="button" class="iconbtn sm" data-del aria-label="${esc(e.title)} 빼기">×</button></div>`;
  box.innerHTML = `
  <div class="dr-grid">
   <div class="dr-main">
    <section class="panel"><h2 class="sec">01 전일 업무 결과 <span class="hist" style="display:inline">${DR.prevDate?`${yymmdd(DR.prevDate)} 보고의 금일 업무에서 가져옴 · `:''}실제 진행률만 고치세요</span></h2>
      <div class="dr-list">${DR.done.map((e,i)=>row(e,i,'done')).join('') || '<div class="hist">전일 보고가 없어요. 아래에서 업무를 추가하세요.</div>'}</div>
      <div class="dr-add"><select id="dr-add-done" aria-label="업무에서 추가"><option value="">+ 내 업무에서 추가</option>${myWorkOpen(me.name).concat(items.filter(r=>isWork(r)&&r.pic===me.name&&r.st==='Completed'&&pd(r.updated_at)>=addDays(rd,-7))).map(r=>`<option value="${r.id}">${esc(titleOf(r))}</option>`).join('')}</select><button class="linkbtn" type="button" data-free="done">+ 직접 입력</button></div>
    </section>
    <section class="panel"><h2 class="sec">02 금일 업무 내용 <span class="hist" style="display:inline">내 업무를 체크하고 목표 진행률을 고르세요</span></h2>
      <div class="dr-pick">${open.map(r=>{ const c=check(r); return `<label class="dr-pk ${chosen.has(r.id)?'on':''}"><input type="checkbox" data-pick="${r.id}" ${chosen.has(r.id)?'checked':''}>${kindTag(r.kind)}<span>${esc(titleOf(r))}</span><span class="hist" style="display:inline">${r.end_date?yymmdd(r.end_date):'완료일 없음'} · ${p100(r.prog)||'0%'}${c==='지연'?' · <b style="color:var(--bad)">지연</b>':''}</span></label>`; }).join('') || '<div class="hist">진행 중인 내 업무가 없어요. 새 업무를 추가하세요.</div>'}</div>
      <div class="dr-list">${DR.today.map((e,i)=>row(e,i,'today')).join('')}</div>
      <form class="dr-new" id="dr-new"><select id="dr-new-kind" aria-label="구분"><option value="P">P 프로젝트</option><option value="R">R 반복</option></select><input id="dr-new-title" placeholder="새 업무명 (예: 메디원 채용공고 제작)" aria-label="새 업무명" maxlength="120"><input type="date" id="dr-new-end" aria-label="예상 완료일"><button class="btn" type="submit">+ 새 업무로 추가</button></form>
      <div class="dr-add"><button class="linkbtn" type="button" data-free="today">+ 업무 등록 없이 직접 입력</button></div>
    </section>
    <section class="panel"><h2 class="sec">03 이슈 / 요청사항 <span class="hist" style="display:inline">@이름을 쓰면 그 사람에게 알림</span></h2>
      <div class="dr-issues">${DR.issues.map((x,i)=>`<div class="dr-iss" data-ii="${i}"><input data-if="issue" value="${esc(x.issue)}" placeholder="이슈 내용 (예: 튜나편입 방문 취소 논의 필요 @이빛나)" aria-label="이슈 내용"><input data-if="action" value="${esc(x.action)}" placeholder="대응 방안 / 요청사항" aria-label="대응 방안"><button type="button" class="iconbtn sm" data-idel aria-label="이슈 빼기">×</button></div>`).join('')}</div>
      <button class="linkbtn" type="button" id="dr-iss-add">+ 이슈 추가</button>
    </section>
    <section class="panel"><h2 class="sec">04 이번 주 계획 <span class="hist" style="display:inline">내 업무 목록에서 자동 · 날짜·완료는 여기서 바로 고칠 수 있어요</span></h2>
      <div class="dr-plan">${plan.map(p=>{ const r=byId[p.item_id], late = p.due && pd(p.due)<rd && p.st!=='Completed'; return `<div class="dr-pr ${late?'late':''} ${p.st==='Completed'?'done':''}">${kindTag(p.kind)}<span class="dr-pt">${esc(p.title)}${p.detail?` <span class="hist" style="display:inline">· ${esc(p.detail)}</span>`:''}</span>
        <input type="date" data-pdue="${p.item_id}" value="${p.due||''}" aria-label="예상 완료일" ${owns(r)?'':'disabled'}><span class="chip ${late?'k-bad':''}">${late?'지남 · ':''}${esc(p.status)}</span>${p.st!=='Completed'&&owns(r)?`<button class="linkbtn" type="button" data-pdone="${p.item_id}">완료</button>`:''}</div>`; }).join('') || '<div class="hist">이번 주 계획에 들어갈 업무가 없어요.</div>'}</div>
    </section>
   </div>
   <aside class="dr-side panel">
     <h2 class="sec">보내기</h2>
     <button class="btn" type="button" id="dr-save">임시 저장</button>
     <button class="btn primary" type="button" id="dr-submit">제출하고 문구 복사</button>
     <button class="btn" type="button" id="dr-xlsx">엑셀 내려받기 (팀 양식)</button>
     <button class="btn" type="button" id="dr-copy">문구만 복사</button>
     <p class="hist" style="margin:4px 0 0">제출하면 전일 결과의 진행률이 각 업무에 반영돼요. 100%는 완료(컨펌 대기를 고르면 '컨펌 대기')로 바뀌어요.</p>
     <h2 class="sec" style="margin-top:12px">미리보기</h2>
     <pre class="dr-pre" id="dr-pre"></pre>
   </aside>
  </div>`;
  $('dr-pre').textContent = drText(me.name, f.date, DR.done, DR.today, DR.issues, plan);
  bindWrite();
}
function drText(author, dateIso, done, todayL, issues, plan){
  const line = (e, label) => `(${e.kind||'P'}) ${e.title}${e.detail?` : ${e.detail}`:''} (${label})`;
  const iss = issues.filter(x=>x.issue||x.action);
  return [`[일일보고] ${author} / ${yymmdd(dateIso)}`, '',
    '전일 업무 결과', ...(done.length?done.map(e=>line(e, Number(e.prog)>=1 ? `완료 100%${e.note?` - ${e.note}중`:''}` : `진행률 ${p100(e.prog)||'0%'}`)):['- 없음']), '',
    '금일 업무 내용', ...(todayL.length?todayL.map(e=>line(e, `목표 진행률 ${p100(e.prog)||'0%'}`)):['- 없음']), '',
    '이슈', ...(iss.length?iss.map(x=>`이슈내용 : ${x.issue}${x.action?` → ${x.action}`:''}`):['이슈내용 : 없음']), '',
    '이번 주 계획', ...(plan.length?plan.map(p=>line(p, `예상 완료일 : ${p.due?yymmdd(p.due):'미정'}`)):['- 없음'])].join('\n');
}
function bindWrite(){
  const old = $('dr-body'), box = old.cloneNode(true); old.replaceWith(box);   // 다시 그릴 때 이벤트가 겹치지 않게
  const f = ui.daily;
  const touch = () => { DR.dirty = true; $('dr-state').textContent = '저장 안 됨 · 임시 저장하거나 제출하세요'; $('dr-pre').textContent = drText(me.name, f.date, DR.done, DR.today, DR.issues, planFor(me.name, f.date)); };
  box.addEventListener('input', e => {
    const rw = e.target.closest('[data-sec]');
    if(rw && e.target.dataset.f){ const L = DR[rw.dataset.sec][+rw.dataset.i]; const k=e.target.dataset.f; L[k] = k==='prog' ? Number(e.target.value) : e.target.value; touch(); return; }
    const ir = e.target.closest('[data-ii]'); if(ir && e.target.dataset.if){ DR.issues[+ir.dataset.ii][e.target.dataset.if] = e.target.value; touch(); }
  });
  box.addEventListener('change', async e => {
    if(e.target.matches('select[data-f]')){ const rw=e.target.closest('[data-sec]'); const L=DR[rw.dataset.sec][+rw.dataset.i]; L[e.target.dataset.f] = e.target.dataset.f==='prog'?Number(e.target.value):e.target.value; touch(); return; }
    if(e.target.dataset.pick){ const r=byId[e.target.dataset.pick]; if(e.target.checked){ if(!DR.today.some(x=>x.item_id===r.id)) DR.today.push(entryFromItem(r, Math.min(1, Math.round(((r.prog||0)+.2)*10)/10))); } else DR.today = DR.today.filter(x=>x.item_id!==r.id); DR.dirty=true; renderWrite(); return; }
    if(e.target.id==='dr-add-done' && e.target.value){ const r=byId[e.target.value]; if(!DR.done.some(x=>x.item_id===r.id)) DR.done.push(entryFromItem(r)); DR.dirty=true; renderWrite(); return; }
    if(e.target.dataset.pdue){ const r=byId[e.target.dataset.pdue]; if(r && await quickUpdate(r,{end_date:e.target.value||null})) toast('예상 완료일을 바꿨어요.'); renderWrite(); }
  });
  box.addEventListener('click', async e => {
    const d = e.target.closest('[data-del]'); if(d){ const rw=d.closest('[data-sec]'); DR[rw.dataset.sec].splice(+rw.dataset.i,1); DR.dirty=true; renderWrite(); return; }
    const di = e.target.closest('[data-idel]'); if(di){ DR.issues.splice(+di.closest('[data-ii]').dataset.ii,1); if(!DR.issues.length) DR.issues=[{issue:'',action:''}]; DR.dirty=true; renderWrite(); return; }
    const fr = e.target.closest('[data-free]'); if(fr){ DR[fr.dataset.free].push({item_id:null, kind:'P', title:'', detail:'', prog:fr.dataset.free==='done'?1:.5, note:''}); DR.dirty=true; renderWrite(); const rows=$('dr-body').querySelectorAll(`[data-sec="${fr.dataset.free}"] .dr-title`); if(rows.length) rows[rows.length-1].focus(); return; }
    const pdn = e.target.closest('[data-pdone]'); if(pdn){ const r=byId[pdn.dataset.pdone]; if(r && await quickUpdate(r,{st:'Completed'})) toast('완료로 바꿨어요.'); renderWrite(); return; }
    if(e.target.id==='dr-iss-add'){ DR.issues.push({issue:'',action:''}); renderWrite(); return; }
    if(e.target.id==='dr-save'){ await saveDaily(false); return; }
    if(e.target.id==='dr-submit'){ await saveDaily(true); return; }
    if(e.target.id==='dr-copy'){ copyText($('dr-pre').textContent, '일일보고 문구를 복사했어요.'); return; }
    if(e.target.id==='dr-xlsx'){ await downloadDailyXlsx(me.name, f.date, DR.done, DR.today, DR.issues, planFor(me.name, f.date)); return; }
  });
  $('dr-new').onsubmit = async e => {
    e.preventDefault(); const t=$('dr-new-title').value.trim(); if(!t){ toast('새 업무명을 입력하세요.'); return; }
    const kind=$('dr-new-kind').value, end=$('dr-new-end').value||null;
    const parent = byId['WBS-INBOX'] ? 'WBS-INBOX' : null; if(!parent){ toast('미분류함이 없어요. 관리자에게 문의하세요.'); return; }
    const id = await insertUnder(parent, {cat:t, kind, pic:me.name, st:'In Progress', start_date:ui.daily.date, end_date:end, prog:0, cyc:kind==='R'?'반복':'단발'}, '업무 등록');
    if(!id) return;
    DR.today.push(entryFromItem(byId[id], .3)); DR.dirty=true; toast(`${t} 업무를 등록했어요. (미분류함)`); renderWrite();
  };
}
function copyText(t, msg){ (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(()=>toast(msg)).catch(()=>openText('일일보고', t)); }
const cleanEntries = L => L.filter(e=>(e.title||'').trim());
async function saveDaily(submit, quiet){
  const f = ui.daily, now = new Date().toISOString();
  DR.done = cleanEntries(DR.done); DR.today = cleanEntries(DR.today);
  const issues = DR.issues.filter(x=>(x.issue||'').trim()||(x.action||'').trim());
  const row = {report_date:f.date, author:me.name, issues, updated_at:now}; if(submit) row.submitted_at = now;
  const { data:rep, error } = await sb.from('daily_reports').upsert(row, {onConflict:'author,report_date'}).select().single();
  if(error){ toast('저장하지 못했어요: '+error.message); return; }
  // 업무 반영 (제출할 때만): 전일 결과 진행률 → 업무, 금일 업무 → 진행 중
  if(submit){
    for(const e of DR.done){ const r = e.item_id && byId[e.item_id]; if(!r || !owns(r)) continue;
      const p = Number(e.prog), patch = {prog:p};
      if(p>=1) patch.st = e.note==='컨펌 대기' ? 'Review' : 'Completed'; else if(r.st==='Planned' || r.st==='Completed' || r.st==='Review') patch.st = 'In Progress';
      await quickUpdate(r, patch); }
    for(const e of DR.today){ const r = e.item_id && byId[e.item_id]; if(r && owns(r) && r.st==='Planned') await quickUpdate(r, {st:'In Progress'}); }
  }
  const plan = planFor(me.name, f.date);
  await sb.from('daily_entries').delete().eq('report_id', rep.id);
  const ents = [
    ...DR.done.map((e,i)=>({report_id:rep.id, section:'done', item_id:e.item_id||null, kind:e.kind||'P', title:e.title.trim(), detail:e.detail||null, prog:e.prog==null?null:Number(e.prog), note:e.note||null, sort_order:i})),
    ...DR.today.map((e,i)=>({report_id:rep.id, section:'today', item_id:e.item_id||null, kind:e.kind||'P', title:e.title.trim(), detail:e.detail||null, prog:e.prog==null?null:Number(e.prog), sort_order:i})),
    ...(submit ? plan.map((p,i)=>({report_id:rep.id, section:'plan', item_id:p.item_id, kind:p.kind, title:p.title, detail:p.detail||null, due_date:p.due, status:p.status, sort_order:i})) : [])
  ];
  if(ents.length){ const { error:e2 } = await sb.from('daily_entries').insert(ents); if(e2){ toast('항목을 저장하지 못했어요: '+e2.message); return; } }
  DR.report = rep; DR.dirty = false;
  if(submit){
    await sb.from('item_history').insert({item_id:'DAILY', changed_by:me.name, changes:`일일보고 제출 (${yymmdd(f.date)}) · 전일 ${DR.done.length}건 · 금일 ${DR.today.length}건`});
    for(const x of issues){ const t = `${x.issue} ${x.action}`; const ms = mentionsIn(t).filter(n=>n!==me.name); if(ms.length) await sb.from('item_history').insert({item_id:'DAILY', changed_by:me.name, changes:`일일보고 이슈: ${x.issue}${x.action?' → '+x.action:''}`}); }
    copyText(drText(me.name, f.date, DR.done, DR.today, issues, plan), '제출했어요. 일일보고 문구를 복사했어요 — 메신저에 붙여넣으세요.');
  } else if(!quiet) toast('임시 저장했어요.');
  if(!quiet) renderWrite();
}
async function downloadDailyXlsx(author, dateIso, done, todayL, issues, plan){
  try{
    if(!window.DailyXlsx) throw new Error('엑셀 기능을 불러오지 못했어요.');
    if(!DR_TPL) DR_TPL = await (await fetch('templates/daily_report.xlsx', {cache:'no-cache'})).arrayBuffer();
    const blob = await DailyXlsx.build(DR_TPL, {author, date:dateIso,
      done: cleanEntries(done).map(e=>({kind:e.kind, title:e.title, detail:[e.detail, e.note&&Number(e.prog)>=1?`(${e.note})`:''].filter(Boolean).join(' '), prog:e.prog==null?null:Number(e.prog)})),
      today: cleanEntries(todayL).map(e=>({kind:e.kind, title:e.title, detail:e.detail, prog:e.prog==null?null:Number(e.prog)})),
      issues: issues.filter(x=>x.issue||x.action), plan: plan.map(p=>({kind:p.kind, title:p.title, detail:p.detail, due:p.due, status:p.status}))});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `일일보고_${author}_${dateIso.replace(/-/g,'').slice(2)}.xlsx`; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
    toast('엑셀(팀 양식)로 내려받았어요.');
  }catch(err){ toast('엑셀을 만들지 못했어요: '+err.message); }
}

// ---- 팀 일일보고 (날짜별 전원 · 미제출 · 이슈 · 공동 업무 · 주간 정리)
async function renderTeamDaily(){
  const box = $('dr-body'), f = ui.daily;
  const { data:reps } = await sb.from('daily_reports').select('*').eq('report_date', f.date);
  // 작성 대상: 로그인 계정이 있는 팀원(member) + 그날 보고를 쓴 사람
  const memberNames = new Set(MEMBERS.filter(m=>m.role==='member').map(m=>m.name));
  const people = [...new Set([...STAFF.filter(s=>s.active && memberNames.has(s.name)).map(s=>s.name), ...(reps||[]).map(r=>r.author)])];
  const ids = (reps||[]).map(r=>r.id);
  const { data:ents } = ids.length ? await sb.from('daily_entries').select('*').in('report_id', ids).order('sort_order') : {data:[]};
  if(current()!=='daily' || ui.daily.mode!=='team') return;
  const byA = {}; for(const r of reps||[]) byA[r.author] = {rep:r, done:[], today:[], plan:[]};
  for(const e of ents||[]){ const r = (reps||[]).find(x=>x.id===e.report_id); if(r) byA[r.author][e.section].push({...e, due:e.due_date}); }
  const sub = people.filter(p=>byA[p] && byA[p].rep.submitted_at), notYet = people.filter(p=>!(byA[p] && byA[p].rep.submitted_at));
  const issues = (reps||[]).flatMap(r=>(r.issues||[]).map(x=>({...x, author:r.author})));
  // 공동 업무: 하위 업무 담당자가 2명 이상인 상위 업무
  const shared = items.filter(r=>r.lvl==='P' && r.kind!=='goal' && !DONE(r.st) && new Set(kids(r.id).map(k=>k.pic).filter(p=>p && p!=='전원')).size>=2);
  $('dr-state').textContent = `제출 ${sub.length} / ${people.length}명`;
  const card = p => { const x = byA[p]; if(!x) return `<div class="panel dr-card miss"><h2 class="sec">${esc(p)} <span class="chip k-bad">미작성</span></h2></div>`;
    const t = drText(p, f.date, x.done, x.today, x.rep.issues||[], x.plan.map(e=>({...e, due:e.due_date})));
    return `<div class="panel dr-card"><div class="dr-ch"><h2 class="sec" style="margin:0">${esc(p)} ${x.rep.submitted_at?`<span class="chip c-co">제출 ${new Date(x.rep.submitted_at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</span>`:'<span class="chip k-warn">임시 저장</span>'}</h2><div class="spacer"></div><button class="linkbtn" type="button" data-tcopy="${esc(p)}">문구 복사</button><button class="linkbtn" type="button" data-txlsx="${esc(p)}">엑셀</button></div><pre class="dr-pre">${esc(t)}</pre></div>`; };
  box.innerHTML = `
    ${notYet.length?`<div class="calc" style="margin-bottom:12px"><div style="background:var(--warn-soft);color:var(--warn)">미제출: ${notYet.map(esc).join(', ')}</div></div>`:''}
    <div class="dr-team">
      <div class="dr-cards">${people.map(card).join('')}</div>
      <aside class="dr-side">
        <div class="panel"><h2 class="sec">오늘 이슈 <span class="hist" style="display:inline">${issues.length}건</span></h2>${issues.map(x=>`<div class="dr-ti"><b>${esc(x.author)}</b> ${richText(x.issue||'')}${x.action?`<div class="hist">→ ${esc(x.action)}</div>`:''}</div>`).join('')||'<div class="hist">이슈가 없어요.</div>'}</div>
        <div class="panel"><h2 class="sec">공동 업무</h2>${shared.map(s=>{ const a=groupAgg(s); return `<div class="dr-sh"><button type="button" class="linkbtn" data-open="${s.id}"><b>${esc(s.cat)}</b></button> <span class="hist" style="display:inline">평균 ${pct(a.prog)}</span>${kids(s.id).map(k=>`<div class="dr-shr"><span>${esc(k.pic||'–')}</span><div class="pbar"><i style="width:${Math.round((k.prog||0)*100)}%"></i></div><span class="mono">${p100(k.prog)||'0%'}</span><span class="hist" style="display:inline">${k.end_date?yymmdd(k.end_date):''}</span>${check(k)==='지연'?chkChip('지연'):''}</div>`).join('')}</div>`; }).join('')||'<div class="hist">여러 명이 함께 하는 업무가 없어요.</div>'}</div>
        <div class="panel"><h2 class="sec">주간 정리</h2><p class="hist" style="margin:0 0 8px">${(()=>{const [w0,w1]=weekOf(f.date); return `${fmtD(w0)} ~ ${fmtD(w1)}`;})()} 일일보고를 사람·업무별로 묶어 대표님 보고용 문구를 만들어요.</p><button class="btn" type="button" id="dr-week">주간 정리 복사</button></div>
      </aside>
    </div>`;
  box.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openDrawer(b.dataset.open));
  box.querySelectorAll('[data-tcopy]').forEach(b=>b.onclick=()=>{ const x=byA[b.dataset.tcopy]; copyText(drText(b.dataset.tcopy, f.date, x.done, x.today, x.rep.issues||[], x.plan.map(e=>({...e, due:e.due_date}))), `${b.dataset.tcopy} 님 일일보고를 복사했어요.`); });
  box.querySelectorAll('[data-txlsx]').forEach(b=>b.onclick=()=>{ const x=byA[b.dataset.txlsx]; downloadDailyXlsx(b.dataset.txlsx, f.date, x.done, x.today, x.rep.issues||[], x.plan.map(e=>({...e, due:e.due_date}))); });
  $('dr-week').onclick = () => weeklyFromDaily(f.date);
}
async function weeklyFromDaily(dateIso){
  const [w0,w1] = weekOf(dateIso);
  const { data:reps } = await sb.from('daily_reports').select('id,author,report_date,issues').gte('report_date', iso(w0)).lte('report_date', iso(w1)).not('submitted_at','is',null);
  const ids = (reps||[]).map(r=>r.id); if(!ids.length){ toast('이번 주에 제출된 일일보고가 없어요.'); return; }
  const { data:ents } = await sb.from('daily_entries').select('*').in('report_id', ids).eq('section','done');
  const out = [`[주간 업무 정리] ${fmtD(w0)} ~ ${fmtD(w1)}`];
  for(const p of [...new Set(reps.map(r=>r.author))]){
    const mine = reps.filter(r=>r.author===p).map(r=>r.id), m = {};
    for(const e of ents.filter(e=>mine.includes(e.report_id))){ const k = e.item_id || e.title; const d = reps.find(r=>r.id===e.report_id).report_date; if(!m[k] || m[k].d < d) m[k] = {e, d}; }
    const L = Object.values(m).sort((a,b)=>Number(b.e.prog)-Number(a.e.prog));
    out.push('', `■ ${p}`, ...L.map(({e})=>`(${e.kind||'P'}) ${e.title}${e.detail?` : ${e.detail}`:''} — ${Number(e.prog)>=1?'완료':`진행률 ${p100(e.prog)}`}`));
    const iss = reps.filter(r=>r.author===p).flatMap(r=>r.issues||[]).filter(x=>x.issue);
    if(iss.length) out.push(...iss.map(x=>`  · 이슈: ${x.issue}${x.action?` → ${x.action}`:''}`));
  }
  copyText(out.join('\n'), '주간 정리 문구를 복사했어요.');
}
// 업무 상세 '일일 기록' 탭: 이 업무(와 하위 업무)가 일일보고에 어떻게 기록됐는지
async function loadItemDaily(r){
  const ids = [r.id, ...desc(r.id).map(x=>x.id)];
  const { data, error } = await sb.from('daily_entries').select('section,title,detail,prog,note,item_id,daily_reports(report_date,author)').in('item_id', ids).neq('section','plan').limit(300);
  const box = $('d-daily'); if(!box || selId!==r.id) return;
  if(error){ box.innerHTML = '<div class="hist">일일 기록을 불러오지 못했어요.</div>'; return; }
  const L = (data||[]).filter(e=>e.daily_reports).sort((a,b)=>b.daily_reports.report_date.localeCompare(a.daily_reports.report_date) || (a.section==='done'?-1:1));
  box.innerHTML = L.length ? L.map(e=>`<div class="cmt"><div class="cmt-h"><b>${esc(e.daily_reports.author)}</b><span>${yymmdd(e.daily_reports.report_date)} · ${e.section==='done'?'전일 결과':'금일 목표'}</span><span style="margin-left:auto" class="mono">${p100(e.prog)}${e.note?` · ${esc(e.note)}`:''}</span></div><div class="cmt-b">${esc(e.title)}${e.detail?` : ${esc(e.detail)}`:''}</div></div>`).join('') : '<div class="cmt-empty">아직 일일보고에 기록되지 않았어요.</div>';
}

// ---------------- drawer (상세·편집)
const drawer=$('drawer'), scrim=$('scrim');
let drawerTab='info', drawerTabFor=null;
async function openDrawer(id, tab){
  const r=byId[id]; if(!r) return;
  const nw = newsOf(r);
  if(tab) drawerTab = tab;
  else if(drawerTabFor!==id) drawerTab = (nw && nw.kind==='cmt') ? 'cmt' : 'info';
  if(r.lvl==='L1' && drawerTab==='cmt') drawerTab='info';
  drawerTabFor = id;
  selId=id; markSeen(id); markItemRead(id);
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
    <nav class="dtabs" role="tablist">
      <button type="button" role="tab" data-dt="info">상세</button>
      ${grp?'':`<button type="button" role="tab" data-dt="cmt">댓글 <span class="dn-c" id="d-cn">${CMT_N[r.id]||''}</span></button>`}
      ${isTask(r)||r.lvl==='P'?'<button type="button" role="tab" data-dt="daily">일일 기록</button>':''}
      <button type="button" role="tab" data-dt="hist">변경 이력</button>
    </nav>
    <div class="body">
      <div class="dpane" data-pane="info">
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
        ${!grp?`<div class="field"><label for="f-kind">유형${r.lvl==='P'?' (상위 업무)':''}</label><select id="f-kind">${r.kind?'':'<option value="" selected>미지정</option>'}<option value="P" ${r.kind==='P'?'selected':''}>P 프로젝트</option><option value="R" ${r.kind==='R'?'selected':''}>R 반복(루틴)</option><option value="goal" ${r.kind==='goal'?'selected':''}>목표·R&amp;R (일정 체크 제외)</option></select></div>`:''}
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
      </div>
      ${grp?'':`<div class="dpane" data-pane="cmt">${commentsHtml(r)}</div>`}
      <div class="dpane" data-pane="daily"><div class="cmts" id="d-daily"><div class="hist">불러오는 중…</div></div></div>
      <div class="dpane" data-pane="hist"><div class="hist" id="d-hist"><div>불러오는 중…</div></div></div>
    </div>
    <footer class="dfoot" data-foot="info">${delButtons(r)}<button class="btn" type="button" id="d-cancel">${ro?'닫기':'취소'}</button>${ro?'':'<button class="btn primary" type="button" id="d-save">저장</button>'}</footer>
    ${grp?'':`<footer class="dfoot cmt-foot" data-foot="cmt">${composerHtml()}</footer>`}`;
  const setTab = t => {
    drawerTab = t;
    drawer.querySelectorAll('[data-dt]').forEach(b=>{ b.classList.toggle('on', b.dataset.dt===t); b.setAttribute('aria-selected', b.dataset.dt===t); });
    drawer.querySelectorAll('[data-pane]').forEach(p=>p.hidden = p.dataset.pane!==t);
    drawer.querySelectorAll('[data-foot]').forEach(f=>f.hidden = !(f.dataset.foot===t || ((t==='hist'||t==='daily') && f.dataset.foot==='info')));
    if(t==='daily') loadItemDaily(r);
    const bd = drawer.querySelector('.body');
    if(t==='cmt'){ bd.scrollTop = bd.scrollHeight; const ta=$('d-cbody'); if(ta) setTimeout(()=>ta.focus(), 30); } else bd.scrollTop = 0;
  };
  drawer.querySelectorAll('[data-dt]').forEach(b=>b.onclick=()=>setTab(b.dataset.dt));
  setTab(drawerTab);
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
  FLASH_ID = r.id;
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
// ---- 업무 위치 옮기기: target 앞(before) / 뒤(after) / 안(into: 그 항목의 맨 아래 하위로). 형제 번호는 순서대로 다시 매김
function placeCheck(r, target, mode){
  if(!r || !target || r.id===target.id) return '같은 위치예요.';
  if(r.sheet!==target.sheet) return 'WBS와 대표님 REQ 사이로는 옮길 수 없어요.';
  if(r.lvl==='L1') return '카테고리는 옮길 수 없어요.';
  if(desc(r.id).some(x=>x.id===target.id)) return '자기 하위 업무 안으로는 옮길 수 없어요.';
  const np = mode==='into' ? target : byId[target.parent];
  if(!np) return '옮길 위치를 찾지 못했어요.';
  if(mode==='into' && target.lvl==='C') return '하위 업무 안에는 넣을 수 없어요 (최대 3단계).';
  if(np.lvl!=='L1' && desc(r.id).length) return '하위 업무가 있는 항목은 카테고리 바로 아래로만 옮길 수 있어요.';
  if(mode!=='into' && np.id===r.parent){ const sib = kids(np.id); const i = sib.indexOf(target), j = sib.indexOf(r); if((mode==='before' && i===j+1) || (mode==='after' && i===j-1)) return '이미 그 위치에 있어요.'; }
  return '';
}
function placeDesc(r, target, mode){
  const np = mode==='into' ? target : byId[target.parent];
  const where = mode==='into' ? '맨 아래' : `${target.num} ${String(target.cat||'').slice(0,24)} ${mode==='before'?'앞':'다음'}`;
  return {from:`${byId[r.parent]?byId[r.parent].num+' '+esc(byId[r.parent].cat):'–'} · ${esc(r.num)}`, to:`${esc(np.num)} ${esc(np.cat)} · ${esc(where)}`};
}
async function placeItem(r, target, mode){
  const err = placeCheck(r, target, mode); if(err){ toast(err); return false; }
  const np = mode==='into' ? target : byId[target.parent], old = byId[r.parent];
  const kidsAll = desc(r.id), subIds = new Set([r.id, ...kidsAll.map(x=>x.id)]);
  const order = items.filter(x=>!subIds.has(x.id)).sort((a,b)=>a.sort_order-b.sort_order);
  // 들어갈 자리의 앞(lo)·뒤(hi) sort_order
  let lo, hi;
  if(mode==='before'){ const i = order.indexOf(target); lo = i>0 ? order[i-1].sort_order : target.sort_order-1; hi = target.sort_order; }
  else {
    const blockOf = mode==='into' ? np : target;
    const block = [blockOf, ...desc(blockOf.id)].filter(x=>!subIds.has(x.id));
    const tail = block.reduce((a,b)=>b.sort_order>a.sort_order?b:a);
    const nx = order.find(x=>x.sort_order>tail.sort_order);
    lo = tail.sort_order; hi = nx ? nx.sort_order : tail.sort_order + kidsAll.length + 2;
  }
  const step = (hi-lo)/(kidsAll.length+2);
  const stamp = {updated_by:me.name, updated_at:new Date().toISOString()};
  const patch = {};   // id -> 바뀌는 값
  const put = (id, p) => { patch[id] = {...(patch[id]||{}), ...p}; };
  put(r.id, {parent:np.id, lvl: np.lvl==='L1' ? (kidsAll.length?'P':'T') : 'C', sort_order: lo+step});
  kidsAll.sort((a,b)=>a.sort_order-b.sort_order).forEach((k,i)=>put(k.id, {sort_order: lo+step*(i+2)}));
  if(np.lvl==='T') put(np.id, {lvl:'P'});
  if(old && old.id!==np.id && old.lvl==='P' && kids(old.id).filter(x=>x.id!==r.id).length===0) put(old.id, {lvl:'T'});
  // 번호 다시 매기기 (새 상위, 옛 상위의 형제와 그 하위)
  const so = x => patch[x.id] && patch[x.id].sort_order!=null ? patch[x.id].sort_order : x.sort_order;
  const parentOf = x => patch[x.id] && patch[x.id].parent ? patch[x.id].parent : x.parent;
  const childrenOf = pid => items.filter(x=>parentOf(x)===pid).sort((a,b)=>so(a)-so(b));
  const renum = (pid, pnum) => childrenOf(pid).forEach((c,i)=>{ const n = `${pnum}.${i+1}`; if(c.num!==n) put(c.id, {num:n}); renum(c.id, n); });
  renum(np.id, np.num); if(old && old.id!==np.id) renum(old.id, old.num);
  const ids = Object.keys(patch);
  for(const id of ids){ const { error } = await sb.from('items').update({...patch[id], ...stamp}).eq('id', id); if(error){ toast('옮기지 못했어요: '+error.message); await loadItems(); return false; } }
  const newNum = (patch[r.id].num) || r.num;
  FLASH_ID = r.id;
  await sb.from('item_history').insert({item_id:r.id, changed_by:me.name, changes:`상위 항목 이동: ${old?old.num+' '+old.cat:'–'} → ${np.num} ${np.cat} (새 번호 ${newNum})`});
  await loadItems();
  toast(`${r.id}를 ${np.cat} ${mode==='into'?'맨 아래로':mode==='before'?`의 ${target.id} 앞으로`:`의 ${target.id} 다음으로`} 옮겼어요.`);
  return true;
}
async function moveItem(r, newParentId){ return placeItem(r, byId[newParentId], 'into'); }
// 표에서 줄을 끌어 옮기기 (확인 창을 거쳐서)
function bindRowDrag(tbody){
  if(!tbody) return;
  let dragId = null;
  const zone = (tr, e) => {
    const t = byId[tr.dataset.id||tr.dataset.g], rc = tr.getBoundingClientRect(), y = (e.clientY-rc.top)/rc.height;
    if(tr.dataset.g) return {t, mode:'into'};
    if(y < .3) return {t, mode:'before'};
    if(y > .7) return {t, mode:'after'};
    return {t, mode: t.lvl==='C' ? (y<.5?'before':'after') : 'into'};
  };
  const clear = () => tbody.querySelectorAll('.drop-before,.drop-after,.drop-into,.drop-no').forEach(x=>x.classList.remove('drop-before','drop-after','drop-into','drop-no'));
  tbody.addEventListener('dragstart', e => {
    const tr = e.target.closest('tr[data-id][draggable="true"]'); if(!tr) return;
    dragId = tr.dataset.id; tr.classList.add('dragging-row');
    e.dataTransfer.effectAllowed = 'move'; try{ e.dataTransfer.setData('text/plain', 'row:'+dragId); }catch(_){}
  });
  tbody.addEventListener('dragend', e => { const tr = e.target.closest('tr'); if(tr) tr.classList.remove('dragging-row'); clear(); dragId = null; });
  tbody.addEventListener('dragover', e => {
    if(!dragId) return; const tr = e.target.closest('tr[data-id],tr[data-g]'); if(!tr) return;
    e.preventDefault(); clear();
    const {t, mode} = zone(tr, e), bad = placeCheck(byId[dragId], t, mode);
    tr.classList.add(bad ? 'drop-no' : 'drop-'+mode); e.dataTransfer.dropEffect = bad ? 'none' : 'move';
  });
  tbody.addEventListener('dragleave', e => { const tr = e.target.closest('tr'); if(tr && !tr.contains(e.relatedTarget)) tr.classList.remove('drop-before','drop-after','drop-into','drop-no'); });
  tbody.addEventListener('drop', async e => {
    if(!dragId) return; const tr = e.target.closest('tr[data-id],tr[data-g]'); if(!tr) return;
    e.preventDefault(); clear();
    const r = byId[dragId], {t, mode} = zone(tr, e); dragId = null;
    const bad = placeCheck(r, t, mode); if(bad){ toast(bad); return; }
    const d = placeDesc(r, t, mode);
    const yes = await confirmBox({title:'업무를 옮길까요?', what:`${r.id} ${titleOf(r)}${desc(r.id).length?` (하위 업무 ${desc(r.id).length}건 함께)`:''}`, from:d.from, to:d.to, ok:'옮기기'});
    if(!yes){ toast('옮기기를 취소했어요.'); return; }
    await placeItem(r, t, mode);
  });
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
const VIEWS=['my','daily','dashboard','wbs','req','weekly','cal','gantt','admin'];
const current=()=>{ const h=location.hash.slice(1); return VIEWS.includes(h)?h:'my'; };
let lastView = null;
function rerender(){
  if(!me) return;
  newsTabs();
  const v=current();
  document.querySelectorAll('#tabs a').forEach(a=>a.classList.toggle('on',a.dataset.v===v));
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('on',s.id==='v-'+v));
  if(v==='admin' && me.role!=='admin'){ location.hash='my'; return; }
  const entering = lastView!==v; lastView = v;
  const winY = window.scrollY;
  queueMicrotask(()=>{ if(!entering && Math.abs(window.scrollY-winY)>1) window.scrollTo(0, winY); });
  if(v==='daily'){ if(entering || !$('dr-body')) renderDaily(); } else if(v==='my') renderMy(); else if(v==='admin') renderAdmin(); else if(v==='dashboard') renderDashboard(); else if(v==='wbs'||v==='req') renderTable(v==='wbs'?'WBS':'REQ', document.activeElement && document.activeElement.id===v+'-q'); else if(v==='weekly') renderWeekly(); else if(v==='cal') renderCal(); else renderGantt();
}
window.addEventListener('hashchange',()=>{ if(location.hash.includes('access_token')) return; rerender(); });
document.querySelector('main').addEventListener('click',e=>{
  const cb=e.target.closest('[data-cmt]'); if(cb){ e.stopPropagation(); openDrawer(cb.dataset.cmt,'cmt'); return; }
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
