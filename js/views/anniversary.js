// 纪念日管理（第8步）：列表 + 底部弹窗添加/编辑/删除 + 默认种子
import {
  escapeHtml, fmtDate, daysBetween, toISODate, confirmDialog, pageHeader, toast
} from '../ui.js';
import {
  loadAnniversaries, createAnniversary, updateAnniversary, deleteAnniversary
} from '../supabase.js';
import { solarToLunar, formatLunar, nextOccurrence } from '../lunar.js';

const pad = (n) => String(n).padStart(2, '0');
function parseLocal(str) {
  return new Date(Number(str.slice(0, 4)), Number(str.slice(5, 7)) - 1, Number(str.slice(8, 10)));
}

function countdownOf(a) {
  let m, d;
  if (a.is_lunar) {
    const l = solarToLunar(parseLocal(a.date));
    m = l.month; d = l.day;
  } else {
    m = Number(a.date.slice(5, 7)); d = Number(a.date.slice(8, 10));
  }
  const next = nextOccurrence(m, d, new Date());
  const n = daysBetween(toISODate(new Date()), toISODate(next));
  return { next, n };
}

function dateLabel(a) {
  return a.is_lunar ? formatLunar(parseLocal(a.date)) : fmtDate(a.date);
}

function setWriteBtn(root, show) {
  const btn = root.querySelector('#header-action');
  if (btn) btn.style.display = show ? '' : 'none';
}

// 内存状态：当前列表（含未同步的本地项）
let currentList = [];

export async function render(root, ctx) {
  setWriteBtn(root, true);
  root.innerHTML = `
    ${pageHeader('纪念日', { right: '＋ 添加' })}
    <div id="annList" class="fade-in"></div>`;

  root.querySelector('#header-back')?.addEventListener('click', () => {
    if (history.length > 1) history.back(); else ctx.navigate('/mine');
  });
  root.querySelector('#header-action').addEventListener('click', () => openSheet(root, ctx, null));

  await renderList(root, ctx);
}

async function renderList(root, ctx) {
  setWriteBtn(root, true);
  const box = root.querySelector('#annList');
  box.innerHTML = `<div class="placeholder"><div class="big">🌸</div><p>加载中…</p></div>`;
  try {
    currentList = await loadAnniversaries(ctx.coupleId);
  } catch (e) {
    box.innerHTML = `<div class="placeholder"><div class="big">🌧️</div><p>加载失败：${escapeHtml(e.message || e)}</p></div>`;
    return;
  }

  applyPrivacyFilter(ctx);

  // 首次进入且无数据：写入一条默认「相恋日」（每个空间仅一次）
  if (!currentList.length) {
    const seedKey = 'rainbow-seed-anniv:' + ctx.coupleId;
    if (!localStorage.getItem(seedKey)) {
      localStorage.setItem(seedKey, '1');
      try {
        await createAnniversary({
          coupleId: ctx.coupleId, ownerId: ctx.me.id,
          title: '相恋日', date: '2019-06-06', isLunar: false, isPrivate: false
        });
        currentList = await loadAnniversaries(ctx.coupleId);
        applyPrivacyFilter(ctx);
      } catch (err) {
        console.warn('默认纪念日种子写入失败', err);
      }
    }
  }

  renderFromState(root, ctx);
}

function applyPrivacyFilter(ctx) {
  // 仅自己可见的：配对后只对本人显示（避免误显示对方私密项）
  if (ctx.isPaired() && ctx.me) {
    currentList = currentList.filter((a) => !a.is_private || a.owner_id === ctx.me.id);
  }
}

