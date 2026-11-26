# 👑 이솔 비서실

미우 · 클로드 · 뮤즈 · 키링 · 챗지피티 · 인스팅트 여섯 비서가 한 화면에 모이는 개인 비서실 웹앱입니다.
빌드 도구 없이 **정적 파일만**으로 동작하고, Supabase를 연결하면 기기 간 **실시간 동기화**가 됩니다.

- 화면: `index.html` · `styles.css` · `app.js` · `config.js`
- DB: `supabase-schema.sql` (테이블 4개 + RLS + Realtime + 시드)
- 키가 비어 있으면 **로컬 데모 모드**(localStorage)로 모든 기능이 그대로 동작합니다.

---

## 1. 바로 열어보기 (로컬 데모)

가장 간단한 방법은 `index.html`을 브라우저로 여는 것입니다.
(폰트·아이콘 모두 시스템 자원이라 인터넷 없이도 뜹니다.)

```bash
# 폴더에서 정적 서버 띄우기 (권장)
cd yisol-office
python3 -m http.server 8000
# → http://localhost:8000
```

데모 모드에서는
- 메시지·작업·메모·비서 상태가 브라우저 `localStorage`에 저장되고,
- 상단 배지가 **로컬 데모**(노란색)로 표시되며,
- `연결 테스트` 버튼을 누르면 선택한 비서가 데모 응답을 돌려줍니다.

### 파일 하나로 열기 (폰에서 바로 보기)

`dist/이솔-비서실-데모.html` 은 CSS·JS를 모두 한 파일에 담은 버전입니다.
파일 앱 → Safari로 열면 폰에서도 그대로 동작합니다. (로컬 데모 전용)

```bash
python3 build-standalone.py   # index.html + styles.css + config.js + app.js → dist/
```

> 데모 데이터는 화면 확인용 샘플입니다. 실제 기록은 Supabase를 연결한 뒤부터 쌓입니다.
> 브라우저 저장소를 지우면(`localStorage.removeItem('yisol-office.v1')`) 처음 샘플로 돌아갑니다.

---

## 2. Supabase 연결 (로그인 + 실시간 동기화)

> 이 프로젝트(`yzeovdjceqjundyyyfwo`)는 이미 `config.js`에 연결되어 있습니다.
> 새 프로젝트를 쓰려면 아래 3번에서 URL·키만 바꾸면 됩니다.

### 한 번만 하면 되는 3단계

1. 프로젝트 → **SQL Editor** → `supabase-schema.sql` 전체를 붙여넣고 **Run**.
   - `assistants` · `messages` · `tasks` · `memos` 4개 테이블
   - **로그인 전용 RLS**(`auth.role() = 'authenticated'`) — 비로그인은 읽기·쓰기 모두 불가
   - Realtime 발행, 비서 6명 시드
2. 프로젝트 → **Authentication → Users → Add user**
   - 본인 이메일 + 비밀번호로 **계정 1개**만 만듭니다.
   - **Auto Confirm User** 를 체크해야 메일 인증 없이 바로 로그인됩니다.
3. (권장) **Authentication → Sign In / Providers → Email** 에서
   **Allow new users to sign up** 을 끕니다.
   - 정책이 `authenticated` 기준이라, 회원가입이 열려 있으면 남이 자기 계정을 만들어 들어올 수 있습니다.
   - 이 앱은 **한 사람 전용**이므로 가입은 닫아 두세요.
4. 사이트를 열면 **이솔 비서실 로그인 화면**이 뜹니다. 2번에서 만든 이메일·비밀번호로 로그인.
   - 로그인 상태는 그 기기에 저장되어, 다음부터는 바로 열립니다.
   - 헤더 오른쪽 **나가기** 로 로그아웃할 수 있습니다.

### 키에 대해

`config.js`에 들어가는 것은 **publishable(anon) 키**로, 공개되어도 되는 키입니다.
데이터를 지키는 것은 키가 아니라 **RLS 정책**입니다. (절대 `service_role`/secret 키를 넣지 마세요.)

```js
// config.js
window.APP_CONFIG = {
  APP_TITLE: "이솔 비서실",
  OWNER_NAME: "이솔",
  OWNER_LABEL: "이솔님 전용",
  SUPABASE_URL: "https://yzeovdjceqjundyyyfwo.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_..."
};
```

