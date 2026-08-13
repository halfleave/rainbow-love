// 记忆 · 情侣日记（第6步）：列表 / 写 / 详情 / 双作者区分 / 编辑删除
import {
  escapeHtml, fmtDate, fmtDateTime, confirmDialog, pageHeader, toast
} from '../ui.js';
import {
  loadDiaryEntries, loadDiaryEntry, createDiary, updateDiary,
  deleteDiary, getDiaryImageUrl
} from '../supabase.js';

const EMOJIS = ['🌸', '💕', '☀️', '🌙', '🌟', '🍰', '🌈', '💭', '✨', '🥰', '🌿', '🎀'];

// 模块级视图状态：外部进入 render 始终回到 list
let mode = 'list';
let currentEntry = null;
let selectedFiles = [];

export async function render(root, ctx) {
  mode = 'list';
  currentEntry = null;
  selectedFiles = [];
  await renderList(root, ctx);
}

// ---------------- 列表 ----------------
async function renderList(root, ctx) {
  mode = 'list';
  root.classList.remove('no-tabbar');
  if (!ctx.isPaired()) {
    root.innerHTML = `
      ${pageHeader('记忆')}
      <div class="placeholder fade-in">
        <div class="big">📖</div>
        <p>配对后才能和 TA 一起写日记</p>
        <button class="btn primary" id="goPair">去配对</button>
      </div>`;
    root.querySelector('#goPair')?.addEventListener('click', () => ctx.navigate('/pairing'));
    return;
  }
  root.innerHTML = `
    ${pageHeader('记忆', { right: '✏️ 写' })}
    <div class="fade-in">
      <div id="diaryList" class="diary-list">
        <div class="placeholder"><div class="big">🌸</div><p>加载中…</p></div>
      </div>
    </div>`;
  root.querySelector('#header-action')?.addEventListener('click', () => renderForm(root, ctx, null));
  await loadAndRenderList(root, ctx);
}

async function loadAndRenderList(root, ctx) {
  const box = root.querySelector('#diaryList');
  if (!box) return;
  let list = [];
  try {
    list = await loadDiaryEntries(ctx.coupleId, 60);
  } catch (e) {
    console.warn('日记列表拉取失败', e);
    box.innerHTML = `<div class="placeholder"><div class="big">🌧️</div><p>加载失败：${escapeHtml(e.message || e)}</p></div>`;
    return;
  }
  if (!list.length) {
    box.innerHTML = `<div class="placeholder"><div class="big">📝</div>
      <p>还没有日记<br>点右上角「写」记录第一篇</p></div>`;
    return;
  }
  box.innerHTML = list.map((d) => {
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
  }).join('');
  box.querySelectorAll('.diary-item').forEach((el) => {
    el.addEventListener('click', () => renderDetail(root, ctx, el.dataset.id));
  });
}

// ---------------- 写 / 编辑 ----------------
function renderForm(root, ctx, entry) {
  mode = entry ? 'edit' : 'write';
  currentEntry = entry;
  selectedFiles = [];
  root.classList.add('no-tabbar');

  const isEdit = !!entry;
  root.innerHTML = `
    ${pageHeader(isEdit ? '编辑日记' : '写日记', { right: '保存' })}
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
    </div>`;

  const ta = root.querySelector('#body');
  const preview = root.querySelector('#preview');
  const hint = root.querySelector('#fileHint');

  root.querySelector('#header-action')?.addEventListener('click', () => save(root, ctx));
  root.querySelector('#header-back')?.addEventListener('click', () => renderList(root, ctx));

  root.querySelectorAll('.emoji-btn').forEach((b) => {
    b.addEventListener('click', () => {
      ta.value += b.dataset.e;
      ta.focus();
    });
  });

  const fileInput = root.querySelector('#fileInput');
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
      b.addEventListener('click', () => {
        selectedFiles.splice(Number(b.dataset.i), 1);
        renderPreview();
      });
    });
  }

  async function save() {
    const body = ta.value.trim();
    if (!body && selectedFiles.length === 0) { toast('写点什么或加张图吧～'); return; }
    const btn = root.querySelector('#header-action');
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
      await renderList(root, ctx);
    } catch (e) {
      console.error(e);
      toast('保存失败：' + (e.message || e));
      btn.textContent = '保存';
      btn.disabled = false;
    }
  }
}

// ---------------- 详情 ----------------
async function renderDetail(root, ctx, id) {
  mode = 'detail';
  root.classList.add('no-tabbar');
  root.innerHTML = `
    ${pageHeader('日记', { right: '⋯' })}
    <div class="fade-in"><div class="placeholder"><div class="big">🌸</div><p>加载中…</p></div></div>`;
  root.querySelector('#header-back')?.addEventListener('click', () => renderList(root, ctx));

  let entry;
  try {
    entry = await loadDiaryEntry(id);
  } catch (e) {
    console.warn('日记详情失败', e);
    root.querySelector('.fade-in').innerHTML = `<div class="placeholder"><div class="big">🌧️</div><p>加载失败</p></div>`;
    return;
  }
  if (!entry) {
    root.querySelector('.fade-in').innerHTML = `<div class="placeholder"><div class="big">🗑️</div><p>这条日记不存在或已删除</p></div>`;
    return;
  }

  const color = (entry.author && entry.author.color) || '#ccc';
  const name = (entry.author && entry.author.nickname) || 'TA';
  const isMine = ctx.me && entry.author_id === ctx.me.id;

  const photos = (entry.photos || [])
    .map((p) => `<div class="diary-img"><img src="${escapeHtml(getDiaryImageUrl(p.url))}" alt=""></div>`)
    .join('');

  const actions = isMine ? `
    <div class="diary-actions">
      <button class="btn ghost" id="editBtn">编辑</button>
      <button class="btn danger" id="delBtn">删除</button>
    </div>` : '';

  root.querySelector('.fade-in').innerHTML = `
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
    root.querySelector('#editBtn')?.addEventListener('click', () => renderForm(root, ctx, entry));
    root.querySelector('#delBtn')?.addEventListener('click', async () => {
      const ok = await confirmDialog('删除日记', '删除后无法恢复，确定吗？');
      if (!ok) return;
      try {
        await deleteDiary(entry.id);
        toast('已删除');
        await renderList(root, ctx);
      } catch (e) {
        toast('删除失败：' + (e.message || e));
      }
    });
  }
}

// 正文里的换行转 <br>，其余转义
function fmtBody(text) {
  return escapeHtml(text || '').replace(/\n/g, '<br>');
}
