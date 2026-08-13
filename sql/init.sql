-- ============================================================
-- 彩虹 · Supabase 初始化 SQL
-- 复制到 Supabase Dashboard → SQL Editor → New query → Run
-- 执行顺序：扩展 → 表 → 视图 → 索引 → RLS 函数/策略 → Realtime → Storage
-- ============================================================

-- 1. 扩展（uuid 生成）
create extension if not exists pgcrypto;

-- 2. 表结构
-- 情侣对
create table if not exists couples (
  id          uuid primary key default gen_random_uuid(),
  pair_code   text unique not null,
  start_date  date not null,
  is_paired   boolean default false,
  created_at  timestamptz default now()
);

-- 两人身份（id 即 auth.uid()）
create table if not exists profiles (
  id          uuid primary key default auth.uid(),
  couple_id   uuid references couples(id) not null,
  nickname    text not null,
  avatar_url  text,
  color       text not null,
  created_at  timestamptz default now()
);

-- 纪念日（is_lunar=true 时 date 为农历换算后的公历日期；同步类·双方可改删；普通默认 is_private=false）
create table if not exists anniversaries (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid references couples(id) not null,
  owner_id    uuid references profiles(id) not null,
  title       text not null,
  date        date not null,
  is_lunar    boolean default false,
  type        text,
  is_private  boolean default false,
  created_at  timestamptz default now(),
  is_deleted  boolean default false
);

-- 未来计划（同步类·双方可改删）
create table if not exists plans (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid references couples(id) not null,
  owner_id    uuid references profiles(id) not null,
  title       text not null,
  description text,
  type        text,
  status      text default 'idea' check (status in ('idea','doing','done')),
  created_at  timestamptz default now(),
  is_deleted  boolean default false
);

-- 日常任务（同步类·双方可改删）
create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid references couples(id) not null,
  owner_id    uuid references profiles(id) not null,
  title       text not null,
  assignee_id uuid references profiles(id),
  status      text default 'todo' check (status in ('todo','done')),
  created_at  timestamptz default now(),
  is_deleted  boolean default false
);

-- 日常打卡（一人一天一类型唯一；复制类·仅自己改；双连续天数指标）
create table if not exists checkins (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid references couples(id) not null,
  owner_id     uuid references profiles(id) not null,
  type         text not null check (type in ('morning','evening','miss')),
  date         date default current_date,
  note         text,
  streak_self    int default 1,
  streak_shared int default 1,
  created_at   timestamptz default now(),
  unique (couple_id, type, owner_id, date)
);

-- 情侣日记（复制类·仅自己改）
create table if not exists diary_entries (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid references couples(id) not null,
  owner_id    uuid references profiles(id) not null,
  body        text not null,
  created_at  timestamptz default now(),
  is_deleted  boolean default false
);

-- 日记图片（照片墙唯一来源）
create table if not exists diary_photos (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid references diary_entries(id) not null,
  url         text not null,
  created_at  timestamptz default now()
);

-- 影视条目（同步类·按 external_id 去重一份；不含双方评分，评分在 movie_reviews 分表）
create table if not exists movies (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid references couples(id) not null,
  external_id   text not null,
  title         text not null,
  poster        text,
  official_rating numeric(3,1),
  watched       boolean default false,
  created_at    timestamptz default now(),
  is_deleted    boolean default false,
  unique (couple_id, external_id)
);

-- 影评（复制类·按人一份·仅自己改）
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

-- 聊天消息
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid references couples(id) not null,
  sender_id   uuid references profiles(id) not null,
  body        text,
  kind        text default 'text' check (kind in ('text','image')),
  image_url   text,
  created_at  timestamptz default now(),
  read_at     timestamptz
);

-- 3. 索引
create index if not exists idx_profiles_couple_id on profiles (couple_id);
create index if not exists idx_messages_couple_created on messages (couple_id, created_at desc);
create index if not exists idx_diary_entries_couple_created on diary_entries (couple_id, created_at desc);
create index if not exists idx_checkins_lookup on checkins (couple_id, type, owner_id, date);
create index if not exists idx_diary_photos_entry on diary_photos (entry_id);
create index if not exists idx_anniversaries_couple_date on anniversaries (couple_id, date);
create index if not exists idx_plans_status on plans (couple_id, status);
create index if not exists idx_tasks_status on tasks (couple_id, status);

