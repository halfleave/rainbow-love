// 彩虹 · 应用入口：Service Worker 注册、主题、底部 Tab、哈希路由
import { isConfigured, initSupabase, sb, ensureSession, getOrCreateProfile, getCouple, getPartner } from './supabase.js';
import { toast } from './ui.js';
import * as home from './views/home.js';
import * as memory from './views/memory.js';
import * as chat from './views/chat.js';
import * as mine from './views/mine.js';
import * as pairing from './views/pairing.js';
import * as onboarding from './views/onboarding.js';

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/><path d="M12 19v-4.4"/><path d="M12 14.6c-.9-1-2.2-.8-2.2-2 0-.7.7-1.2 1.2-.9.3.2.9.2 1.2 0 .5-.3 1.2.2 1.2.9 0 1.2-1.3 1-2.2 2z" fill="currentColor" stroke="none"/></svg>',
  memory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H5z"/><path d="M19 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4z"/></svg>',
  mine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.3"/><path d="M5.5 19a6.5 6.5 0 0 1 13 0"/></svg>'
};

const TABS = [
  { key: 'home', label: '首页', icon: ICONS.home, mod: home },
  { key: 'memory', label: '记忆', icon: ICONS.memory, mod: memory },
  { key: 'chat', label: '聊天', icon: ICONS.chat, mod: chat },
  { key: 'mine', label: '我的', icon: ICONS.mine, mod: mine }
];

const ROUTES = {
  '/home': home,
  '/memory': memory,
  '/chat': chat,
  '/mine': mine,
  '/pairing': pairing,
  '/onboarding': onboarding
};

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('rainbow-theme', t);
  const m = document.getElementById('meta-theme');
  if (m) m.content = t === 'dark' ? '#271E2B' : '#E86A92';
}

// 共享上下文，后续每一步的视图都通过它访问后端与工具
const ctx = {
  sb,
  isConfigured,
  me: null,          // 当前 profile
  coupleId: null,    // 当前空间（单人 or 共享）
  couple: null,      // 空间行（含 pair_code / start_date）
  partner: null,     // 伴侣 profile（null = 个人模式）
  navigate,
  toast,
  getTheme: () => localStorage.getItem('rainbow-theme') || 'light',
  setTheme,
  // 载入 profile 后补全 couple / partner 信息
  async applyProfile(profile) {
    this.me = profile;
    this.coupleId = profile ? profile.couple_id : null;
    this.couple = null;
    this.partner = null;
    if (this.coupleId) {
      try { this.couple = await getCouple(this.coupleId); } catch (e) { console.warn(e); }
      if (this.me) {
        try { this.partner = await getPartner(this.coupleId, this.me.id); } catch (e) { console.warn(e); }
      }
    }
  },
  isPaired() { return !!this.partner; },
  // 从云端重载最新身份/配对状态（配对成功后调用）
  async refresh() {
    if (!this.me) return;
    try {
      const { data } = await sb.from('profiles').select('*').eq('id', this.me.id).single();
      await this.applyProfile(data);
    } catch (e) { console.warn(e); }
  }
};

async function renderTabbar() {
  const bar = document.getElementById('tabbar');
  bar.innerHTML = TABS.map((t) => `
    <button class="tab" data-key="${t.key}" aria-label="${t.label}">
      ${t.icon}<span>${t.label}</span>
    </button>`).join('');
  bar.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => navigate('/' + btn.dataset.key));
  });
}

function syncTabActive() {
  const key = (location.hash.replace('#', '') || '/home').replace('/', '');
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.key === key));
}

async function route() {
  const path = location.hash.replace('#', '') || '/home';
  const mod = ROUTES[path] || home;
  const root = document.getElementById('view');
  syncTabActive();
  root.classList.toggle('no-tabbar', path === '/pairing' || path === '/onboarding');
  root.innerHTML = '';
  try {
    await mod.render(root, ctx);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="placeholder"><div class="big">🌸</div><p>页面出错了：${escapeText(e.message)}</p></div>`;
  }
}

function escapeText(s) {
  return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showConfigBanner() {
  if (isConfigured) return;
  const b = document.getElementById('banner');
  if (!b) return;
  b.hidden = false;
  b.textContent = '尚未配置 Supabase：在 js/config.js 填入 Project URL 与 anon key 即可连接云端（详见 sql/配置说明.md）。';
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

async function boot() {
  setTheme(ctx.getTheme());
  renderTabbar();
  registerSW();
  window.addEventListener('hashchange', route);

  let isNew = false;
  try {
    await initSupabase();
    ctx.sb = sb;
    await ensureSession();
    const res = await getOrCreateProfile();
    await ctx.applyProfile(res.profile);
    isNew = res.isNew;
  } catch (e) {
    console.warn('启动失败（检查 Supabase 配置/匿名登录/SQL）：', e);
    showConfigBanner();
  }

  // 路由：新用户先完善个人资料；否则进首页
  if (isNew) {
    location.hash = '/onboarding';
  } else if (!location.hash) {
    location.hash = '/home';
  } else {
    route();
  }
}

boot();
