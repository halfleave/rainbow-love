// 日常任务模块（同步类·双方可改删）：列表分组 + 截止时间 + 自动状态 + 底部弹窗 + 勾选完成 + 删除
import {
  escapeHtml, confirmDialog, pageHeader, toast
} from '../ui.js';
import {
  loadTasks, createTask, updateTask, deleteTask, toggleTask
} from '../supabase.js';

const HOUR = 3600 * 1000;

// 内存状态：当前列表（含本地乐观项）
let currentList = [];

// 任务展示状态：done(手动完成) / soon(距截止≤1h) / ended(已截止) / doing(进行中)
function taskState(t, now = new Date()) {
  if ((t.status || 'todo') === 'done') return 'done';
  if (!t.deadline) return 'doing';
  const diff = new Date(t.deadline).getTime() - now.getTime();
  if (diff <= 0) return 'ended';
  if (diff <= HOUR) return 'soon';
  return 'doing';
}

function deadlineText(deadline) {
  if (!deadline) return '';
  const d = new Date(deadline);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// datetime-local 值 -> 存库 ISO(UTC)；空串 -> null
function toISO(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}
// 存库 ISO -> datetime-local 输入框值
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function render(root, ctx) {
  root.innerHTML = `
    ${pageHeader('日常任务', { right: '＋ 添加' })}
    <div id="taskList" class="fade-in"></div>`;

  root.querySelector('#header-back')?.addEventListener('click', () => {
    if (history.length > 1) history.back(); else ctx.navigate('/mine');
  });
  root.querySelector('#header-action').addEventListener('click', () => openSheet(root, ctx, null));

  await renderList(root, ctx);
}

function setWriteBtn(root, show) {
  const btn = root.querySelector('#header-action');
  if (btn) btn.style.display = show ? '' : 'none';
}

async function renderList(root, ctx) {
  const box = root.querySelector('#taskList');
  box.innerHTML = `<div class="placeholder"><div class="big">🌸</div><p>加载中…</p></div>`;
  try {
    currentList = await loadTasks(ctx.coupleId);
  } catch (e) {
    box.innerHTML = `<div class="placeholder"><div class="big">🌧️</div><p>加载失败：${escapeHtml(e.message || e)}</p></div>`;
    return;
  }
  renderFromState(root, ctx);
}

function renderFromState(root, ctx) {
  const box = root.querySelector('#taskList');

  if (!currentList.length) {
    setWriteBtn(root, false);
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-emoji">📋</div>
        <p class="empty-text">还没有任务，添加一个吧</p>
        <button class="btn-capsule empty-add">添加任务</button>
      </div>`;
    box.querySelector('.empty-add').addEventListener('click', () => openSheet(root, ctx, null));
    return;
  }
  setWriteBtn(root, true);

  const now = new Date();
  const withState = currentList.map((t) => ({ ...t, _state: taskState(t, now) }));

  // 进行中（含快结束，按截止时间升序，最近截止的在前）
  const active = withState
    .filter((t) => t._state === 'doing' || t._state === 'soon')
    .sort((a, b) => {
      const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return da - db;
    });
  const ended = withState.filter((t) => t._state === 'ended');
  const done = withState.filter((t) => t._state === 'done');

  const groups = [
    { key: 'doing', label: '进行中', items: active },
    { key: 'ended', label: '已结束', items: ended },
    { key: 'done', label: '已完成', items: done }
  ].filter((g) => g.items.length);

  if (!groups.length) {
    setWriteBtn(root, false);
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-emoji">📋</div>
        <p class="empty-text">还没有任务，添加一个吧</p>
        <button class="btn-capsule empty-add">添加任务</button>
      </div>`;
    box.querySelector('.empty-add').addEventListener('click', () => openSheet(root, ctx, null));
    return;
  }

  box.innerHTML = groups.map(groupHtml).join('');
  box.querySelectorAll('.task-item').forEach((el) => {
    const id = el.dataset.id;
    el.querySelector('.task-del')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      doDelete(root, ctx, id);
    });
    el.addEventListener('click', () => {
      const t = currentList.find((x) => x.id === id);
      if (!t) return;
      toggleStatus(root, ctx, t);
    });
  });
}

function groupHtml(g) {
  return `
    <div class="task-group">
      <div class="task-group-title">${g.label} <span class="task-group-count">${g.items.length}</span></div>
      <div class="task-items">
        ${g.items.map(itemHtml).join('')}
      </div>
    </div>`;
}

