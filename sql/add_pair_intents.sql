-- ============================================================
-- 彩虹 · 双向确认配对（在已执行 init.sql + add_pair_rpc.sql 之后执行）
-- 目标：把"一方填码即合并"升级为"双方都填了对方的码才牵手成功"，
--       且先填邀请码的一方保留自己的空间（后填方并入先填方空间）。
-- ============================================================

-- 1. 配对意向表：记录"谁想加入哪个邀请码对应的空间"
create table if not exists pair_intents (
  from_uid    uuid primary key,                 -- 发起方（填了对方码的人）= auth.uid()
  to_code     text not null,                    -- 对方邀请码（想加入的空间）
  created_at  timestamptz default now()
);

-- 2. 查询自己是否处于"等待对方确认"态
create or replace function my_pair_intent()
returns json language sql security definer set search_path = public as $$
  select coalesce(
    (select json_build_object('pending', true, 'to_code', to_code)
       from pair_intents where from_uid = auth.uid()),
    json_build_object('pending', false)
  );
$$;

-- 3. 发起 / 确认配对（双向确认核心）
create or replace function request_pair(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_mine     uuid;          -- 我当前的空间
  v_mycode   text;          -- 我的邀请码
  v_target   uuid;          -- 对方空间
  v_other    uuid;          -- 对方（已填我码的人）
  v_cnt      int;
begin
  -- 取自己的档案
  select couple_id, (select pair_code from couples where id = p.couple_id)
    into v_mine, v_mycode
    from profiles p where id = v_uid;
  if v_mine is null then
    return json_build_object('ok', false, 'error', '请先完成个人设置');
  end if;

  -- 对方空间
  select id into v_target from couples where pair_code = p_code;
  if v_target is null then
    return json_build_object('ok', false, 'error', '邀请码无效');
  end if;

  if v_mine = v_target then
    return json_build_object('ok', false, 'error', '不能加入自己的空间');
  end if;

  select count(*) into v_cnt from profiles where couple_id = v_target;
  if v_cnt >= 2 then
    return json_build_object('ok', false, 'error', '该伴侣空间已满');
  end if;

  -- 是否已存在"对方填了我的码"的意向？
  select from_uid into v_other from pair_intents where to_code = v_mycode;

  if v_other is not null then
    -- 双向匹配：先填方（v_other 对应的空间）保留，当前用户并入对方空间
    -- 当前用户各表历史并入 v_target（对方空间），与 join_couple 逻辑一致
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

    -- 清理本次/历史意向
    delete from pair_intents where from_uid = v_uid or from_uid = v_other;

    return json_build_object('ok', true, 'paired', true, 'couple_id', v_target);
  end if;

  -- 未匹配：登记我的意向（upsert，便于改主意重填）
  insert into pair_intents (from_uid, to_code)
    values (v_uid, p_code)
  on conflict (from_uid) do update set to_code = excluded.to_code, created_at = now();

  return json_build_object('ok', true, 'pending', true);
end;
$$;

-- 4. RLS（仅通过 RPC 访问，这里放开本人对自己意向的读写以便排查）
alter table pair_intents enable row level security;
drop policy if exists "本人可管自己意向" on pair_intents;
create policy "本人可管自己意向" on pair_intents for all to authenticated
  using (from_uid = auth.uid()) with check (from_uid = auth.uid());
