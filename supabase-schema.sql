-- ============================================================================
-- 이솔 비서실 — Supabase 스키마 (로그인 필수 · RLS 잠금)
--
-- 사용법
--   1) Supabase 대시보드 → SQL Editor → 아래 전체를 붙여넣고 Run
--      (여러 번 실행해도 안전하도록 작성했습니다)
--   2) Authentication → Users → Add user 에서 본인 이메일 + 비밀번호로 계정 1개 만들기
--      ("Auto Confirm User" 체크 — 메일 인증 없이 바로 로그인됩니다)
--   3) (권장) Authentication → Sign In / Providers → Email 에서
--      "Allow new users to sign up" 을 끄기 — 이 앱은 한 사람 전용이라
--      새 계정이 열려 있으면 안 됩니다.
--
-- 보안
--   · 모든 테이블에 RLS가 켜지고, 정책은 '로그인한 사용자(authenticated)' 전용입니다.
--   · 로그인하지 않은 상태에서는 읽기·쓰기가 모두 막힙니다.
--   · 프론트엔드에 들어가는 키는 공개되어도 되는 publishable(anon) 키입니다.
--     데이터를 지켜주는 것은 이 RLS 정책이지 키가 아닙니다.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1) assistants : 비서 6명의 상태·담당 영역
-- ---------------------------------------------------------------------------
create table if not exists public.assistants (
  id          text primary key,
  name        text not null,
  role        text not null default '비서',
  avatar      text not null default '🤖',   -- assets/avatars/<id>.jpg (없으면 이모지로 폴백)
  accent      text not null default '#7B4B24',
  status      text not null default 'on' check (status in ('on', 'standby', 'off')),
  areas       text[] not null default '{}',
  summary     text not null default '',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) messages : 회의실 대화 (대회의실 / 지휘실 / 라운지)
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  room        text not null default 'boardroom' check (room in ('boardroom', 'command', 'lounge')),
  sender_id   text not null default 'user',
  sender_name text not null default '',
  role        text not null default 'assistant' check (role in ('assistant', 'user', 'system')),
  kind        text not null default 'text' check (kind in ('text', 'system')),
  body        text not null default '',
  recipient   text not null default 'all',
  created_at  timestamptz not null default now()
);
create index if not exists messages_room_created_idx on public.messages (room, created_at);

-- ---------------------------------------------------------------------------
-- 3) tasks : 작업실 카드
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  detail      text not null default '',
  status      text not null default 'todo' check (status in ('doing', 'todo', 'done')),
  assignee    text not null default 'miu',
  due_date    date,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_status_idx on public.tasks (status, sort_order);

