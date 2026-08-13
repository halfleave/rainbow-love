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
