# JC EDU 마케팅 WBS

JC EDU 마케팅팀 업무(WBS·대표님 REQ)를 함께 관리하는 웹 서비스입니다.
GitHub Pages에서 화면을 제공하고, 데이터는 Supabase(DB·로그인)에 저장합니다.

## 기능
- 업무 현황: 실제 진척 vs 오늘까지 계획, 지연·임박·확인 필요 건수, 담당자별 업무량, 이번 주 마감
- WBS / 대표님 REQ: 카테고리 → 상시 업무 → 하위 업무 3단계, 필터(담당자·상태·브랜드·일정 체크·내 업무), D-day·일정 체크 자동 계산
- 상세 편집: 상태·진척률·일정·산출물 링크·상시 업무 월 실적·대표님 보고 관리, 완료 시 진척률 100% 자동 반영
- 변경 이력: 누가 언제 무엇을 바꿨는지 자동 기록
- 실시간 반영: 다른 팀원이 수정한 내용이 바로 화면에 반영, 동시에 같은 업무를 고치면 덮어쓰기 방지
- 주간 보고: 기준일의 주간 지연 / 이번 주 마감 / 진행 중 / 지난주 완료 자동 추출, 보고 문구 복사
- 간트: 주 단위 일정 막대, 오늘 표시
- 엑셀 다운로드: WBS·대표님 REQ·변경 이력 시트가 든 .xlsx

## 권한
| role | 보기 | 편집·업무 추가 | 삭제 |
|---|---|---|---|
| admin | O | O | O |
| member | O | O | X |
| viewer | O | X | X |

`members` 테이블에 등록된 이메일만 로그인 후 데이터를 볼 수 있습니다 (DB의 RLS 정책으로 강제).

## 설치 (최초 1회)

### 1. Supabase
1. supabase.com 에서 새 프로젝트 생성 (Region: Northeast Asia (Seoul))
2. **SQL Editor**에서 `supabase/schema.sql` 실행
3. **SQL Editor**에서 초기 데이터 `seed.sql` 실행 — 저장소에 없는 별도 파일입니다. 팀원 이메일을 채운 뒤 실행하세요.
4. **Authentication → URL Configuration**
   - Site URL: `https://goochanbae.github.io/JCEDU/`
   - Redirect URLs: `https://goochanbae.github.io/JCEDU/` 추가
5. **Project Settings → API**에서 Project URL과 `anon` `public` 키를 복사

### 2. 코드 설정
`config.js`에 위에서 복사한 값을 넣습니다.
```js
window.JC_CONFIG = {
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...'
};
```
anon 키는 공개되어도 되는 키입니다. 데이터는 RLS 정책이 보호합니다. `service_role` 키는 절대 넣지 마세요.

### 3. GitHub Pages
저장소 **Settings → Pages** → Source: `Deploy from a branch`, Branch: `main` / `/ (root)` → Save
몇 분 뒤 `https://goochanbae.github.io/JCEDU/` 에서 열립니다.

## 팀원 추가
1. SQL Editor에서 등록
   ```sql
   insert into public.members (email, name, role) values ('이메일', '이름', 'member');
   ```
2. 로그인 방법 (둘 중 하나)
   - **로그인 링크**: 로그인 화면에 이메일만 입력 → 메일로 받은 링크 클릭
     (Supabase 기본 메일은 시간당 발송 수가 적습니다. 여러 명이 한꺼번에 로그인하면 막힐 수 있습니다)
   - **비밀번호**: Supabase **Authentication → Users → Add user → Create new user**에서 이메일·비밀번호 입력, `Auto Confirm User` 체크 → 팀원에게 비밀번호 전달

## 카테고리(L1) 추가·순서 변경
현재 화면에서는 업무·하위 업무만 추가할 수 있습니다. 카테고리는 Supabase **Table Editor → items**에서 `lvl = 'L1'` 행을 추가하세요. 순서는 `sort_order` 값으로 정해집니다.

## 파일 구성
```
index.html          화면
style.css           스타일
app.js              기능 (Supabase 연동, 계산, 엑셀 내보내기)
config.js           Supabase 접속 정보
supabase/schema.sql 테이블·권한(RLS)·실시간 설정
```
