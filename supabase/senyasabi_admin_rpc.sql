-- SenyaSabi admin dashboard: RPC functions (v2)
-- Learners = every row in auth.users that is NOT in public.admin_users.
-- Needs these tables: lesson_progress, lessons, modules, quizzes, quiz_attempts,
-- streaks, minigames, minigame_attempts (user_id, minigame_id, completed_at,
-- score, accuracy, duration_seconds), admin_users (user_id).

-- ------------------------------------------------------------------ access check
create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public, auth as $$
  select exists (select 1 from public.admin_users a where a.user_id = auth.uid());
$$;

-- ------------------------------------------- internal views (not exposed to the API)
drop view if exists public.v_admin_user_rows;
create view public.v_admin_user_rows as
select
  a.id as user_id,
  coalesce(a.raw_user_meta_data ->> 'name', split_part(a.email, '@', 1)) as name,
  a.email,
  a.created_at      as registered_at,
  a.last_sign_in_at as last_login,
  (select count(*) from public.lesson_progress lp
     where lp.user_id = a.id and lp.status = 'Completed') as lessons_completed,
  (select count(*) from public.quiz_attempts qa
     where qa.user_id = a.id and qa.completed_at is not null) as quizzes_completed,
  (select count(*) from public.minigame_attempts ma
     where ma.user_id = a.id and ma.completed_at is not null) as minigames_completed,
  (select round(avg(t.acc), 2) from (
      select qa.percentage as acc from public.quiz_attempts qa
        where qa.user_id = a.id and qa.completed_at is not null and qa.percentage is not null
      union all
      select ma.accuracy from public.minigame_attempts ma
        where ma.user_id = a.id and ma.completed_at is not null and ma.accuracy is not null
  ) t) as average_accuracy,
  (
    coalesce((select sum(lp.time_spent_seconds) from public.lesson_progress lp
                where lp.user_id = a.id), 0)
    + coalesce((select sum(coalesce(qa.duration_seconds::numeric,
                                    extract(epoch from qa.completed_at - qa.started_at)))
                from public.quiz_attempts qa
                where qa.user_id = a.id and qa.completed_at is not null), 0)
    + coalesce((select sum(ma.duration_seconds) from public.minigame_attempts ma
                where ma.user_id = a.id and ma.completed_at is not null), 0)
  )::bigint as total_time_spent_seconds,
  coalesce(st.current_streak, 0) as current_streak,
  coalesce(st.longest_streak, 0) as longest_streak
from auth.users a
left join public.streaks st on st.user_id = a.id
where a.deleted_at is null
  and not exists (select 1 from public.admin_users au where au.user_id = a.id);

drop view if exists public.v_admin_module_progress;
create view public.v_admin_module_progress as
select
  r.user_id, m.module_id,
  count(l.lesson_id) as total_lessons,
  count(l.lesson_id) filter (where lp.status = 'Completed') as completed_lessons,
  coalesce(round(
    sum(case when lp.status = 'Completed' then 100.0
             else coalesce(lp.completion_percentage, 0) end)
    / nullif(count(l.lesson_id), 0), 2), 0) as completion_percentage,
  case
    when count(l.lesson_id) = 0 then 'Not Started'
    when count(l.lesson_id) filter (where lp.status = 'Completed') = count(l.lesson_id) then 'Completed'
    when count(l.lesson_id) filter (where coalesce(lp.completion_percentage, 0) > 0
                                       or lp.status in ('In Progress', 'Completed')) > 0 then 'In Progress'
    else 'Not Started'
  end as status,
  max(lp.last_accessed) as last_accessed
from public.v_admin_user_rows r
cross join public.modules m
left join public.lessons l on l.parent_module = m.module_id and l.is_active and not l.is_deleted
left join public.lesson_progress lp on lp.user_id = r.user_id and lp.lesson_id = l.lesson_id
where m.is_active and not m.is_deleted
group by r.user_id, m.module_id;

revoke all on public.v_admin_user_rows, public.v_admin_module_progress
  from public, anon, authenticated;

