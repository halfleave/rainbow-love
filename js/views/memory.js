// 记忆 · 日记 / 日历 / 照片墙 / 回忆时光轴（第6+7步）
import {
  escapeHtml, fmtDate, fmtDateTime, confirmDialog, pageHeader, toast
} from '../ui.js';
import {
  loadDiaryEntries, loadDiaryEntry, createDiary, updateDiary,
  deleteDiary, getDiaryImageUrl, loadAllPhotos, loadTimeline
} from '../supabase.js';

const EMOJIS = ['🌸', '💕', '☀️', '🌙', '🌟', '🍰', '🌈', '💭', '✨', '🥰', '🌿', '🎀'];
const SUB = [
  { key: 'diary', label: '📖 日记' },
  { key: 'calendar', label: '📅 日历' },
  { key: 'photos', label: '🖼️ 照片' },
  { key: 'timeline', label: '🕰️ 时光' }
];

// 模块级视图状态
let sub = 'diary';
let calYear = 0, calMonth = 0, calSel = null;
let calCache = null;     // 日历按月复用，避免反复拉取
let selectedFiles = [];
let editingEntry = null;

// ---------------- 工具 ----------------
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const toLocalDate = (iso) => { const x = new Date(iso); return isoOf(x.getFullYear(), x.getMonth(), x.getDate()); };

function setWriteBtn(root, show) {
  const btn = root.querySelector('#header-action');
  if (btn) btn.style.display = show ? '' : 'none';
}

// ---------------- 入口 ----------------
export async function render(root, ctx) {
  sub = 'diary';
  const now = new Date();
  calYear = now.getFullYear(); calMonth = now.getMonth(); calSel = null;
  await renderShell(root, ctx);
}

async function renderShell(root, ctx) {
  root.classList.remove('no-tabbar');
  root.innerHTML = `
    ${pageHeader('记忆', { right: '✏️ 写' })}
    <div class="subtabs">
      ${SUB.map((s) => `<button data-sub="${s.key}" class="${s.key === sub ? 'on' : ''}">${s.label}</button>`).join('')}
    </div>
    <div id="subView" class="fade-in"></div>`;

  const actionBtn = root.querySelector('#header-action');
  actionBtn.style.display = sub === 'diary' ? '' : 'none';
  actionBtn.addEventListener('click', () => { if (sub === 'diary') renderForm(root, ctx, null); });

  root.querySelectorAll('.subtabs button').forEach((b) => {
    b.addEventListener('click', () => {
      sub = b.dataset.sub;
      root.querySelectorAll('.subtabs button').forEach((x) => x.classList.toggle('on', x === b));
      actionBtn.style.display = sub === 'diary' ? '' : 'none';
      renderSub(root, ctx);
    });
  });

  await renderSub(root, ctx);
}

async function renderSub(root, ctx) {
  const box = root.querySelector('#subView');
  if (!box) return;
  if (sub === 'diary') await renderDiaryList(root, ctx);
  else if (sub === 'calendar') await renderCalendar(root, ctx);
  else if (sub === 'photos') await renderPhotos(root, ctx);
  else if (sub === 'timeline') await renderTimeline(root, ctx);
}

// ---------------- 日记列表 ----------------
async function renderDiaryList(root, ctx) {
  setWriteBtn(root, true);
  const box = root.querySelector('#subView');
  box.innerHTML = `<div class="placeholder"><div class="big">🌸</div><p>加载中…</p></div>`;
  let list = [];
  try {
    list = await loadDiaryEntries(ctx.coupleId, 80);
  } catch (e) {
    box.innerHTML = `<div class="placeholder"><div class="big">🌧️</div><p>加载失败：${escapeHtml(e.message || e)}</p></div>`;
    return;
  }
  if (!list.length) {
    box.innerHTML = `<div class="placeholder"><div class="big">📝</div><p>暂无数据</p></div>`;
    return;
  }
  box.innerHTML = `<div class="diary-list">${list.map(diaryItemHtml).join('')}</div>`;
  box.querySelectorAll('.diary-item').forEach((el) => {
    el.addEventListener('click', () => renderDetail(root, ctx, el.dataset.id));
  });
}

