// 首页（第5步）：天数 / 纪念日倒计时 / 今日情话 / 今日速览 / 回忆入口
import {
  daysBetween, toISODate, escapeHtml, fmtDate
} from '../ui.js';
import {
  loadAnniversaries, loadTodayTasks, loadTodayCheckins,
  loadRecentDiary, loadRecentPhotos, toggleTask, checkIn
} from '../supabase.js';
import { nextOccurrence, formatLunar, solarToLunar } from '../lunar.js';

const WORDS = {
  morning: [
    '早安，想你想了一整夜。',
    '新的一天，第一个念头是你。',
    '今天也要好好吃早餐，记得想我。',
    '阳光和你，都是我起床的理由。'
  ],
  afternoon: [
    '忙里偷闲，也想和你说话。',
    '午后的风很软，像你的手。',
    '今天也要加油呀，我一直在。',
    '无论多忙，你都是我心里的甜。'
  ],
  evening: [
    '晚安，今天也辛苦啦。',
    '想和你一起，虚度每一个黄昏。',
    '今天有没有好好吃饭、好好想我？',
    '夜色很美，可惜你不在身边。'
  ]
};

function pickWord() {
  const h = new Date().getHours();
  const group = h < 11 ? WORDS.morning : h < 18 ? WORDS.afternoon : WORDS.evening;
  return group[Math.floor(Math.random() * group.length)];
}

function countdownLabel(ann) {
  let m, d;
  if (ann.is_lunar) {
    const p = ann.date.split('-').map(Number);
    const l = solarToLunar(new Date(p[0], p[1] - 1, p[2]));
    m = l.month; d = l.day;
  } else {
    m = Number(ann.date.slice(5, 7)); d = Number(ann.date.slice(8, 10));
  }
  const t = nextOccurrence(m, d, new Date());
  const n = daysBetween(toISODate(new Date()), toISODate(t));
  if (n === 0) return '就是今天 🎉';
  return `还有 ${n} 天`;
}