function itemHtml(t) {
  const isDone = t._state === 'done';
  const isSoon = t._state === 'soon';
  const isEnded = t._state === 'ended';
  const who = t.assignee
    ? `<span class="task-who" style="color:${escapeHtml(t.assignee.color || '#999')}">@${escapeHtml(t.assignee.nickname || 'TA')}</span>`
    : '';
  const priv = t.is_private ? `<span class="badge lock">🔒</span>` : '';
  let stateBadge = '';
  if (isSoon) stateBadge = `<span class="badge soon">⏰ 快结束</span>`;
  else if (isEnded) stateBadge = `<span class="badge ended">已结束</span>`;
  const dl = deadlineText(t.deadline);
  const sub = [dl, who, stateBadge, priv].filter(Boolean).join('');
  return `
    <div class="task-item ${isDone ? 'done' : ''} ${isSoon ? 'soon' : ''} ${isEnded ? 'ended' : ''}" data-id="${t.id}">
      <span class="task-check">${isDone ? '✓' : '○'}</span>
      <div class="task-item-body">
        <span class="task-item-title">${escapeHtml(t.title)}</span>
        ${sub ? `<span class="task-item-sub">${sub}</span>` : ''}
      </div>
      <button class="icon-btn task-del" aria-label="删除">🗑️</button>
    </div>`;
}

// ---------------- 勾选完成 ----------------
async function toggleStatus(root, ctx, t) {
  const next = (t.status || 'todo') === 'done' ? 'todo' : 'done';
  // 乐观更新
  const idx = currentList.findIndex((x) => x.id === t.id);
  if (idx >= 0) currentList[idx].status = next;
  renderFromState(root, ctx);
  try {
    await toggleTask(t.id, next === 'done');
  } catch (e) {
    if (idx >= 0) currentList[idx].status = t.status; // 回滚
    renderFromState(root, ctx);
    toast('更新失败：' + (e.message || e));
  }
}

// ---------------- 底部弹窗（sheet，高 85%） ----------------
function openSheet(root, ctx, entry) {
  const isEdit = !!entry;
  const paired = ctx.isPaired();
  const partner = ctx.partner || {};
  const me = ctx.me || {};

  // 默认指派：编辑时看原 assignee，新建默认指派给自己
  const defaultAssigneeMe = !entry || !entry.assignee_id || entry.assignee_id === me.id;
  const segInit = defaultAssigneeMe ? 'me' : 'partner';

  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head">
        <button class="sheet-close" id="sheetClose" aria-label="关闭">×</button>
        <span class="sheet-title">${isEdit ? '编辑任务' : '添加任务'}</span>
        <button class="sheet-action" id="saveBtn">${isEdit ? '保存' : '添加'}</button>
      </div>
      <div class="sheet-body">
        <label class="form-row">
          <span class="form-label">标题</span>
          <div class="input-wrap">
            <input class="form-input" id="fTitle" type="text" placeholder="如：一起做顿饭" value="${isEdit ? escapeHtml(entry.title) : ''}" maxlength="40">
            <button type="button" class="input-clear" id="fClear" aria-label="清空">×</button>
          </div>
        </label>

        <label class="form-row">
          <span class="form-label">截止时间（可选）</span>
          <input class="form-input" id="fDeadline" type="datetime-local" value="${isEdit ? toLocalInput(entry.deadline) : ''}">
        </label>

        <label class="form-row">
          <span class="form-label">指派给</span>
          <div class="seg" id="fAssignee">
            <button type="button" data-a="me" class="${segInit === 'me' ? 'on' : ''}">${escapeHtml(me.nickname || '我')}</button>
            ${paired ? `<button type="button" data-a="partner" class="${segInit === 'partner' ? 'on' : ''}">${escapeHtml(partner.nickname || 'TA')}</button>` : ''}
          </div>
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

  let assignee = segInit;
  overlay.querySelector('#fAssignee').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      assignee = b.dataset.a;
      overlay.querySelector('#fAssignee').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    });
  });

  overlay.querySelector('#saveBtn').addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) { toast('填个标题吧～'); return; }
    const isPrivate = overlay.querySelector('#fPrivate').checked;
    const assigneeId = assignee === 'partner' ? partner.id : me.id;
    const payload = {
      title,
      assigneeId,
      isPrivate,
      deadline: toISO(overlay.querySelector('#fDeadline').value)
    };

    const btn = overlay.querySelector('#saveBtn');
    btn.textContent = '保存中…';
    btn.disabled = true;
    try {
      if (isEdit) {
        await updateTask(entry.id, payload);
        toast('已保存');
      } else {
        await createTask({ coupleId: ctx.coupleId, ownerId: me.id, ...payload });
        toast('任务已添加 📋');
      }
      close();
      await renderList(root, ctx);
    } catch (e) {
      console.error(e);
      toast('保存失败：' + (e.message || e));
      btn.textContent = isEdit ? '保存' : '添加';
      btn.disabled = false;
    }
  });
}

async function doDelete(root, ctx, id) {
  const ok = await confirmDialog('删除任务', '删除后无法恢复，确定吗？');
  if (!ok) return;
  // 本地乐观移除
  const idx = currentList.findIndex((t) => t.id === id);
  if (idx >= 0) currentList.splice(idx, 1);
  renderFromState(root, ctx);
  try {
    await deleteTask(id);
    toast('已删除');
  } catch (e) {
    // 回滚：重新拉取
    await renderList(root, ctx);
    toast('删除失败：' + (e.message || e));
  }
}
