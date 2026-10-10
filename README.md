# 노인일자리 비대면 교육 이수 확인 — Supabase 연결 버전

외부 워크북·유튜브로 교육을 받은 참여자가 휴대전화에서 본인 확인과 서명을 제출하고, 담당자가 공식 PDF를 내려받는 도구입니다. 참여자 약 125명, 사업단 2개, 담당자 1명을 기준으로 합니다.

## 변경된 구조

```text
참여자 휴대전화 / 담당자 PC
          ↓ 같은 웹앱 주소 (HTTPS)
Node.js 서버 — 담당자 인증·참여자별 조회·3시간 검증·공식 PDF 생성
          ↓ 서버 전용 Supabase 키
Supabase PostgreSQL — 교육 데이터·서명·PDF·수정 이력
```

브라우저별 localStorage를 공통 저장소로 사용하지 않습니다. 서버를 실행해야 하며, index.html을 더블클릭하거나 GitHub Pages에 올리는 것만으로는 작동하지 않습니다. Supabase에는 데이터와 SQL을 넣고, HTML·JavaScript·Node.js 코드는 웹앱 프로젝트에서 실행합니다.

## 1. Supabase 데이터베이스 준비

1. Supabase에서 프로젝트를 만듭니다.
2. SQL Editor를 엽니다.
3. `supabase/migrations/202610100001_training.sql`의 전체 내용을 실행합니다.
4. Table Editor에서 기존 5개 테이블과 `training_documents`가 생겼는지 확인합니다.

사용자가 이미 만든 `training_settings`, `training_participants`, `training_assignments`, `training_submissions`, `training_audit_logs` 구조에 맞춘 보완 SQL입니다. 기존 테이블과 명단·배정·서명·이력은 유지하고 추가 열과 PDF 테이블 및 함수를 만듭니다. 기존의 모든 공개 접근 정책을 제거하고 평문 관리자 비밀번호를 비웁니다. 먼저 데이터를 백업하세요. 새 담당자 비밀번호는 서버의 ADMIN_PASSWORD로 설정해야 합니다. 원래 공개 정책이 있는 구버전 웹앱은 이 SQL 적용 후 직접 데이터에 접근할 수 없습니다. 새 서버 버전으로 함께 전환하세요.

SQL은 익명·일반 로그인 사용자의 테이블 접근을 막는 RLS를 켜고, 서버의 service_role만 접근하도록 구성합니다. RLS를 끄거나 공개 접근 정책을 추가하지 마세요.

## 2. 웹앱 연결 설정

Node.js 24 이상과 npm을 사용합니다.

프로젝트 폴더에서 `.env.example`을 복사해 `.env`를 만들고 아래 항목을 채웁니다. 실제 키는 채팅·스크린샷·GitHub에 올리지 않습니다.

| 항목 | 설정 내용 |
|---|---|
| SUPABASE_URL | Supabase 프로젝트 주소 |
| SUPABASE_SERVICE_ROLE_KEY | 서버 전용 secret key 또는 기존 service_role 키. anon/publishable 키를 넣지 않습니다. |
| ADMIN_PASSWORD | 최초 담당자 비밀번호. 12자 이상. 초기화 시 DB에 해시로 저장합니다. |
| PORT | 기본 3000 |
| HOST | 로컬은 127.0.0.1. 배포 서비스가 요구하면 0.0.0.0 |
| COOKIE_SECURE | 로컬 HTTP는 false, HTTPS 배포는 true |

Supabase 프로젝트의 Connect 또는 Settings / API Keys에서 프로젝트 주소와 키를 확인합니다. 키는 `.env` 또는 배포 서비스의 비밀 환경변수에만 설정합니다. 브라우저 코드에 넣거나 `VITE_`, `NEXT_PUBLIC_` 접두사를 붙이지 않습니다.

이미 담당자 비밀번호가 초기화된 DB에서는 `ADMIN_PASSWORD` 변경으로 비밀번호가 재설정되지 않습니다. 앱 담당자 설정에서 비밀번호를 변경합니다.

## 3. 실행

```sh
npm ci
npm run build
npm start
```

개발용으로 서버 시작 후 브라우저에서 `http://127.0.0.1:3000`을 엽니다. 이 주소는 본인 컴퓨터의 개발용 주소이며 다른 사람에게 보낼 교육 링크가 아닙니다.

