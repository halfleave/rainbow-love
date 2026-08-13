// 配对伴侣（双向确认）：双方都填对方邀请码才牵手成功，先填方保留空间
import { requestPair, getCouple, getInviteCode, getMyIntent } from '../supabase.js';
import { toast, copyText, escapeHtml, pageHeader } from '../ui.js';

// 轮询定时器（等待对方确认期间，定时刷新是否已成对）
let pollTimer = null;

function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// 离开页面时清理轮询（app.js 会调用 mod.cleanup）
export function cleanup() {
  stopPoll();
}

export async function render(root, ctx) {
  // 优先通过 RPC 取邀请码（绕过 couples RLS 读取异常）
  let inviteError = '';
  let code = null;
  try {
    const r = await getInviteCode();
    if (r && r.ok) code = r.code;
    else inviteError = (r && r.error) || '取邀请码失败';
  } catch (e) {
    console.warn('getInviteCode 失败', e);
    inviteError = (e && e.message) || '取邀请码失败';
  }

  // 同时刷新 couple 行（用于起始日等）
  let couple = ctx.couple;
  if (ctx.coupleId && !couple) {
    try { couple = await getCouple(ctx.coupleId); ctx.couple = couple; }
    catch (e) { console.warn('getCouple 失败', e); }
  }

  const paired = ctx.isPaired();
  const partner = ctx.partner || {};

  // 是否已处于"等待对方确认"态（自己之前填过对方的码）
  let waiting = false;
  if (!paired) {
    try {
      const intent = await getMyIntent();
      waiting = !!(intent && intent.pending);
    } catch (e) { console.warn('getMyIntent 失败', e); }
  }

  root.innerHTML = `
    ${pageHeader('和TA牵手')}

    ${paired ? `
      <div class="card">
        <div class="section-title">已绑定 💞</div>
        <div class="partner-row">
          <div class="avatar sm" style="background:${escapeHtml(partner.color || '#999')}">${(escapeHtml(partner.nickname || '?'))[0]}</div>
          <div class="identity-meta">
            <div class="name">${escapeHtml(partner.nickname || 'TA')}</div>
            <div class="sub">在一起始于 ${escapeHtml(couple?.start_date || '—')}</div>
          </div>
        </div>
      </div>
    ` : waiting ? `
      <div class="card" id="waitingCard" style="text-align:center">
        <div class="big">💞</div>
        <div class="section-title">已发送邀请</div>
        <p class="tip">正等待 TA 也填你的邀请码。<br>TA 填好后，你们会自动牵手成功～</p>
        <div class="code-box" style="justify-content:center;margin-top:6px">
          <div class="pair-code" id="mycode2">${escapeHtml(code || '------')}</div>
          <button class="btn ghost sm" id="copy2" ${!code ? 'disabled' : ''}>复制邀请码</button>
        </div>
        <p class="tip" style="margin-top:10px">正在等待 TA 的确认…</p>
      </div>
    ` : `
      <div class="card">
        <div class="section-title">我的邀请码</div>
        <div class="code-box">
          <div class="pair-code" id="mycode">${escapeHtml(code || '------')}</div>
          <button class="btn ghost sm" id="copy" ${!code ? 'disabled' : ''}>复制邀请码</button>
        </div>
        ${!code ? `<p class="tip" style="color:var(--danger)">${escapeHtml(inviteError || '邀请码加载失败')}</p>` : ''}
      </div>
      <div class="card">
        <div class="section-title">输入 TA 的邀请码</div>
        <input id="input" class="text-input" placeholder="6 位邀请码" maxlength="6" style="text-transform:uppercase">
      </div>
      <button class="btn primary block" id="join" style="margin-top:14px">牵手</button>
    `}
  `;

  root.querySelector('#header-back')?.addEventListener('click', () => history.length > 1 ? history.back() : ctx.navigate('/mine'));

  // 复制邀请码（两种态都有）
  const bindCopy = (btnId, codeId) => {
    root.querySelector('#' + btnId)?.addEventListener('click', async () => {
      if (!code) return;
      const ok = await copyText(code);
      toast(ok ? '已复制邀请码' : '复制失败，请手动长按');
    });
  };
  bindCopy('copy', 'mycode');
  bindCopy('copy2', 'mycode2');

  if (paired) return;

  // 等待态：启动轮询，对方填码后自动变已配对
  if (waiting) {
    startPoll(ctx, root);
    return;
  }

  // 初始输入态：点牵手发起/确认
  root.querySelector('#join')?.addEventListener('click', async () => {
    const v = root.querySelector('#input').value.trim().toUpperCase();
    if (v.length < 6) { toast('邀请码为 6 位'); return; }
    const btn = root.querySelector('#join');
    btn.disabled = true;
    try {
      const res = await requestPair(v);
      if (!res || !res.ok) { toast(res?.error || '配对失败'); btn.disabled = false; return; }
      if (res.paired) {
        stopPoll();
        await ctx.refresh();
        toast('配对成功，欢迎 TA 💞');
        ctx.navigate('/mine');
        return;
      }
      // 进入等待对方确认态
      toast('已发送邀请，等待 TA 确认 💞');
      await render(root, ctx); // 重渲染为等待态
      startPoll(ctx, root);
    } catch (e) {
      console.error(e);
      toast('配对失败：' + (e.message || e));
      btn.disabled = false;
    }
  });
}

// 每 4 秒刷新一次身份状态；一旦双方都确认（isPaired 变 true）即跳转
function startPoll(ctx, root) {
  stopPoll();
  pollTimer = setInterval(async () => {
    try {
      await ctx.refresh();
      if (ctx.isPaired()) {
        stopPoll();
        toast('TA 已确认，牵手成功 💞');
        ctx.navigate('/mine');
      }
    } catch (e) { console.warn('配对轮询失败', e); }
  }, 4000);
}
