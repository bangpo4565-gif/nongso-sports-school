-- 농소스포츠스쿨 데이터베이스 설정
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여 넣고 Run 을 누르세요.
-- 여러 번 실행해도 괜찮아요 (이미 있는 표는 그대로 두고, 함수만 새로 바꿔요).
--
-- 누가 무엇을 하나
--  * 관리교사(owner): 맨 처음 가입한 선생님. 모든 설정, 선생님 승인.
--  * 선생님(teacher): 관리교사가 승인한 선생님. 명단, QR 출석, 미션, 레이스.
--  * 승인 대기(pending): 아무것도 볼 수 없어요.
--  * 학생: Supabase 계정 없이, 학번 + 비밀번호로 아래 student_* 함수만 써요.
--    처음에는 이름 + 학번이 명단과 맞아야 비밀번호를 만들 수 있어요.
-- 표는 직접 쓰지 못하게 막고(RLS), 모든 기록은 함수 안에서 서버 시계로 남겨요.

create extension if not exists pgcrypto;

-- ---------- 표 ----------
create table if not exists settings (
  id int primary key default 1 check (id = 1),
  school text not null default '농소스포츠스쿨',
  qr_seconds int not null default 30 check (qr_seconds between 10 and 120),
  geo_lat double precision,             -- 위치 인증 기준점 (비어 있으면 위치 인증을 하지 않아요)
  geo_lng double precision,
  geo_radius_m int not null default 80,
  race_program_id int,                  -- 학급 레이스에 세는 프로그램 (보통 아침 운동)
  race_from date,
  race_to date,
  prizes jsonb not null default '["피자","햄버거 · 핫도그","과자 · 간식"]'
);
insert into settings (id) values (1) on conflict do nothing;

create table if not exists teachers (
  id uuid primary key references auth.users on delete cascade,
  email text,
  name text not null default '',
  role text not null default 'pending' check (role in ('owner', 'teacher', 'pending')),
  created_at timestamptz not null default now()
);

-- 명단은 학년·반·번호·이름 4가지만 받아요. 학번 = 학년 1자리 + 반 2자리 + 번호 2자리
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  student_no text not null unique,
  grade int not null,
  class int not null,
  num int not null,
  name text not null,
  xp int not null default 0,
  active boolean not null default true,
  signed_up_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists students_grade_class on students (grade, class);
-- 학생: 학번 5자리(학년+반2+번호2). 함께 운동하는 선생님: 학년·반 0, 교사번호 9로 시작하는 5자리(90001~)
alter table students drop constraint if exists students_student_no_check;
alter table students drop constraint if exists students_grade_check;
alter table students drop constraint if exists students_class_check;
alter table students drop constraint if exists students_num_check;
alter table students add constraint students_student_no_check check (student_no ~ '^([1-3][0-9]{4}|9[0-9]{4})$');
alter table students add constraint students_grade_check check (grade between 0 and 3);
alter table students add constraint students_class_check check (class between 0 and 20);
alter table students add constraint students_num_check check (num between 1 and 9999);

create table if not exists student_secrets (
  student_id uuid primary key references students on delete cascade,
  pw_hash text,
  fails int not null default 0,
  locked_until timestamptz
);
create table if not exists student_sessions (
  token uuid primary key default gen_random_uuid(),
  student_id uuid not null references students on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '180 days'
);

create table if not exists programs (
  id serial primary key,
  name text not null,
  min_seconds int not null check (min_seconds between 10 and 7200),
  xp int not null default 10 check (xp between 0 and 200),
  geo boolean not null default false,
  active boolean not null default true,
  sort int not null default 0
);
insert into programs (id, name, min_seconds, xp, geo, sort)
select * from (values (1, '아침 운동', 600, 30, true, 1), (2, '점심 운동', 300, 20, true, 2), (3, '특별 프로그램', 180, 15, false, 3), (4, '체험 테스트', 20, 0, false, 9)) v
where not exists (select 1 from programs);
select setval('programs_id_seq', greatest((select max(id) from programs), 1));
update settings set race_program_id = 1 where id = 1 and race_program_id is null;
-- 학급 레이스에 함께 세는 프로그램 (설정의 세는 프로그램은 늘 들어가요)
alter table programs add column if not exists in_race boolean not null default false;
-- 시작 QR 한 번만 찍으면 바로 인정 (끄면 시작 QR + 최소 시간 뒤 완료 QR)
alter table programs add column if not exists one_scan boolean not null default true;
create or replace function race_prog(p_program int) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_program = (select race_program_id from settings where id = 1) or exists (select 1 from programs where id = p_program and in_race)
$$;

-- QR 출석 세션. 비밀값은 아무도 직접 못 읽어요
create table if not exists qr_sessions (
  id uuid primary key default gen_random_uuid(),
  program_id int not null references programs,
  target_grade int check (target_grade between 1 and 3),   -- 비어 있으면 전교생
  day date not null default (now() at time zone 'Asia/Seoul')::date,
  opened_by uuid references teachers on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create table if not exists qr_secrets (
  session_id uuid primary key references qr_sessions on delete cascade,
  secret text not null default encode(gen_random_bytes(32), 'hex')
);

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references qr_sessions on delete cascade,
  student_id uuid not null references students on delete cascade,
  state text not null check (state in ('ACTIVE', 'COMPLETED', 'FAILED', 'MANUAL')),
  in_at timestamptz,
  out_at timestamptz,
  device_id text,
  xp int not null default 0,
  manual_by uuid references teachers on delete set null,
  unique (session_id, student_id)
);
create unique index if not exists attendance_device_once on attendance (session_id, device_id) where device_id is not null;

create table if not exists xp_ledger (
  id bigserial primary key,
  student_id uuid not null references students on delete cascade,
  amount int not null,
  reason text not null,
  ref text,
  created_by uuid references teachers on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists xp_ledger_student on xp_ledger (student_id, created_at desc);

create table if not exists missions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('walk', 'squat', 'pushup', 'lunge', 'jack', 'plank')),
  goal int not null check (goal between 1 and 100000),
  xp int not null default 20 check (xp between 0 and 200),
  target_grade int check (target_grade between 0 and 3),   -- 비어 있으면 전교생+선생님, 0이면 선생님만
  target_class int check (target_class between 1 and 20),
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null,
  created_by uuid references teachers on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists mission_subs (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions on delete cascade,
  student_id uuid not null references students on delete cascade,
  value int not null,
  secs int,
  method text not null check (method in ('sensor', 'pose')),
  flagged boolean not null default false,
  submitted_at timestamptz not null default now(),
  unique (mission_id, student_id)
);

-- PAPS(학생건강체력평가) 기록. 학생, 학년도, 회차, 종목, 기록, 등급만 남겨요 (성별·생년월일·키·몸무게는 저장하지 않아요)
create table if not exists paps_records (
  id bigserial primary key,
  student_id uuid not null references students on delete cascade,
  year int not null check (year between 2015 and 2100),
  round int not null default 1 check (round between 1 and 4),
  item text not null check (item ~ '^[a-z0-9_]{2,20}$'),
  value numeric(7,2) not null,
  grade_level int check (grade_level between 1 and 5),
  entered_by uuid references teachers on delete set null,
  updated_at timestamptz not null default now(),
  unique (student_id, year, round, item)
);

-- ---------- 권한 도우미 ----------
create or replace function my_role() returns text language sql stable security definer set search_path = public, extensions as
$$ select role from teachers where id = auth.uid() $$;
create or replace function is_staff() returns boolean language sql stable security definer set search_path = public, extensions as
$$ select coalesce((select role in ('owner', 'teacher') from teachers where id = auth.uid()), false) $$;
create or replace function is_owner() returns boolean language sql stable security definer set search_path = public, extensions as
$$ select coalesce((select role = 'owner' from teachers where id = auth.uid()), false) $$;
create or replace function need_staff() returns void language plpgsql stable security definer set search_path = public, extensions as
$$ begin if not is_staff() then raise exception 'not_staff'; end if; end $$;
create or replace function seoul_today() returns date language sql stable as
$$ select (now() at time zone 'Asia/Seoul')::date $$;

-- 선생님 가입: 맨 처음 가입한 사람이 관리교사, 나머지는 승인 대기
create or replace function handle_new_teacher() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into teachers (id, email, name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', ''),
          case when exists (select 1 from teachers where role = 'owner') then 'pending' else 'owner' end)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_teacher();

-- 관리교사가 한 명은 꼭 남아 있게
create or replace function keep_an_owner() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.role = 'owner' and new.role <> 'owner' and not exists (select 1 from teachers where role = 'owner' and id <> old.id) then
    raise exception 'last_owner';
  end if;
  return new;
end $$;
drop trigger if exists keep_owner on teachers;
create trigger keep_owner before update on teachers for each row execute function keep_an_owner();

-- ---------- 표 접근 규칙 ----------
alter table settings enable row level security;
alter table teachers enable row level security;
alter table students enable row level security;
alter table student_secrets enable row level security;
alter table student_sessions enable row level security;
alter table programs enable row level security;
alter table qr_sessions enable row level security;
alter table qr_secrets enable row level security;
alter table attendance enable row level security;
alter table xp_ledger enable row level security;
alter table missions enable row level security;
alter table mission_subs enable row level security;
alter table paps_records enable row level security;

