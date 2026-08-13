// 计划管理：列表（按状态分组）+ 底部弹窗添加/编辑/删除
import {
  escapeHtml, confirmDialog, pageHeader, toast
} from '../ui.js';
import {
  loadPlans, createPlan, updatePlan, deletePlan
} from '../supabase.js';

const STATUS = {
  idea: { label: '想法', icon: '💡' },
  doing: { label: '进行中', icon: '🚧' },
  done: { label: '已完成', icon: '✅' }
};

function setWriteBtn(root, show) {
  const btn = root.querySelector('#header-action');
  if (btn) btn.style.display = show ? '' : 'none';
}

export async function render(root, ctx) {
  setWriteBtn(root, true);
  root.innerHTML = `
    ${pageHeader('未来计划', { right: '＋ 添加' })}
    <div id="planList" class="fade-in"></div>`;

  root.querySelector('#header-back')?.addEventListener('click', () => {
    if (history.length > 1) history.back(); else ctx.navigate('/mine');
  });
  root.querySelector('#header-action').addEventListener('click', () => openSheet(root, ctx, null));

  await renderList(root, ctx);
}

async function renderList(root, ctx) {
  setWriteBtn(root, true);
  const box = root.querySelector('#planList');
  box.innerHTML = `<div class="placeholder"><div class="big">🌸</div><p>加载中…</p></div>`;
  let list = [];
  try {
    list = await loadPlans(ctx.coupleId);
  } catch (e) {
    box.innerHTML = `<div class="placeholder"><div class="big">🌧️</div><p>加载失败：${escapeHtml(e.message || e)}</p></div>`;
    return;
  }

  if (!list.length) {
    setWriteBtn(root, false);
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-emoji">🗺️</div>
        <p class="empty-text">还没有计划，规划一下吧</p>
        <button class="btn-capsule empty-add">添加计划</button>
      </div>`;
    box.querySelector('.empty-add').addEventListener('click', () => openSheet(root, ctx, null));
    return;
  }

  // 按状态分组：进行中 → 想法 → 已完成
  const order = ['doing', 'idea', 'done'];
  const groups = order.map((s) => ({
    status: s,
    items: list.filter((p) => (p.status || 'idea') === s)
  })).filter((g) => g.items.length);

  box.innerHTML = groups.map(groupHtml).join('');
  box.querySelectorAll('.plan-item').forEach((el) => {
    const id = el.dataset.id;
    el.querySelector('.plan-edit')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const p = list.find((x) => x.id === id);
      openSheet(root, ctx, p);
    });
    el.querySelector('.plan-del')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      doDelete(root, ctx, id);
    });
    // 点击卡片本身：在详情弹窗里切换状态更顺手，这里直接编辑
    el.addEventListener('click', () => {
      const p = list.find((x) => x.id === id);
      openSheet(root, ctx, p);
    });
  });
}

function groupHtml(g) {
  const meta = STATUS[g.status];
  return `
    <div class="plan-group">
      <div class="plan-group-title">${meta.icon} ${meta.label} <span class="plan-group-count">${g.items.length}</span></div>
      <div class="plan-items">
        ${g.items.map(itemHtml).join('')}
      </div>
    </div>`;
}

function itemHtml(p) {
  const desc = p.description
    ? `<div class="plan-item-sub">${escapeHtml(p.description)}</div>`
    : '';
  return `
    <div class="plan-item" data-id="${p.id}">
      <div class="plan-item-main">
        <div class="plan-item-title">${escapeHtml(p.title)}</div>
        ${desc}
      </div>
      <div class="plan-item-actions">
        <button class="icon-btn plan-edit" aria-label="编辑">✏️</button>
        <button class="icon-btn plan-del" aria-label="删除">🗑️</button>
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
        <span class="sheet-title">${isEdit ? '编辑计划' : '添加计划'}</span>
        <button class="sheet-action" id="saveBtn">${isEdit ? '保存' : '添加'}</button>
      </div>
      <div class="sheet-body">
        <label class="form-row">
          <span class="form-label">标题</span>
          <div class="input-wrap">
            <input class="form-input" id="fTitle" type="text" placeholder="如：一起去海边" value="${isEdit ? escapeHtml(entry.title) : ''}" maxlength="40">
            <button type="button" class="input-clear" id="fClear" aria-label="清空">×</button>
          </div>
        </label>

        <label class="form-row">
          <span class="form-label">说明</span>
          <textarea class="form-input" id="fDesc" rows="3" placeholder="想做点什么、去哪里…（可选）" maxlength="200">${isEdit && entry.description ? escapeHtml(entry.description) : ''}</textarea>
        </label>

        <label class="form-row">
          <span class="form-label">状态</span>
          <div class="seg" id="fStatus">
            ${Object.entries(STATUS).map(([k, v]) => `
              <button type="button" data-s="${k}" class="${!isEdit ? (k === 'idea' ? 'on' : '') : (entry.status === k ? 'on' : '')}">${v.label}</button>
            `).join('')}
          </div>
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

  const titleInput = overlay.querySelector('#fTitle');
  const clearBtn = overlay.querySelector('#fClear');
  const syncClear = () => { clearBtn.style.display = titleInput.value ? '' : 'none'; };
  clearBtn.addEventListener('click', () => { titleInput.value = ''; titleInput.focus(); syncClear(); });
  titleInput.addEventListener('input', syncClear);
  syncClear();

  let status = isEdit ? entry.status : 'idea';
  overlay.querySelector('#fStatus').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      status = b.dataset.s;
      overlay.querySelector('#fStatus').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    });
  });

  overlay.querySelector('#saveBtn').addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) { toast('填个标题吧～'); return; }
    const payload = {
      title,
      description: overlay.querySelector('#fDesc').value.trim(),
      status
    };
    const btn = overlay.querySelector('#saveBtn');
    btn.textContent = '保存中…';
    btn.disabled = true;
    try {
      if (isEdit) {
        await updatePlan(entry.id, payload);
        toast('已保存');
      } else {
        await createPlan({ coupleId: ctx.coupleId, ownerId: ctx.me.id, ...payload });
        toast('计划已添加 🗺️');
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
  const ok = await confirmDialog('删除计划', '删除后无法恢复，确定吗？');
  if (!ok) return;
  try {
    await deletePlan(id);
    toast('已删除');
    await renderList(root, ctx);
  } catch (e) {
    toast('删除失败：' + (e.message || e));
  }
}
