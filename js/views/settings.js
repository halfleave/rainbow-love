// 设置（聚合页：关于我们·成果统计 + 外观主题 + 账户入口）
import { escapeHtml, pageHeader } from '../ui.js';
import {
  loadAnniversaries, loadPlans, loadTasks, loadMovies,
  loadDiaryEntries, loadAllPhotos, loadCheckinsByType
} from '../supabase.js';

// 安全计数：单模块失败不影响整体统计
async function safeCount(fn) {
  try { const r = await fn(); return Array.isArray(r) ? r.length : (r || 0); }
  catch (_) { return 0; }
}

async function gatherStats(ctx) {
  const c = ctx.coupleId;
  const me = ctx.me && ctx.me.id;
  const out = { days: 0, anniv: 0, diary: 0, photo: 0, movie: 0, plan: 0, task: 0, checkin: 0 };

  // 在一起天数：来自空间起始日期
  if (ctx.couple && ctx.couple.start_date) {
    const d = Math.floor((Date.now() - new Date(ctx.couple.start_date).getTime()) / 86400000);
    out.days = d > 0 ? d : 0;
  }

  out.anniv = await safeCount(() => loadAnniversaries(c));
  out.diary = await safeCount(() => loadDiaryEntries(c, 200));
  out.photo = await safeCount(() => loadAllPhotos(c, 300));
  const [w, wd] = await Promise.all([
    safeCount(() => loadMovies(c, false)),
    safeCount(() => loadMovies(c, true))
  ]);
  out.movie = w + wd;
  out.plan = await safeCount(() => loadPlans(c));
  out.task = await safeCount(() => loadTasks(c));
  if (me) {
    let ck = 0;
    for (const t of ['morning', 'night', 'miss']) ck += await safeCount(() => loadCheckinsByType(c, me, t, 4000));
    out.checkin = ck;
  }
  return out;
}

function statCard(num, label, emoji) {
  return `
    <div class="stat-card">
      <div class="stat-num">${num}</div>
      <div class="stat-label">${emoji} ${escapeHtml(label)}</div>
    </div>`;
}

export async function render(root, ctx) {
  root.innerHTML = `
    ${pageHeader('设置')}
    <div class="fade-in">
      <div class="card">
        <div class="section-title">关于我们 · 成果统计</div>
        <div id="stats" class="stats-grid">
          <div class="placeholder"><p>统计中…</p></div>
        </div>
        <p class="tip">这些数据是你们一起走过的痕迹 💞</p>
      </div>

      <div class="card">
        <div class="section-title">外观</div>
        <div class="row between">
          <span>主题</span>
          <div class="seg" id="theme">
            <button data-t="light" class="${ctx.getTheme() === 'light' ? 'on' : ''}">浅色</button>
            <button data-t="dark" class="${ctx.getTheme() === 'dark' ? 'on' : ''}">深色</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="section-title">账户与数据</div>
        <div class="row-link" id="goProfile">
          <span class="rl-label">👤 资料与配对</span>
          <span class="chev">›</span>
        </div>
        <div class="row-link" id="goApi">
          <span class="rl-label">🔑 API 管理</span>
          <span class="chev">›</span>
        </div>
      </div>

      <p class="tip center">数据自动同步到云端，安心记录你们的每一天 💞</p>
    </div>`;

  root.querySelector('#header-back')?.addEventListener('click', () => {
    if (history.length > 1) history.back(); else ctx.navigate('/mine');
  });
  root.querySelector('#goProfile')?.addEventListener('click', () => ctx.navigate('/onboarding'));
  root.querySelector('#goApi')?.addEventListener('click', () => ctx.navigate('/api-config'));

  const themeSeg = root.querySelector('#theme');
  themeSeg?.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    ctx.setTheme(b.dataset.t);
    themeSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  }));

  const box = root.querySelector('#stats');
  const s = await gatherStats(ctx);
  box.innerHTML = `
    ${statCard(s.days, '在一起天数', '💞')}
    ${statCard(s.anniv, '纪念日', '📅')}
    ${statCard(s.diary, '日记', '📖')}
    ${statCard(s.photo, '照片', '🖼️')}
    ${statCard(s.movie, '影视', '🎬')}
    ${statCard(s.plan, '计划', '🗺️')}
    ${statCard(s.task, '任务', '📋')}
    ${statCard(s.checkin, '打卡', '🌅')}
  `;
}