drop policy if exists settings_read on settings;   create policy settings_read on settings for select using (is_staff());
drop policy if exists settings_write on settings;  create policy settings_write on settings for update using (is_owner()) with check (is_owner());
drop policy if exists teachers_read on teachers;   create policy teachers_read on teachers for select using (is_staff() or id = auth.uid());
drop policy if exists teachers_write on teachers;  create policy teachers_write on teachers for update using (is_owner()) with check (is_owner());
drop policy if exists teachers_del on teachers;    create policy teachers_del on teachers for delete using (is_owner() and id <> auth.uid());
drop policy if exists students_read on students;   create policy students_read on students for select using (is_staff());
drop policy if exists programs_read on programs;   create policy programs_read on programs for select using (is_staff());
drop policy if exists programs_write on programs;  create policy programs_write on programs for all using (is_staff()) with check (is_staff());
drop policy if exists qrs_read on qr_sessions;     create policy qrs_read on qr_sessions for select using (is_staff());
drop policy if exists att_read on attendance;      create policy att_read on attendance for select using (is_staff());
drop policy if exists xp_read on xp_ledger;        create policy xp_read on xp_ledger for select using (is_staff());
drop policy if exists missions_read on missions;   create policy missions_read on missions for select using (is_staff());
drop policy if exists msubs_read on mission_subs;  create policy msubs_read on mission_subs for select using (is_staff());
drop policy if exists paps_read on paps_records;   create policy paps_read on paps_records for select using (is_staff());
-- student_secrets, student_sessions, qr_secrets 는 규칙이 없어서 아무도 직접 읽거나 쓸 수 없어요.

