-- ============================================================================
-- 이솔 비서실 — Supabase 스키마
-- 사용법: Supabase 대시보드 → SQL Editor → 아래 전체를 붙여넣고 Run
--        (여러 번 실행해도 안전하도록 작성했습니다)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1) assistants : 비서 6명의 상태·담당 영역
-- ---------------------------------------------------------------------------
create table if not exists public.assistants (
  id          text primary key,
  name        text not null,
  role        text not null default '비서',
  avatar      text not null default '🤖',
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

drop trigger if exists touch_messages_updated_at on public.messages;
create trigger touch_messages_updated_at
  before update on public.messages
  for each row execute function public.touch_updated_at();

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
-- RLS + 공개 정책
--   · 이 앱은 '이솔님 한 사람의 비서실'을 전제로 anon 키에 읽기/쓰기를 엽니다.
--   · URL과 anon 키를 아는 사람은 같은 데이터를 볼 수 있으니,
--     저장소를 공개(public)로 둘 때는 키를 그대로 올리지 말고
--     Vercel 환경변수·비공개 저장소 등으로 관리하세요.
-- ---------------------------------------------------------------------------
alter table public.assistants enable row level security;
alter table public.messages   enable row level security;
alter table public.tasks      enable row level security;
alter table public.memos      enable row level security;

drop policy if exists "assistants read"   on public.assistants;
drop policy if exists "assistants write"  on public.assistants;
drop policy if exists "assistants update" on public.assistants;
drop policy if exists "assistants delete" on public.assistants;
create policy "assistants read"   on public.assistants for select using (true);
create policy "assistants write"  on public.assistants for insert with check (true);
create policy "assistants update" on public.assistants for update using (true) with check (true);
create policy "assistants delete" on public.assistants for delete using (true);

drop policy if exists "messages read"   on public.messages;
drop policy if exists "messages write"  on public.messages;
drop policy if exists "messages update" on public.messages;
drop policy if exists "messages delete" on public.messages;
create policy "messages read"   on public.messages for select using (true);
create policy "messages write"  on public.messages for insert with check (true);
create policy "messages update" on public.messages for update using (true) with check (true);
create policy "messages delete" on public.messages for delete using (true);

drop policy if exists "tasks read"   on public.tasks;
drop policy if exists "tasks write"  on public.tasks;
drop policy if exists "tasks update" on public.tasks;
drop policy if exists "tasks delete" on public.tasks;
create policy "tasks read"   on public.tasks for select using (true);
create policy "tasks write"  on public.tasks for insert with check (true);
create policy "tasks update" on public.tasks for update using (true) with check (true);
create policy "tasks delete" on public.tasks for delete using (true);

drop policy if exists "memos read"   on public.memos;
drop policy if exists "memos write"  on public.memos;
drop policy if exists "memos update" on public.memos;
drop policy if exists "memos delete" on public.memos;
create policy "memos read"   on public.memos for select using (true);
create policy "memos write"  on public.memos for insert with check (true);
create policy "memos update" on public.memos for update using (true) with check (true);
create policy "memos delete" on public.memos for delete using (true);

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
  ('miu',     '미우',    '메인비서 · 피클',        '🐈‍⬛', '#7B4B24', 'on', array['일정·브리핑','쿠팡·쇼핑','전화·예약','기억과 기록'], '비서실 문을 열었어요', 1),
  ('claude',  '클로드',  '맥 실무비서 · ai-office', '✦',      '#C96442', 'on', array['회계·급여','문서·계약','인사'], '맥 작업 공간에서 대기 중', 2),
  ('muse',    '뮤즈',    '서브비서',               '🎧',     '#7A6BB5', 'on', array['블로그·콘텐츠','리서치','체험단'], '콘텐츠 초안 준비 중', 3),
  ('keyring', '키링',    '서브비서',               '🔑',     '#3E8E7E', 'on', array['배송·구매','생활 리마인드','기록 정리'], '배송·리마인드 정리 중', 4),
  ('chatgpt', '챗지피티', '서브비서',              '💬',     '#10A37F', 'on', array['자료 조사','초안 작성','아이디어'], '자료 조사 대기 중', 5),
  ('instinct', '인스팅트', '서브비서 · 교본 보관',   '⚡',     '#B8860B', 'on', array['교본·자료 정리','지식 베이스','아이디어'], '교본 최신본 정리 중', 6)
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