function renderFromState(root, ctx) {
  const box = root.querySelector('#annList');

  if (!currentList.length) {
    setWriteBtn(root, false);
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-emoji">💞</div>
        <p class="empty-text">还没有纪念日，记录第一个吧</p>
        <button class="btn-capsule empty-add">添加纪念日</button>
      </div>`;
    box.querySelector('.empty-add').addEventListener('click', () => openSheet(root, ctx, null));
    return;
  }

  const list = currentList
    .map((a) => ({ ...a, _cd: countdownOf(a) }))
    .sort((x, y) => x._cd.n - y._cd.n);

  box.innerHTML = `<div class="ann-list">${list.map(itemHtml).join('')}</div>`;
  box.querySelectorAll('.ann-item').forEach((el) => {
    const id = el.dataset.id;
    el.querySelector('.ann-edit')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const a = list.find((x) => x.id === id);
      openSheet(root, ctx, a);
    });
    el.querySelector('.ann-del')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      doDelete(root, ctx, id);
    });
  });
}

function itemHtml(a) {
  const cd = a._cd;
  const cdText = cd.n === 0 ? '就是今天 🎉' : `还有 ${cd.n} 天`;
  const priv = a.is_private ? `<span class="badge lock">🔒</span>` : '';
  const lunar = a.is_lunar ? `<span class="badge">农历</span>` : '';
  const pending = a._pending ? `<span class="badge">${a._failed ? '同步失败' : '同步中'}</span>` : '';
  return `
    <div class="ann-item" data-id="${a.id}">
      <div class="ann-item-main">
        <div class="ann-item-title">${escapeHtml(a.title)}</div>
        <div class="ann-item-sub">${dateLabel(a)} · ${cdText}${lunar}${priv}${pending}</div>
      </div>
      <div class="ann-item-actions">
        <button class="icon-btn ann-edit" aria-label="编辑">✏️</button>
        <button class="icon-btn ann-del" aria-label="删除">🗑️</button>
      </div>
    </div>`;
}

// ---------------- 底部弹窗（sheet，高 85%） ----------------
function openSheet(root, ctx, entry) {
  const isEdit = !!entry;
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head">
        <button class="sheet-close" id="sheetClose" aria-label="关闭">×</button>
        <span class="sheet-title">${isEdit ? '编辑纪念日' : '添加纪念日'}</span>
        <button class="sheet-action" id="saveBtn">${isEdit ? '保存' : '添加'}</button>
      </div>
      <div class="sheet-body">
        <label class="form-row">
          <span class="form-label">标题</span>
          <div class="input-wrap">
            <input class="form-input" id="fTitle" type="text" placeholder="如：我们在一起" value="${isEdit ? escapeHtml(entry.title) : ''}" maxlength="40">
            <button type="button" class="input-clear" id="fClear" aria-label="清空">×</button>
          </div>
        </label>

        <label class="form-row">
          <span class="form-label">日期</span>
          <input class="form-input" id="fDate" type="date" value="${isEdit ? escapeHtml(entry.date) : ''}">
        </label>

        <label class="switch-row">
          <span>农历日期</span>
          <label class="switch"><input type="checkbox" id="fLunar" ${isEdit && entry.is_lunar ? 'checked' : ''}><span class="slider"></span></label>
        </label>

        <label class="switch-row">
          <span>仅自己可见</span>
          <label class="switch"><input type="checkbox" id="fPrivate" ${isEdit && entry.is_private ? 'checked' : ''}><span class="slider"></span></label>
        </label>
      </div>
    </div>`;
  root.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const close = () => {
    overlay.remove();
    document.body.style.overflow = '';
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#sheetClose').addEventListener('click', close);

  // 标题内清空按钮
  const titleInput = overlay.querySelector('#fTitle');
  const clearBtn = overlay.querySelector('#fClear');
  const syncClear = () => { clearBtn.style.display = titleInput.value ? '' : 'none'; };
  clearBtn.addEventListener('click', () => { titleInput.value = ''; titleInput.focus(); syncClear(); });
  titleInput.addEventListener('input', syncClear);
  syncClear();

  overlay.querySelector('#saveBtn').addEventListener('click', () => {
    const title = titleInput.value.trim();
    const date = overlay.querySelector('#fDate').value;
    if (!title) { toast('填个标题吧～'); return; }
    if (!date) { toast('选个日期吧～'); return; }
    const payload = {
      title, date,
      isLunar: overlay.querySelector('#fLunar').checked,
      isPrivate: overlay.querySelector('#fPrivate').checked
    };

    // 1) 立即关闭弹窗，先写本地，UI 立刻响应
    close();
    const isLocalEdit = isEdit && String(entry.id).startsWith('local-');

    if (isEdit && !isLocalEdit) {
      // 编辑已有项：先改本地状态
      const idx = currentList.findIndex((a) => a.id === entry.id);
      if (idx >= 0) {
        currentList[idx] = { ...currentList[idx], ...payload, _pending: true, _failed: false };
      }
      renderFromState(root, ctx);
      toast('已保存');
      // 2) 后台静默同步
      updateAnniversary(entry.id, payload)
        .then(() => {
          if (idx >= 0) currentList[idx]._pending = false;
          renderFromState(root, ctx);
        })
        .catch((e) => {
          console.error(e);
          if (idx >= 0) currentList[idx]._pending = false;
          if (idx >= 0) currentList[idx]._failed = true;
          renderFromState(root, ctx);
          toast('同步失败：' + (e.message || e));
        });
    } else {
      // 新建（或编辑本地未同步项）：本地先插一条临时记录
      const tempId = 'local-' + Date.now();
      const temp = {
        id: tempId,
        couple_id: ctx.coupleId,
        owner_id: ctx.me.id,
        title: payload.title,
        date: payload.date,
        is_lunar: payload.isLunar,
        is_private: payload.isPrivate,
        _pending: true,
        _failed: false,
        _local: true
      };

      if (isLocalEdit) {
        // 替换原来的本地失败项
        const idx = currentList.findIndex((a) => a.id === entry.id);
        if (idx >= 0) currentList[idx] = temp; else currentList.push(temp);
      } else {
        currentList.push(temp);
      }
      renderFromState(root, ctx);
      toast('已添加');

      // 后台静默上传
      createAnniversary({ coupleId: ctx.coupleId, ownerId: ctx.me.id, ...payload })
        .then((data) => {
          const idx = currentList.findIndex((a) => a.id === tempId);
          if (data && idx >= 0) {
            currentList[idx] = { ...data, _pending: false };
          } else if (idx >= 0) {
            currentList[idx]._pending = false;
          }
          renderFromState(root, ctx);
        })
        .catch((e) => {
          console.error(e);
          const idx = currentList.findIndex((a) => a.id === tempId);
          if (idx >= 0) {
            currentList[idx]._pending = false;
            currentList[idx]._failed = true;
          }
          renderFromState(root, ctx);
          toast('同步失败：' + (e.message || e));
        });
    }
  });
}

async function doDelete(root, ctx, id) {
  const ok = await confirmDialog('删除纪念日', '删除后无法恢复，确定吗？');
  if (!ok) return;

  // 本地未同步的项：直接移除，不用等服务器
  if (String(id).startsWith('local-')) {
    currentList = currentList.filter((a) => a.id !== id);
    renderFromState(root, ctx);
    toast('已删除');
    return;
  }

  try {
    await deleteAnniversary(id);
    toast('已删除');
    await renderList(root, ctx);
  } catch (e) {
    toast('删除失败：' + (e.message || e));
  }
}