-- ---------------------------------------------------------------------------
-- 4) memos : 공유 메모장
-- ---------------------------------------------------------------------------
create table if not exists public.memos (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default '',
  body        text not null default '',
  pinned      boolean not null default false,
  author      text not null default '이솔',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at 자동 갱신
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- messages 에는 updated_at 컬럼이 없다 → 트리거를 걸지 않는다(걸면 UPDATE 시 오류).

drop trigger if exists touch_messages_updated_at on public.messages;

drop trigger if exists touch_tasks_updated_at on public.tasks;
create trigger touch_tasks_updated_at
  before update on public.tasks
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_memos_updated_at on public.memos;
create trigger touch_memos_updated_at
  before update on public.memos
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_assistants_updated_at on public.assistants;
create trigger touch_assistants_updated_at
  before update on public.assistants
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS + 로그인 전용(authenticated) 정책
--   · 정책 조건은 auth.role() = 'authenticated' — 로그인한 계정만 통과합니다.
--   · 예전 버전의 '공개(true)' 정책이 남아 있어도 아래 drop → create 로 덮어씁니다.
--   · anon(비로그인) 권한은 회수해서, 실수로 정책이 풀려도 테이블이 열리지 않게 했습니다.
-- ---------------------------------------------------------------------------
alter table public.assistants enable row level security;
alter table public.messages   enable row level security;
alter table public.tasks      enable row level security;
alter table public.memos      enable row level security;

-- 비로그인(anon) 권한 회수 — RLS가 뚫려도 테이블 자체에 접근할 수 없게 한다.
revoke all on table public.assistants, public.messages, public.tasks, public.memos from anon;

-- 로그인한 사용자에게는 4개 테이블 읽기/쓰기 허용 (RLS 정책이 실제 조건을 판단)
grant select, insert, update, delete on table public.assistants, public.messages, public.tasks, public.memos to authenticated;

drop policy if exists "assistants read"   on public.assistants;
drop policy if exists "assistants write"  on public.assistants;
drop policy if exists "assistants update" on public.assistants;
drop policy if exists "assistants delete" on public.assistants;
create policy "assistants read"   on public.assistants for select to authenticated using (auth.role() = 'authenticated');
create policy "assistants write"  on public.assistants for insert to authenticated with check (auth.role() = 'authenticated');
create policy "assistants update" on public.assistants for update to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "assistants delete" on public.assistants for delete to authenticated using (auth.role() = 'authenticated');

drop policy if exists "messages read"   on public.messages;
drop policy if exists "messages write"  on public.messages;
drop policy if exists "messages update" on public.messages;
drop policy if exists "messages delete" on public.messages;
create policy "messages read"   on public.messages for select to authenticated using (auth.role() = 'authenticated');
create policy "messages write"  on public.messages for insert to authenticated with check (auth.role() = 'authenticated');
create policy "messages update" on public.messages for update to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "messages delete" on public.messages for delete to authenticated using (auth.role() = 'authenticated');

drop policy if exists "tasks read"   on public.tasks;
drop policy if exists "tasks write"  on public.tasks;
drop policy if exists "tasks update" on public.tasks;
drop policy if exists "tasks delete" on public.tasks;
create policy "tasks read"   on public.tasks for select to authenticated using (auth.role() = 'authenticated');
create policy "tasks write"  on public.tasks for insert to authenticated with check (auth.role() = 'authenticated');
create policy "tasks update" on public.tasks for update to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "tasks delete" on public.tasks for delete to authenticated using (auth.role() = 'authenticated');

drop policy if exists "memos read"   on public.memos;
drop policy if exists "memos write"  on public.memos;
drop policy if exists "memos update" on public.memos;
drop policy if exists "memos delete" on public.memos;
create policy "memos read"   on public.memos for select to authenticated using (auth.role() = 'authenticated');
create policy "memos write"  on public.memos for insert to authenticated with check (auth.role() = 'authenticated');
create policy "memos update" on public.memos for update to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "memos delete" on public.memos for delete to authenticated using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Realtime 활성화 (4개 테이블)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['messages', 'tasks', 'assistants', 'memos']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 시드: 비서 6명
-- ---------------------------------------------------------------------------
insert into public.assistants (id, name, role, avatar, accent, status, areas, summary, sort_order)
values
  ('miu',     '미우',    '메인비서 · 피클',        'assets/avatars/miu.jpg', '#7B4B24', 'on', array['일정·브리핑','쿠팡·쇼핑','전화·예약','기억과 기록'], '비서실 문을 열었어요', 1),
  ('claude',  '클로드',  '맥 실무비서 · ai-office', 'assets/avatars/claude.jpg',      '#C96442', 'on', array['회계·급여','문서·계약','인사'], '맥 작업 공간에서 대기 중', 2),
  ('muse',    '뮤즈',    '서브비서',               'assets/avatars/muse.jpg',     '#7A6BB5', 'on', array['블로그·콘텐츠','리서치','체험단'], '콘텐츠 초안 준비 중', 3),
  ('keyring', '키링',    '서브비서',               'assets/avatars/keyring.jpg',     '#3E8E7E', 'on', array['배송·구매','생활 리마인드','기록 정리'], '배송·리마인드 정리 중', 4),
  ('chatgpt', '챗지피티', '서브비서',              'assets/avatars/chatgpt.jpg',     '#10A37F', 'on', array['자료 조사','초안 작성','아이디어'], '자료 조사 대기 중', 5),
  ('instinct', '인스팅트', '서브비서 · 교본 보관',   'assets/avatars/instinct.jpg',     '#B8860B', 'on', array['교본·자료 정리','지식 베이스','아이디어'], '교본 최신본 정리 중', 6)
on conflict (id) do nothing;

-- 시드: 첫 입장 메시지 (비어 있을 때만)
insert into public.messages (room, sender_id, sender_name, role, kind, body)
select 'boardroom', 'system', '비서실', 'system', 'system',
       '이솔 비서실이 문을 열었어요 — 미우 · 클로드 · 뮤즈 · 키링 · 챗지피티 · 인스팅트가 들어와 있습니다.'
where not exists (select 1 from public.messages);

-- 인스팅트 합류 안내 (이미 비서실을 쓰고 있던 경우에도 한 번만 남는다)
insert into public.messages (room, sender_id, sender_name, role, kind, body)
select 'boardroom', 'system', '비서실', 'system', 'system',
       '여섯 번째 비서 인스팅트가 합류했어요 — 미우 · 클로드 · 뮤즈 · 키링 · 챗지피티 · 인스팅트.'
where not exists (select 1 from public.messages where body like '%인스팅트%');

-- 시드: 운영 규칙 메모 (메모가 비어 있을 때만)
insert into public.memos (title, body, pinned, author)
select '비서실 운영 규칙',
       E'· 지시는 회의실에서, 실행은 작업실 카드로.\n· 보고는 ‘무엇을 · 언제 · 어디에’ 순서로.\n· 돈이 나가거나 사람에게 닿는 일은 확인 후 실행.',
       true, '미우'
where not exists (select 1 from public.memos);