function diaryItemHtml(d) {
  const color = (d.author && d.author.color) || '#ccc';
  const name = (d.author && d.author.nickname) || 'TA';
  const initial = escapeHtml((name)[0] || '?');
  return `
    <div class="diary-item" data-id="${d.id}">
      <div class="avatar xs" style="background:${escapeHtml(color)}">${initial}</div>
      <div class="diary-main">
        <div class="diary-meta">
          <span class="dot" style="background:${escapeHtml(color)}"></span>
          <span class="name">${escapeHtml(name)}</span>
          <span class="time">${fmtDate(d.created_at)}</span>
        </div>
        <div class="diary-preview">${escapeHtml(d.body.slice(0, 48))}${d.body.length > 48 ? '…' : ''}</div>
      </div>
    </div>`;
}

// ---------------- 写 / 编辑 ----------------
function renderForm(root, ctx, entry) {
  setWriteBtn(root, false);
  const box = root.querySelector('#subView');
  const isEdit = !!entry;
  editingEntry = entry;
  selectedFiles = [];

  box.innerHTML = `
    <div class="sub-back" id="backBtn">← 返回</div>
    <div class="diary-form fade-in">
      <textarea id="body" class="diary-textarea" placeholder="今天想写点什么呢…">${isEdit ? escapeHtml(entry.body) : ''}</textarea>
      <div class="emoji-row">
        ${EMOJIS.map((e) => `<button class="emoji-btn" data-e="${e}">${e}</button>`).join('')}
      </div>
      <div class="photo-grid" id="preview"></div>
      <label class="add-photo">
        📷 添加图片
        <input type="file" accept="image/*" multiple id="fileInput" hidden>
      </label>
      <p class="tip" id="fileHint">${isEdit ? '编辑仅修改文字' : ''}</p>
      <button class="btn primary block" id="saveBtn">${isEdit ? '保存修改' : '记录这一刻'}</button>
    </div>`;

  const ta = box.querySelector('#body');
  const preview = box.querySelector('#preview');
  const hint = box.querySelector('#fileHint');

  box.querySelector('#backBtn').addEventListener('click', () => renderDiaryList(root, ctx));
  box.querySelector('#saveBtn').addEventListener('click', () => save(root, ctx));

  box.querySelectorAll('.emoji-btn').forEach((b) => {
    b.addEventListener('click', () => { ta.value += b.dataset.e; ta.focus(); });
  });

  const fileInput = box.querySelector('#fileInput');
  fileInput.addEventListener('change', () => {
    for (const f of fileInput.files) selectedFiles.push(f);
    fileInput.value = '';
    renderPreview();
  });

  function renderPreview() {
    preview.innerHTML = selectedFiles.map((f, i) => `
      <div class="photo-cell">
        <img src="${URL.createObjectURL(f)}" alt="">
        <button class="photo-del" data-i="${i}" aria-label="删除">×</button>
      </div>`).join('');
    hint.textContent = selectedFiles.length ? `已选 ${selectedFiles.length} 张图片` : (isEdit ? '编辑仅修改文字' : '');
    preview.querySelectorAll('.photo-del').forEach((b) => {
      b.addEventListener('click', () => { selectedFiles.splice(Number(b.dataset.i), 1); renderPreview(); });
    });
  }

  async function save() {
    const body = ta.value.trim();
    if (!body && selectedFiles.length === 0) { toast('写点什么或加张图吧～'); return; }
    const btn = box.querySelector('#saveBtn');
    btn.textContent = '保存中…';
    btn.disabled = true;
    try {
      if (isEdit) {
        await updateDiary(entry.id, { body });
        toast('已保存');
      } else {
        await createDiary({ coupleId: ctx.coupleId, body, files: selectedFiles });
        toast('日记已记录 🌸');
      }
      calCache = null; // 日历标记失效，下次重算
      await renderDiaryList(root, ctx);
    } catch (e) {
      console.error(e);
      toast('保存失败：' + (e.message || e));
      btn.textContent = isEdit ? '保存修改' : '记录这一刻';
      btn.disabled = false;
    }
  }
}

