/* JC EDU 마케팅 WBS — GitHub Pages + Supabase
 * 데이터: items(업무), item_history(변경 이력), members(팀원·권한)
 * 권한: members 테이블에 등록된 이메일만 조회 가능, role=admin|member 편집, admin만 삭제 (RLS)
 */
(() => {
const CFG = window.JC_CONFIG || {};
if(!window.supabase){ document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">필요한 모듈(Supabase)을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.</p>'; return; }
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

const STATUS = ['In Progress','Planned','On Hold','Completed','Canceled'];
const ST_KO = {'In Progress':'진행 중','Planned':'예정','On Hold':'보류','Completed':'완료','Canceled':'취소'};
const ST_CLS = {'In Progress':'ip','Planned':'pl','On Hold':'oh','Completed':'co','Canceled':'ca'};
const BRANDS = ['공통','메디원','유프관','메디원&유프관','아임이그잼','인노트','제이콘','기타'];
const CYCLES = ['일간','주간','월간','분기','반기','연간','행사별','수시','단발'];
const FIELDS = ['cat','task','output','link','brand','cyc','pic','bak','st','prog','start_date','end_date','note','kpi_target','kpi_actual','kpi_month','kpi_memo','req_date','due_date','req_text','done_date','feedback'];
const LABELS = {cat:'Category',task:'Task',output:'Output',link:'산출물 링크',brand:'브랜드',cyc:'주기',pic:'PIC',bak:'Backup',st:'진행 상태',prog:'progress',start_date:'Start',end_date:'End',note:'비고',kpi_target:'월 목표',kpi_actual:'월 실적',kpi_month:'기준월',kpi_memo:'실적 메모',req_date:'요청일',due_date:'보고 기한',req_text:'요청 원문',done_date:'보고 완료일',feedback:'대표님 피드백'};
const DAY = 864e5;
const today = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();

let items = [], byId = {}, PEOPLE = ['전원'], me = null, selId = null;
const ui = {
  wbs:{q:'',pic:'',st:'',brand:'',chk:'',mine:false,collapsed:new Set()},
  req:{q:'',pic:'',st:'',brand:'',chk:'',mine:false,collapsed:new Set()},
  weeklyBase:null, ganttSheet:'WBS'
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
  $('loginBtn').disabled = true; $('loginMsg').className='msg'; $('loginMsg').textContent = pw ? '로그인 중…' : '로그인 링크를 보내는 중…';
  if(pw){
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    $('loginBtn').disabled = false;
    if(error){ $('loginMsg').className='msg err'; $('loginMsg').textContent='로그인하지 못했습니다. 이메일과 비밀번호를 확인하세요.'; }
    return;
  }
  const { error } = await sb.auth.signInWithOtp({ email, options:{ emailRedirectTo: location.origin + location.pathname } });
  $('loginBtn').disabled = false;
  if(error){ $('loginMsg').className='msg err'; $('loginMsg').textContent = /rate|limit/i.test(error.message) ? '메일 발송 한도를 넘었습니다. 잠시 후 다시 시도하거나 관리자에게 비밀번호 발급을 요청하세요.' : '로그인 링크를 보내지 못했습니다: '+error.message; }
  else { $('loginMsg').textContent = `${email}로 로그인 링크를 보냈습니다. 메일함에서 링크를 눌러주세요. (스팸함도 확인)`; }
});
$('deniedLogout').addEventListener('click', ()=>sb.auth.signOut());
$('logoutBtn').addEventListener('click', ()=>sb.auth.signOut());

async function enter(session){
  const email = session.user.email;
  const { data: mem, error } = await sb.from('members').select('email,name,role').order('name');
  if(error){ showOnly('deniedView'); $('deniedMsg').textContent='팀원 정보를 불러오지 못했습니다: '+error.message; return; }
  me = (mem||[]).find(m => m.email.toLowerCase()===email.toLowerCase());
  if(!me){ showOnly('deniedView'); $('deniedMsg').textContent=`${email}은(는) 팀원 목록에 등록되어 있지 않습니다. 관리자에게 등록을 요청하세요.`; return; }
  PEOPLE = [...mem.map(m=>m.name), '전원'];
  $('meName').textContent = me.name; $('meRole').textContent = me.role==='admin'?'관리자':me.role==='viewer'?'보기 전용':'';
  ui.wbs.mine = false;
  showOnly('appView');
  await loadItems();
  subscribe();
  rerender();
}
async function loadItems(){
  const { data, error } = await sb.from('items').select('*').order('sort_order');
  if(error){ toast('업무를 불러오지 못했습니다: '+error.message); return; }
  items = data.map(norm); index();
  $('nW').textContent = items.filter(r=>r.sheet==='WBS'&&r.lvl!=='L1').length;
  $('nR').textContent = items.filter(r=>r.sheet==='REQ'&&r.lvl!=='L1').length;
}
function norm(r){ for(const k of ['w','prog','kpi_target','kpi_actual','sort_order']) if(r[k]!=null) r[k]=Number(r[k]); return r; }
function subscribe(){
  sb.channel('items-live').on('postgres_changes', {event:'*', schema:'public', table:'items'}, p => {
    if(p.eventType==='DELETE'){ items = items.filter(r=>r.id!==p.old.id); }
    else { const n = norm(p.new); const i = items.findIndex(r=>r.id===n.id); if(i>=0) items[i]=n; else items.push(n); }
    index();
    if(selId && p.new && p.new.id===selId && p.new.updated_by!==me.name) toast(`${p.new.updated_by||'다른 팀원'}님이 이 업무를 방금 수정했습니다.`);
    if(!$('drawer').classList.contains('on')) rerender();
  }).subscribe(st => { const el=$('syncState'); el.textContent = st==='SUBSCRIBED'?'실시간 반영 중':'연결 중'; el.classList.toggle('live', st==='SUBSCRIBED'); });
}

// ---------------- dashboard
function renderDashboard(){
  const W=sheetStats('WBS'), R=sheetStats('REQ'); const all=[...W.ts,...R.ts];
  const w0=new Date(today); w0.setDate(today.getDate()-((today.getDay()+6)%7)); const w1=new Date(w0); w1.setDate(w0.getDate()+6);
  const due = all.filter(r=>{const e=pd(r.end_date); return e&&e>=w0&&e<=w1;}).sort((a,b)=>pd(a.end_date)-pd(b.end_date));
  const tile=(k,v,s,cls,go)=>`<button class="tile ${cls||''}" type="button" data-go="${go}"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></button>`;
  const prog=(lab,S,go)=>`<button class="tile" type="button" data-go="${go}"><span class="k">${lab} 진척</span><span class="v">${pct(S.actual)}</span><div class="pbar"><i style="width:${S.actual*100}%"></i><b style="left:calc(${Math.min(1,S.plan)*100}% - 1px)"></b></div><span class="s">오늘까지 계획 ${pct(S.plan)} · ${S.actual>=S.plan?'계획 이상':'계획보다 '+Math.round((S.plan-S.actual)*100)+'%p 늦음'}</span></button>`;
  const ppl = [...PEOPLE,'(미지정)'].map(p=>{ const mine=all.filter(r=>p==='(미지정)'?!r.pic:r.pic===p); return {p, cnt:STATUS.map(s=>mine.filter(r=>r.st===s).length), tot:mine.length, late:mine.filter(r=>check(r)==='지연').length}; });
  const max = Math.max(...ppl.map(x=>x.tot),1);
  $('v-dashboard').innerHTML = `
  <div class="grid-tiles">${prog('WBS',W,'wbs')}${prog('대표님 REQ',R,'req')}
    ${tile('지연',W.late+R.late,'종료일이 지났는데 완료되지 않음','bad','chk:지연')}
    ${tile('임박',W.soon+R.soon,'3일 이내 마감','warn','chk:임박')}
    ${tile('⚠ 확인 필요',W.warn+R.warn,'완료인데 진척률 미달 · 종료일 없음','caution','chk:⚠')}
    ${tile('이번 주 마감',due.length,`${fmtD(w0)} ~ ${fmtD(w1)}`,'','weekly')}</div>
  <div class="cols">
    <div class="panel"><h2 class="sec">담당자별 업무량</h2>
      <div class="people">${ppl.map(x=>`<div class="person"><span class="nm">${esc(x.p)}</span><div class="stack" style="width:${x.tot/max*100}%">${x.cnt.map((c,i)=>c?`<span class="s-${ST_CLS[STATUS[i]]}" style="width:${c/x.tot*100}%" title="${ST_KO[STATUS[i]]} ${c}건"></span>`:'').join('')}</div><span class="tot">${x.tot}${x.late?` <span style="color:var(--bad)">·${x.late}</span>`:''}</span></div>`).join('')}</div>
      <div class="legend">${STATUS.map(s=>`<span><i class="s-${ST_CLS[s]}"></i>${ST_KO[s]}</span>`).join('')}<span>숫자 옆 빨간 수 = 지연 건수</span></div></div>
    <div class="panel"><h2 class="sec">이번 주 마감 (${fmtD(w0)} ~ ${fmtD(w1)})</h2>
      ${due.length?`<table style="min-width:0"><thead><tr><th>ID</th><th>업무</th><th>PIC</th><th>상태</th><th>End</th><th></th></tr></thead><tbody>${due.map(r=>`<tr class="task" data-id="${r.id}"><td class="mono">${r.id}</td><td class="t-name"><span class="cat">${esc(r.cat)}</span><span class="tk">${esc(r.task)}</span></td><td class="nw">${esc(r.pic||'')}</td><td>${stChip(r.st)}</td><td class="mono">${fmtD(pd(r.end_date))}</td><td class="nw">${chkChip(check(r))}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">이번 주 마감 업무가 없습니다.</div>'}</div>
  </div>`;
}

// ---------------- WBS / REQ table
function rowVisible(r,f){
  if(f.pic && r.pic!==f.pic && r.bak!==f.pic) return false;
  if(f.mine && r.pic!==me.name && r.bak!==me.name) return false;
  if(f.st && r.st!==f.st) return false;
  if(f.brand && r.brand!==f.brand) return false;
  if(f.chk){ const c=check(r); if(f.chk==='⚠' ? !c.startsWith('⚠') : c!==f.chk) return false; }
  if(f.q){ const q=f.q.toLowerCase(); if(![r.id,r.cat,r.task,r.output,r.note,r.pic].some(x=>x&&String(x).toLowerCase().includes(q))) return false; }
  return true;
}
function renderTable(sheet){
  const key = sheet==='WBS'?'wbs':'req', f = ui[key];
  const groups = items.filter(r=>r.sheet===sheet&&r.lvl==='L1');
  const filtering = f.q||f.pic||f.st||f.brand||f.chk||f.mine;
  let shown=0,total=0,body='';
  for(const g of groups){
    const members = desc(g.id);
    const vis = members.filter(r=> rowVisible(r,f) || (r.lvl==='P' && desc(r.id).some(k=>rowVisible(k,f))));
    total += members.length;
    if(filtering && !vis.length) continue;
    shown += vis.length;
    const a = groupAgg(g), col = f.collapsed.has(g.id) && !filtering;
    body += `<tr class="g1" data-g="${g.id}"><td colspan="2"><span class="tw">${col?'▸':'▾'}</span>${esc(g.num)}</td><td colspan="5">${esc(g.cat)} <span style="font-weight:400;color:var(--muted)">· ${a.n}건</span>${canEdit()?`<button class="addbtn" type="button" data-add="${g.id}">+ 업무 추가</button>`:''}</td><td class="mono">${a.start?fmt(iso(a.start)):''}</td><td class="mono">${a.end?fmt(iso(a.end)):''}</td><td></td><td></td><td>${a.prog!=null?mini(a.prog):''}</td></tr>`;
    if(col) continue;
    for(const r of vis){
      const d=dday(r), c=check(r), m=isTask(r)?must(r):null, a2=r.lvl==='P'?groupAgg(r):null;
      body += `<tr class="task lvl-${r.lvl}${r.id===selId?' sel':''}" data-id="${r.id}">
        <td class="mono">${r.id}</td><td class="mono" style="color:var(--muted)">${esc(r.num)}</td>
        <td class="t-name"><span class="cat">${esc(r.cat||'')}</span><span class="tk">${esc(r.task||'')}</span></td>
        <td>${esc(r.brand||'')}</td><td>${esc(r.cyc||'')}</td>
        <td class="nw">${esc(r.pic||'')}${r.bak?`<span style="color:var(--muted)"> / ${esc(r.bak)}</span>`:''}</td>
        <td>${stChip(r.st)}</td>
        <td class="mono">${isTask(r)?fmt(r.start_date):(a2&&a2.start?fmt(iso(a2.start)):'')}</td>
        <td class="mono">${isTask(r)?fmt(r.end_date):(a2&&a2.end?fmt(iso(a2.end)):'')}</td>
        <td class="mono dday ${d!=null&&d<0?'neg':''}">${ddTxt(d)}</td>
        <td class="nw">${chkChip(c)}</td>
        <td>${isTask(r)&&r.cyc==='단발'?mini(r.prog,m):(a2&&a2.prog!=null?mini(a2.prog):(r.kpi_target?`<span class="mono" style="color:var(--muted)">월 ${r.kpi_actual??'–'}/${r.kpi_target}</span>`:''))}</td></tr>`;
    }
  }
  const pick=(arr,v,lab)=>`<option value="">${lab}</option>`+arr.map(x=>`<option ${x===v?'selected':''}>${esc(x)}</option>`).join('');
  $('v-'+key).innerHTML = `
    <div class="toolbar">
      <input type="search" id="${key}-q" placeholder="ID·업무·비고 검색" value="${esc(f.q)}">
      <select id="${key}-pic" aria-label="담당자">${pick(PEOPLE,f.pic,'담당자 전체')}</select>
      <select id="${key}-st" aria-label="진행 상태"><option value="">상태 전체</option>${STATUS.map(s=>`<option value="${s}" ${s===f.st?'selected':''}>${ST_KO[s]}</option>`).join('')}</select>
      <select id="${key}-brand" aria-label="브랜드">${pick(BRANDS,f.brand,'브랜드 전체')}</select>
      <select id="${key}-chk" aria-label="일정 체크">${pick(['지연','임박','⚠','진행','예정','완료'],f.chk,'일정 체크 전체')}</select>
      <label><input type="checkbox" id="${key}-mine" ${f.mine?'checked':''}> 내 업무만</label>
      <button class="btn" type="button" id="${key}-fold">${f.collapsed.size?'모두 펼치기':'모두 접기'}</button>
      <button class="btn" type="button" id="${key}-reset">필터 초기화</button>
      <span class="count">${filtering?`${shown} / ${total}행 표시`:`${total}행`}</span>
    </div>
    <div class="tablewrap"><table><thead><tr><th>ID</th><th>#</th><th>업무</th><th>브랜드</th><th>주기</th><th>PIC / Backup</th><th>상태</th><th>Start</th><th>End</th><th>D-day</th><th>일정 체크</th><th>진척 · 실적</th></tr></thead><tbody>${body||'<tr><td colspan="12" class="empty">조건에 맞는 업무가 없습니다.</td></tr>'}</tbody></table></div>`;
  const on=(id,ev,fn)=>$(id).addEventListener(ev,fn);
  on(`${key}-q`,'input',e=>{f.q=e.target.value; renderTable(sheet); const i=$(`${key}-q`); i.focus(); i.setSelectionRange(i.value.length,i.value.length);});
  for(const k of ['pic','st','brand','chk']) on(`${key}-${k}`,'change',e=>{f[k]=e.target.value; renderTable(sheet);});
  on(`${key}-mine`,'change',e=>{f.mine=e.target.checked; renderTable(sheet);});
  on(`${key}-fold`,'click',()=>{ if(f.collapsed.size) f.collapsed.clear(); else groups.forEach(g=>f.collapsed.add(g.id)); renderTable(sheet); });
  on(`${key}-reset`,'click',()=>{ Object.assign(f,{q:'',pic:'',st:'',brand:'',chk:'',mine:false}); renderTable(sheet); });
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
      html += `<div class="wk-sec"><h3><span class="chip ${cls}">${t}</span>${rows.length}건 <span style="font-weight:400;color:var(--muted);font-size:12px">${sub}</span></h3>${rows.length?`<div class="tablewrap" style="max-height:none"><table><thead><tr><th>ID</th><th>업무</th><th>PIC</th><th>상태</th><th>Start</th><th>End</th><th>D-day</th><th>비고</th></tr></thead><tbody>${rows.map(r=>{const d=dday(r);return `<tr class="task" data-id="${r.id}"><td class="mono">${r.id}</td><td class="t-name"><span class="cat">${esc(r.cat)}</span><span class="tk">${esc(r.task)}</span></td><td class="nw">${esc(r.pic||'')}</td><td>${stChip(r.st)}</td><td class="mono">${fmtD(pd(r.start_date))}</td><td class="mono">${fmtD(pd(r.end_date))}</td><td class="mono dday ${d!=null&&d<0?'neg':''}">${ddTxt(d)}</td><td style="max-width:320px">${esc(r.note||'')}</td></tr>`;}).join('')}</tbody></table></div>`:''}</div>`;
      text += `- ${t} ${rows.length}건\n` + rows.map(r=>`  · [${r.id}] ${r.cat} - ${r.task||''} (${r.pic||'미지정'}, ~${fmtD(pd(r.end_date))})`).join('\n') + (rows.length?'\n':'');
    }
  }
  $('v-weekly').innerHTML = html;
  $('wk-base').addEventListener('change',e=>{ui.weeklyBase=pd(e.target.value)||null; renderWeekly();});
  $('wk-copy').addEventListener('click',async()=>{ try{ await navigator.clipboard.writeText(text); toast('보고 문구를 복사했습니다. 메신저에 붙여넣으세요.'); }catch(e){ toast('복사하지 못했습니다. 브라우저 권한을 확인하세요.'); } });
}

// ---------------- gantt
function renderGantt(){
  const sheet = ui.ganttSheet;
  const dated = items.filter(r=>r.sheet===sheet&&isTask(r)&&r.start_date);
  const minS = dated.length ? new Date(Math.min(...dated.map(r=>pd(r.start_date)))) : today;
  const g0 = new Date(minS); g0.setDate(g0.getDate()-((g0.getDay()+6)%7));
  const maxE = dated.length ? new Date(Math.max(...dated.map(r=>pd(r.end_date||r.start_date)), today)) : today;
  const weeks = Math.max(8, Math.ceil((maxE-g0)/DAY/7)+2);
  const g1 = new Date(g0.getTime()+weeks*7*DAY), span=(g1-g0)/DAY, X=d=>((d-g0)/DAY)/span*100;
  let head='',grid='',pm=-1;
  for(let k=0;k<weeks;k++){ const d=new Date(g0.getTime()+k*7*DAY), m=d.getMonth(); head+=`<div class="${m!==pm?'m':''}" style="left:${k/weeks*100}%">${m!==pm?(m+1)+'월 ':''}${d.getDate()}</div>`; grid+=`<div style="left:${k/weeks*100}%"></div>`; pm=m; }
  const tx = `<div class="g-today" style="left:${X(today)}%" title="오늘"></div>`;
  let rows='';
  for(const g of items.filter(r=>r.sheet===sheet&&r.lvl==='L1')){
    const a=groupAgg(g);
    rows += `<div class="g-row g1"><div class="g-lab">${esc(g.num)}. ${esc(g.cat)}</div><div class="g-track"><div class="g-grid">${grid}</div>${tx}${a.start&&a.end?`<div class="g-bar grp" style="left:${X(a.start)}%;width:${Math.max(.4,X(new Date(a.end.getTime()+DAY))-X(a.start))}%"></div>`:''}</div></div>`;
    for(const r of desc(g.id).filter(isTask)){
      const s=pd(r.start_date), e=pd(r.end_date)||s; if(!s) continue;
      const cls = check(r)==='지연' ? 'late' : ST_CLS[r.st]||'';
      rows += `<div class="g-row" data-id="${r.id}"><div class="g-lab" title="${esc(r.cat)} · ${esc(r.task||'')}"><span class="mono" style="color:var(--muted)">${r.id}</span> ${esc(r.cat)}</div><div class="g-track"><div class="g-grid">${grid}</div>${tx}<div class="g-bar ${cls}" style="left:${X(s)}%;width:${Math.max(.5,X(new Date(e.getTime()+DAY))-X(s))}%" title="${fmtD(s)} ~ ${fmtD(e)} · ${ST_KO[r.st]||''} · ${pct(r.prog)}">${r.prog?`<i style="width:${Math.min(1,r.prog)*100}%"></i>`:''}</div></div></div>`;
    }
  }
  $('v-gantt').innerHTML = `<div class="toolbar"><select id="g-sheet" aria-label="시트"><option value="WBS" ${sheet==='WBS'?'selected':''}>WBS</option><option value="REQ" ${sheet==='REQ'?'selected':''}>대표님 REQ</option></select><div class="legend" style="margin:0"><span><i class="s-ip"></i>진행 중</span><span><i class="s-pl"></i>예정</span><span><i class="s-oh"></i>보류</span><span><i class="s-co"></i>완료</span><span><i style="background:var(--bad)"></i>지연</span><span>빨간 세로선 = 오늘 · 막대 안 진한 부분 = 진척률</span></div><span class="count">일정이 있는 업무만 표시</span></div>
  <div class="gantt"><div class="g-head"><div class="g-lab">업무</div><div class="g-weeks">${head}</div></div>${rows}</div>`;
  $('g-sheet').addEventListener('change',e=>{ui.ganttSheet=e.target.value; renderGantt();});
}

// ---------------- drawer (상세·편집)
const drawer=$('drawer'), scrim=$('scrim');
async function openDrawer(id){
  const r=byId[id]; if(!r) return; selId=id;
  const ro = !canEdit();
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
      ${isTask(r)?`<div class="calc"><div>D-day <b>${ddTxt(d)||'–'}</b></div><div>일정 체크 ${chkChip(c)||'–'}</div><div>오늘까지 계획 <b>${pct(m)}</b></div></div>`:''}
      <fieldset ${ro?'disabled':''} style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:12px">
      <div class="fgrid">
        <div class="field full"><label for="f-cat">Category</label><input id="f-cat" value="${esc(r.cat||'')}"></div>
        ${grp?'':`
        <div class="field full"><label for="f-task">Task</label><textarea id="f-task">${esc(r.task||'')}</textarea></div>
        <div class="field"><label for="f-output">Output / Check</label><input id="f-output" value="${esc(r.output||'')}"></div>
        <div class="field"><label for="f-link">산출물 링크</label><input id="f-link" placeholder="NAS 경로 또는 URL" value="${esc(r.link||'')}"></div>
        <div class="field"><label for="f-brand">브랜드</label><select id="f-brand">${opt(BRANDS,r.brand)}${extraOpt(BRANDS,r.brand)}</select></div>
        <div class="field"><label for="f-cyc">주기</label><input id="f-cyc" list="cyc-list" value="${esc(r.cyc||'')}"><datalist id="cyc-list">${CYCLES.map(x=>`<option value="${x}">`).join('')}</datalist></div>
        <div class="field"><label for="f-pic">PIC</label><select id="f-pic">${opt(PEOPLE,r.pic)}${extraOpt(PEOPLE,r.pic)}</select></div>
        <div class="field"><label for="f-bak">Backup</label><select id="f-bak">${opt(PEOPLE,r.bak)}${extraOpt(PEOPLE,r.bak)}</select></div>
        <div class="field"><label for="f-st">진행 상태</label><select id="f-st">${opt(STATUS,r.st,STATUS.map(s=>ST_KO[s]))}</select></div>
        <div class="field"><label for="f-prog">progress %</label><input id="f-prog" type="number" min="0" max="100" step="5" value="${r.prog!=null?Math.round(r.prog*100):''}" ${isTask(r)?'':'disabled'}></div>
        <div class="field"><label for="f-start_date">Start</label><input id="f-start_date" type="date" value="${r.start_date||''}" ${isTask(r)?'':'disabled'}></div>
        <div class="field"><label for="f-end_date">End</label><input id="f-end_date" type="date" value="${r.end_date||''}" ${isTask(r)?'':'disabled'}></div>
        <div class="field full"><label for="f-note">비고</label><textarea id="f-note">${esc(r.note||'')}</textarea></div>`}
      </div>${kpi}${req}</fieldset>
      ${!grp && canEdit() && r.lvl!=='C' ? `<button class="addbtn" type="button" id="d-addchild" style="align-self:flex-start;margin:0">+ 이 업무 아래에 하위 업무 추가</button>`:''}
      <div class="subhead">변경 이력</div><div class="hist" id="d-hist"><div>불러오는 중…</div></div>
    </div>
    <footer>${me.role==='admin'&&!grp?'<button class="btn danger" type="button" id="d-del" style="margin-right:auto">삭제</button>':''}<button class="btn" type="button" id="d-cancel">${ro?'닫기':'취소'}</button>${ro?'':'<button class="btn primary" type="button" id="d-save">저장</button>'}</footer>`;
  drawer.classList.add('on'); scrim.classList.add('on');
  $('d-close').onclick=closeDrawer; $('d-cancel').onclick=closeDrawer;
  if($('d-save')) $('d-save').onclick=()=>saveDrawer(r);
  if($('d-del')) $('d-del').onclick=()=>deleteItem(r);
  if($('d-addchild')) $('d-addchild').onclick=()=>addItem(r.id);
  rerender();
  const { data, error } = await sb.from('item_history').select('changed_at,changed_by,changes').eq('item_id',id).order('changed_at',{ascending:false}).limit(50);
  if(selId!==id) return;
  $('d-hist').innerHTML = error ? `<div>이력을 불러오지 못했습니다.</div>` : (data.length ? data.map(h=>`<div>${new Date(h.changed_at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} · ${esc(h.changed_by)} · ${esc(h.changes)}</div>`).join('') : '<div>아직 변경 이력이 없습니다.</div>');
}
function closeDrawer(){ drawer.classList.remove('on'); scrim.classList.remove('on'); selId=null; rerender(); }
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
  const st = patch.st!==undefined ? patch.st : r.st, pr = patch.prog!==undefined ? patch.prog : r.prog;
  if(isTask(r) && st==='Completed' && (pr==null||pr<1)){ patch.prog=1; changes.push('progress: 완료 처리로 100% 자동 반영'); }
  if(!changes.length){ toast('바뀐 내용이 없습니다.'); return; }
  patch.updated_by = me.name; patch.updated_at = new Date().toISOString();
  $('d-save').disabled = true;
  const { data, error } = await sb.from('items').update(patch).eq('id',r.id).eq('updated_at',r.updated_at).select();
  if(error){ $('d-save').disabled=false; toast('저장하지 못했습니다: '+error.message); return; }
  if(!data.length){
    await loadItems(); toast('다른 팀원이 먼저 수정했습니다. 최신 내용을 불러왔으니 다시 확인 후 저장하세요.'); openDrawer(r.id); return;
  }
  Object.assign(r, norm(data[0]));
  await sb.from('item_history').insert({item_id:r.id, changed_by:me.name, changes:changes.join(' / ')});
  toast(`${changes.length}개 항목을 저장했습니다.`);
  openDrawer(r.id);
}
async function addItem(parentId){
  const p = byId[parentId]; if(!p) return;
  const sheet = p.sheet, pref = sheet==='WBS'?'W':'R';
  const nums = items.filter(r=>r.sheet===sheet && r.id.startsWith(pref+'-')).map(r=>parseInt(r.id.slice(2),10)).filter(n=>!isNaN(n));
  const id = `${pref}-${String((nums.length?Math.max(...nums):0)+1).padStart(3,'0')}`;
  const sib = kids(parentId);
  const lastNum = sib.length ? Math.max(...sib.map(s=>parseInt(String(s.num).split('.').pop(),10)||0)) : 0;
  const num = `${p.num}.${lastNum+1}`;
  const tail = [p, ...desc(parentId)].reduce((a,b)=>b.sort_order>a.sort_order?b:a);
  const next = items.find(x=>x.sort_order>tail.sort_order);
  const sort_order = next ? (tail.sort_order+next.sort_order)/2 : tail.sort_order+1;
  const lvl = p.lvl==='L1' ? 'T' : 'C';
  const row = {id, sheet, num, lvl, parent:parentId, cat:'새 업무', brand:p.brand||'공통', cyc:'단발', pic:me.name, st:'Planned', w:0, sort_order, updated_by:me.name, updated_at:new Date().toISOString()};
  const { data, error } = await sb.from('items').insert(row).select();
  if(error){ toast('추가하지 못했습니다: '+error.message); return; }
  if(p.lvl==='T'){ await sb.from('items').update({lvl:'P', updated_by:me.name, updated_at:new Date().toISOString()}).eq('id',p.id); p.lvl='P'; }
  await sb.from('item_history').insert({item_id:id, changed_by:me.name, changes:`업무 추가 (${p.cat} 하위)`});
  items.push(norm(data[0])); index();
  toast(`${id} 업무를 추가했습니다. 내용을 입력하고 저장하세요.`);
  openDrawer(id);
}
async function deleteItem(r){
  if(kids(r.id).length){ toast('하위 업무가 있는 항목은 하위 업무를 먼저 삭제해야 합니다.'); return; }
  const btn=$('d-del');
  if(btn.dataset.confirm!=='1'){ btn.dataset.confirm='1'; btn.textContent='한 번 더 누르면 삭제됩니다'; return; }
  const { error } = await sb.from('items').delete().eq('id',r.id);
  if(error){ toast('삭제하지 못했습니다: '+error.message); return; }
  await sb.from('item_history').insert({item_id:r.id, changed_by:me.name, changes:`업무 삭제: ${r.cat} / ${r.task||''}`});
  items = items.filter(x=>x.id!==r.id); index();
  toast(`${r.id}를 삭제했습니다.`); closeDrawer();
}
scrim.addEventListener('click',closeDrawer);
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&drawer.classList.contains('on')) closeDrawer(); });

// ---------------- routing
const VIEWS=['dashboard','wbs','req','weekly','gantt'];
const current=()=>{ const h=location.hash.slice(1); return VIEWS.includes(h)?h:'dashboard'; };
function rerender(){
  if(!me) return;
  const v=current();
  document.querySelectorAll('#tabs a').forEach(a=>a.classList.toggle('on',a.dataset.v===v));
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('on',s.id==='v-'+v));
  if(v==='dashboard') renderDashboard(); else if(v==='wbs') renderTable('WBS'); else if(v==='req') renderTable('REQ'); else if(v==='weekly') renderWeekly(); else renderGantt();
}
window.addEventListener('hashchange',()=>{ if(location.hash.includes('access_token')) return; rerender(); });
document.querySelector('main').addEventListener('click',e=>{
  const add=e.target.closest('[data-add]'); if(add){ e.stopPropagation(); addItem(add.dataset.add); return; }
  const go=e.target.closest('[data-go]');
  if(go){ const t=go.dataset.go; if(t.startsWith('chk:')){ for(const k of ['wbs','req']) Object.assign(ui[k],{q:'',pic:'',st:'',brand:'',chk:t.slice(4),mine:false}); location.hash='wbs'; rerender(); } else location.hash=t; return; }
  const g=e.target.closest('tr.g1');
  if(g){ const f=ui[current()]; if(f&&f.collapsed){ f.collapsed.has(g.dataset.g)?f.collapsed.delete(g.dataset.g):f.collapsed.add(g.dataset.g); rerender(); } return; }
  const t=e.target.closest('[data-id]'); if(t) openDrawer(t.dataset.id);
});
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
      hr.eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF64005F'}};c.alignment={vertical:'middle',horizontal:'center',wrapText:true};});
      for(const row of sheetRows(sheet)){
        const xr=ws.addRow(row.vals); xr.alignment={vertical:'middle',wrapText:true};
        if(row.lvl==='L1') xr.eachCell({includeEmpty:true},c=>{c.font={bold:true};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDDDDD'}};});
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
    hs.addRow(['일시','ID','수정자','변경 내용']).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF64005F'}};});
    for(const h of hist||[]) hs.addRow([new Date(h.changed_at), h.item_id, h.changed_by, h.changes]);
    hs.getColumn(1).numFmt='yy.mm.dd hh:mm'; [16,9,10,100].forEach((w,i)=>hs.getColumn(i+1).width=w);
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
