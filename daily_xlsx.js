// 일일보고 엑셀: 팀 양식(templates/daily_report.xlsx)을 그대로 열어 칸에 값을 채워 내려받기
// 외부 라이브러리 없이 브라우저 기본 기능(압축 해제·압축)만 사용해 양식의 서식·수식·드롭다운·조건부 서식을 그대로 유지
// 칸이 모자라면(전일 5 · 금일 5 · 이슈 3 · 이번 주 8행) 같은 모양의 행을 아래에 추가
(function(){
  'use strict';
  const TD = new TextDecoder(), TE = new TextEncoder();

  // ---------- zip 읽기/쓰기 ----------
  async function inflateRaw(bytes){ return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }
  async function deflateRaw(bytes){ return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); }
  async function readZip(buf){
    const u = new Uint8Array(buf), dv = new DataView(buf);
    let e = u.length - 22; while(e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if(e < 0) throw new Error('엑셀 양식 파일을 읽지 못했어요.');
    const n = dv.getUint16(e+10, true); let p = dv.getUint32(e+16, true);
    const files = [];
    for(let i=0;i<n;i++){
      const method = dv.getUint16(p+10, true), csize = dv.getUint32(p+20, true);
      const nl = dv.getUint16(p+28, true), xl = dv.getUint16(p+30, true), cl = dv.getUint16(p+32, true), off = dv.getUint32(p+42, true);
      const name = TD.decode(u.subarray(p+46, p+46+nl));
      const lnl = dv.getUint16(off+26, true), lxl = dv.getUint16(off+28, true), start = off+30+lnl+lxl;
      const raw = u.subarray(start, start+csize);
      files.push({name, data: method===8 ? await inflateRaw(raw) : raw.slice()});
      p += 46+nl+xl+cl;
    }
    return files;
  }
  const CRC = (()=>{ const t = new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xEDB88320^(c>>>1) : c>>>1; t[n]=c>>>0; } return t; })();
  const crc32 = d => { let c = 0xFFFFFFFF; for(let i=0;i<d.length;i++) c = CRC[(c^d[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; };
  async function writeZip(files){
    const parts = [], central = []; let off = 0;
    const now = new Date(), dt = ((now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1)), dd = (((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate());
    for(const f of files){
      const name = TE.encode(f.name), comp = await deflateRaw(f.data), crc = crc32(f.data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(6,0x0800,true); h.setUint16(8,8,true);
      h.setUint16(10,dt,true); h.setUint16(12,dd,true); h.setUint32(14,crc,true); h.setUint32(18,comp.length,true); h.setUint32(22,f.data.length,true);
      h.setUint16(26,name.length,true); h.setUint16(28,0,true);
      parts.push(new Uint8Array(h.buffer), name, comp);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x0800,true); c.setUint16(10,8,true);
      c.setUint16(12,dt,true); c.setUint16(14,dd,true); c.setUint32(16,crc,true); c.setUint32(20,comp.length,true); c.setUint32(24,f.data.length,true);
      c.setUint16(28,name.length,true); c.setUint32(42,off,true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + comp.length;
    }
    const csize = central.reduce((a,b)=>a+b.length,0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,csize,true); e.setUint32(16,off,true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }

  // ---------- 시트 채우기 ----------
  const xesc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const serial = iso => { if(!iso) return null; const [y,m,d] = String(iso).slice(0,10).split('-').map(Number); return (Date.UTC(y,m-1,d) - Date.UTC(1899,11,30))/864e5; };
  // 템플릿 구역 (행 번호는 양식 기준)
  const SEC = {done:{first:8,last:12}, today:{first:17,last:21}, issue:{first:25,last:27}, plan:{first:31,last:38}};

  function fillSheet(xml, rep){
    const need = {done:rep.done.length, today:rep.today.length, issue:rep.issues.length, plan:rep.plan.length};
    const extra = {}; for(const k in SEC) extra[k] = Math.max(0, need[k] - (SEC[k].last-SEC[k].first+1));
    // 양식 행 r 이 몇 칸 내려가는지
    const shift = r => (r>SEC.done.last?extra.done:0)+(r>SEC.today.last?extra.today:0)+(r>SEC.issue.last?extra.issue:0)+(r>SEC.plan.last?extra.plan:0);
    const total = extra.done+extra.today+extra.issue+extra.plan;
    const nr = r => r + shift(r);
    const rowRe = /<row r="(\d+)"[\s\S]*?<\/row>|<row r="(\d+)"[^>]*\/>/g;
    const rows = {}; let m;
    const sd = xml.match(/<sheetData>([\s\S]*)<\/sheetData>/);
    while((m = rowRe.exec(sd[1]))) rows[+(m[1]||m[2])] = m[0];
    const setRowNum = (rowXml, to) => rowXml.replace(/^<row r="\d+"/, `<row r="${to}"`).replace(/ r="([A-Z]+)\d+"/g, (_,c)=>` r="${c}${to}"`);
    // 셀 값 넣기 (기존 셀의 서식 s 유지)
    const setCell = (rowXml, col, val, kind) => {
      const re = new RegExp(`<c r="${col}(\\d+)"([^>]*?)(/>|>[\\s\\S]*?</c>)`);
      return rowXml.replace(re, (all, rn, attrs) => {
        const s = (attrs.match(/ s="\d+"/)||[''])[0];
        if(val==null || val==='') return `<c r="${col}${rn}"${s}/>`;
        if(kind==='n') return `<c r="${col}${rn}"${s}><v>${val}</v></c>`;
        if(kind==='f') return `<c r="${col}${rn}"${s} t="str"><f>${xesc(val)}</f><v></v></c>`;
        return `<c r="${col}${rn}"${s} t="inlineStr"><is><t xml:space="preserve">${xesc(val)}</t></is></c>`;
      });
    };
    const H4 = '$H$4';
    const out = [];
    const maxRow = Math.max(...Object.keys(rows).map(Number));
    for(let r=1; r<=maxRow; r++){
      if(!rows[r]) continue;
      let base = rows[r];
      const secKey = Object.keys(SEC).find(k => r>=SEC[k].first && r<=SEC[k].last);
      if(!secKey){
        let x = setRowNum(base, nr(r));
        if(r===4){ x = setCell(x,'D',rep.author); x = setCell(x,'H',serial(rep.date),'n'); }
        if(r===SEC.done.last+1){ const a = nr(SEC.done.first), b = nr(SEC.done.last)+extra.done; x = setCell(x,'G',`IFERROR(AVERAGE(G${a}:G${b}),"")`,'f'); }
        out.push(x);
        continue;
      }
      // 구역의 마지막 양식 행 뒤에 추가 행을 이어 붙임
      const S = SEC[secKey], idxs = [r - S.first];
      if(r===S.last) for(let i=1;i<=extra[secKey];i++) idxs.push(r - S.first + i);
      for(const idx of idxs){
        const to = nr(S.first) + idx;
        let x = setRowNum(base, to).replace(/<f t="shared"[^>]*\/>|<f t="shared"[^>]*>[\s\S]*?<\/f>/g, '<f></f>');
        x = setCell(x,'C',idx+1,'n');
        if(secKey==='done'){
          const e = rep.done[idx]||{};
          x = setCell(x,'D',e.kind); x = setCell(x,'E',e.title); x = setCell(x,'F',e.detail); x = setCell(x,'G',e.prog==null?null:e.prog,'n');
          x = setCell(x,'H',`IF(G${to}="","",IF(G${to}>=1,"완료","진행중"))`,'f');
        } else if(secKey==='today'){
          const e = rep.today[idx]||{};
          x = setCell(x,'D',e.kind); x = setCell(x,'E',e.title); x = setCell(x,'F',e.detail); x = setCell(x,'G',e.prog==null?null:e.prog,'n');
        } else if(secKey==='issue'){
          const e = rep.issues[idx]||{};
          x = setCell(x,'D',e.issue); x = setCell(x,'F',e.action);
        } else {
          const e = rep.plan[idx]||{};
          x = setCell(x,'D',e.kind); x = setCell(x,'E',e.title); x = setCell(x,'F',e.detail); x = setCell(x,'G',serial(e.due),'n'); x = setCell(x,'H',e.status);
          x = setCell(x,'I',`IF(OR(G${to}="",${H4}=""),"",IF(H${to}="완료","-",IF(G${to}-${H4}=0,"D-day",IF(G${to}<${H4},"D+"&(${H4}-G${to}),"D-"&(G${to}-${H4})))))`,'f');
        }
        out.push(x);
      }
    }
    xml = xml.replace(sd[0], `<sheetData>${out.join('')}</sheetData>`);
    // 병합: 양식 병합을 옮기고, 추가된 이슈 행에도 같은 병합
    const merges = [...xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g)].map(m=>[m[1],+m[2],m[3],+m[4]]);
    const nm = merges.map(([c1,r1,c2,r2])=>`${c1}${nr(r1)}:${c2}${nr(r2)}`);
    for(let i=1;i<=extra.issue;i++){ const rr = nr(SEC.issue.last)+i; nm.push(`D${rr}:E${rr}`, `F${rr}:I${rr}`); }
    xml = xml.replace(/<mergeCells[\s\S]*?<\/mergeCells>/, `<mergeCells count="${nm.length}">${nm.map(r=>`<mergeCell ref="${r}"/>`).join('')}</mergeCells>`);
    // 조건부 서식·드롭다운 범위
    const pa = nr(SEC.plan.first), pb = nr(SEC.plan.last)+extra.plan, da = nr(SEC.done.first), db = nr(SEC.done.last)+extra.done, ta = nr(SEC.today.first), tb = nr(SEC.today.last)+extra.today;
    xml = xml.replace(/sqref="C31:J38"/, `sqref="C${pa}:J${pb}"`).replace(/\$G31/g, `$G${pa}`).replace(/\$H31/g, `$H${pa}`)
             .replace(/sqref="H8:H12"/, `sqref="H${da}:H${db}"`);
    const list = (col,a,b) => { const o=[]; for(let i=a;i<=b;i++) o.push(col+i); return o.join(' '); };
    xml = xml.replace(/(<dataValidation [^>]*?sqref=")([^"]*)("[^>]*>\s*<formula1>"P,R")/, (_,a,__,c)=>a+[list('D',da,db),list('D',ta,tb),list('D',pa,pb)].join(' ')+c)
             .replace(/(<dataValidation [^>]*?sqref=")([^"]*)("[^>]*>\s*<formula1>"예정)/, (_,a,__,c)=>a+list('H',pa,pb)+c)
             .replace(/(<dataValidation [^>]*?type="decimal"[^>]*?sqref=")([^"]*)(")/, (_,a,__,c)=>a+[list('G',da,db),list('G',ta,tb)].join(' ')+c);
    xml = xml.replace(/<dimension ref="B2:J(\d+)"\/>/, (_,r)=>`<dimension ref="B2:J${+r+total}"/>`);
    xml = xml.replace(/<selection [^>]*\/>/, '<selection activeCell="C3" sqref="C3"/>');
    return {xml, total};
  }

  // rep = {author, date:'YYYY-MM-DD', done:[{kind,title,detail,prog}], today:[...], issues:[{issue,action}], plan:[{kind,title,detail,due,status}]}
  async function build(templateBuf, rep){
    const files = await readZip(templateBuf);
    const get = n => files.find(f=>f.name===n);
    const sh = get('xl/worksheets/sheet1.xml');
    const {xml, total} = fillSheet(TD.decode(sh.data), rep);
    sh.data = TE.encode(xml);
    // 인쇄 영역 늘리기, 열 때 수식 다시 계산, 계산 순서 파일 제거
    const wb = get('xl/workbook.xml');
    let w = TD.decode(wb.data).replace(/\$C\$3:\$I\$(\d+)/, (_,r)=>`$C$3:$I$${+r+total}`).replace(/<calcPr[^>]*\/>/, '<calcPr calcId="191029" fullCalcOnLoad="1"/>');
    wb.data = TE.encode(w);
    const out = files.filter(f=>f.name!=='xl/calcChain.xml');
    const rel = get('xl/_rels/workbook.xml.rels'); rel.data = TE.encode(TD.decode(rel.data).replace(/<Relationship [^>]*calcChain[^>]*\/>/, ''));
    const ct = get('[Content_Types].xml'); ct.data = TE.encode(TD.decode(ct.data).replace(/<Override PartName="\/xl\/calcChain.xml"[^>]*\/>/, ''));
    return writeZip(out);
  }
  window.DailyXlsx = { build };
})();
