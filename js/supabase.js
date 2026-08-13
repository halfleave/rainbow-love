// Supabase 客户端初始化（按需动态加载 CDN，断网/未配置时也不影响页面渲染）
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { toISODate } from './ui.js';

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// 动态初始化，避免 CDN 不可达时整页白屏
export let sb = null;
let initPromise = null;
let cachedUid = null;

async function currentUserId() {
  if (!sb) await initSupabase();
  // 以本地 session 为准；如果与缓存不一致则更新缓存，防止重新登录后 uid 对不上
  const { data: { session }, error: se } = await sb.auth.getSession();
  if (se) throw se;
  if (session?.user) {
    if (cachedUid && cachedUid !== session.user.id) {
      console.warn('[auth] uid 已变更（session 丢失后重新登录）:', cachedUid, '->', session.user.id);
    }
    cachedUid = session.user.id;
    return cachedUid;
  }
  // session 丢失，兜底重新匿名登录
  const { data: r, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  if (!r.session?.user) throw new Error('匿名登录后仍无 session');
  if (cachedUid && cachedUid !== r.session.user.id) {
    console.warn('[auth] uid 已变更（重新匿名登录）:', cachedUid, '->', r.session.user.id);
  }
  cachedUid = r.session.user.id;
  return cachedUid;
}

export function initSupabase() {
  if (!isConfigured) return Promise.resolve(null);
  if (sb) return Promise.resolve(sb);
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return sb;
  })();
  return initPromise;
}

// ============================================================
// 身份与配对（第3步）
// ============================================================

// 6 位易读邀请码（去易混字符）
export function genPairCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// 匿名登录（无 session 时自动注册匿名用户）
export async function ensureSession() {
  if (!sb) await initSupabase();
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session;
  const { data: r, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  // 重新登录后 uid 变了，清掉缓存让 currentUserId 重新取
  cachedUid = null;
  return r.session;
}

// 原子创建/刷新「单人空间」：couple + profile 一起建，避免 couples select RLS
// 使用 RPC 绕过 couples 表 select RLS：刚创建空间时 profile 尚无 couple_id，直接 select couples 会被拒绝
export async function createSingleSpace(nickname = '我', color = '#E86A92') {
  if (!sb) await initSupabase();
  await ensureSession();
  const { data: r, error } = await sb.rpc('create_single_space', {
    p_nickname: nickname,
    p_color: color
  });
  if (error) throw new Error('创建个人空间失败：' + (error.message || error));
  if (!r || !r.ok) throw new Error('创建个人空间失败：' + (r?.error || '未知错误'));
  return r.profile;
}

// 取当前档案；不存在则创建默认「单人空间」
export async function getOrCreateProfile() {
  if (!sb) await initSupabase();
  const uid = await currentUserId();
  const { data } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (data) return { profile: data, isNew: false };

  const profile = await createSingleSpace('我', '#E86A92');
  return { profile, isNew: true };
}

export async function updateProfile(patch) {
  await ensureSession();        // 确保 session 存在（防止刷新/过期丢失）
  const uid = await currentUserId();
  // 先更新；如果 profile 行因任何原因不存在，则改为 upsert
  const { error } = await sb.from('profiles').upsert({ id: uid, ...patch });
  if (error) throw error;
  // upsert 不返回行时，再单独读一次（兼容不同 Supabase 返回行为）
  const { data, error: readErr } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (readErr) throw readErr;
  if (!data) throw new Error('更新后读取档案为空，请检查 RLS 策略');
  return data;
}

export async function getCouple(coupleId) {
  const { data, error } = await sb.from('couples').select('*').eq('id', coupleId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getPartner(coupleId, myId) {
  const { data, error } = await sb.from('profiles')
    .select('*').eq('couple_id', coupleId).neq('id', myId).maybeSingle();
  if (error) throw error;
  return data; // null = 仍处于单人空间
}

// 加入对方空间（调用 SQL 里的 join_couple，会把个人历史并入共享空间）
export async function joinCouple(code) {
  const { data, error } = await sb.rpc('join_couple', { p_code: String(code || '').toUpperCase() });
  if (error) throw error;
  return data; // { ok:true, couple_id } | { ok:false, error }
}

// 双向确认配对：发起/确认（双方都填对方码才成功，先填方保留空间）
export async function requestPair(code) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.rpc('request_pair', { p_code: String(code || '').toUpperCase() });
  if (error) throw error;
  return data; // { ok:true, paired:true, couple_id } | { ok:true, pending:true } | { ok:false, error }
}

// 查询自己是否处于"等待对方确认"态（已进入配对页时判断初始状态）
export async function getMyIntent() {
  if (!sb) await initSupabase();
  const { data, error } = await sb.rpc('my_pair_intent');
  if (error) throw error;
  return data || { pending: false }; // { pending:true, to_code } | { pending:false }
}

// 取当前用户邀请码（RPC 方式，更稳）
export async function getInviteCode() {
  const { data, error } = await sb.rpc('get_my_invite_code');
  if (error) throw error;
  return data; // { ok:true, code } | { ok:false, error }
}

// ============================================================
// 聊天（第4步）：消息 + Realtime + Presence + Broadcast
// ============================================================

// 加载历史消息（新→老排序后取最近 limit 条，再反转为老→新）
export async function loadMessages(coupleId, limit = 50) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('messages')
    .select('*').eq('couple_id', coupleId)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).reverse();
}