// ---------------- 详情 ----------------
async function renderDetail(root, ctx, id) {
  setWriteBtn(root, false);
  const box = root.querySelector('#subView');
  box.innerHTML = `<div class="sub-back" id="backBtn">← 返回</div>
    <div class="fade-in"><div class="placeholder"><div class="big">🌸</div><p>加载中…</p></div></div>`;
  box.querySelector('#backBtn').addEventListener('click', () => renderDiaryList(root, ctx));

  let entry;
  try {
    entry = await loadDiaryEntry(id);
  } catch (e) {
    box.querySelector('.fade-in').innerHTML = `<div class="placeholder"><div class="big">🌧️</div><p>加载失败</p></div>`;
    return;
  }
  if (!entry) {
    box.querySelector('.fade-in').innerHTML = `<div class="placeholder"><div class="big">🗑️</div><p>这条日记不存在或已删除</p></div>`;
    return;
  }

  const color = (entry.author && entry.author.color) || '#ccc';
  const name = (entry.author && entry.author.nickname) || 'TA';
  const isMine = ctx.me && entry.owner_id === ctx.me.id;
  const photos = (entry.photos || [])
    .map((p) => `<div class="diary-img"><img src="${escapeHtml(getDiaryImageUrl(p.url))}" alt="" loading="lazy"></div>`).join('');
  const actions = isMine ? `
    <div class="diary-actions">
      <button class="btn ghost" id="editBtn">编辑</button>
      <button class="btn danger" id="delBtn">删除</button>
    </div>` : '';

  box.querySelector('.fade-in').innerHTML = `
    <div class="diary-detail">
      <div class="detail-author">
        <div class="avatar sm" style="background:${escapeHtml(color)}">${escapeHtml((name)[0] || '?')}</div>
        <div class="identity-meta">
          <div class="name">${escapeHtml(name)}</div>
          <div class="sub">${fmtDateTime(entry.created_at)}</div>
        </div>
      </div>
      ${photos ? `<div class="diary-imgs">${photos}</div>` : ''}
      <div class="diary-body">${fmtBody(entry.body)}</div>
      ${actions}
    </div>`;

  if (isMine) {
    box.querySelector('#editBtn')?.addEventListener('click', () => renderForm(root, ctx, entry));
    box.querySelector('#delBtn')?.addEventListener('click', async () => {
      const ok = await confirmDialog('删除日记', '删除后无法恢复，确定吗？');
      if (!ok) return;
      try {
        await deleteDiary(entry.id);
        calCache = null;
        toast('已删除');
        await renderDiaryList(root, ctx);
      } catch (e) {
        toast('删除失败：' + (e.message || e));
      }
    });
  }
}

// ---------------- 日历（月历 + 粉点） ----------------
async function renderCalendar(root, ctx) {
  setWriteBtn(root, false);
  const box = root.querySelector('#subView');

  if (!calCache) {
    try {
      calCache = await loadDiaryEntries(ctx.coupleId, 400);
    } catch (e) {
      calCache = []; // 日历永远渲染，失败时按空数据展示
      console.warn('calendar loadDiaryEntries failed', e);
    }
  }

  const byDate = {};
  for (const d of calCache) {
    const key = toLocalDate(d.created_at);
    (byDate[key] ||= []).push(d);
  }

  box.innerHTML = calendarHtml(byDate);
  box.querySelector('#calPrev').addEventListener('click', () => {
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar(root, ctx);
  });
  box.querySelector('#calNext').addEventListener('click', () => {
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar(root, ctx);
  });
  box.querySelectorAll('.cal-cell[data-day]').forEach((c) => {
    c.addEventListener('click', () => { calSel = Number(c.dataset.day); renderCalendar(root, ctx); });
  });

  const selKey = calSel ? isoOf(calYear, calMonth, calSel) : null;
  renderDayPanel(root, box, selKey ? byDate[selKey] : null, ctx);
}

function calendarHtml(byDate) {
  const first = new Date(calYear, calMonth, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  const todayKey = isoOf(today.getFullYear(), today.getMonth(), today.getDate());
  const dows = ['日', '一', '二', '三', '四', '五', '六'];

  let cells = '';
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell muted"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = isoOf(calYear, calMonth, d);
    const has = byDate[key] && byDate[key].length;
    const cls = ['cal-cell'];
    if (key === todayKey) cls.push('today');
    if (calSel === d) cls.push('sel');
    cells += `<div class="${cls.join(' ')}" data-day="${d}">${d}${has ? '<span class="cal-dot"></span>' : ''}</div>`;
  }

  return `
    <div class="cal-head">
      <button class="cal-nav" id="calPrev" aria-label="上个月">‹</button>
      <div class="cal-title">${calYear}年${calMonth + 1}月</div>
      <button class="cal-nav" id="calNext" aria-label="下个月">›</button>
    </div>
    <div class="cal-grid">
      ${dows.map((w) => `<div class="cal-dow">${w}</div>`).join('')}
      ${cells}
    </div>
    <div id="calDay" class="cal-day-entries"></div>`;
}

