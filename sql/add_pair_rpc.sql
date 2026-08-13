-- ============================================================
-- 彩虹 · 配对合并函数（追加执行，无需重建表）
-- 在已执行 init.sql 之后，再到 SQL Editor 跑这一段即可。
-- 作用：让"后配对的一方"加入对方的空间，并把其个人历史数据并入共享空间。
-- ============================================================

create or replace function join_couple(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_target uuid;
  v_mine   uuid;
  v_cnt    int;
begin
  -- 1. 找到对方空间
  select id into v_target from couples where pair_code = p_code;
  if v_target is null then
    return json_build_object('ok', false, 'error', '邀请码无效');
  end if;

  -- 2. 当前用户必须已有个人档案（含单人空间）
  select couple_id into v_mine from profiles where id = v_uid;
  if v_mine is null then
    return json_build_object('ok', false, 'error', '请先完成个人设置');
  end if;

  -- 3. 对方空间不能已满
  select count(*) into v_cnt from profiles where couple_id = v_target;
  if v_cnt >= 2 then
    return json_build_object('ok', false, 'error', '该伴侣空间已满');
  end if;

  -- 4. 不能加入自己的空间
  if v_mine = v_target then
    return json_build_object('ok', false, 'error', '不能加入自己的空间');
  end if;

  -- 5. 把当前用户在各表的"个人历史"并入共享空间
  update anniversaries set couple_id = v_target where couple_id = v_mine;
  update plans         set couple_id = v_target where couple_id = v_mine;
  update tasks         set couple_id = v_target where couple_id = v_mine;
  update checkins      set couple_id = v_target where couple_id = v_mine;
  update diary_entries set couple_id = v_target where couple_id = v_mine;
  update movies        set couple_id = v_target where couple_id = v_mine;
  update messages      set couple_id = v_target where couple_id = v_mine;

  -- 6. 本人移入共享空间；单人空间若已无人则删除
  update profiles set couple_id = v_target where id = v_uid;
  delete from couples
   where id = v_mine
     and not exists (select 1 from profiles where couple_id = v_mine);

  return json_build_object('ok', true, 'couple_id', v_target);
end;
$$;
