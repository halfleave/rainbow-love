// Supabase 客户端初始化（按需动态加载 CDN，断网/未配置时也不影响页面渲染）
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { toISODate } from './ui.js';

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// 动态初始化，避免 CDN 不可达时整页白屏
export let sb = null;
let initPromise = null;
let cachedUid = null;

async function currentUserId() {
  if (cachedUid) return cachedUid;
  if (!sb) await initSupabase();
  // session 可能因刷新/过期丢失，兜底重新匿名登录
  let { data: { user }, error } = await sb.auth.getUser();
  if (error || !user) {
    await ensureSession();
    const got = await sb.auth.getUser();
    user = got.data.user;
    error = got.error;
  }
  if (error) throw error;
  if (!user) throw new Error('未登录，请先开启匿名登录');
  cachedUid = user.id;
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
  return r.session;
}

// 取当前档案；不存在则创建「单人空间」+ 默认档案（个人模式可独立使用）
export async function getOrCreateProfile() {
  if (!sb) await initSupabase();
  const uid = await currentUserId();
  const { data } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (data) return { profile: data, isNew: false };

  let couple = null;
  for (let i = 0; i < 10; i++) {
    const code = genPairCode();
    const { data: c, error } = await sb.from('couples')
      .insert({ pair_code: code, start_date: toISODate(new Date()) })
      .select().single();
    if (!error && c) { couple = c; break; }
  }
  if (!couple) throw new Error('创建个人空间失败');

  const { data: p, error: pe } = await sb.from('profiles').insert({
    id: uid, couple_id: couple.id, nickname: '我', color: '#E86A92'
  }).select().single();
  if (pe) throw pe;
  return { profile: p, isNew: true };
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