function renderDayPanel(root, box, entries, ctx) {
  const day = box.querySelector('#calDay');
  if (!day) return;
  if (calSel == null) {
    day.innerHTML = `<div class="tip" style="text-align:center;margin-top:14px;">点击带粉点的日期，查看当天的日记 🌸</div>`;
    return;
  }
  if (!entries || !entries.length) {
    day.innerHTML = `<div class="tip" style="text-align:center;margin-top:14px;">暂无数据</div>`;
    return;
  }
  day.innerHTML = `<div class="sub2">${calYear}年${calMonth + 1}月${calSel}日 · 共 ${entries.length} 篇</div>`
    + entries.map(diaryItemHtml).join('');
  day.querySelectorAll('.diary-item').forEach((el) => {
    el.addEventListener('click', () => renderDetail(root, ctx, el.dataset.id));
  });
}

// ---------------- 照片墙（瀑布流） ----------------
async function renderPhotos(root, ctx) {
  setWriteBtn(root, false);
  const box = root.querySelector('#subView');
  box.innerHTML = `<div class="placeholder"><div class="big">🌸</div><p>加载中…</p></div>`;
  let photos = [];
  try {
    photos = await loadAllPhotos(ctx.coupleId, 120);
  } catch (e) {
    box.innerHTML = `<div class="placeholder"><div class="big">🌧️</div><p>加载失败：${escapeHtml(e.message || e)}</p></div>`;
    return;
  }
  if (!photos.length) {
    box.innerHTML = `<div class="placeholder"><div class="big">🖼️</div><p>暂无数据</p></div>`;
    return;
  }
  box.innerHTML = `<div class="photo-wall">${photos.map((p) =>
    `<div class="pw-item"><img src="${escapeHtml(getDiaryImageUrl(p.url))}" alt="" loading="lazy"></div>`
  ).join('')}</div>`;
  box.querySelectorAll('.pw-item img').forEach((img, i) => {
    img.addEventListener('click', () => openLightbox(getDiaryImageUrl(photos[i].url)));
  });
}

function openLightbox(url) {
  let ov = document.getElementById('lightbox');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'lightbox';
    ov.className = 'lightbox';
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
  ov.style.display = 'flex';
  ov.onclick = () => { ov.style.display = 'none'; };
}

// ---------------- 时光轴（多源聚合） ----------------
const TL_META = {
  diary: { icon: '📖', label: '日记' },
  anniversary: { icon: '💞', label: '纪念日' },
  movie: { icon: '🎬', label: '影视' },
  plan: { icon: '✨', label: '计划' },
  checkin: { icon: '🌿', label: '打卡' }
};
const CHECKIN_LABEL = { morning: '早安 ☀️', evening: '晚安 🌙', miss: '想你 💭' };

async function renderTimeline(root, ctx) {
  setWriteBtn(root, false);
  const box = root.querySelector('#subView');
  box.innerHTML = `<div class="placeholder"><div class="big">🌸</div><p>加载中…</p></div>`;
  let items = [];
  try {
    items = await loadTimeline(ctx.coupleId, 80);
  } catch (e) {
    box.innerHTML = `<div class="placeholder"><div class="big">🌧️</div><p>加载失败：${escapeHtml(e.message || e)}</p></div>`;
    return;
  }
  if (!items.length) {
    box.innerHTML = `<div class="placeholder"><div class="big">🕰️</div><p>暂无数据</p></div>`;
    return;
  }
  box.innerHTML = `<div class="timeline">${items.map(timelineItemHtml).join('')}</div>`;
}

function timelineItemHtml(t) {
  const m = TL_META[t.source] || { icon: '•', label: t.source };
  let title = t.title || '';
  if (t.source === 'diary') title = title.length > 40 ? title.slice(0, 40) + '…' : title;
  if (t.source === 'checkin') title = CHECKIN_LABEL[t.title] || '打卡';
  return `
    <div class="tl-item">
      <div class="tl-dot">${m.icon}</div>
      <div class="tl-card">
        <div class="tl-title">${escapeHtml(title)}</div>
        <div class="tl-meta">${m.label} · ${fmtDate(t.created_at)}</div>
      </div>
    </div>`;
}

// 正文换行转 <br>，其余转义
function fmtBody(text) {
  return escapeHtml(text || '').replace(/\n/g, '<br>');
}
