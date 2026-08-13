-- ============================================================
-- 彩虹 · 对齐定稿（概要设计 v2 / 同步策略）迁移脚本
-- 执行时机：已执行过 init.sql 之后，到 Supabase Dashboard → SQL Editor 跑本文件。
-- 目标：把线上库结构对齐到定稿 §9 / §5：
--   1. couples 增加 is_paired（配对标记）
--   2. anniversaries / plans / tasks 增加 owner_id；anniversaries 增加 is_private
--   3. checkins：who → owner_id；新增 streak_self / streak_shared；移除单 streak
--   4. diary_entries：author_id → owner_id
--   5. movies：移除 rating_a/rating_b/review_a/review_b，新增 external_id(去重) + official_rating
--      新建 movie_reviews 分表（按 人一份、仅自己改）
--   6. 重写 RLS（§9.4 复制/同步/本地）
--   7. 重建 timeline 视图（列名对齐）
--   8. join_couple 增加 movie_reviews 迁移 + is_paired 置位
-- ============================================================

-- 0. 辅助函数 my_id()（RLS 中用，等价于 auth.uid()）
create or replace function my_id() returns uuid language sql stable as $$
  select auth.uid()
$$;

-- 1. couples：增加 is_paired
alter table couples add column if not exists is_paired boolean not null default false;

-- 2. anniversaries：owner_id + is_private
alter table anniversaries add column if not exists owner_id uuid references profiles(id);
alter table anniversaries add column if not exists is_private boolean not null default false;
update anniversaries set owner_id = (
  select id from profiles where profiles.couple_id = anniversaries.couple_id limit 1
) where owner_id is null;
alter table anniversaries alter column owner_id set not null;

-- 3. plans：owner_id
alter table plans add column if not exists owner_id uuid references profiles(id);
update plans set owner_id = (
  select id from profiles where profiles.couple_id = plans.couple_id limit 1
) where owner_id is null;
alter table plans alter column owner_id set not null;

-- 4. tasks：owner_id
alter table tasks add column if not exists owner_id uuid references profiles(id);
update tasks set owner_id = (
  select id from profiles where profiles.couple_id = tasks.couple_id limit 1
) where owner_id is null;
alter table tasks alter column owner_id set not null;

-- 5. checkins：who → owner_id；streak_self / streak_shared；移除旧 streak
alter table checkins rename column who to owner_id;
alter table checkins add column if not exists streak_self int not null default 1;
alter table checkins add column if not exists streak_shared int not null default 1;
alter table checkins drop column if exists streak;
alter table checkins drop constraint if exists checkins_couple_id_type_who_date_key;
alter table checkins add constraint checkins_couple_id_type_owner_id_date_key
  unique (couple_id, type, owner_id, date);

-- 6. diary_entries：author_id → owner_id
alter table diary_entries rename column author_id to owner_id;

-- 7. movies：拆分（同一部片仅一份，按 external_id 去重）
alter table movies drop column if exists rating_a;
alter table movies drop column if exists rating_b;
alter table movies drop column if exists review_a;
alter table movies drop column if exists review_b;
alter table movies add column if not exists external_id text;
alter table movies add column if not exists official_rating numeric(3,1);
update movies set external_id = id::text where external_id is null or external_id = '';
alter table movies alter column external_id set not null;
alter table movies add constraint movies_couple_id_external_id_key unique (couple_id, external_id);

-- 8. movie_reviews 分表（每人一份，仅自己改）
create table if not exists movie_reviews (
  id         uuid primary key default gen_random_uuid(),
  couple_id  uuid references couples(id) not null,
  owner_id   uuid references profiles(id) not null,
  movie_id   uuid references movies(id) not null,
  rating     numeric(2,1) check (rating between 0 and 5),
  review     text,
  created_at timestamptz default now(),
  unique (couple_id, owner_id, movie_id)
);

-- 9. 重建 timeline 视图（列名对齐：owner_id / actor_id）
create or replace view timeline as
  select 'diary' as source, id, couple_id, created_at, body as title, owner_id as actor_id from diary_entries where not is_deleted
  union all
  select 'anniversary', id, couple_id, date::timestamptz, title, owner_id from anniversaries where not is_deleted
  union all
  select 'movie', id, couple_id, created_at, title, null from movies where not is_deleted
  union all
  select 'plan', id, couple_id, created_at, title, owner_id from plans where not is_deleted
  union all
  select 'checkin', id, couple_id, created_at, type, owner_id from checkins;