-- ------------------------------------------------------------ overview dashboard
create or replace function public.admin_dashboard_summary()
returns jsonb language plpgsql stable security definer
set search_path = public, auth as $$
declare r jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with
  s as (select * from public.v_admin_user_rows),
  act as (
    select s.user_id,
      greatest(
        s.last_login,
        (select max(updated_at)   from public.lesson_progress   where user_id = s.user_id),
        (select max(started_at)   from public.quiz_attempts     where user_id = s.user_id),
        (select max(completed_at) from public.minigame_attempts where user_id = s.user_id)
      ) as last_active
    from s
  ),
  lessons_total as (
    select count(*) as n from public.lessons where is_active and not is_deleted
  ),
  ls as (
    select s.user_id,
      count(*) filter (where lp.status = 'Completed') as done,
      count(*) filter (where lp.status <> 'Not Started' or lp.completion_percentage > 0) as touched
    from s left join public.lesson_progress lp on lp.user_id = s.user_id
    group by s.user_id
  ),
  mp as (
    select m.module_id, m.title, m.module_order,
      round(avg(v.completion_percentage), 1) as avg_progress,
      count(*) filter (where v.status = 'Completed') as completed_users,
      round(100.0 * count(*) filter (where v.status = 'Completed') / nullif(count(*), 0), 1) as pct_completed
    from public.modules m
    join public.v_admin_module_progress v on v.module_id = m.module_id
    where m.is_active and not m.is_deleted
    group by m.module_id, m.title, m.module_order
  ),
  ln as (
    select l.lesson_id, l.title, m.title as module_title,
      m.module_order, l.lesson_order,
      round(100.0 * count(distinct lp.user_id) filter (where lp.status = 'Completed')
            / nullif((select count(*) from s), 0), 1) as pct_completed
    from public.lessons l
    join public.modules m on m.module_id = l.parent_module
    left join public.lesson_progress lp
      on lp.lesson_id = l.lesson_id
     and lp.user_id in (select user_id from s)
    where l.is_active and not l.is_deleted
      and m.is_active and not m.is_deleted
    group by l.lesson_id, l.title, m.title, m.module_order, l.lesson_order
  ),
  qa as (
    select q.* from public.quiz_attempts q
    where q.completed_at is not null and q.percentage is not null
      and q.user_id in (select user_id from s)
  ),
  fl as (
    select user_id, quiz_id,
      (array_agg(percentage order by started_at asc))[1]  as first_pct,
      (array_agg(percentage order by started_at desc))[1] as latest_pct
    from qa group by user_id, quiz_id
  )
  select jsonb_build_object(
    'stats', jsonb_build_object(
      'total_users',         (select count(*) from s),
      'lessons_completed',   (select coalesce(sum(lessons_completed), 0) from s),
      'avg_accuracy',        (select round(avg(average_accuracy), 1) from s),
      'quizzes_completed',   (select coalesce(sum(quizzes_completed), 0) from s),
      'minigames_completed', (select coalesce(sum(minigames_completed), 0) from s),
      'avg_time_seconds',    (select round(avg(total_time_spent_seconds)) from s),
      'avg_current_streak',  (select round(coalesce(avg(current_streak), 0), 1) from s),
      'active_7d',           (select count(*) from act where last_active >= now() - interval '7 days'),
      'active_30d',          (select count(*) from act where last_active >= now() - interval '30 days'),
      'pct_one_lesson',      (select round(100.0 * count(*) filter (where done > 0) / nullif(count(*), 0), 1) from ls)
    ),
    'lesson_distribution', jsonb_build_object(
      'not_started', (select count(*) from ls where touched = 0 and done = 0),
      'in_progress', (select count(*) from ls, lessons_total t
                      where (touched > 0 or done > 0) and not (t.n > 0 and done >= t.n)),
      'completed',   (select count(*) from ls, lessons_total t where t.n > 0 and done >= t.n)
    ),
    'modules', (select coalesce(jsonb_agg(to_jsonb(mp) order by module_order), '[]'::jsonb) from mp),
    'lessons', (select coalesce(jsonb_agg(jsonb_build_object(
        'title', ln.title, 'module_title', ln.module_title,
        'pct_completed', ln.pct_completed)
        order by ln.module_order, ln.lesson_order), '[]'::jsonb) from ln),
    'quiz', jsonb_build_object(
      'avg_score',       (select round(avg(percentage), 1) from qa),
      'pass_rate',       (select round(100.0 * count(*) filter (where passed) / nullif(count(*), 0), 1) from qa),
      'camera_accuracy', (select round(avg(camera_accuracy), 1) from qa),
      'mc_accuracy',     (select round(avg(mc_accuracy), 1) from qa),
      'first_attempt',   (select round(avg(first_pct), 1) from fl),
      'latest_attempt',  (select round(avg(latest_pct), 1) from fl)
    )
  ) into r;

  return r;
end $$;

-- ------------------------------------------------------------------ learner list
create or replace function public.admin_list_users()
returns jsonb language plpgsql stable security definer
set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.registered_at desc), '[]'::jsonb)
          from public.v_admin_user_rows x);
end $$;

-- -------------------------------------------------------------- learner profile
create or replace function public.admin_user_profile(p_user_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'user', (select to_jsonb(x) from public.v_admin_user_rows x where x.user_id = p_user_id),
    'modules', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'title', m.title, 'total_lessons', v.total_lessons,
        'completed_lessons', v.completed_lessons,
        'completion_percentage', v.completion_percentage,
        'status', v.status, 'last_accessed', v.last_accessed
      ) order by m.module_order), '[]'::jsonb)
      from public.v_admin_module_progress v
      join public.modules m on m.module_id = v.module_id
      where v.user_id = p_user_id),
    'quizzes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'title', q.title, 'started_at', qa.started_at, 'percentage', qa.percentage,
        'passed', qa.passed, 'camera_accuracy', qa.camera_accuracy,
        'mc_accuracy', qa.mc_accuracy, 'duration_seconds', qa.duration_seconds
      ) order by qa.started_at desc), '[]'::jsonb)
      from (select * from public.quiz_attempts
            where user_id = p_user_id and completed_at is not null
            order by started_at desc limit 100) qa
      join public.quizzes q on q.quiz_id = qa.quiz_id),
    'minigames', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'title', g.game_name, 'completed_at', ma.completed_at, 'score', ma.score,
        'accuracy', ma.accuracy, 'duration_seconds', ma.duration_seconds
      ) order by ma.completed_at desc), '[]'::jsonb)
      from (select * from public.minigame_attempts
            where user_id = p_user_id and completed_at is not null
            order by completed_at desc limit 100) ma
      join public.minigames g on g.minigame_id = ma.minigame_id)
  );
end $$;

-- ------------------------------------------------------------------------ grants
revoke all on function public.is_admin(), public.admin_dashboard_summary(),
  public.admin_list_users(), public.admin_user_profile(uuid) from public, anon;
grant execute on function public.is_admin(), public.admin_dashboard_summary(),
  public.admin_list_users(), public.admin_user_profile(uuid) to authenticated;

notify pgrst, 'reload schema';