값을 비우면 로그인 화면 없이 **로컬 데모 모드**로 동작합니다.

### 동기화되는 것

| 테이블 | 화면 | 내용 |
| --- | --- | --- |
| `messages` | 회의실 | 방(대회의실·지휘실·라운지), 보낸 사람, 받는 비서, 시간 |
| `tasks` | 작업실 | 제목·상세·상태(doing/todo/done)·담당·마감일 |
| `assistants` | 비서현황 | 상태(ON/대기/오프)·담당 영역·최근 활동 |
| `memos` | 메모 | 제목·내용·고정 여부·작성자 |

여러 기기(폰·맥)에서 같은 URL을 열어두면 한쪽에서 쓴 메시지·바꾼 카드가 다른 쪽에 바로 반영됩니다.

### Realtime이 안 될 때

- Supabase → **Database → Replication** 에서 `supabase_realtime` 발행에 4개 테이블이 들어있는지 확인
- 테이블을 나중에 직접 만든 경우 `supabase-schema.sql`의 Realtime 블록만 다시 실행
- 배지가 **연결 끊김**이면 `config.js`의 URL/anon 키, 프로젝트 일시정지 여부를 확인
  (연결에 실패해도 화면은 로컬 데이터로 열립니다.)

---

## 3. 배포

### GitHub Pages
1. 이 폴더(`yisol-office`)를 저장소에 올립니다.
2. 저장소 → **Settings → Pages** → Source: `Deploy from a branch` → 브랜치/`/root`(또는 폴더) 선택.
3. `https://<아이디>.github.io/<저장소>/` 로 접속.

### Vercel
1. <https://vercel.com> → **Add New → Project** → 저장소 선택.
2. Framework Preset: **Other**, Build Command 없음, Output Directory: 이 폴더(`yisol-office`).
3. Deploy → 발급된 URL 접속.

### Netlify / Cloudflare Pages
정적 사이트 배포로 폴더만 지정하면 됩니다. 빌드 명령은 필요 없습니다.

---

## 4. 파일 구조

```
yisol-office/
├── index.html          # 화면 골격 (헤더 · 4개 탭 · 회의실 입력창)
├── styles.css          # 크림/브라운 테마, 반응형 (모바일 1열 / PC 다열)
├── app.js              # 상태·렌더링·CRUD·Supabase Realtime
├── config.js           # 이름과 Supabase 키 (여기만 고치면 됨)
├── assets/avatars/     # 비서 프로필 사진 (256×256, miu·claude·muse·keyring·chatgpt·instinct.jpg)
├── supabase-schema.sql # 테이블 4개 + RLS + Realtime + 시드
├── build-standalone.py # 한 파일 데모 빌드 스크립트
├── dist/               # 빌드 결과 (이솔-비서실-데모.html)
└── README.md
```

---

## 5. 화면 구성

### 회의실
- 서브탭 **🏛️ 대회의실 / 🎯 지휘실 / 🛋️ 라운지**, 상태줄 `대회의실 · ON 6명`
- 비서별 아바타와 역할 배지(미우 · 메인비서 · 피클 / 클로드 · 맥 실무비서 / 뮤즈 · 서브비서 / 키링 · 서브비서 / 챗지피티 · 서브비서)
- 날짜 구분선과 시간이 붙은 타임라인
- 하단 입력창에서 이솔 님이 직접 메시지·지시를 남기고, **받는 비서**를 고르면 그 비서에게만 표시됩니다.
- **연결 테스트**: 선택한 비서에게 신호를 보내 연결을 확인합니다. (데모 모드에서는 응답까지 흉내)

### 작업실
- 진행중 / 대기 / 완료 3열 보드, 상태·담당 필터
- 카드에서 상태 변경(진행중→완료 등), 수정, 삭제
- **+ 새 작업**으로 제목·상세·담당·상태·마감일 추가

### 비서현황
- 여섯 비서 카드: 상태 배지(ON/대기/오프), 상태 전환 버튼, 담당 영역, 최근 활동, 마지막 업데이트 시각
- 상태를 바꾸면 회의실 상태줄의 `ON n명`과 받는 비서 목록에 바로 반영

