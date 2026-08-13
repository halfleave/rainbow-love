// 彩虹 · 应用入口：Service Worker 注册、主题、底部 Tab、哈希路由
import { isConfigured, initSupabase, sb, ensureSession, getOrCreateProfile, getCouple, getPartner } from './supabase.js';
import { toast } from './ui.js';
// 视图模块改为按需动态 import()（见 ROUTES），首屏只加载必需 JS，避免一次性下载全部模块导致白屏

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/><path d="M12 19v-4.4"/><path d="M12 14.6c-.9-1-2.2-.8-2.2-2 0-.7.7-1.2 1.2-.9.3.2.9.2 1.2 0 .5-.3 1.2.2 1.2.9 0 1.2-1.3 1-2.2 2z" fill="currentColor" stroke="none"/></svg>',
  movie: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M3 15h18M8 4v16M16 4v16"/></svg>',
  memory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H5z"/><path d="M19 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4z"/></svg>',
  mine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.3"/><path d="M5.5 19a6.5 6.5 0 0 1 13 0"/></svg>'
};

// 底部 Tab 顺序：小屋（首页）→ 影视 → 聊天 → 记忆 → 我的
const TABS = [
  { key: 'home', label: '小屋', icon: ICONS.home },
  { key: 'movie', label: '影视', icon: ICONS.movie },
  { key: 'chat', label: '聊天', icon: ICONS.chat },
  { key: 'memory', label: '记忆', icon: ICONS.memory },
  { key: 'mine', label: '我的', icon: ICONS.mine }
];

// 路由 → 视图模块路径（按需动态 import）
const ROUTES = {
  '/home': './views/home.js',
  '/movie': './views/movie.js',
  '/chat': './views/chat.js',
  '/memory': './views/memory.js',
  '/mine': './views/mine.js',
  '/movies': './views/movie.js',
  '/movie-search': './views/movie-search.js',
  '/anniversaries': './views/anniversary.js',
  '/plans': './views/plan.js',
  '/tasks': './views/task.js',
  '/checkins': './views/checkin.js',
  '/api-config': './views/api-config.js',
  '/settings': './views/settings.js',
  '/pairing': './views/pairing.js',
  '/onboarding': './views/onboarding.js'
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
  // 视图可注册的离开钩子（如聊天页退订频道），route 切换前调用
  leaveHandler: null,
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
  const path = (location.hash.replace('#', '') || '/home');
  const map = { '/home': 'home', '/movie': 'movie', '/movies': 'movie', '/chat': 'chat', '/memory': 'memory', '/mine': 'mine' };
  const key = map[path] || null;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.key === key));
}

async function route() {
  const path = location.hash.replace('#', '') || '/home';
  const modPath = ROUTES[path] || ROUTES['/home'];
  const root = document.getElementById('view');
  syncTabActive();

  // 离开上一页：先执行其清理钩子（如聊天页退订 Realtime 频道）
  if (ctx.leaveHandler) {
    try { ctx.leaveHandler(); } catch (e) { console.warn('leaveHandler 出错', e); }
    ctx.leaveHandler = null;
  }

  // 视图容器样式：聊天页全屏独立滚动；二级页隐藏 Tab
  const cls = ['view'];
  if (path === '/chat') cls.push('is-chat');
  if (['/pairing', '/onboarding', '/anniversaries', '/plans', '/tasks', '/checkins', '/movie-search', '/api-config', '/settings'].includes(path)) cls.push('no-tabbar');
  root.className = cls.join(' ');

  // 先显示页内加载占位（缓慢旋转），避免空白等待
  root.innerHTML = '<div class="page-loading"><div class="spinner"></div><span>正在加载…</span></div>';

  let mod;
  try {
    mod = await import(modPath);
    if (typeof mod.render !== 'function') throw new Error('视图模块缺少 render 导出：' + modPath);
    await mod.render(root, ctx);
    // 视图可注册离开钩子
    if (typeof mod.cleanup === 'function') ctx.leaveHandler = mod.cleanup;
    hideBoot(); // 首次视图渲染完成，关闭首屏遮罩
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="placeholder"><div class="big">🌸</div><p>页面出错了：${escapeText(e.message)}</p></div>`;
  }
}

// 关闭首屏加载层（幂等）
function hideBoot() {
  const b = document.getElementById('boot');
  if (b) b.classList.add('hide');
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

  // 1) 立即渲染首屏（此时 ctx 尚无 profile，视图自行渲染骨架/空态），杜绝白屏
  await route();

  // 2) 后台初始化云端身份（不阻塞首屏；视图首次拉数据时会自动触发 Supabase 初始化）
  (async () => {
    try {
      await initSupabase();
      ctx.sb = sb;
      await ensureSession();
      const res = await getOrCreateProfile();
      await ctx.applyProfile(res.profile);
      // 初始化完成：新用户引导资料；老用户刷新当前页以填充数据
      if (res.isNew) {
        location.hash = '/onboarding';
      } else {
        await ctx.refresh();
        await route();
      }
    } catch (e) {
      console.warn('启动失败（检查 Supabase 配置/匿名登录/SQL）：', e);
      showConfigBanner();
    }
  })();
}

boot();