-- 10. 重写 RLS（先删旧，再建新，严格对应 §9.4）
-- couples
drop policy if exists "创建空间" on couples;
drop policy if exists "同空间可读" on couples;
drop policy if exists "同空间可改起始日" on couples;
create policy "创建空间" on couples for insert to authenticated with check (true);
create policy "同空间可读" on couples for select to authenticated using (id = my_couple());
create policy "同空间可改" on couples for update to authenticated
  using (id = my_couple()) with check (id = my_couple());

-- profiles
drop policy if exists "同空间可读资料" on profiles;
drop policy if exists "本人可写资料" on profiles;
drop policy if exists "本人可改资料（锁定 couple）" on profiles;
create policy "同空间可读资料" on profiles for select to authenticated using (couple_id = my_couple());
create policy "本人可写资料" on profiles for insert to authenticated with check (id = auth.uid());
create policy "本人可改资料（锁定 couple）" on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and couple_id = (select couple_id from profiles where id = auth.uid()));

-- anniversaries（同步类；读受 is_private 限制）
drop policy if exists "同空间可读纪念日" on anniversaries;
drop policy if exists "同空间可写纪念日" on anniversaries;
drop policy if exists "同空间可改纪念日" on anniversaries;
create policy "同空间可读纪念日" on anniversaries for select to authenticated
  using (couple_id = my_couple() and (not is_private or owner_id = my_id()));
create policy "同空间可写纪念日" on anniversaries for insert to authenticated
  with check (couple_id = my_couple() and owner_id = my_id());
create policy "同空间可改纪念日" on anniversaries for update to authenticated
  using (couple_id = my_couple()) with check (couple_id = my_couple());
create policy "同空间可删纪念日" on anniversaries for delete to authenticated
  using (couple_id = my_couple());

-- plans（同步类）
drop policy if exists "同空间可读计划" on plans;
drop policy if exists "同空间可写计划" on plans;
drop policy if exists "同空间可改计划" on plans;
create policy "同空间可读计划" on plans for select to authenticated using (couple_id = my_couple() and not is_deleted);
create policy "同空间可写计划" on plans for insert to authenticated with check (couple_id = my_couple() and owner_id = my_id());
create policy "同空间可改计划" on plans for update to authenticated using (couple_id = my_couple()) with check (couple_id = my_couple());
create policy "同空间可删计划" on plans for delete to authenticated using (couple_id = my_couple());

-- tasks（同步类）
drop policy if exists "同空间可读任务" on tasks;
drop policy if exists "同空间可写任务" on tasks;
drop policy if exists "同空间可改任务" on tasks;
create policy "同空间可读任务" on tasks for select to authenticated using (couple_id = my_couple() and not is_deleted);
create policy "同空间可写任务" on tasks for insert to authenticated with check (couple_id = my_couple() and owner_id = my_id());
create policy "同空间可改任务" on tasks for update to authenticated using (couple_id = my_couple()) with check (couple_id = my_couple());
create policy "同空间可删任务" on tasks for delete to authenticated using (couple_id = my_couple());

-- checkins（复制类：仅自己改/删）
drop policy if exists "同空间可读打卡" on checkins;
drop policy if exists "同空间可写打卡" on checkins;
drop policy if exists "同空间可改打卡" on checkins;
create policy "同空间可读打卡" on checkins for select to authenticated using (couple_id = my_couple());
create policy "同空间可写打卡" on checkins for insert to authenticated with check (couple_id = my_couple() and owner_id = my_id());
create policy "同空间可改打卡" on checkins for update to authenticated
  using (couple_id = my_couple() and owner_id = my_id())
  with check (couple_id = my_couple() and owner_id = my_id());
create policy "同空间可删打卡" on checkins for delete to authenticated
  using (couple_id = my_couple() and owner_id = my_id());

-- diary_entries（复制类：仅自己改/删）
drop policy if exists "同空间可读日记" on diary_entries;
drop policy if exists "本人可写日记" on diary_entries;
drop policy if exists "本人可改日记" on diary_entries;
create policy "同空间可读日记" on diary_entries for select to authenticated using (couple_id = my_couple() and not is_deleted);
create policy "本人可写日记" on diary_entries for insert to authenticated with check (couple_id = my_couple() and owner_id = my_id());
create policy "本人可改日记" on diary_entries for update to authenticated
  using (couple_id = my_couple() and owner_id = my_id())
  with check (couple_id = my_couple() and owner_id = my_id());
create policy "本人可删日记" on diary_entries for delete to authenticated
  using (couple_id = my_couple() and owner_id = my_id());

