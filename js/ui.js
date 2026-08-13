// 通用 UI 工具
export function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer = null;
export function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// 本地日期 -> YYYY-MM-DD
export function toISODate(d) {
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

// 友好日期：今天 / 昨天 / M月D日
export function fmtDate(d) {
  const x = new Date(d);
  const today = toISODate(new Date());
  const that = toISODate(x);
  if (that === today) return '今天';
  const y = new Date(Date.now() - 86400000);
  if (toISODate(y) === that) return '昨天';
  return `${x.getMonth() + 1}月${x.getDate()}日`;
}

export function fmtDateTime(d) {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${fmtDate(x)} ${p(x.getHours())}:${p(x.getMinutes())}`;
}

// 两个日期相差天数（b - a）
export function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((db - da) / 86400000);
}

// 简易确认弹窗（返回 Promise<bool>）
export function confirmDialog(title, text) {
  return new Promise((resolve) => {
    const ok = window.confirm(`${title}\n${text}`);
    resolve(ok);
  });
}

// 二级页面顶部导航（返回按钮 + 标题）
export function pageHeader(title, opts = {}) {
  const back = opts.hideBack
    ? '<span class="back-spacer"></span>'
    : `<button class="back" id="header-back" aria-label="返回">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
      </button>`;
  const right = opts.right
    ? `<button class="action" id="header-action">${escapeHtml(opts.right)}</button>`
    : '<span class="action-spacer"></span>';
  return `
    <header class="page-header" id="page-header">
      ${back}
      <div class="title">${escapeHtml(title)}</div>
      ${right}
    </header>`;
}

// 复制文本到剪贴板（移动端兼容）
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* 忽略，走兜底 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (_) {
    return false;
  }
}
