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

-- ============================================================
-- 取当前用户邀请码（绕过 couples RLS 读取异常，security definer）
-- ============================================================
create or replace function get_my_invite_code()
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
begin
  select c.pair_code into v_code
  from couples c
  join profiles p on p.couple_id = c.id
  where p.id = v_uid;

  if v_code is null then
    return json_build_object('ok', false, 'error', '未找到个人空间');
  end if;

  return json_build_object('ok', true, 'code', v_code);
end;
$$;

-- ============================================================
-- 原子创建「单人空间」：couple + profile 一起建，避免 couples select RLS
-- ============================================================
create or replace function create_single_space(p_nickname text, p_color text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_exists profiles%rowtype;
  v_code   text;
  v_tries  int := 0;
  v_couple couples%rowtype;
  v_profile profiles%rowtype;
begin
  -- 已有空间直接返回
  select * into v_exists from profiles where id = v_uid;
  if found then
    select * into v_couple from couples where id = v_exists.couple_id;
    return json_build_object('ok', true, 'profile', row_to_json(v_exists), 'couple', row_to_json(v_couple));
  end if;

  -- 生成唯一邀请码
  loop
    v_code := upper(substr(md5(random()::text), 1, 6));
    -- 过滤易混淆字符
    v_code := replace(replace(replace(replace(replace(replace(v_code, '0', '2'), 'O', '3'), 'I', '4'), 'L', '5'), '1', '6'), 'Z', '7');
    v_tries := v_tries + 1;
    begin
      insert into couples (pair_code, start_date) values (v_code, current_date) returning * into v_couple;
      exit;
    exception when unique_violation then
      if v_tries >= 20 then
        return json_build_object('ok', false, 'error', '邀请码生成失败，请重试');
      end if;
    end;
  end loop;

  -- 创建 profile
  insert into profiles (id, couple_id, nickname, color)
  values (v_uid, v_couple.id, coalesce(nullif(p_nickname,''), '我'), coalesce(nullif(p_color,''), '#E86A92'))
  returning * into v_profile;

  return json_build_object('ok', true, 'profile', row_to_json(v_profile), 'couple', row_to_json(v_couple));
end;
$$;