-- 4. 回忆时间轴视图
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

-- 5. 启用 RLS
alter table couples enable row level security;
alter table profiles enable row level security;
alter table anniversaries enable row level security;
alter table plans enable row level security;
alter table tasks enable row level security;
alter table checkins enable row level security;
alter table diary_entries enable row level security;
alter table diary_photos enable row level security;
alter table movies enable row level security;
alter table movie_reviews enable row level security;
alter table messages enable row level security;

-- 6. 辅助函数（security definer 才能绕过 profiles 的 RLS 取 couple_id）
create or replace function my_couple()
returns uuid language sql stable security definer as $$
  select couple_id from profiles where id = auth.uid();
$$;

create or replace function is_same_couple(target uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and couple_id = target
  );
$$;

create or replace function my_id()
returns uuid language sql stable as $$
  select auth.uid()
$$;

-- 7. RLS 策略
-- couples：创建空间时可插入；配对后仅本 couple 可见/可改 start_date
create policy "创建空间" on couples for insert to authenticated with check (true);
create policy "同空间可读" on couples for select to authenticated using (id = my_couple());
create policy "同空间可改起始日" on couples for update to authenticated
  using (id = my_couple()) with check (id = my_couple());

-- profiles
create policy "同空间可读资料" on profiles for select to authenticated using (couple_id = my_couple());
create policy "本人可写资料" on profiles for insert to authenticated with check (id = auth.uid());
create policy "本人可改资料（锁定 couple）" on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and couple_id = (select couple_id from profiles where id = auth.uid()));

-- couples：创建空间时可插入；配对后仅本 couple 可见/可改
create policy "创建空间" on couples for insert to authenticated with check (true);
create policy "同空间可读" on couples for select to authenticated using (id = my_couple());
create policy "同空间可改" on couples for update to authenticated
  using (id = my_couple()) with check (id = my_couple());

-- anniversaries（同步类；读受 is_private 限制）
create policy "同空间可读纪念日" on anniversaries for select to authenticated
  using (couple_id = my_couple() and (not is_private or owner_id = my_id()));
create policy "同空间可写纪念日" on anniversaries for insert to authenticated
  with check (couple_id = my_couple() and owner_id = my_id());
create policy "同空间可改纪念日" on anniversaries for update to authenticated
  using (couple_id = my_couple()) with check (couple_id = my_couple());
create policy "同空间可删纪念日" on anniversaries for delete to authenticated
  using (couple_id = my_couple());

-- plans（同步类）
create policy "同空间可读计划" on plans for select to authenticated using (couple_id = my_couple() and not is_deleted);
create policy "同空间可写计划" on plans for insert to authenticated with check (couple_id = my_couple() and owner_id = my_id());
create policy "同空间可改计划" on plans for update to authenticated using (couple_id = my_couple()) with check (couple_id = my_couple());
create policy "同空间可删计划" on plans for delete to authenticated using (couple_id = my_couple());

-- tasks（同步类）
create policy "同空间可读任务" on tasks for select to authenticated using (couple_id = my_couple() and not is_deleted);
create policy "同空间可写任务" on tasks for insert to authenticated with check (couple_id = my_couple() and owner_id = my_id());
create policy "同空间可改任务" on tasks for update to authenticated using (couple_id = my_couple()) with check (couple_id = my_couple());
create policy "同空间可删任务" on tasks for delete to authenticated using (couple_id = my_couple());

-- checkins（复制类：仅自己改/删）
create policy "同空间可读打卡" on checkins for select to authenticated using (couple_id = my_couple());
create policy "同空间可写打卡" on checkins for insert to authenticated with check (couple_id = my_couple() and owner_id = my_id());
create policy "同空间可改打卡" on checkins for update to authenticated
  using (couple_id = my_couple() and owner_id = my_id())
  with check (couple_id = my_couple() and owner_id = my_id());