-- diary_photos（复制类：仅作者对自己日记的图片读写）
drop policy if exists "同空间可读照片" on diary_photos;
drop policy if exists "本人可写照片" on diary_photos;
drop policy if exists "本人可删照片" on diary_photos;
create policy "同空间可读照片" on diary_photos for select to authenticated
  using (entry_id in (select id from diary_entries where couple_id = my_couple() and not is_deleted));
create policy "本人可写照片" on diary_photos for insert to authenticated
  with check (entry_id in (select id from diary_entries where couple_id = my_couple() and owner_id = my_id()));
create policy "本人可删照片" on diary_photos for delete to authenticated
  using (entry_id in (select id from diary_entries where couple_id = my_couple() and owner_id = my_id()));

-- movies（同步类；无 owner_id 门槛，双方可改/删）
drop policy if exists "同空间可读影视" on movies;
drop policy if exists "同空间可写影视" on movies;
drop policy if exists "同空间可改影视" on movies;
create policy "同空间可读影视" on movies for select to authenticated using (couple_id = my_couple() and not is_deleted);
create policy "同空间可写影视" on movies for insert to authenticated with check (couple_id = my_couple());
create policy "同空间可改影视" on movies for update to authenticated using (couple_id = my_couple()) with check (couple_id = my_couple());
create policy "同空间可删影视" on movies for delete to authenticated using (couple_id = my_couple());

-- movie_reviews（复制类：仅自己改/删）
alter table movie_reviews enable row level security;
drop policy if exists "同空间可读影评" on movie_reviews;
drop policy if exists "同空间可写影评" on movie_reviews;
drop policy if exists "同空间可改影评" on movie_reviews;
create policy "同空间可读影评" on movie_reviews for select to authenticated using (couple_id = my_couple());
create policy "同空间可写影评" on movie_reviews for insert to authenticated with check (couple_id = my_couple() and owner_id = my_id());
create policy "同空间可改影评" on movie_reviews for update to authenticated
  using (couple_id = my_couple() and owner_id = my_id())
  with check (couple_id = my_couple() and owner_id = my_id());
create policy "同空间可删影评" on movie_reviews for delete to authenticated
  using (couple_id = my_couple() and owner_id = my_id());

-- messages（不变）
drop policy if exists "同空间可读消息" on messages;
drop policy if exists "本人可发消息" on messages;
drop policy if exists "同空间可更新已读" on messages;
create policy "同空间可读消息" on messages for select to authenticated using (couple_id = my_couple());
create policy "本人可发消息" on messages for insert to authenticated
  with check (couple_id = my_couple() and sender_id = my_id());
create policy "同空间可更新已读" on messages for update to authenticated
  using (couple_id = my_couple()) with check (couple_id = my_couple());

-- 11. Realtime 增加 movie_reviews
do $$
begin
  alter publication supabase_realtime add table movie_reviews;
exception when duplicate_object then null;
end $$;

-- 12. join_couple：增加 movie_reviews 迁移，配对后置 is_paired=true
create or replace function join_couple(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_target uuid;
  v_mine   uuid;
  v_cnt    int;
begin
  select id into v_target from couples where pair_code = p_code;
  if v_target is null then
    return json_build_object('ok', false, 'error', '邀请码无效');
  end if;

  select couple_id into v_mine from profiles where id = v_uid;
  if v_mine is null then
    return json_build_object('ok', false, 'error', '请先完成个人设置');
  end if;

  select count(*) into v_cnt from profiles where couple_id = v_target;
  if v_cnt >= 2 then
    return json_build_object('ok', false, 'error', '该伴侣空间已满');
  end if;

  if v_mine = v_target then
    return json_build_object('ok', false, 'error', '不能加入自己的空间');
  end if;

  update anniversaries set couple_id = v_target where couple_id = v_mine;
  update plans         set couple_id = v_target where couple_id = v_mine;
  update tasks         set couple_id = v_target where couple_id = v_mine;
  update checkins      set couple_id = v_target where couple_id = v_mine;
  update diary_entries set couple_id = v_target where couple_id = v_mine;
  update movie_reviews set couple_id = v_target where couple_id = v_mine;
  update movies        set couple_id = v_target where couple_id = v_mine;
  update messages      set couple_id = v_target where couple_id = v_mine;

  update profiles set couple_id = v_target where id = v_uid;
  update couples set is_paired = true where id = v_target;
  delete from couples
   where id = v_mine
     and not exists (select 1 from profiles where couple_id = v_mine);

  return json_build_object('ok', true, 'couple_id', v_target);
end;
$$;
