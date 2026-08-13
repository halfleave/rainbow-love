// 我的（第3步基础：身份卡 + 配对入口 + 外观主题；其余模块第8/9/10步）
import { toast, escapeHtml, pageHeader } from '../ui.js';

export async function render(root, ctx) {
  const me = ctx.me || {};
  const paired = ctx.isPaired();
  const partner = ctx.partner || {};

  root.innerHTML = `
    ${pageHeader('我的', { right: paired ? '' : '和TA牵手', hideBack: true })}

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

    <div class="card">
      <div class="section-title">我的记录</div>
      <div class="row-link" id="goAnn">
        <span class="rl-label">📅 纪念日</span>
        <span class="chev">›</span>
      </div>
      <div class="row-link" id="goPlan">
        <span class="rl-label">🗺️ 未来计划</span>
        <span class="chev">›</span>
      </div>
      <div class="row-link" id="goTask">
        <span class="rl-label">📋 日常任务</span>
        <span class="chev">›</span>
      </div>
      <div class="row-link" id="goCheckin">
        <span class="rl-label">📅 日常打卡</span>
        <span class="chev">›</span>
      </div>
    </div>

    <div class="card">
      <div class="section-title">设置</div>
      <div class="row-link" id="goSettings">
        <span class="rl-label">⚙️ 设置</span>
        <span class="chev">›</span>
      </div>
      <div class="row-link" id="goApi">
        <span class="rl-label">🔑 API 管理</span>
        <span class="chev">›</span>
      </div>
    </div>

    <p class="tip center">数据自动同步到云端，安心记录你们的每一天 💞</p>
  `;

  root.querySelector('#edit')?.addEventListener('click', () => ctx.navigate('/onboarding'));
  root.querySelector('#goPair')?.addEventListener('click', () => ctx.navigate('/pairing'));
  root.querySelector('#manage')?.addEventListener('click', () => ctx.navigate('/pairing'));
  root.querySelector('#header-action')?.addEventListener('click', () => ctx.navigate('/pairing'));
  root.querySelector('#goAnn')?.addEventListener('click', () => ctx.navigate('/anniversaries'));
  root.querySelector('#goPlan')?.addEventListener('click', () => ctx.navigate('/plans'));
  root.querySelector('#goTask')?.addEventListener('click', () => ctx.navigate('/tasks'));
  root.querySelector('#goCheckin')?.addEventListener('click', () => ctx.navigate('/checkins'));
  root.querySelector('#goApi')?.addEventListener('click', () => ctx.navigate('/api-config'));
  root.querySelector('#goSettings')?.addEventListener('click', () => ctx.navigate('/settings'));

  const themeSeg = root.querySelector('#theme');
  themeSeg?.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    ctx.setTheme(b.dataset.t);
    themeSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  }));
}
