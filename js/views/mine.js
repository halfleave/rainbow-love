// 我的（第3步基础：身份卡 + 配对入口 + 外观主题；其余模块第8/9/10步）
import { toast, escapeHtml } from '../ui.js';

export async function render(root, ctx) {
  const me = ctx.me || {};
  const paired = ctx.isPaired();
  const partner = ctx.partner || {};

  root.innerHTML = `
    <div class="page-head fade-in">
      <h1 class="page-title">我的</h1>
      <p class="page-sub">身份 · 生活 · 共娱 · 设置</p>
    </div>

    <div class="card identity">
      <div class="avatar" style="background:${escapeHtml(me.color || '#E86A92')}">${(escapeHtml(me.nickname || '我'))[0] || '我'}</div>
      <div class="identity-meta">
        <div class="name">${escapeHtml(me.nickname || '我')}</div>
        <div class="sub">${paired ? '已配对 · 共享空间' : '个人模式 · 未配对'}</div>
      </div>
      <button class="btn ghost sm" id="edit">编辑</button>
    </div>

    <div class="card">
      <div class="section-title">配对伴侣 💞</div>
      ${paired ? `
        <div class="partner-row">
          <div class="avatar sm" style="background:${escapeHtml(partner.color || '#999')}">${(escapeHtml(partner.nickname || '?'))[0]}</div>
          <div class="identity-meta">
            <div class="name">${escapeHtml(partner.nickname || 'TA')}</div>
            <div class="sub">在一起始于 ${escapeHtml(ctx.couple.start_date)}</div>
          </div>
        </div>
        <p class="tip">已绑定，数据自动共享 🎉</p>
        <button class="btn ghost sm" id="manage">管理配对</button>
      ` : `
        <p class="tip">在「配对伴侣」生成邀请码或输入 TA 的邀请码，即可共享所有回忆。</p>
        <button class="btn primary block" id="goPair">去配对</button>
      `}
    </div>

    <div class="card">
      <div class="section-title">外观</div>
      <div class="row between">
        <span>主题</span>
        <div class="seg" id="theme">
          <button data-t="light" class="${ctx.getTheme() === 'light' ? 'on' : ''}">浅色</button>
          <button data-t="dark" class="${ctx.getTheme() === 'dark' ? 'on' : ''}">深色</button>
        </div>
      </div>
    </div>

    <div class="placeholder">
      <div class="big">🛠️</div>
      <p>纪念日 / 计划 / 任务 / 打卡 / 影视 等<br>将在第 8、9、10 步实现</p>
    </div>
  `;

  root.querySelector('#edit')?.addEventListener('click', () => ctx.navigate('/onboarding'));
  root.querySelector('#goPair')?.addEventListener('click', () => ctx.navigate('/pairing'));
  root.querySelector('#manage')?.addEventListener('click', () => ctx.navigate('/pairing'));

  const themeSeg = root.querySelector('#theme');
  themeSeg?.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    ctx.setTheme(b.dataset.t);
    themeSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  }));
}
