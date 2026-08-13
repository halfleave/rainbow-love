// 日常打卡（复制类：仅自己改；连续天数统计）
import { escapeHtml, toISODate, pageHeader, toast } from '../ui.js';
import { loadCheckinsByType, checkIn } from '../supabase.js';

const TYPES = [
  { key: 'morning', emoji: '🌅', label: '早安' },
  { key: 'evening', emoji: '🌙', label: '晚安' },
  { key: 'miss', emoji: '💭', label: '想你' }
];

// 内存：每个类型的已打卡日期集合（'YYYY-MM-DD'）
let history = { morning: [], evening: [], miss: [] };

function todayStr() { return toISODate(new Date()); }

// 计算连续天数（截至今天；今天没打则从昨天起算）
function computeStreak(dates) {
  const set = new Set(dates.map((d) => String(d.date || d).slice(0, 10)));
  const today = todayStr();
  const yest = toISODate(new Date(Date.now() - 86400000));
  if (!set.has(today) && !set.has(yest)) return 0;
  let cur = set.has(today) ? today : yest;
  let n = 0;
  while (set.has(cur)) {
    n++;
    cur = toISODate(new Date(new Date(cur + 'T00:00:00').getTime() - 86400000));
  }
  return n;
}

// 最近 7 天圆点
function weekDots(dates) {
  const set = new Set(dates.map((d) => String(d.date || d).slice(0, 10)));
  let html = '';
  for (let i = 6; i >= 0; i--) {
    const d = toISODate(new Date(Date.now() - i * 86400000));
    html += `<span class="dot ${set.has(d) ? 'on' : ''}"></span>`;
  }
  return html;
}

function noteOf(dates) {
  const t = todayStr();
  const rec = dates.find((d) => String(d.date || d).slice(0, 10) === t);
  return rec && rec.note ? rec.note : '';
}

export async function render(root, ctx) {
  root.innerHTML = `
    ${pageHeader('日常打卡')}
    <div id="checkinBody" class="fade-in"></div>`;
  root.querySelector('#header-back')?.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back(); else ctx.navigate('/mine');
  });
  await loadHistory(ctx);
  renderTiles(root, ctx);
}

async function loadHistory(ctx) {
  try {
    const [m, e, s] = await Promise.all([
      loadCheckinsByType(ctx.coupleId, ctx.me.id, 'morning'),
      loadCheckinsByType(ctx.coupleId, ctx.me.id, 'evening'),
      loadCheckinsByType(ctx.coupleId, ctx.me.id, 'miss')
    ]);
    history = { morning: m, evening: e, miss: s };
  } catch (err) {
    console.warn('打卡历史加载失败', err);
  }
}

function renderTiles(root, ctx) {
  const box = root.querySelector('#checkinBody');
  box.innerHTML = `<div class="checkin-grid">${TYPES.map((t) => tileHtml(t)).join('')}</div>`;
  box.querySelectorAll('.checkin-tile').forEach((el) => {
    const t = TYPES.find((x) => x.key === el.dataset.type);
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.ct-note')) return;   // 备注按钮单独处理
      onTileTap(root, ctx, t);
    });
    el.querySelector('.ct-note')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onNote(root, ctx, t);
    });
  });
}

function tileHtml(t) {
  const dates = history[t.key] || [];
  const done = dates.some((d) => String(d.date || d).slice(0, 10) === todayStr());
  const streak = computeStreak(dates);
  const note = noteOf(dates);
  return `
    <div class="checkin-tile ${done ? 'done' : ''}" data-type="${t.key}">
      <div class="ct-emoji">${t.emoji}</div>
      <div class="ct-label">${t.label}</div>
      <div class="ct-streak">${done ? '今天已打卡' : '连续 ' + streak + ' 天'}</div>
      <div class="ct-week">${weekDots(dates)}</div>
      ${done
        ? `<button class="btn-text ct-note">${note ? '“' + escapeHtml(note) + '”' : '写句话'}</button>`
        : `<div class="ct-hint">点击打卡</div>`}
    </div>`;
}

async function onTileTap(root, ctx, t) {
  const dates = history[t.key] || [];
  const done = dates.some((d) => String(d.date || d).slice(0, 10) === todayStr());
  if (done) return;
  // 乐观：先点亮
  history[t.key] = dates.concat([{ date: todayStr() }]);
  renderTiles(root, ctx);
  try {
    await checkIn(ctx.coupleId, t.key);
    toast('已打卡 · ' + t.label);
  } catch (err) {
    history[t.key] = dates;          // 回滚
    renderTiles(root, ctx);
    toast('打卡失败：' + (err.message || err));
  }
}

async function onNote(root, ctx, t) {
  const cur = noteOf(history[t.key] || []);
  const txt = window.prompt('给今天的「' + t.label + '」写一句话（可不填）', cur || '');
  if (txt === null) return;          // 取消
  try {
    await checkIn(ctx.coupleId, t.key, txt.trim());
    await loadHistory(ctx);
    renderTiles(root, ctx);
    toast(txt.trim() ? '已记录' : '已更新');
  } catch (err) {
    toast('保存失败：' + (err.message || err));
  }
}