// 发送文字 / 图片消息
export async function sendMessage({ coupleId, body, imageUrl }) {
  await ensureSession();
  const uid = await currentUserId();
  const { error } = await sb.from('messages').insert({
    couple_id: coupleId,
    sender_id: uid,
    kind: imageUrl ? 'image' : 'text',
    body: body || null,
    image_url: imageUrl || null
  });
  if (error) throw error;
}

// 批量标记「对方发来的、未读」消息为已读（打开会话时调用）
export async function markRead(coupleId, myId) {
  if (!sb) await initSupabase();
  const { error } = await sb.from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('couple_id', coupleId)
    .neq('sender_id', myId)
    .is('read_at', null);
  if (error) throw error;
}

// 上传聊天图片到 Storage（chat bucket），返回存储路径
export async function uploadChatImage(coupleId, file) {
  await ensureSession();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext) ? ext : 'jpg';
  const path = `chat/${coupleId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const { error } = await sb.storage.from('chat').upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  return path;
}

// 聊天图片的公开访问 URL（需 chat bucket 为 public，见 sql/配置说明.md）
export function getChatImageUrl(path) {
  if (!sb || !path) return '';
  return sb.storage.from('chat').getPublicUrl(path).data.publicUrl;
}

// 订阅聊天频道：实时 INSERT / Presence(在线) / Broadcast(输入中)
// 返回 channel 对象，离开页面时调用 unsubscribeChat(channel) 清理
export function subscribeChat({ coupleId, myId, onInsert, onPresence, onTyping }) {
  if (!sb) return null;
  const channel = sb.channel(`chat:${coupleId}`, {
    config: { presence: { key: myId }, broadcast: { self: false } }
  });

  channel
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      filter: `couple_id=eq.${coupleId}`
    }, (payload) => { onInsert && onInsert(payload.new); })
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const others = Object.values(state).flat();
      const online = others.some((p) => p && p.user_id && p.user_id !== myId);
      onPresence && onPresence(online);
    })
    .on('broadcast', { event: 'typing' }, () => { onTyping && onTyping(); });

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      try { await channel.track({ user_id: myId, online_at: new Date().toISOString() }); } catch (_) {}
    }
  });
  return channel;
}

// 退订频道（离开聊天页必须调用，防止连接累积）
export function unsubscribeChat(channel) {
  if (channel && sb) {
    try { sb.removeChannel(channel); } catch (_) {}
  }
}

// ============================================================
// 首页聚合（第5步）：只读拉取
// ============================================================

// 纪念日（未删除）
export async function loadAnniversaries(coupleId) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('anniversaries')
    .select('*').eq('couple_id', coupleId).eq('is_deleted', false)
    .order('date', { ascending: true });
  if (error) throw error;
  return data || [];
}

// 新建纪念日
export async function createAnniversary({ coupleId, ownerId, title, date, isLunar, type, isPrivate }) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('anniversaries')
    .insert({
      couple_id: coupleId, owner_id: ownerId, title, date,
      is_lunar: !!isLunar, type: type || null, is_private: !!isPrivate
    })
    .select().maybeSingle();
  if (error) throw error;
  return data;
}

// 更新纪念日
export async function updateAnniversary(id, patch) {
  if (!sb) await initSupabase();
  const clean = {};
  if ('title' in patch) clean.title = patch.title;
  if ('date' in patch) clean.date = patch.date;
  if ('isLunar' in patch) clean.is_lunar = patch.isLunar;
  if ('type' in patch) clean.type = patch.type;
  if ('isPrivate' in patch) clean.is_private = patch.isPrivate;
  if (!Object.keys(clean).length) return;
  const { error } = await sb.from('anniversaries').update(clean).eq('id', id);
  if (error) throw error;
}

// 删除纪念日（软删）
export async function deleteAnniversary(id) {
  if (!sb) await initSupabase();
  const { error } = await sb.from('anniversaries').update({ is_deleted: true }).eq('id', id);
  if (error) throw error;
}

// 计划（未删除）
export async function loadPlans(coupleId) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('plans')
    .select('*').eq('couple_id', coupleId).eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// 新建计划
export async function createPlan({ coupleId, ownerId, title, description, type, status }) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('plans')
    .insert({
      couple_id: coupleId, owner_id: ownerId, title,
      description: description || null, type: type || null,
      status: status || 'idea'
    })
    .select().maybeSingle();
  if (error) throw error;
  return data;
}

// 更新计划
export async function updatePlan(id, patch) {
  if (!sb) await initSupabase();
  const clean = {};
  if ('title' in patch) clean.title = patch.title;
  if ('description' in patch) clean.description = patch.description;
  if ('type' in patch) clean.type = patch.type;
  if ('status' in patch) clean.status = patch.status;
  if (!Object.keys(clean).length) return;
  const { error } = await sb.from('plans').update(clean).eq('id', id);
  if (error) throw error;
}

// 删除计划（软删）
export async function deletePlan(id) {
  if (!sb) await initSupabase();
  const { error } = await sb.from('plans').update({ is_deleted: true }).eq('id', id);
  if (error) throw error;
}

// 今日/未完成任务（含指派执行人昵称与代表色）
export async function loadTodayTasks(coupleId) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('tasks')
    .select('*, assignee:profiles(nickname, color)')
    .eq('couple_id', coupleId).eq('is_deleted', false);
  if (error) throw error;
  return (data || []).filter((t) => t.status !== 'done');
}

// 今日打卡（含本人/伴侣）
export async function loadTodayCheckins(coupleId, myId) {
  if (!sb) await initSupabase();
  const today = toISODate(new Date());
  const { data, error } = await sb.from('checkins')
    .select('*').eq('couple_id', coupleId).eq('date', today);
  if (error) throw error;
  return data || [];
}

// 最近日记（含作者昵称/代表色）
export async function loadRecentDiary(coupleId, limit = 5) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('diary_entries')
    .select('*, author:profiles(nickname, color)')
    .eq('couple_id', coupleId).eq('is_deleted', false)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// 最近照片（来自日记图片，按时间倒序，过滤本空间未删除）
export async function loadRecentPhotos(coupleId, limit = 6) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('diary_photos')
    .select('*, entry:diary_entries(couple_id, is_deleted)')
    .order('created_at', { ascending: false }).limit(limit * 4);
  if (error) throw error;
  return (data || [])
    .filter((p) => p.entry && p.entry.couple_id === coupleId && !p.entry.is_deleted)
    .slice(0, limit);
}

// 切换任务状态（今日速览里勾选）
export async function toggleTask(taskId, done) {
  await ensureSession();
  const { error } = await sb.from('tasks').update({ status: done ? 'done' : 'todo' }).eq('id', taskId);
  if (error) throw error;
}

// 任务列表（未删除，含指派执行人昵称/代表色）
export async function loadTasks(coupleId) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('tasks')
    .select('*, assignee:profiles!tasks_assignee_id_fkey(nickname, color)')
    .eq('couple_id', coupleId).eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// 新建任务
export async function createTask({ coupleId, ownerId, title, assigneeId, isPrivate, deadline }) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('tasks')
    .insert({
      couple_id: coupleId, owner_id: ownerId, title,
      assignee_id: assigneeId || ownerId,
      status: 'todo',
      is_private: !!isPrivate,
      deadline: deadline || null
    })
    .select('*, assignee:profiles!tasks_assignee_id_fkey(nickname, color)')
    .maybeSingle();
  if (error) throw error;
  return data;
}

// 更新任务
export async function updateTask(id, patch) {
  if (!sb) await initSupabase();
  const clean = {};
  if ('title' in patch) clean.title = patch.title;
  if ('assigneeId' in patch) clean.assignee_id = patch.assigneeId;
  if ('status' in patch) clean.status = patch.status;
  if ('isPrivate' in patch) clean.is_private = patch.isPrivate;
  if ('deadline' in patch) clean.deadline = patch.deadline; // 允许置空(null)
  if (!Object.keys(clean).length) return;
  const { error } = await sb.from('tasks').update(clean).eq('id', id);
  if (error) throw error;
}

// 删除任务（软删）
export async function deleteTask(id) {
  if (!sb) await initSupabase();
  const { error } = await sb.from('tasks').update({ is_deleted: true }).eq('id', id);
  if (error) throw error;
}

// 打卡（一人一天一类型唯一）
export async function checkIn(coupleId, type, note = '') {
  await ensureSession();
  const uid = await currentUserId();
  const { error } = await sb.from('checkins').upsert(
    { couple_id: coupleId, type, owner_id: uid, note },
    { onConflict: 'couple_id,type,owner_id,date' }
  );
  if (error) throw error;
}

// 取某类型最近打卡日期（用于前端计算连续天数）
export async function loadCheckinsByType(coupleId, ownerId, type, sinceDays = 400) {
  if (!sb) await initSupabase();
  const since = toISODate(new Date(Date.now() - sinceDays * 86400000));
  const { data, error } = await sb.from('checkins')
    .select('date, note')
    .eq('couple_id', coupleId).eq('owner_id', ownerId).eq('type', type)
    .gte('date', since).order('date', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ============================================================
// 影视（条目同步去重·影评按人一份）
// ============================================================

// 影视列表（按 想看/已看 过滤，未删除）
export async function loadMovies(coupleId, watched) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('movies')
    .select('*').eq('couple_id', coupleId).eq('is_deleted', false).eq('watched', watched)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// 单部影视
export async function loadMovieById(id) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('movies').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

// 新建/更新影视（按 external_id 去重，想看→已看 同一部不重复）
export async function upsertMovie({ coupleId, externalId, title, poster, watched, meta, officialRating }) {
  await ensureSession();
  const payload = {
    couple_id: coupleId,
    external_id: externalId,
    title,
    poster: poster || null,
    watched: !!watched,
    is_deleted: false
  };
  if (meta !== undefined) payload.meta = meta || null;
  if (officialRating !== undefined) payload.official_rating = officialRating == null ? null : Number(officialRating);
  const { data, error } = await sb.from('movies')
    .upsert(payload, { onConflict: 'couple_id,external_id' })
    .select().maybeSingle();
  if (error) throw error;
  return data;
}

// 编辑影视（标题/海报）
export async function updateMovie(id, patch) {
  await ensureSession();
  const clean = {};
  if ('title' in patch) clean.title = patch.title;
  if ('poster' in patch) clean.poster = patch.poster || null;
  if (!Object.keys(clean).length) return;
  const { error } = await sb.from('movies').update(clean).eq('id', id);
  if (error) throw error;
}

// 标记已看 / 未看
export async function setMovieWatched(id, watched) {
  await ensureSession();
  const { error } = await sb.from('movies').update({ watched: !!watched }).eq('id', id);
  if (error) throw error;
}

// 软删除影视
export async function deleteMovie(id) {
  await ensureSession();
  const { error } = await sb.from('movies').update({ is_deleted: true }).eq('id', id);
  if (error) throw error;
}

// 某部影视的全部影评（双方，详情页展示）
export async function loadReviewsForMovie(coupleId, movieId) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('movie_reviews')
    .select('owner_id, rating, review').eq('couple_id', coupleId).eq('movie_id', movieId);
  if (error) throw error;
  return data || [];
}

// 我的全部影评（列表页快速取评分映射）
export async function loadMyReviews(coupleId, ownerId) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('movie_reviews')
    .select('movie_id, rating').eq('couple_id', coupleId).eq('owner_id', ownerId);
  if (error) throw error;
  return data || [];
}

// 写/改自己的影评（按 人 一份 upsert）
export async function upsertReview({ coupleId, movieId, rating, review }) {
  await ensureSession();
  const uid = await currentUserId();
  const { error } = await sb.from('movie_reviews').upsert({
    couple_id: coupleId, owner_id: uid, movie_id: movieId,
    rating: rating == null ? null : rating,
    review: review || null
  }, { onConflict: 'couple_id,owner_id,movie_id' });
  if (error) throw error;
}

// ============================================================
// 记忆·日记（第6步）：列表 / 详情 / 写 / 编辑 / 删除（软）
// ============================================================

// 日记列表（倒序，含作者昵称/代表色）
export async function loadDiaryEntries(coupleId, limit = 60) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('diary_entries')
    .select('*, author:profiles(nickname, color)')
    .eq('couple_id', coupleId).eq('is_deleted', false)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// 日记详情（含作者 + 图片列表）
export async function loadDiaryEntry(id) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('diary_entries')
    .select('*, author:profiles(nickname, color), photos:diary_photos(id, url, created_at)')
    .eq('id', id).eq('is_deleted', false).maybeSingle();
  if (error) throw error;
  return data;
}

// 写日记（文字 + 多图）。图片先上传 Storage 再入库 diary_photos
export async function createDiary({ coupleId, body, files = [] }) {
  await ensureSession();
  const uid = await currentUserId();
  // 1. 插入日记正文
  const { data: entry, error } = await sb.from('diary_entries')
    .insert({ couple_id: coupleId, owner_id: uid, body }).select('id').maybeSingle();
  if (error) throw new Error('写日记失败：' + (error.message || error));
  if (!entry || !entry.id) throw new Error('写日记后未取到 id');
  // 2. 逐个上传图片并写入 diary_photos（url 存 storage path，读取时直链）
  for (const f of files) {
    try {
      const path = await uploadDiaryImage(coupleId, f);
      const { error: pe } = await sb.from('diary_photos').insert({ entry_id: entry.id, url: path });
      if (pe) console.warn('图片入库失败', pe);
    } catch (e) {
      console.warn('图片上传失败', e);
    }
  }
  return entry;
}

// 编辑日记正文（仅作者，由 RLS 约束）
export async function updateDiary(id, patch) {
  await ensureSession();
  const { error } = await sb.from('diary_entries').update(patch).eq('id', id);
  if (error) throw error;
}

// 软删除日记（仅作者，由 RLS 约束）
export async function deleteDiary(id) {
  await ensureSession();
  const { error } = await sb.from('diary_entries').update({ is_deleted: true }).eq('id', id);
  if (error) throw error;
}

// 照片墙：聚合全部日记图片（按时间倒序）
export async function loadAllPhotos(coupleId, limit = 120) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('diary_photos')
    .select('id, url, created_at, entry:diary_entries!diary_photos_entry_id_fkey(couple_id, is_deleted)')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || [])
    .filter((p) => p.entry && p.entry.couple_id === coupleId && !p.entry.is_deleted);
}

// 回忆时光轴：聚合多源（diary/anniversary/movie/plan/checkin）
export async function loadTimeline(coupleId, limit = 80) {
  if (!sb) await initSupabase();
  const { data, error } = await sb.from('timeline')
    .select('*').eq('couple_id', coupleId)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// 上传日记图片到 Storage（diary bucket，需 public 以直链显示）
export async function uploadDiaryImage(coupleId, file) {
  await ensureSession();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext) ? ext : 'jpg';
  const path = `diary/${coupleId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const { error } = await sb.storage.from('diary').upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  return path;
}

// 日记图片直链（需 diary bucket 为 public）
export function getDiaryImageUrl(path) {
  if (!sb || !path) return '';
  return sb.storage.from('diary').getPublicUrl(path).data.publicUrl;
}
