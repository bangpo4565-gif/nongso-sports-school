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
  target_grade int check (target_grade between 1 and 3),
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
  where q.program_id = st.race_program_id and (q.target_grade is null or q.target_grade = p_grade)
    and (st.race_from is null or q.day >= st.race_from) and (st.race_to is null or q.day <= st.race_to);
  return json_build_object(
    'grade', p_grade, 'days', days, 'from', st.race_from, 'to', st.race_to, 'prizes', st.prizes,
    'program', (select name from programs where id = st.race_program_id),
    'rows', coalesce((
      select json_agg(r order by r.rate desc, r.class) from (
        select c.class, c.n, coalesce(p.cnt, 0) as parts,
               case when c.n * greatest(days, 1) = 0 then 0 else round(coalesce(p.cnt, 0)::numeric / (c.n * greatest(days, 1)), 4) end as rate
        from (select class, count(*) as n from students where grade = p_grade and active group by class) c
        left join (
          select s.class, count(*) as cnt from attendance a
          join qr_sessions q on q.id = a.session_id
          join students s on s.id = a.student_id
          where a.state in ('COMPLETED', 'MANUAL') and q.program_id = st.race_program_id and s.grade = p_grade
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
      select json_agg(json_build_object('id', q.id, 'program', p.name, 'min_seconds', p.min_seconds, 'xp', p.xp, 'geo', p.geo,
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
    select q.id, q.day, q.opened_at, q.closed_at, q.target_grade, p.name as program,
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
      (select count(*) from students s where s.active and s.grade > 0 and (m.target_grade is null or s.grade = m.target_grade) and (m.target_class is null or s.class = m.target_class)) as targets
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
    insert into programs (name, min_seconds, xp, geo, active, sort)
    values (trim(p ->> 'name'), (p ->> 'min_seconds')::int, (p ->> 'xp')::int, coalesce((p ->> 'geo')::boolean, false), true,
            coalesce((select max(sort) from programs), 0) + 1) returning id into pid;
  else
    update programs set name = coalesce(trim(p ->> 'name'), name), min_seconds = coalesce((p ->> 'min_seconds')::int, min_seconds),
      xp = coalesce((p ->> 'xp')::int, xp), geo = coalesce((p ->> 'geo')::boolean, geo), active = coalesce((p ->> 'active')::boolean, active)
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
  return json_build_object('from', st.race_from, 'to', st.race_to, 'program', (select name from programs where id = st.race_program_id),
    'rows', coalesce((select json_agg(x order by x.done desc, x.xp desc, x.num) from (
      select s.id, s.student_no, s.num, s.name, s.xp, s.active, s.signed_up_at,
        (select count(*) from attendance a join qr_sessions q on q.id = a.session_id
          where a.student_id = s.id and a.state in ('COMPLETED', 'MANUAL') and q.program_id = st.race_program_id
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