create policy "同空间可删打卡" on checkins for delete to authenticated
  using (couple_id = my_couple() and owner_id = my_id());

-- diary_entries（复制类：仅自己改/删）
create policy "同空间可读日记" on diary_entries for select to authenticated using (couple_id = my_couple() and not is_deleted);
create policy "本人可写日记" on diary_entries for insert to authenticated with check (couple_id = my_couple() and owner_id = my_id());
create policy "本人可改日记" on diary_entries for update to authenticated
  using (couple_id = my_couple() and owner_id = my_id())
  with check (couple_id = my_couple() and owner_id = my_id());
create policy "本人可删日记" on diary_entries for delete to authenticated
  using (couple_id = my_couple() and owner_id = my_id());

-- diary_photos（复制类：仅作者对自己日记的图片读写）
create policy "同空间可读照片" on diary_photos for select to authenticated
  using (entry_id in (select id from diary_entries where couple_id = my_couple() and not is_deleted));
create policy "本人可写照片" on diary_photos for insert to authenticated
  with check (entry_id in (select id from diary_entries where couple_id = my_couple() and owner_id = my_id()));
create policy "本人可删照片" on diary_photos for delete to authenticated
  using (entry_id in (select id from diary_entries where couple_id = my_couple() and owner_id = my_id()));

-- movies（同步类）
create policy "同空间可读影视" on movies for select to authenticated using (couple_id = my_couple() and not is_deleted);
create policy "同空间可写影视" on movies for insert to authenticated with check (couple_id = my_couple());
create policy "同空间可改影视" on movies for update to authenticated using (couple_id = my_couple()) with check (couple_id = my_couple());
create policy "同空间可删影视" on movies for delete to authenticated using (couple_id = my_couple());

-- movie_reviews（复制类：仅自己改/删）
create policy "同空间可读影评" on movie_reviews for select to authenticated using (couple_id = my_couple());
create policy "同空间可写影评" on movie_reviews for insert to authenticated with check (couple_id = my_couple() and owner_id = my_id());
create policy "同空间可改影评" on movie_reviews for update to authenticated
  using (couple_id = my_couple() and owner_id = my_id())
  with check (couple_id = my_couple() and owner_id = my_id());
create policy "同空间可删影评" on movie_reviews for delete to authenticated
  using (couple_id = my_couple() and owner_id = my_id());

-- messages
create policy "同空间可读消息" on messages for select to authenticated using (couple_id = my_couple());
create policy "本人可发消息" on messages for insert to authenticated
  with check (couple_id = my_couple() and sender_id = auth.uid());
create policy "同空间可更新已读" on messages for update to authenticated
  using (couple_id = my_couple()) with check (couple_id = my_couple());

-- 8. Realtime 发布
do $$
begin
  alter publication supabase_realtime add table messages;
  alter publication supabase_realtime add table diary_entries;
  alter publication supabase_realtime add table diary_photos;
  alter publication supabase_realtime add table plans;
  alter publication supabase_realtime add table tasks;
  alter publication supabase_realtime add table checkins;
  alter publication supabase_realtime add table anniversaries;
  alter publication supabase_realtime add table movies;
  alter publication supabase_realtime add table movie_reviews;
exception when duplicate_object then
  -- 已存在则忽略
  null;
end
$$;

-- 9. Storage buckets（头像、日记图片、聊天图片）
-- 说明：avatars 设 private（需签名访问）；diary/chat 设 public（照片墙与聊天图片需直链实时显示）
insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', false),
  ('diary', 'diary', true),
  ('chat', 'chat', true)
on conflict (id) do nothing;

-- Storage 权限：已登录用户可读可写这三个 bucket（路径中已包含 couple_id/user_id，实际由应用控制）
create policy "avatars 可读写" on storage.objects for all to authenticated
  using (bucket_id = 'avatars') with check (bucket_id = 'avatars');
create policy "diary 可读写" on storage.objects for all to authenticated
  using (bucket_id = 'diary') with check (bucket_id = 'diary');
create policy "chat 可读写" on storage.objects for all to authenticated
  using (bucket_id = 'chat') with check (bucket_id = 'chat');