-- ---------- XP ----------
create or replace function give_xp(p_student uuid, p_amount int, p_reason text, p_ref text, p_by uuid default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_amount = 0 then return; end if;
  insert into xp_ledger (student_id, amount, reason, ref, created_by) values (p_student, p_amount, p_reason, p_ref, p_by);
  update students set xp = greatest(0, xp + p_amount) where id = p_student;
end $$;

-- ---------- 학생 로그인 ----------
create or replace function session_student(p_token uuid) returns students
language plpgsql stable security definer set search_path = public, extensions as $$
declare s students;
begin
  select st.* into s from student_sessions ss join students st on st.id = ss.student_id
  where ss.token = p_token and ss.expires_at > now() and st.active;
  if not found then raise exception 'session_expired'; end if;
  return s;
end $$;

create or replace function student_fail(sid uuid) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into student_secrets (student_id, fails) values (sid, 1)
  on conflict (student_id) do update set
    fails = case when student_secrets.fails + 1 >= 5 then 0 else student_secrets.fails + 1 end,
    locked_until = case when student_secrets.fails + 1 >= 5 then now() + interval '10 minutes' else student_secrets.locked_until end;
  return json_build_object('error', 'login_failed');
end $$;

create or replace function student_new_session(sid uuid) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare tok uuid;
begin
  update student_secrets set fails = 0, locked_until = null where student_id = sid;
  delete from student_sessions where student_id = sid and expires_at < now();
  insert into student_sessions (student_id) values (sid) returning token into tok;
  return json_build_object('token', tok);
end $$;

-- 로그인: 학번 + 비밀번호. 실패는 오류 대신 {error} 로 돌려줘요 (오류를 내면 실패 횟수도 취소돼서)
create or replace function student_login(p_no text, p_pw text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s students; sec student_secrets;
begin
  select * into s from students where student_no = trim(p_no) and active;
  if not found then return json_build_object('error', 'login_failed'); end if;
  select * into sec from student_secrets where student_id = s.id;
  if sec.locked_until is not null and sec.locked_until > now() then return json_build_object('error', 'locked'); end if;
  if sec.pw_hash is null then return json_build_object('error', 'not_signed_up'); end if;
  if sec.pw_hash <> crypt(coalesce(p_pw, ''), sec.pw_hash) then return student_fail(s.id); end if;
  return student_new_session(s.id);
end $$;

-- 처음 가입: 이름 + 학번이 명단과 맞고, 아직 아무도 비밀번호를 만들지 않았을 때만
create or replace function student_signup(p_no text, p_name text, p_pw text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s students; sec student_secrets;
begin
  select * into s from students where student_no = trim(p_no) and active;
  if not found then return json_build_object('error', 'no_match'); end if;
  select * into sec from student_secrets where student_id = s.id;
  if sec.locked_until is not null and sec.locked_until > now() then return json_build_object('error', 'locked'); end if;
  if regexp_replace(s.name, '\s', '', 'g') <> regexp_replace(coalesce(p_name, ''), '\s', '', 'g') then
    perform student_fail(s.id);
    return json_build_object('error', 'no_match');
  end if;
  if sec.pw_hash is not null then return json_build_object('error', 'already'); end if;
  if p_pw is null or length(p_pw) < 8 or length(p_pw) > 64 then return json_build_object('error', 'pw_format'); end if;
  insert into student_secrets (student_id, pw_hash) values (s.id, crypt(p_pw, gen_salt('bf')))
  on conflict (student_id) do update set pw_hash = excluded.pw_hash;
  update students set signed_up_at = now() where id = s.id;
  return student_new_session(s.id);
end $$;

create or replace function student_logout(p_token uuid) returns void language sql security definer set search_path = public, extensions as
$$ delete from student_sessions where token = p_token $$;

create or replace function student_change_pw(p_token uuid, p_old text, p_new text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s students; h text;
begin
  s := session_student(p_token);
  select pw_hash into h from student_secrets where student_id = s.id;
  if h is null or h <> crypt(coalesce(p_old, ''), h) then return json_build_object('error', 'wrong_pw'); end if;
  if p_new is null or length(p_new) < 8 or length(p_new) > 64 then return json_build_object('error', 'pw_format'); end if;
  update student_secrets set pw_hash = crypt(p_new, gen_salt('bf')) where student_id = s.id;
  delete from student_sessions where student_id = s.id and token <> p_token;
  return json_build_object('ok', true);
end $$;

-- ---------- 학급 레이스 ----------
-- 반별 참여율 = 기간 안 레이스 프로그램 완료(COMPLETED·MANUAL) 수 ÷ (반 인원 × 운영한 날 수). 이름은 내보내지 않아요.
create or replace function race_board(p_grade int) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare st settings; days int;
begin
  select * into st from settings where id = 1;
  select count(distinct q.day) into days from qr_sessions q
  where race_prog(q.program_id) and (q.target_grade is null or q.target_grade = p_grade)
    and (st.race_from is null or q.day >= st.race_from) and (st.race_to is null or q.day <= st.race_to);
  return json_build_object(
    'grade', p_grade, 'days', days, 'from', st.race_from, 'to', st.race_to, 'prizes', st.prizes,
    'program', (select string_agg(name, ' · ' order by sort, id) from programs where race_prog(id)),
    'rows', coalesce((
      select json_agg(r order by r.rate desc, r.class) from (
        select c.class, c.n, coalesce(p.cnt, 0) as parts,
               case when c.n * greatest(days, 1) = 0 then 0 else round(coalesce(p.cnt, 0)::numeric / (c.n * greatest(days, 1)), 4) end as rate
        from (select class, count(*) as n from students where grade = p_grade and active group by class) c
        left join (
          select s.class, count(distinct (a.student_id, q.day)) as cnt from attendance a
          join qr_sessions q on q.id = a.session_id
          join students s on s.id = a.student_id
          where a.state in ('COMPLETED', 'MANUAL') and race_prog(q.program_id) and s.grade = p_grade
            and (st.race_from is null or q.day >= st.race_from) and (st.race_to is null or q.day <= st.race_to)
          group by s.class) p on p.class = c.class
      ) r), '[]'));
end $$;

-- ---------- 학생 화면 ----------
create or replace function student_home(p_token uuid) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare s students; today date := seoul_today();
begin
  s := session_student(p_token);
  return json_build_object(
    'me', json_build_object('id', s.id, 'no', s.student_no, 'grade', s.grade, 'class', s.class, 'num', s.num, 'name', s.name, 'xp', s.xp),
    'school', (select school from settings where id = 1),
    'now', now(),
    'week_count', (select count(*) from attendance a join qr_sessions q on q.id = a.session_id
                   where a.student_id = s.id and a.state in ('COMPLETED', 'MANUAL') and q.day > today - 7),
    'total_count', (select count(*) from attendance where student_id = s.id and state in ('COMPLETED', 'MANUAL')),
    'open', coalesce((
      select json_agg(json_build_object('id', q.id, 'program', p.name, 'min_seconds', p.min_seconds, 'xp', p.xp, 'geo', p.geo, 'one_scan', p.one_scan,
        'mine', (select json_build_object('state', a.state, 'in_at', a.in_at, 'out_at', a.out_at, 'xp', a.xp) from attendance a where a.session_id = q.id and a.student_id = s.id))
        order by q.opened_at)
      from qr_sessions q join programs p on p.id = q.program_id
      where q.closed_at is null and q.day = today and (q.target_grade is null or q.target_grade = s.grade or s.grade = 0)), '[]'),
    'missions', coalesce((
      select json_agg(json_build_object('id', m.id, 'kind', m.kind, 'goal', m.goal, 'xp', m.xp, 'opens_at', m.opens_at, 'closes_at', m.closes_at,
        'target_grade', m.target_grade, 'target_class', m.target_class,
        'done', (select json_build_object('value', ms.value, 'secs', ms.secs, 'at', ms.submitted_at) from mission_subs ms where ms.mission_id = m.id and ms.student_id = s.id))
        order by m.closes_at)
      from missions m
      where (m.target_grade is null or m.target_grade = s.grade) and (m.target_class is null or m.target_class = s.class)
        and m.closes_at > now() - interval '3 days'), '[]'));
end $$;

create or replace function student_history(p_token uuid) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare s students;
begin
  s := session_student(p_token);
  return json_build_object(
    'attendance', coalesce((select json_agg(x) from (
      select q.day, p.name as program, a.state, a.xp, a.in_at, a.out_at from attendance a
      join qr_sessions q on q.id = a.session_id join programs p on p.id = q.program_id
      where a.student_id = s.id order by coalesce(a.in_at, q.opened_at) desc limit 100) x), '[]'),
    'xp', coalesce((select json_agg(x) from (
      select amount, reason, created_at from xp_ledger where student_id = s.id order by created_at desc limit 100) x), '[]'));
end $$;

create or replace function mask_name(p text) returns text language sql immutable as $$
  select case when length(n) <= 1 then n when length(n) = 2 then left(n, 1) || '*'
              else left(n, 1) || repeat('*', length(n) - 2) || right(n, 1) end
  from (select regexp_replace(coalesce(p, ''), '\s', '', 'g') as n) x $$;

-- 개인 순위: 같은 학년 XP 순위. 이름 가운데 글자는 가려서 보내요
create or replace function student_rank(p_token uuid) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare s students;
begin
  s := session_student(p_token);
  return json_build_object(
    'top', coalesce((select json_agg(x) from (
      select rank() over (order by xp desc) as rank, class,
             case when s.grade = 0 then regexp_replace(name, '\s', '', 'g') else mask_name(name) end as name,
             xp, id = s.id as me
      from students where grade = s.grade and active order by xp desc limit 20) x), '[]'),
    'my_rank', (select count(*) + 1 from students where grade = s.grade and active and xp > s.xp),
    'total', (select count(*) from students where grade = s.grade and active));
end $$;

create or replace function student_race(p_token uuid, p_grade int) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare s students;
begin
  s := session_student(p_token);
  return race_board(coalesce(p_grade, s.grade));
end $$;

-- ---------- QR 출석 ----------
create or replace function qr_window() returns bigint language sql stable as
$$ select floor(extract(epoch from now()) / (select qr_seconds from settings where id = 1))::bigint $$;
create or replace function qr_code_for(p_session uuid, p_mode text, p_window bigint) returns text
language sql stable security definer set search_path = public, extensions as $$
  select substr(encode(hmac(p_mode || ':' || p_window::text, (select secret from qr_secrets where session_id = p_session), 'sha256'), 'hex'), 1, 16)
$$;

create or replace function admin_open_session(p_program int, p_grade int) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare sid uuid;
begin
  perform need_staff();
  if not exists (select 1 from programs where id = p_program and active) then raise exception 'bad_program'; end if;
  insert into qr_sessions (program_id, target_grade, opened_by) values (p_program, p_grade, auth.uid()) returning id into sid;
  insert into qr_secrets (session_id) values (sid);
  return sid;
end $$;

-- 세션 닫기: 아직 CHECK-OUT 안 한 ACTIVE 는 FAILED 가 돼요
create or replace function admin_close_session(p_session uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  perform need_staff();
  update qr_sessions set closed_at = now() where id = p_session and closed_at is null;
  update attendance set state = 'FAILED' where session_id = p_session and state = 'ACTIVE';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function admin_reopen_session(p_session uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  update qr_sessions set closed_at = null where id = p_session and day = seoul_today();
end $$;

-- TV 화면에 띄울 QR 값: "세션.모드.코드" (30초마다 바뀌어요)
create or replace function admin_qr(p_session uuid, p_mode text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare w bigint := qr_window(); sec int := (select qr_seconds from settings where id = 1);
begin
  perform need_staff();
  if p_mode not in ('in', 'out') then raise exception 'bad_mode'; end if;
  if not exists (select 1 from qr_sessions where id = p_session and closed_at is null) then raise exception 'session_closed'; end if;
  return json_build_object('payload', 'NS1.' || p_session || '.' || p_mode || '.' || qr_code_for(p_session, p_mode, w),
                           'left', sec - (extract(epoch from now())::numeric % sec), 'seconds', sec);
end $$;

-- 학생이 QR을 찍었을 때. 시간은 모두 서버 시계로 재요.
create or replace function student_scan(p_token uuid, p_payload text, p_device text, p_lat double precision default null, p_lng double precision default null) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  s students; parts text[]; sid uuid; mode text; code text; q qr_sessions; p programs; st settings; a attendance;
  w bigint := qr_window(); dist double precision; elapsed numeric;
begin
  s := session_student(p_token);
  parts := string_to_array(coalesce(p_payload, ''), '.');
  if array_length(parts, 1) <> 4 or parts[1] <> 'NS1' then return json_build_object('error', 'bad_qr'); end if;
  begin sid := parts[2]::uuid; exception when others then return json_build_object('error', 'bad_qr'); end;
  mode := parts[3]; code := parts[4];
  if mode not in ('in', 'out') then return json_build_object('error', 'bad_qr'); end if;
  select * into q from qr_sessions where id = sid;
  if not found then return json_build_object('error', 'bad_qr'); end if;
  if q.closed_at is not null or q.day <> seoul_today() then return json_build_object('error', 'session_closed'); end if;
  if q.target_grade is not null and q.target_grade <> s.grade and s.grade <> 0 then return json_build_object('error', 'not_target'); end if;
  if code <> qr_code_for(sid, mode, w) and code <> qr_code_for(sid, mode, w - 1) then return json_build_object('error', 'expired'); end if;
  select * into p from programs where id = q.program_id;
  select * into st from settings where id = 1;
  if p.geo and st.geo_lat is not null then
    if p_lat is null or p_lng is null then return json_build_object('error', 'need_location'); end if;
    dist := 6371000 * 2 * asin(sqrt(power(sin(radians(p_lat - st.geo_lat) / 2), 2)
            + cos(radians(st.geo_lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - st.geo_lng) / 2), 2)));
    if dist > st.geo_radius_m then return json_build_object('error', 'too_far', 'meters', round(dist)); end if;
  end if;
  select * into a from attendance where session_id = sid and student_id = s.id;
  if mode = 'in' then
    if found then
      return json_build_object('error', case when a.state = 'ACTIVE' then 'already_in' else 'already_done' end, 'state', a.state);
    end if;
    if p_device is not null and exists (select 1 from attendance where session_id = sid and device_id = p_device) then
      return json_build_object('error', 'device_used');
    end if;
    if p.one_scan then
      insert into attendance (session_id, student_id, state, in_at, out_at, xp, device_id) values (sid, s.id, 'COMPLETED', now(), now(), p.xp, p_device) returning * into a;
      perform give_xp(s.id, p.xp, p.name || ' 출석', 'att:' || a.id);
      return json_build_object('ok', true, 'state', 'COMPLETED', 'xp', p.xp, 'secs', 0, 'one_scan', true, 'total_xp', (select xp from students where id = s.id));
    end if;
    insert into attendance (session_id, student_id, state, in_at, device_id) values (sid, s.id, 'ACTIVE', now(), p_device) returning * into a;
    return json_build_object('ok', true, 'state', 'ACTIVE', 'in_at', a.in_at, 'min_seconds', p.min_seconds, 'program', p.name);
  end if;
  -- CHECK-OUT
  if not found or a.state <> 'ACTIVE' then
    return json_build_object('error', case when not found then 'not_in' else 'already_done' end);
  end if;
  if a.device_id is not null and p_device is distinct from a.device_id then return json_build_object('error', 'other_device'); end if;
  elapsed := extract(epoch from now() - a.in_at);
  if elapsed < p.min_seconds then return json_build_object('error', 'too_early', 'left', ceil(p.min_seconds - elapsed)); end if;
  update attendance set state = 'COMPLETED', out_at = now(), xp = p.xp where id = a.id;
  perform give_xp(s.id, p.xp, p.name || ' 완료', 'att:' || a.id);
  return json_build_object('ok', true, 'state', 'COMPLETED', 'xp', p.xp, 'secs', round(elapsed), 'total_xp', (select xp from students where id = s.id));
end $$;

-- 선생님이 직접 인정 (MANUAL)
create or replace function admin_manual(p_session uuid, p_student uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare p programs; a attendance;
begin
  perform need_staff();
  select p2.* into p from qr_sessions q join programs p2 on p2.id = q.program_id where q.id = p_session;
  if not found then raise exception 'bad_session'; end if;
  select * into a from attendance where session_id = p_session and student_id = p_student;
  if found and a.state in ('COMPLETED', 'MANUAL') then return; end if;
  insert into attendance (session_id, student_id, state, in_at, out_at, xp, manual_by)
  values (p_session, p_student, 'MANUAL', coalesce(a.in_at, now()), now(), p.xp, auth.uid())
  on conflict (session_id, student_id) do update set state = 'MANUAL', out_at = now(), xp = p.xp, manual_by = auth.uid();
  perform give_xp(p_student, p.xp, p.name || ' 선생님 인정', 'att:' || p_session || ':' || p_student, auth.uid());
end $$;

-- LIVE 화면: 대상 학생 전원과 상태
create or replace function admin_live(p_session uuid, p_class int default null) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare q qr_sessions;
begin
  perform need_staff();
  select * into q from qr_sessions where id = p_session;
  return json_build_object(
    'session', (select json_build_object('id', q.id, 'day', q.day, 'closed_at', q.closed_at, 'target_grade', q.target_grade,
                 'program', p.name, 'min_seconds', p.min_seconds, 'xp', p.xp) from programs p where p.id = q.program_id),
    'now', now(),
    'rows', coalesce((select json_agg(x order by x.grade, x.class, x.num) from (
      select s.id, s.grade, s.class, s.num, s.name, coalesce(a.state, 'WAITING') as state, a.in_at, a.out_at
      from students s left join attendance a on a.student_id = s.id and a.session_id = q.id
      where s.active and (q.target_grade is null or s.grade = q.target_grade or s.grade = 0) and (p_class is null or s.class = p_class)) x), '[]'));
end $$;

create or replace function admin_sessions(p_days int default 14) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  return coalesce((select json_agg(x order by x.opened_at desc) from (
    select q.id, q.day, q.opened_at, q.closed_at, q.target_grade, p.name as program, p.one_scan,
      (select count(*) from attendance a where a.session_id = q.id and a.state in ('COMPLETED', 'MANUAL')) as done,
      (select count(*) from attendance a where a.session_id = q.id and a.state = 'ACTIVE') as active
    from qr_sessions q join programs p on p.id = q.program_id
    where q.day > seoul_today() - p_days) x), '[]');
end $$;

-- ---------- 학생 명단 ----------
-- rows: [{"grade":2,"class":3,"num":12,"name":"홍길동"}, ...]  같은 학번이 있으면 이름만 고쳐요
create or replace function admin_import_roster(p_rows jsonb) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb; n_new int := 0; n_upd int := 0; g int; c int; nn int; nm text; no text;
begin
  perform need_staff();
  for r in select * from jsonb_array_elements(p_rows) loop
    g := (r ->> 'grade')::int; c := (r ->> 'class')::int; nn := (r ->> 'num')::int; nm := trim(r ->> 'name');
    if g is null or c is null or nn is null or nm is null or nm = '' or g not between 1 and 3 or c not between 1 and 20 or nn not between 1 and 99 then continue; end if;
    no := g::text || lpad(c::text, 2, '0') || lpad(nn::text, 2, '0');
    if exists (select 1 from students where student_no = no) then
      update students set name = nm, grade = g, class = c, num = nn, active = true where student_no = no;
      n_upd := n_upd + 1;
    else
      insert into students (student_no, grade, class, num, name) values (no, g, c, nn, nm);
      n_new := n_new + 1;
    end if;
  end loop;
  return json_build_object('added', n_new, 'updated', n_upd);
end $$;

create or replace function admin_students(p_grade int, p_class int) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  return coalesce((select json_agg(x order by x.num) from (
    select s.id, s.student_no, s.num, s.name, s.xp, s.active, s.signed_up_at,
      (select count(*) from attendance a where a.student_id = s.id and a.state in ('COMPLETED', 'MANUAL')) as done
    from students s where s.grade = p_grade and s.class = p_class) x), '[]');
end $$;

create or replace function admin_classes() returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  return coalesce((select json_agg(x order by x.grade, x.class) from (
    select grade, class, count(*) as n, count(signed_up_at) as joined from students where active and grade > 0 group by grade, class) x), '[]');
end $$;

-- 비밀번호 초기화: 학생이 다음에 '처음이에요'로 다시 만들어요
create or replace function admin_reset_password(p_student uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  delete from student_secrets where student_id = p_student;
  delete from student_sessions where student_id = p_student;
  update students set signed_up_at = null where id = p_student;
end $$;

create or replace function admin_set_active(p_student uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  update students set active = p_active where id = p_student;
  if not p_active then delete from student_sessions where student_id = p_student; end if;
end $$;

create or replace function admin_adjust_xp(p_student uuid, p_amount int, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  if coalesce(trim(p_reason), '') = '' then raise exception 'need_reason'; end if;
  if abs(p_amount) > 500 then raise exception 'too_big'; end if;
  perform give_xp(p_student, p_amount, '선생님 조정: ' || trim(p_reason), null, auth.uid());
end $$;

-- ---------- 미션 ----------
-- 선생님만 대상인 미션(0)을 쓸 수 있게 예전 표의 규칙을 넓혀요
alter table missions drop constraint if exists missions_target_grade_check;
alter table missions add constraint missions_target_grade_check check (target_grade between 0 and 3);

create or replace function admin_create_mission(p_kind text, p_goal int, p_xp int, p_grade int, p_class int, p_opens timestamptz, p_closes timestamptz) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare mid uuid;
begin
  perform need_staff();
  if p_closes <= coalesce(p_opens, now()) then raise exception 'bad_time'; end if;
  insert into missions (kind, goal, xp, target_grade, target_class, opens_at, closes_at, created_by)
  values (p_kind, p_goal, p_xp, p_grade, p_class, coalesce(p_opens, now()), p_closes, auth.uid()) returning id into mid;
  return mid;
end $$;

create or replace function admin_delete_mission(p_mission uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  -- 이미 준 XP는 되돌려요
  perform give_xp(ms.student_id, -m.xp, '미션 삭제', 'mission:' || m.id) from mission_subs ms join missions m on m.id = ms.mission_id where m.id = p_mission;
  delete from missions where id = p_mission;
end $$;

create or replace function admin_missions() returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  return coalesce((select json_agg(x order by x.closes_at desc) from (
    select m.*, (select count(*) from mission_subs ms where ms.mission_id = m.id) as subs,
      (select count(*) from students s where s.active and (m.target_grade is null or s.grade = m.target_grade) and (m.target_class is null or s.class = m.target_class)) as targets
    from missions m order by m.closes_at desc limit 100) x), '[]');
end $$;

create or replace function admin_mission_subs(p_mission uuid, p_grade int, p_class int) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  return coalesce((select json_agg(x order by x.num) from (
    select s.id, s.num, s.name, ms.value, ms.secs, ms.method, ms.flagged, ms.submitted_at
    from students s left join mission_subs ms on ms.student_id = s.id and ms.mission_id = p_mission
    where s.active and s.grade = p_grade and s.class = p_class) x), '[]');
end $$;

-- 학생 제출: 목표를 채웠고 미션 시간 안이어야 해요. 걷기는 분당 150보가 넘으면 확인 필요로 표시해요
create or replace function student_mission_submit(p_token uuid, p_mission uuid, p_value int, p_secs int, p_method text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s students; m missions; flag boolean := false;
begin
  s := session_student(p_token);
  select * into m from missions where id = p_mission;
  if not found then return json_build_object('error', 'not_found'); end if;
  if (m.target_grade is not null and m.target_grade <> s.grade) or (m.target_class is not null and m.target_class <> s.class) then
    return json_build_object('error', 'not_target');
  end if;
  if now() < m.opens_at then return json_build_object('error', 'not_open'); end if;
  if now() > m.closes_at then return json_build_object('error', 'closed'); end if;
  if p_value is null or p_value < m.goal then return json_build_object('error', 'not_enough'); end if;
  if exists (select 1 from mission_subs where mission_id = m.id and student_id = s.id) then return json_build_object('error', 'already'); end if;
  if m.kind = 'walk' then
    flag := p_secs is null or p_secs <= 0 or (p_value::numeric / (p_secs / 60.0)) > 150;
  end if;
  insert into mission_subs (mission_id, student_id, value, secs, method, flagged)
  values (m.id, s.id, least(p_value, m.goal * 3), p_secs, case when m.kind = 'walk' then 'sensor' else 'pose' end, flag);
  perform give_xp(s.id, m.xp, '미션 완료', 'mission:' || m.id);
  return json_build_object('ok', true, 'xp', m.xp, 'flagged', flag);
end $$;

-- ---------- 대시보드 ----------
create or replace function admin_dashboard() returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare today date := seoul_today();
begin
  perform need_staff();
  return json_build_object(
    'me', (select json_build_object('name', name, 'email', email, 'role', role) from teachers where id = auth.uid()),
    'students', (select count(*) from students where active and grade > 0),
    'joined', (select count(*) from students where active and grade > 0 and signed_up_at is not null),
    'today_done', (select count(*) from attendance a join qr_sessions q on q.id = a.session_id where q.day = today and a.state in ('COMPLETED', 'MANUAL')),
    'today_active', (select count(*) from attendance a join qr_sessions q on q.id = a.session_id where q.day = today and a.state = 'ACTIVE'),
    'open_sessions', (select count(*) from qr_sessions where closed_at is null and day = today),
    'week', coalesce((select json_agg(x order by x.day) from (
      select q.day, count(*) filter (where a.state in ('COMPLETED', 'MANUAL')) as done
      from qr_sessions q left join attendance a on a.session_id = q.id
      where q.day > today - 7 group by q.day) x), '[]'),
    'pending_teachers', (select count(*) from teachers where role = 'pending'));
end $$;

-- ---------- 설정 · 선생님 · 프로그램 ----------
create or replace function admin_settings() returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  return json_build_object(
    'settings', (select row_to_json(st) from settings st where id = 1),
    'programs', coalesce((select json_agg(p order by p.sort, p.id) from programs p), '[]'),
    'teachers', case when is_owner() then coalesce((select json_agg(t order by t.created_at) from (select id, email, name, role, created_at from teachers) t), '[]') else '[]' end,
    'me', (select json_build_object('id', id, 'name', name, 'email', email, 'role', role) from teachers where id = auth.uid()));
end $$;

-- 관리교사만: QR 시간, 위치 기준점, 레이스 기간·상품
create or replace function admin_save_settings(p jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_owner() then raise exception 'not_owner'; end if;
  update settings set
    qr_seconds = coalesce((p ->> 'qr_seconds')::int, qr_seconds),
    geo_lat = case when p ? 'geo_lat' then (p ->> 'geo_lat')::double precision else geo_lat end,
    geo_lng = case when p ? 'geo_lng' then (p ->> 'geo_lng')::double precision else geo_lng end,
    geo_radius_m = coalesce((p ->> 'geo_radius_m')::int, geo_radius_m),
    race_program_id = case when p ? 'race_program_id' then (p ->> 'race_program_id')::int else race_program_id end,
    race_from = case when p ? 'race_from' then nullif(p ->> 'race_from', '')::date else race_from end,
    race_to = case when p ? 'race_to' then nullif(p ->> 'race_to', '')::date else race_to end,
    prizes = coalesce(p -> 'prizes', prizes)
  where id = 1;
end $$;

create or replace function admin_set_teacher(p_id uuid, p_role text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_owner() then raise exception 'not_owner'; end if;
  if p_role = 'remove' then
    if p_id = auth.uid() then raise exception 'last_owner'; end if;
    begin delete from auth.users where id = p_id; exception when others then null; end;
    delete from teachers where id = p_id;
  else
    if p_role not in ('owner', 'teacher', 'pending') then raise exception 'bad_role'; end if;
    update teachers set role = p_role where id = p_id;
  end if;
end $$;

-- 프로그램 추가·수정 (id 가 없으면 새로 만들어요)
create or replace function admin_save_program(p jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare pid int := (p ->> 'id')::int;
begin
  perform need_staff();
  if pid is null then
    insert into programs (name, min_seconds, xp, geo, in_race, one_scan, active, sort)
    values (trim(p ->> 'name'), (p ->> 'min_seconds')::int, (p ->> 'xp')::int, coalesce((p ->> 'geo')::boolean, false), coalesce((p ->> 'in_race')::boolean, false), coalesce((p ->> 'one_scan')::boolean, true), true,
            coalesce((select max(sort) from programs), 0) + 1) returning id into pid;
  else
    update programs set name = coalesce(trim(p ->> 'name'), name), min_seconds = coalesce((p ->> 'min_seconds')::int, min_seconds),
      xp = coalesce((p ->> 'xp')::int, xp), geo = coalesce((p ->> 'geo')::boolean, geo), active = coalesce((p ->> 'active')::boolean, active),
      one_scan = coalesce((p ->> 'one_scan')::boolean, one_scan), in_race = coalesce((p ->> 'in_race')::boolean, in_race)
    where id = pid;
  end if;
  return pid;
end $$;

-- ---------- 함께 운동하는 선생님 ----------
-- rows: [{"name":"홍길동"} 또는 {"num":3,"name":"홍길동"}] 번호가 없으면 다음 번호를 붙여요. 같은 이름이 이미 있으면 그대로 둬요
create or replace function admin_import_staff(p_rows jsonb) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb; nm text; nn int; n_new int := 0; n_same int := 0;
begin
  perform need_staff();
  for r in select * from jsonb_array_elements(p_rows) loop
    nm := regexp_replace(coalesce(r ->> 'name', ''), '\s', '', 'g');
    if nm = '' then continue; end if;
    nn := (r ->> 'num')::int;
    if nn is null and exists (select 1 from students where grade = 0 and regexp_replace(name, '\s', '', 'g') = nm) then
      update students set active = true where grade = 0 and regexp_replace(name, '\s', '', 'g') = nm;
      n_same := n_same + 1; continue;
    end if;
    if nn is null then nn := coalesce((select max(num) from students where grade = 0), 0) + 1; end if;
    if nn < 1 or nn > 9999 then continue; end if;
    insert into students (student_no, grade, class, num, name) values ('9' || lpad(nn::text, 4, '0'), 0, 0, nn, nm)
    on conflict (student_no) do update set name = excluded.name, active = true;
    n_new := n_new + 1;
  end loop;
  return json_build_object('added', n_new, 'same', n_same);
end $$;

-- 선생님 참여 순위: 레이스 기간 안 완료 횟수, 그다음 XP
create or replace function admin_staff_board() returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare st settings;
begin
  perform need_staff();
  select * into st from settings where id = 1;
  return json_build_object('from', st.race_from, 'to', st.race_to, 'program', (select string_agg(name, ' · ' order by sort, id) from programs where race_prog(id)),
    'rows', coalesce((select json_agg(x order by x.done desc, x.xp desc, x.num) from (
      select s.id, s.student_no, s.num, s.name, s.xp, s.active, s.signed_up_at,
        (select count(distinct q.day) from attendance a join qr_sessions q on q.id = a.session_id
          where a.student_id = s.id and a.state in ('COMPLETED', 'MANUAL') and race_prog(q.program_id)
            and (st.race_from is null or q.day >= st.race_from) and (st.race_to is null or q.day <= st.race_to)) as done,
        (select count(*) from attendance a where a.student_id = s.id and a.state in ('COMPLETED', 'MANUAL')) as all_done
      from students s where s.grade = 0) x), '[]'));
end $$;

-- ---------- PAPS ----------
-- 선생님: 기록 저장. 한 줄 = {student_no, name?, year, round, item, value, grade_level}. value가 비어 있으면 그 기록을 지워요
create or replace function admin_paps_save(p_rows jsonb) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb; sid uuid; sname text; n_save int := 0; n_del int := 0; miss text[] := '{}'; diff text[] := '{}'; v numeric; gl int; y int; rd int; it text;
begin
  perform need_staff();
  for r in select * from jsonb_array_elements(p_rows) loop
    sid := null;
    select id, name into sid, sname from students where student_no = trim(r ->> 'student_no');
    if sid is null then miss := array_append(miss, coalesce(r ->> 'student_no', '?')); continue; end if;
    -- 이름을 같이 보냈으면 명단 이름과 같을 때만 저장해요 (학번이 밀린 파일을 막으려고)
    if coalesce(r ->> 'name', '') <> '' and regexp_replace(r ->> 'name', '\s', '', 'g') <> regexp_replace(sname, '\s', '', 'g') then
      diff := array_append(diff, r ->> 'student_no'); continue;
    end if;
    y := (r ->> 'year')::int; rd := coalesce((r ->> 'round')::int, 1); it := r ->> 'item';
    if y is null or it is null or it !~ '^[a-z0-9_]{2,20}$' then continue; end if;
    v := nullif(trim(coalesce(r ->> 'value', '')), '')::numeric;
    gl := nullif(trim(coalesce(r ->> 'grade_level', '')), '')::int;
    if gl is not null and gl not between 1 and 5 then gl := null; end if;
    if v is null then
      delete from paps_records where student_id = sid and year = y and round = rd and item = it;
      if found then n_del := n_del + 1; end if;
    else
      insert into paps_records (student_id, year, round, item, value, grade_level, entered_by)
      values (sid, y, rd, it, v, gl, auth.uid())
      on conflict (student_id, year, round, item) do update
        set value = excluded.value, grade_level = excluded.grade_level, entered_by = excluded.entered_by, updated_at = now();
      n_save := n_save + 1;
    end if;
  end loop;
  return json_build_object('saved', n_save, 'removed', n_del, 'missing', to_json(miss), 'name_diff', to_json(diff));
end $$;

-- 선생님: 한 반 학생과 그 학생들의 모든 PAPS 기록 (학급 단위 입력 화면)
create or replace function admin_paps_class(p_grade int, p_class int) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  return coalesce((select json_agg(x order by x.num) from (
    select s.id, s.student_no, s.num, s.name,
      coalesce((select json_agg(json_build_object('year', p.year, 'round', p.round, 'item', p.item, 'value', p.value, 'grade_level', p.grade_level) order by p.year, p.round)
                from paps_records p where p.student_id = s.id), '[]') as recs
    from students s where s.grade = p_grade and s.class = p_class and s.active) x), '[]');
end $$;

-- 학생: 내 기록만
create or replace function student_paps(p_token uuid) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare s students;
begin
  s := session_student(p_token);
  return coalesce((select json_agg(json_build_object('year', year, 'round', round, 'item', item, 'value', value, 'grade_level', grade_level) order by year, round)
    from paps_records where student_id = s.id), '[]');
end $$;

-- ========== 자유운동 · 운동 달력 · 꾸준한 운동 · 배지 · 운동 도감 · 도전 · 월간 리포트 ==========
-- 승인된 설계 보고서대로 표를 더해요. 기존 표의 데이터는 지우거나 바꾸지 않아요.
-- 저장하지 않는 것: 위치, 이동 경로, 주소, 심박수, 건강 정보.

-- 자유운동 설정 (관리교사가 바꿔요)
alter table settings add column if not exists free_workout jsonb not null default
  '{"on": true, "kinds": ["walk", "run", "jumprope", "hometrain"], "basis": "time", "min_secs": 600, "min_steps": 1000,
    "daily_count": 2, "daily_xp": 40, "xp": {"walk": 20, "run": 20, "jumprope": 20, "hometrain": 20}}';

-- 자유운동 측정 기록. 시간은 서버 시계로 재요
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students on delete cascade,
  kind text not null check (kind in ('walk', 'run', 'jumprope', 'hometrain')),
  day date not null default seoul_today(),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  active_secs int not null default 0,
  steps int not null default 0,
  minute_steps jsonb not null default '[]',
  screen_off_secs int not null default 0,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'OK', 'SHORT', 'REVIEW', 'APPROVED', 'REJECTED')),
  flags text[] not null default '{}',
  xp int not null default 0,
  reviewed_by uuid references teachers on delete set null
);
create index if not exists workouts_student on workouts (student_id, started_at desc);
create unique index if not exists workouts_one_active on workouts (student_id) where status = 'ACTIVE';

-- 운동 종목 (운동 도감)
create table if not exists sports (
  id serial primary key,
  name text not null unique,
  icon text not null default '🏅',
  code text unique,                       -- 자유운동 종류와 연결 (walk, run, jumprope, hometrain)
  sort int not null default 0,
  active boolean not null default true
);
insert into sports (name, icon, code, sort) values
  ('걷기', '🚶', 'walk', 1), ('달리기', '🏃', 'run', 2), ('줄넘기', '🤸', 'jumprope', 3), ('홈트레이닝', '💪', 'hometrain', 4),
  ('농구', '🏀', null, 5), ('배드민턴', '🏸', null, 6), ('피구', '🤾', null, 7), ('축구', '⚽', null, 8), ('배구', '🏐', null, 9), ('탁구', '🏓', null, 10)
on conflict (name) do nothing;
alter table programs add column if not exists sport_id int references sports on delete set null;
alter table qr_sessions add column if not exists sport_id int references sports on delete set null;

-- QR 출석을 열 때 종목을 따로 고르지 않으면 프로그램의 기본 종목을 써요
create or replace function qr_session_sport() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.sport_id is null then new.sport_id := (select sport_id from programs where id = new.program_id); end if;
  return new;
end $$;
drop trigger if exists qr_session_sport on qr_sessions;
create trigger qr_session_sport before insert on qr_sessions for each row execute function qr_session_sport();

-- 배지
create table if not exists badges (
  id serial primary key,
  code text not null unique,
  name text not null,
  icon text not null default '🏅',
  kind text not null check (kind in ('total', 'school', 'morning', 'streak', 'free', 'steps', 'sports', 'challenges', 'missions', 'days')),
  goal int not null check (goal between 1 and 10000000),
  sort int not null default 0,
  active boolean not null default true
);
insert into badges (code, name, icon, kind, goal, sort) values
  ('first', '첫 운동', '🌱', 'total', 1, 1),
  ('total10', '운동 10회', '🏃', 'total', 10, 2),
  ('total30', '운동 30회', '🏅', 'total', 30, 3),
  ('total100', '운동 100회', '🏆', 'total', 100, 4),
  ('morning10', '아침 운동 10회', '🌅', 'morning', 10, 5),
  ('streak3', '3회 연속 참여', '🔥', 'streak', 3, 6),
  ('streak7', '7회 연속 참여', '⚡', 'streak', 7, 7),
  ('free5', '자유운동 5회', '🏠', 'free', 5, 8),
  ('steps10k', '누적 1만 걸음', '👟', 'steps', 10000, 9),
  ('steps50k', '누적 5만 걸음', '🥾', 'steps', 50000, 10),
  ('sports3', '종목 3개 경험', '🧭', 'sports', 3, 11),
  ('sports5', '종목 5개 경험', '🗺️', 'sports', 5, 12),
  ('mission5', '미션 5개 완료', '✅', 'missions', 5, 13),
  ('challenge3', '도전 3개 달성', '🎯', 'challenges', 3, 14),
  ('days20', '운동한 날 20일', '📅', 'days', 20, 15)
on conflict (code) do nothing;
create table if not exists student_badges (
  student_id uuid not null references students on delete cascade,
  badge_id int not null references badges on delete cascade,
  earned_at timestamptz not null default now(),
  seen boolean not null default false,
  primary key (student_id, badge_id)
);

-- 도전과 우리 반 공동목표 (scope = class 이면 반 전체 기록을 더해요)
create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 60),
  scope text not null check (scope in ('day', 'week', 'period', 'class')),
  metric text not null check (metric in ('count', 'minutes', 'days', 'steps', 'free', 'school')),
  goal int not null check (goal between 1 and 10000000),
  xp int not null default 20 check (xp between 0 and 200),
  starts_on date not null,
  ends_on date not null,
  target_grade int check (target_grade between 1 and 3),
  target_class int check (target_class between 1 and 20),
  created_by uuid references teachers on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create table if not exists challenge_done (
  challenge_id uuid not null references challenges on delete cascade,
  student_id uuid not null references students on delete cascade,
  xp int not null default 0,
  done_at timestamptz not null default now(),
  primary key (challenge_id, student_id)
);

alter table workouts enable row level security;
alter table sports enable row level security;
alter table badges enable row level security;
alter table student_badges enable row level security;
alter table challenges enable row level security;
alter table challenge_done enable row level security;
drop policy if exists workouts_read on workouts;   create policy workouts_read on workouts for select using (is_staff());
drop policy if exists sports_read on sports;       create policy sports_read on sports for select using (is_staff());
drop policy if exists badges_read on badges;       create policy badges_read on badges for select using (is_staff());
drop policy if exists sbadges_read on student_badges; create policy sbadges_read on student_badges for select using (is_staff());
drop policy if exists chal_read on challenges;     create policy chal_read on challenges for select using (is_staff());
drop policy if exists chdone_read on challenge_done; create policy chdone_read on challenge_done for select using (is_staff());

-- ---------- 운동 기록 모으기 ----------
-- 학교 QR 운동(완료·선생님 인정), 미션, 인정된 자유운동을 한 줄씩 모아요
create or replace function activity_of(p_student uuid, p_from date, p_to date)
returns table (day date, src text, secs int, steps int, sport_id int, label text, at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select q.day, 'school'::text,
         coalesce(greatest(0, extract(epoch from (a.out_at - a.in_at)))::int, p.min_seconds), 0, q.sport_id, p.name, coalesce(a.out_at, a.in_at, q.opened_at)
  from attendance a join qr_sessions q on q.id = a.session_id join programs p on p.id = q.program_id
  where a.student_id = p_student and a.state in ('COMPLETED', 'MANUAL') and q.day between p_from and p_to
  union all
  select (ms.submitted_at at time zone 'Asia/Seoul')::date, 'mission', coalesce(ms.secs, 0), case when m.kind = 'walk' then ms.value else 0 end,
         (select id from sports where code = case when m.kind = 'walk' then 'walk' else 'hometrain' end), m.kind, ms.submitted_at
  from mission_subs ms join missions m on m.id = ms.mission_id
  where ms.student_id = p_student and (ms.submitted_at at time zone 'Asia/Seoul')::date between p_from and p_to
  union all
  select w.day, 'free', w.active_secs, w.steps, (select id from sports where code = w.kind), w.kind, coalesce(w.ended_at, w.started_at)
  from workouts w where w.student_id = p_student and w.status in ('OK', 'APPROVED') and w.day between p_from and p_to
$$;

create or replace function metric_of(p_student uuid, p_metric text, p_from date, p_to date) returns int
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(case p_metric
    when 'count' then count(*)
    when 'minutes' then sum(secs) / 60
    when 'days' then count(distinct day)
    when 'steps' then sum(steps)
    when 'free' then count(*) filter (where src = 'free')
    when 'school' then count(*) filter (where src = 'school') end, 0)::int
  from activity_of(p_student, p_from, p_to) $$;

-- 꾸준한 운동: 학교 운동이 열린 날만 세요. 운동이 없는 주말·방학에는 끊기지 않고, 오늘 아직 안 했어도 끊기지 않아요
create or replace function streak_of(p_student uuid) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare g int; today date := seoul_today(); m0 date := date_trunc('month', seoul_today())::date;
  run int := 0; best int := 0; mrun int := 0; mbest int := 0; d record;
begin
  select grade into g from students where id = p_student;
  for d in
    select x.day, exists (select 1 from attendance a join qr_sessions q2 on q2.id = a.session_id
                          where a.student_id = p_student and q2.day = x.day and a.state in ('COMPLETED', 'MANUAL')) as did
    from (select distinct q.day from qr_sessions q where (q.target_grade is null or q.target_grade = g or g = 0) and q.day <= today) x
    order by x.day
  loop
    if d.did then
      run := run + 1;
      if d.day >= m0 then mrun := mrun + 1; end if;
    elsif d.day < today then
      run := 0; mrun := 0;
    end if;
    best := greatest(best, run); mbest := greatest(mbest, mrun);
  end loop;
  return json_build_object('cur', run, 'best', best, 'month_best', mbest);
end $$;

-- 배지·도감에 쓰는 누적 숫자
create or replace function stats_of(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r jsonb; rp int := (select race_program_id from settings where id = 1);
begin
  select jsonb_build_object(
    'total', count(*), 'school', count(*) filter (where src = 'school'), 'free', count(*) filter (where src = 'free'),
    'missions', count(*) filter (where src = 'mission'), 'steps', coalesce(sum(steps), 0), 'minutes', coalesce(sum(secs), 0) / 60,
    'days', count(distinct day), 'sports', count(distinct sport_id))
  into r from activity_of(p_student, date '2000-01-01', seoul_today());
  return r || jsonb_build_object(
    'morning', (select count(*) from attendance a join qr_sessions q on q.id = a.session_id where a.student_id = p_student and a.state in ('COMPLETED', 'MANUAL') and q.program_id = rp),
    'streak', (streak_of(p_student) ->> 'best')::int,
    'challenges', (select count(*) from challenge_done where student_id = p_student));
end $$;

-- 학생: 내 성장 (배지는 여기서 조건을 확인해서 줘요. 새 배지는 한 번만 알려요)
create or replace function student_progress(p_token uuid) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s students; st jsonb; nb json; today date := seoul_today(); w0 date := date_trunc('week', seoul_today())::date;
begin
  s := session_student(p_token);
  st := stats_of(s.id);
  insert into student_badges (student_id, badge_id)
    select s.id, b.id from badges b where b.active and coalesce((st ->> b.kind)::int, 0) >= b.goal
  on conflict do nothing;
  select json_agg(json_build_object('name', b.name, 'icon', b.icon) order by b.sort) into nb
    from student_badges sb join badges b on b.id = sb.badge_id where sb.student_id = s.id and not sb.seen;
  update student_badges set seen = true where student_id = s.id and not seen;
  return json_build_object(
    'stats', st, 'streak', streak_of(s.id), 'new_badges', coalesce(nb, '[]'),
    'week', json_build_object('count', metric_of(s.id, 'count', w0, today), 'minutes', metric_of(s.id, 'minutes', w0, today),
      'xp', (select coalesce(sum(amount), 0) from xp_ledger where student_id = s.id and amount > 0 and (created_at at time zone 'Asia/Seoul')::date >= w0)),
    'badges', coalesce((select json_agg(json_build_object('id', b.id, 'name', b.name, 'icon', b.icon, 'kind', b.kind, 'goal', b.goal,
        'value', coalesce((st ->> b.kind)::int, 0), 'earned_at', sb.earned_at) order by b.sort, b.id)
      from badges b left join student_badges sb on sb.badge_id = b.id and sb.student_id = s.id where b.active or sb.earned_at is not null), '[]'),
    'sports', coalesce((select json_agg(json_build_object('id', sp.id, 'name', sp.name, 'icon', sp.icon, 'first', f.first, 'times', coalesce(f.n, 0)) order by sp.sort, sp.id)
      from sports sp left join (select a.sport_id, min(a.day) as first, count(*) as n from activity_of(s.id, date '2000-01-01', today) a where a.sport_id is not null group by a.sport_id) f on f.sport_id = sp.id
      where sp.active or f.n > 0), '[]'));
end $$;

-- 학생: 운동 달력 (한 달)
create or replace function student_calendar(p_token uuid, p_month date) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare s students; m0 date := date_trunc('month', coalesce(p_month, seoul_today()))::date; m1 date;
begin
  s := session_student(p_token);
  m1 := (m0 + interval '1 month - 1 day')::date;
  return json_build_object('month', m0, 'today', seoul_today(), 'items', coalesce((
    select json_agg(json_build_object('day', a.day, 'src', a.src, 'secs', a.secs, 'steps', a.steps, 'label', a.label,
      'sport', (select name from sports where id = a.sport_id), 'at', a.at) order by a.at)
    from activity_of(s.id, m0, m1) a), '[]'));
end $$;

-- 월간 리포트: 이번 달과 지난달의 나
create or replace function month_summary(p_student uuid, p_m0 date) returns json
language sql stable security definer set search_path = public, extensions as $$
  select json_build_object('month', p_m0,
    'school', count(*) filter (where src = 'school'), 'mission', count(*) filter (where src = 'mission'), 'free', count(*) filter (where src = 'free'),
    'minutes', coalesce(sum(secs), 0) / 60, 'steps', coalesce(sum(steps), 0), 'days', count(distinct day),
    'xp', (select coalesce(sum(amount), 0) from xp_ledger where student_id = p_student and amount > 0
             and (created_at at time zone 'Asia/Seoul')::date between p_m0 and (p_m0 + interval '1 month - 1 day')::date))
  from activity_of(p_student, p_m0, (p_m0 + interval '1 month - 1 day')::date) $$;
create or replace function student_report(p_token uuid, p_month date) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare s students; m0 date := date_trunc('month', coalesce(p_month, seoul_today()))::date;
begin
  s := session_student(p_token);
  return json_build_object('this', month_summary(s.id, m0), 'prev', month_summary(s.id, (m0 - interval '1 month')::date), 'streak', streak_of(s.id));
end $$;

-- ---------- 자유운동 ----------
create or replace function free_kind_name(k text) returns text language sql immutable as
$$ select case k when 'walk' then '걷기' when 'run' then '달리기' when 'jumprope' then '줄넘기' when 'hometrain' then '홈트레이닝' else k end $$;

-- 하루 인정 횟수·최대 XP 안에서 줄 수 있는 XP
create or replace function free_xp_for(p_student uuid, p_kind text, p_day date, p_skip uuid) returns int
language plpgsql stable security definer set search_path = public, extensions as $$
declare cfg jsonb := (select free_workout from settings where id = 1); n int; used int;
begin
  select count(*), coalesce(sum(xp), 0) into n, used from workouts
  where student_id = p_student and day = p_day and xp > 0 and id <> p_skip;
  if n >= coalesce((cfg ->> 'daily_count')::int, 2) then return 0; end if;
  return greatest(0, least(coalesce((cfg -> 'xp' ->> p_kind)::int, 20), coalesce((cfg ->> 'daily_xp')::int, 40) - used));
end $$;

create or replace function student_free_state(p_token uuid) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare s students; today date := seoul_today();
begin
  s := session_student(p_token);
  return json_build_object(
    'cfg', (select free_workout from settings where id = 1), 'now', now(),
    'active', (select json_build_object('id', id, 'kind', kind, 'started_at', started_at) from workouts where student_id = s.id and status = 'ACTIVE'),
    'today', json_build_object('count', (select count(*) from workouts where student_id = s.id and day = today and xp > 0),
                               'xp', (select coalesce(sum(xp), 0) from workouts where student_id = s.id and day = today)),
    'recent', coalesce((select json_agg(x) from (
      select id, kind, day, started_at, ended_at, active_secs, steps, status, flags, xp from workouts
      where student_id = s.id and status <> 'ACTIVE' order by started_at desc limit 20) x), '[]'));
end $$;

-- 시작: 서버가 시작 시각을 적어요. 진행 중인 기록이 있으면 그건 끝내요
create or replace function student_free_start(p_token uuid, p_kind text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s students; cfg jsonb := (select free_workout from settings where id = 1); w workouts;
begin
  s := session_student(p_token);
  if not coalesce((cfg ->> 'on')::boolean, true) then return json_build_object('error', 'free_off'); end if;
  if not coalesce(cfg -> 'kinds' ? p_kind, false) then return json_build_object('error', 'bad_kind'); end if;
  update workouts set status = 'SHORT', ended_at = now(), flags = array_append(flags, 'restarted')
  where student_id = s.id and status = 'ACTIVE';
  insert into workouts (student_id, kind) values (s.id, p_kind) returning * into w;
  return json_build_object('id', w.id, 'kind', w.kind, 'started_at', w.started_at, 'now', now());
end $$;

create or replace function student_free_cancel(p_token uuid, p_id uuid) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s students;
begin
  s := session_student(p_token);
  delete from workouts where id = p_id and student_id = s.id and status = 'ACTIVE';
  return json_build_object('ok', true);
end $$;

-- 종료: 운동시간은 서버 시각으로 재고, 인정 조건과 이상 기록을 확인해요
-- p_steps: 걷기·달리기는 걸음 수, 줄넘기·홈트레이닝은 휴대폰이 움직인 횟수(0이면 인정하지 않아요)
-- p_minutes: 1분마다의 걸음 수 목록, p_off: 화면이 꺼져 있던 초
create or replace function student_free_finish(p_token uuid, p_id uuid, p_steps int, p_minutes jsonb, p_off int) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s students; w workouts; cfg jsonb := (select free_workout from settings where id = 1);
  dur int; act int; fl text[] := '{}'; st text; v_xp int := 0; stepk boolean; ok boolean; v_steps int; mins jsonb;
  mins_n int; mins_max int; mins_distinct int; min_secs int; min_steps int;
begin
  s := session_student(p_token);
  select * into w from workouts where id = p_id and student_id = s.id for update;
  if not found then return json_build_object('error', 'not_found'); end if;
  if w.status <> 'ACTIVE' then return json_build_object('error', 'already', 'status', w.status); end if;
  min_secs := coalesce((cfg ->> 'min_secs')::int, 600); min_steps := coalesce((cfg ->> 'min_steps')::int, 1000);
  dur := greatest(0, extract(epoch from (now() - w.started_at))::int);
  act := greatest(0, dur - least(greatest(coalesce(p_off, 0), 0), dur));
  if act > 10800 then act := 10800; fl := array_append(fl, 'long'); end if;
  stepk := w.kind in ('walk', 'run');
  v_steps := greatest(0, least(coalesce(p_steps, 0), 200000));
  mins := case when stepk and jsonb_typeof(p_minutes) = 'array' then p_minutes else '[]'::jsonb end;
  if jsonb_array_length(mins) > 300 then mins := '[]'::jsonb; end if;
  if stepk then
    select count(*), max(v::int), count(distinct v::int) into mins_n, mins_max, mins_distinct from jsonb_array_elements_text(mins) v;
    if act >= 60 and v_steps / (act / 60.0) > 200 then fl := array_append(fl, 'fast'); end if;
    if coalesce(mins_max, 0) > 200 then fl := array_append(fl, 'fast_minute'); end if;
    if mins_n >= 5 and mins_distinct = 1 and mins_max > 0 then fl := array_append(fl, 'even'); end if;
  end if;
  ok := case coalesce(cfg ->> 'basis', 'time')
          when 'steps' then (stepk and v_steps >= min_steps) or (not stepk and act >= min_secs)
          when 'both' then act >= min_secs and (not stepk or v_steps >= min_steps)
          else act >= min_secs end;
  if not stepk and v_steps = 0 then ok := false; fl := array_append(fl, 'nomove'); end if;
  if not ok then st := 'SHORT';
  elsif fl && array['fast', 'fast_minute', 'even'] then st := 'REVIEW';
  else
    st := 'OK'; v_xp := free_xp_for(s.id, w.kind, w.day, w.id);
    if v_xp = 0 then fl := array_append(fl, 'daily_limit'); end if;
  end if;
  update workouts set ended_at = now(), active_secs = act, steps = case when stepk then v_steps else 0 end, minute_steps = mins,
    screen_off_secs = least(greatest(coalesce(p_off, 0), 0), dur), status = st, flags = fl, xp = v_xp
  where id = w.id;
  if v_xp > 0 then perform give_xp(s.id, v_xp, '자유운동 ' || free_kind_name(w.kind), 'workout:' || w.id); end if;
  return json_build_object('ok', true, 'status', st, 'xp', v_xp, 'active_secs', act, 'steps', case when stepk then v_steps else 0 end, 'flags', fl,
    'min_secs', min_secs, 'min_steps', min_steps, 'basis', coalesce(cfg ->> 'basis', 'time'), 'total_xp', (select xp from students where id = s.id));
end $$;

-- 자유운동 순위: 이번 주(월요일부터) 인정된 운동시간. 검토 중·반려 기록은 넣지 않아요
create or replace function student_free_rank(p_token uuid) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare s students; w0 date := date_trunc('week', seoul_today())::date;
begin
  s := session_student(p_token);
  return (with t as (
      select st.id, st.class, st.name, sum(w.active_secs) / 60 as minutes, sum(w.steps) as steps
      from workouts w join students st on st.id = w.student_id
      where st.grade = s.grade and st.active and w.status in ('OK', 'APPROVED') and w.day >= w0
      group by st.id),
    r as (select t.*, rank() over (order by minutes desc, steps desc) as rank from t)
    select json_build_object('from', w0,
      'top', coalesce((select json_agg(json_build_object('rank', rank, 'class', class, 'minutes', minutes, 'steps', steps, 'me', id = s.id,
                  'name', case when s.grade = 0 then regexp_replace(name, '\s', '', 'g') else mask_name(name) end) order by rank) from r where rank <= 20), '[]'),
      'me', (select json_build_object('rank', rank, 'minutes', minutes, 'steps', steps) from r where id = s.id),
      'total', (select count(*) from t)));
end $$;

-- ---------- 도전 ----------
create or replace function challenge_fits(c challenges, s students) returns boolean language sql stable as $$
  select (c.target_grade is null or c.target_grade = s.grade) and (c.target_class is null or c.target_class = s.class)
     and (c.scope <> 'class' or s.grade > 0) $$;
create or replace function challenge_progress(c challenges, s students) returns int
language sql stable security definer set search_path = public, extensions as $$
  select case when c.scope = 'class'
    then (select coalesce(sum(metric_of(m.id, c.metric, c.starts_on, least(c.ends_on, seoul_today()))), 0)::int from students m where m.active and m.grade = s.grade and m.class = s.class)
    else metric_of(s.id, c.metric, c.starts_on, least(c.ends_on, seoul_today())) end $$;

create or replace function student_challenges(p_token uuid) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare s students; today date := seoul_today();
begin
  s := session_student(p_token);
  return coalesce((select json_agg(json_build_object('id', c.id, 'title', c.title, 'scope', c.scope, 'metric', c.metric, 'goal', c.goal, 'xp', c.xp,
      'starts_on', c.starts_on, 'ends_on', c.ends_on, 'progress', case when c.starts_on <= today then challenge_progress(c, s) else 0 end,
      'done', (select json_build_object('at', d.done_at, 'xp', d.xp) from challenge_done d where d.challenge_id = c.id and d.student_id = s.id),
      'class_done', case when c.scope = 'class' then (select count(*) from challenge_done d join students m on m.id = d.student_id where d.challenge_id = c.id and m.grade = s.grade and m.class = s.class) end)
    order by (c.ends_on < today), c.ends_on, c.created_at)
    from challenges c where challenge_fits(c, s) and c.ends_on >= today - 7 and c.starts_on <= today + 7), '[]');
end $$;

-- 목표를 채우면 보상 받기 (한 번만). 기간이 끝나고 3일 안까지 받을 수 있어요
create or replace function student_challenge_claim(p_token uuid, p_id uuid) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s students; c challenges; today date := seoul_today(); n int;
begin
  s := session_student(p_token);
  select * into c from challenges where id = p_id;
  if not found or not challenge_fits(c, s) then return json_build_object('error', 'not_found'); end if;
  if today < c.starts_on then return json_build_object('error', 'not_open'); end if;
  if today > c.ends_on + 3 then return json_build_object('error', 'closed'); end if;
  if challenge_progress(c, s) < c.goal then return json_build_object('error', 'not_enough'); end if;
  insert into challenge_done (challenge_id, student_id, xp) values (c.id, s.id, c.xp) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('error', 'already'); end if;
  perform give_xp(s.id, c.xp, case when c.scope = 'class' then '우리 반 공동목표 달성' else '도전 달성' end, 'challenge:' || c.id);
  return json_build_object('ok', true, 'xp', c.xp, 'total_xp', (select xp from students where id = s.id));
end $$;

-- ---------- 선생님: 자유운동 ----------
create or replace function admin_free_list(p_status text, p_grade int, p_class int) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  return json_build_object(
    'review', (select count(*) from workouts where status = 'REVIEW'),
    'rows', coalesce((select json_agg(x) from (
      select w.id, w.kind, w.day, w.started_at, w.ended_at, w.active_secs, w.steps, w.minute_steps, w.screen_off_secs, w.status, w.flags, w.xp,
             s.grade, s.class, s.num, s.name, s.student_no
      from workouts w join students s on s.id = w.student_id
      where (p_status is null or w.status = p_status) and (p_grade is null or s.grade = p_grade) and (p_class is null or s.class = p_class)
      order by w.started_at desc limit 300) x), '[]'));
end $$;

-- 검토 중 기록: 인정하면 그날 한도 안에서 XP를 주고, 반려하면 기록만 남아요
create or replace function admin_free_review(p_id uuid, p_ok boolean) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare w workouts; v_xp int := 0;
begin
  perform need_staff();
  select * into w from workouts where id = p_id for update;
  if not found or w.status <> 'REVIEW' then return json_build_object('error', 'not_review'); end if;
  if p_ok then
    v_xp := free_xp_for(w.student_id, w.kind, w.day, w.id);
    update workouts set status = 'APPROVED', xp = v_xp, reviewed_by = auth.uid() where id = w.id;
    if v_xp > 0 then perform give_xp(w.student_id, v_xp, '자유운동 ' || free_kind_name(w.kind) || ' (선생님 인정)', 'workout:' || w.id, auth.uid()); end if;
  else
    update workouts set status = 'REJECTED', reviewed_by = auth.uid() where id = w.id;
  end if;
  return json_build_object('ok', true, 'xp', v_xp);
end $$;

-- 관리교사만: 자유운동 설정
create or replace function admin_save_free(p jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_owner() then raise exception 'not_owner'; end if;
  if coalesce((p ->> 'min_secs')::int, 600) not between 60 and 7200 then raise exception 'bad_value'; end if;
  if coalesce((p ->> 'daily_count')::int, 2) not between 0 and 20 or coalesce((p ->> 'daily_xp')::int, 40) not between 0 and 1000 then raise exception 'bad_value'; end if;
  update settings set free_workout = jsonb_build_object(
    'on', coalesce((p ->> 'on')::boolean, true),
    'kinds', coalesce(p -> 'kinds', '["walk", "run", "jumprope", "hometrain"]'::jsonb),
    'basis', case when p ->> 'basis' in ('time', 'steps', 'both') then p ->> 'basis' else 'time' end,
    'min_secs', coalesce((p ->> 'min_secs')::int, 600), 'min_steps', coalesce((p ->> 'min_steps')::int, 1000),
    'daily_count', coalesce((p ->> 'daily_count')::int, 2), 'daily_xp', coalesce((p ->> 'daily_xp')::int, 40),
    'xp', coalesce(p -> 'xp', '{"walk": 20, "run": 20, "jumprope": 20, "hometrain": 20}'::jsonb))
  where id = 1;
end $$;

-- ---------- 선생님: 도전 ----------
create or replace function admin_challenges() returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  return coalesce((select json_agg(x order by x.ends_on desc, x.created_at desc) from (
    select c.*, (select count(*) from challenge_done d where d.challenge_id = c.id) as done
    from challenges c order by c.ends_on desc limit 100) x), '[]');
end $$;

create or replace function admin_save_challenge(p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare cid uuid;
begin
  perform need_staff();
  if (p ->> 'scope') = 'class' and nullif(p ->> 'target_grade', '') is null then raise exception 'need_grade'; end if;
  insert into challenges (title, scope, metric, goal, xp, starts_on, ends_on, target_grade, target_class, created_by)
  values (p ->> 'title', p ->> 'scope', p ->> 'metric', (p ->> 'goal')::int, coalesce((p ->> 'xp')::int, 20),
          (p ->> 'starts_on')::date, (p ->> 'ends_on')::date, nullif(p ->> 'target_grade', '')::int, nullif(p ->> 'target_class', '')::int, auth.uid())
  returning id into cid;
  return cid;
end $$;

create or replace function admin_delete_challenge(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  -- 이미 준 XP는 되돌려요
  perform give_xp(d.student_id, -d.xp, '도전 삭제', 'challenge:' || d.challenge_id) from challenge_done d where d.challenge_id = p_id and d.xp > 0;
  delete from challenges where id = p_id;
end $$;

-- ---------- 선생님: 배지 · 종목 ----------
create or replace function admin_badges() returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  return json_build_object(
    'badges', coalesce((select json_agg(x order by x.sort, x.id) from (select b.*, (select count(*) from student_badges sb where sb.badge_id = b.id) as earned from badges b) x), '[]'),
    'sports', coalesce((select json_agg(x order by x.sort, x.id) from (select sp.*,
        (select count(*) from programs p where p.sport_id = sp.id) as programs from sports sp) x), '[]'));
end $$;

create or replace function admin_save_badge(p jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  if (p ->> 'id') is null then
    insert into badges (code, name, icon, kind, goal, sort)
    values ('b' || substr(md5(random()::text), 1, 10), p ->> 'name', coalesce(nullif(p ->> 'icon', ''), '🏅'), p ->> 'kind', (p ->> 'goal')::int,
            coalesce((select max(sort) from badges), 0) + 1);
  else
    update badges set name = coalesce(p ->> 'name', name), icon = coalesce(nullif(p ->> 'icon', ''), icon), goal = coalesce((p ->> 'goal')::int, goal),
      active = coalesce((p ->> 'active')::boolean, active)
    where id = (p ->> 'id')::int;
  end if;
end $$;

create or replace function admin_save_sport(p jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform need_staff();
  if (p ->> 'id') is null then
    insert into sports (name, icon, sort) values (p ->> 'name', coalesce(nullif(p ->> 'icon', ''), '🏅'), coalesce((select max(sort) from sports), 0) + 1);
  else
    update sports set name = coalesce(p ->> 'name', name), icon = coalesce(nullif(p ->> 'icon', ''), icon), active = coalesce((p ->> 'active')::boolean, active)
    where id = (p ->> 'id')::int;
  end if;
end $$;

create or replace function admin_set_program_sport(p_program int, p_sport int) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin perform need_staff(); update programs set sport_id = p_sport where id = p_program; end $$;
create or replace function admin_set_session_sport(p_session uuid, p_sport int) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin perform need_staff(); update qr_sessions set sport_id = p_sport where id = p_session; end $$;

-- ---------- 함수 실행 권한 ----------
-- 학생은 로그인 없이(anon) student_* 와 race_board 만, 선생님(authenticated)은 admin_* 도 (안에서 다시 확인해요)
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function student_login(text, text), student_signup(text, text, text), student_logout(uuid),
  student_change_pw(uuid, text, text), student_home(uuid), student_history(uuid), student_rank(uuid),
  student_race(uuid, int), student_scan(uuid, text, text, double precision, double precision),
  student_mission_submit(uuid, uuid, int, int, text), student_paps(uuid), race_board(int) to anon, authenticated;
-- 표 접근 규칙이 쓰는 도우미는 모두 실행할 수 있어야 해요 (로그인 안 했으면 false)
grant execute on function is_staff(), is_owner(), my_role() to anon, authenticated;
grant execute on function admin_open_session(int, int), admin_close_session(uuid), admin_reopen_session(uuid), admin_qr(uuid, text),
  admin_manual(uuid, uuid), admin_live(uuid, int), admin_sessions(int), admin_import_roster(jsonb), admin_students(int, int),
  admin_classes(), admin_reset_password(uuid), admin_set_active(uuid, boolean), admin_adjust_xp(uuid, int, text),
  admin_create_mission(text, int, int, int, int, timestamptz, timestamptz), admin_delete_mission(uuid), admin_missions(),
  admin_mission_subs(uuid, int, int), admin_dashboard(), admin_settings(), admin_save_settings(jsonb),
  admin_set_teacher(uuid, text), admin_save_program(jsonb), admin_import_staff(jsonb), admin_staff_board(),
  admin_paps_save(jsonb), admin_paps_class(int, int) to authenticated;
grant execute on function student_progress(uuid), student_calendar(uuid, date), student_report(uuid, date), student_free_state(uuid),
  student_free_start(uuid, text), student_free_cancel(uuid, uuid), student_free_finish(uuid, uuid, int, jsonb, int), student_free_rank(uuid),
  student_challenges(uuid), student_challenge_claim(uuid, uuid) to anon, authenticated;
grant execute on function admin_free_list(text, int, int), admin_free_review(uuid, boolean), admin_save_free(jsonb), admin_challenges(),
  admin_save_challenge(jsonb), admin_delete_challenge(uuid), admin_badges(), admin_save_badge(jsonb), admin_save_sport(jsonb),
  admin_set_program_sport(int, int), admin_set_session_sport(uuid, int) to authenticated;