### 메모
- 공유 메모장: 고정(📌) 우선 정렬, 새 메모·수정·삭제
- 여러 기기에서 같은 메모를 보고 고칠 수 있습니다.

---

## 6. 커스터마이즈

| 바꾸고 싶은 것 | 위치 |
| --- | --- |
| 앱 이름·주인 표기 (`이솔 비서실`, `이솔님 전용`) | `config.js` 또는 각 HTML의 텍스트 |
| 비서 이름·역할·아바타·담당 영역 | Supabase `assistants` 테이블(연결 시) / `app.js`의 `ASSISTANT_SEED`(데모 시) |
| 비서 프로필 사진 | `assets/avatars/<id>.jpg` (256×256 정사각형). 사진이 없거나 로드에 실패하면 `APP.js`의 `AVATAR_EMOJI` 이모지로 폴백합니다. |
| 회의실 방 이름·구성 | `app.js`의 `ROOMS` 배열 |
| 색상·모서리·간격 | `styles.css` 상단 `:root` 변수 |
| 데모 샘플 데이터 | `app.js`의 `buildSeed()` |

비서를 추가하려면 `assistants`에 행을 하나 넣고 `ROOMS`의 `members` 배열에 id를 더하면 됩니다.
(데모 모드라면 `ASSISTANT_SEED`와 `buildSeed()`의 메시지도 함께 수정)

> 이미 Supabase를 연결해 쓰던 중이라면 `supabase-schema.sql`의 시드 블록을 다시 실행하세요.
> `on conflict (id) do nothing`이라 기존 데이터는 그대로 두고 새로 추가한 비서 행만 들어갑니다.
> 데모(localStorage) 모드는 저장된 데이터에 빠진 비서를 자동으로 채워 넣습니다.

---

## 7. 보안·주의

- **로그인 필수**: 모든 테이블에 RLS가 켜져 있고 정책은 `auth.role() = 'authenticated'`입니다.
  로그인하지 않은 상태(anon)에서는 읽기도 쓰기도 막힙니다. anon 권한은 회수해 두었습니다.
- 프론트에 들어가는 키는 **publishable(anon) 키** — 공개되어도 되는 키입니다.
  **`service_role`/secret 키는 절대 넣지 마세요.** 그 키는 RLS를 우회합니다.
- **회원가입은 닫아 두세요** (Authentication → Sign In / Providers → Email).
  열려 있으면 누구나 계정을 만들어 로그인할 수 있습니다.
- 비밀번호를 잊으면: Supabase → Authentication → Users → 해당 계정 → **Reset password**
  (또는 새 비밀번호로 계정을 다시 만들고 기존 계정을 지움).
- 저장되는 내용은 평문입니다. 건강·금융 등 민감한 내용은 메모에 그대로 적지 않는 편이 안전합니다.
- 기기를 잃어버렸을 때는 Supabase → Authentication → Users 에서 **Sign out all sessions** 를 누르는 것이 가장 확실합니다.

---

## 8. 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| 로그인 화면이 계속 뜸 | Supabase → Authentication → Users 에 계정이 있는지, Auto Confirm 상태인지 |
| “이메일 또는 비밀번호가 맞지 않아요” | 오타 확인 · Users에서 **Reset password** |
| “비서실 테이블이 아직 없어요” | SQL Editor에서 `supabase-schema.sql`을 실행했는지 |
| 배지가 계속 `로컬 데모` | `config.js`의 두 값이 비어 있거나 20자 미만인지 |
| `연결 끊김` | Supabase 프로젝트 일시정지, URL·키 오타 |
| 새 메시지가 다른 기기에 안 뜸 | Database → Replication 의 `supabase_realtime` 발행 테이블 확인 |
| 화면이 비어 보임 | 브라우저 콘솔 오류 확인, `index.html`과 같은 폴더에 `app.js`·`styles.css`가 있는지 |
| 폰에서 입력창이 가려짐 | iOS 안전영역(`env(safe-area-inset-bottom)`)이 적용돼 있습니다. Safari 새로고침 후 재확인 |

---

만든 날: 2026-11-26 · 이솔님 전용