export async function render(root, ctx) {
  const pair = ctx.isPaired();
  const start = ctx.couple ? ctx.couple.start_date : null;
  const days = start ? daysBetween(start, toISODate(new Date())) : 0;
  const me = ctx.me || {};

  root.innerHTML = `<div class="fade-in" id="home-body">
    <div class="hero">
      ${pair ? `
        <div class="days">${days}<small>天</small></div>
        <div class="since">从 ${escapeHtml(start)} 起，我们在一起</div>
      ` : `
        <div class="days" style="font-size:28px">${escapeHtml(me.nickname || '我')} 的空间</div>
        <div class="since">个人模式 · 随时可邀请 TA</div>
      `}
      <div class="heart heartbeat">💗</div>
    </div>
    <div id="home-loader" class="placeholder"><div class="big">🌸</div><p>正在加载…</p></div>
  </div>`;

  // 并发拉取首页数据（个人模式 / 配对模式 通用：除聊天外功能都以自己的数据为中心）
  let ann = [], tasks = [], checks = [], diary = [], photos = [];
  let loadErr = '';
  try {
    [ann, tasks, checks, diary, photos] = await Promise.all([
      loadAnniversaries(ctx.coupleId),
      loadTodayTasks(ctx.coupleId),
      loadTodayCheckins(ctx.coupleId, me.id),
      loadRecentDiary(ctx.coupleId, 3),
      loadRecentPhotos(ctx.coupleId, 6)
    ]);
  } catch (e) {
    loadErr = e?.message || String(e);
    console.warn('首页数据拉取失败', e);
  }

  const word = pickWord();
  const nextAnn = ann.length ? ann[0] : null;
  const checkedMap = {};
  checks.forEach((c) => { checkedMap[c.type] = c; });

  root.querySelector('#home-loader').outerHTML = `
    ${loadErr ? `<div class="card" style="border:1px solid var(--danger); color:var(--danger)"><div class="section-title">数据加载失败</div><p class="tip">${escapeHtml(loadErr)}</p></div>` : ''}
    <!-- 纪念日倒计时 -->
    <div class="card ann-card" id="annCard">
      <div class="ann-left">
        <div class="ann-title">${escapeHtml(nextAnn ? nextAnn.title : '还没有纪念日')}</div>
        <div class="ann-sub">${nextAnn ? countdownLabel(nextAnn) : '去添加一个吧'}</div>
      </div>
      <div class="ann-heart">💞</div>
    </div>
    ${ann.length > 1 ? `<div class="ann-more" id="annMore">还有 ${ann.length - 1} 个纪念日 ›</div>` : ''}

    <!-- 今日情话 -->
    <div class="card word-card">
      <div class="section-title">今日情话</div>
      <p class="word" id="word">${escapeHtml(word)}</p>
      <button class="btn ghost sm" id="changeWord">换一句</button>
    </div>

    <!-- 今日速览 -->
    <div class="card">
      <div class="section-title">今日速览</div>
      <div class="sub2">打卡</div>
      <div class="checkin-row" id="checkinRow">
        ${renderCheckin('morning', '🌅 早安', checkedMap.morning)}
        ${renderCheckin('evening', '🌙 晚安', checkedMap.evening)}
        ${renderCheckin('miss', '💭 想念', checkedMap.miss)}
      </div>
      <div class="sub2">任务 ${tasks.length ? '' : '（今天没有）'}</div>
      <div class="task-list" id="taskList">
        ${tasks.length ? tasks.map((t) => renderTask(t)).join('') : '<p class="tip">轻轻松松的一天 ✨</p>'}
      </div>
    </div>

    <!-- 回忆入口 -->
    <div class="card">
      <div class="section-title">最新回忆</div>
      ${diary.length ? diary.map((d) => `
        <div class="mini-diary">
          <div class="avatar xs" style="background:${escapeHtml((d.author && d.author.color) || '#ccc')}">${escapeHtml(((d.author && d.author.nickname) || '?')[0])}</div>
          <div class="mini-body">
            <div class="mini-meta">${escapeHtml((d.author && d.author.nickname) || 'TA')} · ${fmtDate(d.created_at)}</div>
            <div class="mini-text">${escapeHtml(d.body.slice(0, 40))}${d.body.length > 40 ? '…' : ''}</div>
          </div>
        </div>`).join('') : '<p class="tip">还没有日记，去「记忆」写第一篇吧</p>'}
      ${photos.length ? `
        <div class="photo-strip">
          ${photos.map((p) => `<img class="photo-thumb" src="${escapeHtml(p.url)}" alt="">`).join('')}
        </div>` : ''}
      <button class="btn ghost block" id="goMemory" style="margin-top:10px">进入记忆</button>
    </div>

  `;

  root.querySelector('#changeWord')?.addEventListener('click', () => {
    root.querySelector('#word').textContent = pickWord();
  });
  root.querySelector('#goMemory')?.addEventListener('click', () => ctx.navigate('/memory'));
  root.querySelector('#annCard')?.addEventListener('click', () => ctx.navigate('/anniversaries'));
  root.querySelector('#annMore')?.addEventListener('click', () => ctx.navigate('/anniversaries'));
  root.querySelector('#goPair')?.addEventListener('click', () => ctx.navigate('/pairing'));

  // 打卡点击
  root.querySelectorAll('.checkin-chip').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const type = chip.dataset.type;
      if (chip.classList.contains('on')) return;
      chip.classList.add('on');
      try { await checkIn(ctx.coupleId, type); }
      catch (e) { chip.classList.remove('on'); ctx.toast('打卡失败：' + (e.message || e)); }
    });
  });

  // 任务勾选
  root.querySelectorAll('.task-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const id = item.dataset.id;
      item.classList.toggle('done');
      const done = item.classList.contains('done');
      try { await toggleTask(id, done); }
      catch (e) { item.classList.toggle('done'); ctx.toast('更新失败：' + (e.message || e)); }
    });
  });
}

function renderCheckin(type, label, rec) {
  const on = rec ? 'on' : '';
  const note = rec && rec.note ? `· ${escapeHtml(rec.note)}` : '';
  return `<div class="checkin-chip ${on}" data-type="${type}">
    <span class="chip-label">${label}${note}</span>
  </div>`;
}

function renderTask(t) {
  const who = t.assignee ? `<span class="task-who" style="color:${escapeHtml(t.assignee.color || '#999')}">@${escapeHtml(t.assignee.nickname || 'TA')}</span>` : '';
  const dl = t.deadline
    ? (() => { const d = new Date(t.deadline); const p = (n) => String(n).padStart(2, '0'); return `<span class="task-dl">🕒 ${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}</span>`; })()
    : '';
  return `<div class="task-item" data-id="${t.id}">
    <span class="check">○</span>
    <span class="task-title">${escapeHtml(t.title)}</span>
    ${who}${dl}
  </div>`;
}
