// 配对伴侣（第3步）：设置内的配对入口，也可从首页/聊天到达
import { joinCouple, getCouple } from '../supabase.js';
import { toast, copyText, escapeHtml, pageHeader } from '../ui.js';

export async function render(root, ctx) {
  // 刷新 couple，确保邀请码/起始日等显示正确
  let couple = ctx.couple;
  if (!couple && ctx.coupleId) {
    try { couple = await getCouple(ctx.coupleId); ctx.couple = couple; }
    catch (e) { console.warn('刷新空间失败', e); }
  }

  const paired = ctx.isPaired();
  const partner = ctx.partner || {};
  const code = couple ? couple.pair_code : null;

  root.innerHTML = `
    ${pageHeader('配对伴侣')}
    <div class="page-head fade-in" style="margin-top:-6px">
      <p class="page-sub">邀请 TA，共享所有回忆</p>
    </div>

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
        <p class="tip">你们已绑定，数据自动共享 🎉</p>
      </div>
    ` : `
      <div class="card">
        <div class="section-title">我的邀请码</div>
        <p class="tip">把邀请码发给 TA，TA 在「配对伴侣」里输入即可加入你的空间。</p>
        <div class="code-box">
          <div class="pair-code" id="mycode">${escapeHtml(code || '------')}</div>
          <button class="btn ghost sm" id="copy" ${!code ? 'disabled' : ''}>复制邀请码</button>
        </div>
        ${!code ? '<p class="tip" style="color:var(--danger)">邀请码加载失败，请下拉刷新或返回重进</p>' : ''}
      </div>
      <div class="card">
        <div class="section-title">输入 TA 的邀请码</div>
        <input id="input" class="text-input" placeholder="6 位邀请码" maxlength="6" style="text-transform:uppercase">
        <button class="btn primary block" id="join" style="margin-top:12px">加入 TA 的空间</button>
      </div>
    `}
  `;

  root.querySelector('#header-back')?.addEventListener('click', () => history.length > 1 ? history.back() : ctx.navigate('/mine'));

  if (!paired) {
    root.querySelector('#copy')?.addEventListener('click', async () => {
      if (!code) return;
      const ok = await copyText(code);
      toast(ok ? '已复制邀请码' : '复制失败，请手动长按');
    });
    root.querySelector('#join')?.addEventListener('click', async () => {
      const v = root.querySelector('#input').value.trim().toUpperCase();
      if (v.length < 6) { toast('邀请码为 6 位'); return; }
      try {
        const res = await joinCouple(v);
        if (!res || !res.ok) { toast(res?.error || '配对失败'); return; }
        await ctx.refresh();
        toast('配对成功，欢迎 TA 💞');
        ctx.navigate('/mine');
      } catch (e) {
        console.error(e);
        toast('配对失败：' + (e.message || e));
      }
    });
  }
}