서버 연결 확인은 `GET /api/health`로 합니다. Supabase 테이블이 없거나 주소·키가 잘못되면 서버 시작이 실패합니다. 서비스가 실행됐다는 사실만으로 학습·서명·발급 기능 검증이 완료되는 것은 아닙니다.

## 4. 연결 후 사용 순서

1. 담당자 관리 화면에서 설정한 비밀번호로 로그인합니다.
2. 기관명과 사업단 이름을 설정합니다.
3. 가상 참여자가 들어 있는 엑셀로 먼저 등록을 테스트합니다.
4. 교육 배정일을 지정하고 사업단 전체에 정확히 3시간을 배정합니다.
5. 별도 브라우저 또는 휴대전화로 참여자 이름과 생년월일 8자리를 입력합니다.
6. 과목마다 이수 확인 체크와 손가락 서명을 제출합니다.
7. 담당자 화면에서 제출 기록을 확인하고 PDF를 내려받습니다.
8. 결과를 검증한 뒤 실제 명단을 등록합니다.

부분 완료한 과목은 서버에 저장되고 다른 기기에서도 이어할 수 있습니다. 최종 과목까지 저장되면 서버가 PDF를 생성하고 Supabase에 함께 저장합니다. 담당자의 현황 화면은 15초마다 새 기록을 확인합니다.

## 5. Netlify에서 다른 기기와 공유하기

Netlify에 index.html만 배포하면 서버 API는 실행되지 않습니다. 이 저장소의 `netlify.toml`은 화면을 `dist`에 빌드하고 `/api/*`를 Netlify Functions에 연결합니다.

1. Netlify 사이트의 Git 배포 브랜치를 `codex/supabase-integration`으로 설정합니다. 기본 main은 아직 구버전일 수 있습니다.
2. Supabase SQL Editor에서 `202610100001_training.sql`을 적용하고, 이어서 `202610100002_sessions.sql`을 적용합니다. 첫 SQL은 기존 테이블과 공개 접근 정책을 보완하며, 두 번째 SQL은 여러 함수 인스턴스에서 로그인 상태를 공유합니다.
3. Netlify의 환경변수 설정에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD, COOKIE_SECURE=true를 등록합니다. 비밀 키는 브라우저 코드나 GitHub에 넣지 않습니다. 비밀번호는 12자 이상이어야 합니다.
4. 새 배포를 실행합니다. 빌드 명령은 `npm run build:netlify`, 공개 폴더는 `dist`, 함수 폴더는 `netlify/functions`입니다. netlify.toml에서 지정하므로 기존 대시보드 설정이 있다면 일치하는지 확인합니다.
5. 배포된 주소의 `/api/health`가 JSON `{"ok":true}`를 반환하는지 확인합니다. HTML이나 404가 나오면 함수 라우팅이 반영되지 않은 것입니다. 503이면 DB 보완 SQL 또는 서버 환경변수를 확인합니다.
6. 담당자로 가상 참여자를 추가합니다. Supabase `training_participants`에 저장됐는지 확인하고, 다른 브라우저에서 그 참여자로 본인 확인을 테스트합니다.
7. 다른 담당자 화면의 명단·현황은 최대 15초 뒤 갱신됩니다. 참여자는 본인 확인할 때 최신 명단을 조회합니다. 설정·배정 입력 화면은 작성 중 내용을 보호하기 위해 자동 갱신하지 않습니다.

주소가 같아도 각 브라우저의 localStorage에만 저장하는 구버전은 공유되지 않습니다. Supabase 테이블 생성만으로 구버전이 자동 연결되는 것도 아닙니다. 함수 설정과 새 코드 배포가 모두 필요합니다.

로그인 세션은 `training_sessions`에 토큰의 해시만 저장합니다. 함수가 재시작되거나 다른 인스턴스로 요청이 전달돼도 로그인은 유지되며, 로그아웃하면 DB의 세션을 삭제합니다. 만료 세션은 인증에 사용할 수 없습니다.

정적 공개 폴더에는 화면·CSS·브라우저 라이브러리만 복사합니다. `.env`, 서버 코드, 테스트 데이터는 공개하지 않습니다. 다른 Node.js 호스팅 서비스에서는 기존 `npm start` 방식도 계속 사용할 수 있습니다.

## 데이터베이스 설계

- `training_settings`: 기관 설정, 상태 버전 번호, 담당자 비밀번호 해시. 기존 평문 admin_password는 사용하지 않습니다.
- `training_participants`: 참여자 명단.
- `training_assignments`: 교육 배정과 개인별 예외.
- `training_submissions`: 과목별 이수 확인·서명·부분 저장·제출 시각.
- `training_audit_logs`: 담당자 수정 이력.
- `load_training_state`: 기존 snake_case 열을 화면의 camelCase 데이터로 변환하여 읽습니다.
- `training_sessions`: 서버 간 공유 로그인 세션. 원래 토큰은 저장하지 않고 해시·역할·만료 시각만 저장합니다.
- `training_documents`: 참여자·교육일·버전별 PDF. PDF는 base64로 DB에 저장하며 공개 Storage 버킷을 사용하지 않습니다.
- `save_training_state`: 상태와 PDF를 한 트랜잭션에서 저장하고, 다른 기기의 오래된 저장 요청을 거절합니다.

기존 관계형 테이블을 그대로 사용합니다. 첫 버전에서는 담당자 작업을 상태 단위로 저장하고, SQL 함수에서 여러 테이블을 트랜잭션으로 갱신합니다. 인원·기관 수가 커지면 행 단위 API와 private Storage로의 PDF 이전을 검토합니다.

## 공식 양식과 수정

`이수확인증_양식.pdf` 원본의 문구·교육명·교육시간·표는 변경하지 않습니다. 원본에 이미 인쇄된 2026년과 점을 유지하며 빈 월·일 칸과 서명 공간만 채웁니다. 현재 양식은 2026년 배정만 지원합니다.

담당자는 제출 기록 상세의 ‘교육 기록 수정’으로 과목과 날짜를 정정하고 사유를 남깁니다. 기존 서명을 과목에 직접 연결하며 한 서명을 여러 과목에 복제할 수 없습니다. 원래 기록은 이력에 남고 최신 PDF를 다시 생성합니다. 기존 서명보다 새 과목 수가 많으면 수정할 수 없습니다. 사업단 공동 배정의 수정은 해당 참여자의 개별 배정으로 저장됩니다. 날짜를 바꾸면 그 참여자만 기존 공동 배정에서 제외해 다른 참여자의 일정은 유지합니다.

전자서명 인정, 서명 후 과목 변경, 배정일을 실제학습일로 쓰는 방식은 기관 확인이 필요합니다. 이름·생년월일 대조는 강한 본인 인증이 아니므로 개인정보 보관·삭제 기준도 실제 운영 전에 정해야 합니다.

## 기존 브라우저 데이터

이전 버전의 localStorage 데이터는 자동 삭제하거나 자동 업로드하지 않습니다. 이전 버전에서 JSON 백업을 내려받아 보관하세요. 현재 버전의 일반 백업 불러오기 기능은 비활성화했으며, 기존 제출 기록 이전은 별도 검증·이전 작업이 필요합니다. Supabase 연결로 기존 PC의 데이터가 자동 이전되지는 않습니다.

## 검증

```sh
npm test
npm run test:e2e
```

테스트는 가상 참여자와 메모리 저장소 및 모의 Supabase HTTP 응답을 사용합니다. 다른 기기의 기록 공유, 접근 제한, 3시간 검증, 부분 서명 저장, 공식 PDF 생성, 수정 이력, 비밀번호 변경을 검사합니다. 브라우저 테스트는 Chromium으로 휴대전화 화면의 서명과 별도 담당자 화면의 기록 확인을 검증합니다.

테스트용 서버는 `tests/browser-server.mjs`에만 있으며 운영 `npm start`는 Supabase 연결 없이는 실행되지 않습니다. 새 개발 환경에서 Chromium이 없으면 `npx playwright install chromium`으로 설치하세요. 실제 Supabase 프로젝트 연결과 SQL 실행은 사용자 프로젝트의 설정 이후 별도로 검증해야 합니다.

## 주요 파일

- `netlify.toml`, `netlify/functions/api.mjs`: Netlify 빌드·서버 함수 연결.
- `server.mjs`: 인증·조회·서명·검증·PDF 생성 API.
- `supabase-store.mjs`: 서버 전용 Supabase 연결.
- `supabase/migrations/202610100001_training.sql`: 테이블·RLS·트랜잭션 함수.
- `client.js`: 기존 화면을 서버 API에 연결하는 코드.
- `.env.example`: 연결 설정 예시.
- `index.html`: 참여자·담당자 화면.
- `assets/NotoSansKR.ttf`, `assets/OFL.txt`: PDF 한글 폰트와 라이선스.
