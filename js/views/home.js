// 首页（第3步基础：个人/情侣状态；完整聚合第5步）
import { daysBetween, toISODate, escapeHtml } from '../ui.js';

export async function render(root, ctx) {
  const paired = ctx.isPaired();
  const start = ctx.couple ? ctx.couple.start_date : null;
  const days = start ? daysBetween(start, toISODate(new Date())) : 0;
  const me = ctx.me || {};

  root.innerHTML = `
    <div class="fade-in">
      <div class="hero">
        ${paired ? `
          <div class="days">${days}<small>天</small></div>
          <div class="since">从 ${escapeHtml(start)} 起，我们在一起</div>
        ` : `
          <div class="days" style="font-size:30px">${escapeHtml(me.nickname || '我')} 的空间</div>
          <div class="since">个人模式 · 随时可邀请 TA</div>
        `}
        <div class="heart heartbeat">💗</div>
      </div>

      ${paired ? '' : `
        <div class="card">
          <div class="section-title">邀请伴侣 💞</div>
          <p class="tip">在「我的 → 配对伴侣」生成邀请码，或输入 TA 的邀请码，即可共享所有回忆。</p>
          <button class="btn primary block" id="goPair">去配对</button>
        </div>
      `}

      <div class="placeholder">
        <div class="big">🛠️</div>
        <p>首页完整聚合（情话 / 速览 / 回忆入口）<br>将在第 5 步实现</p>
      </div>
    </div>`;

  root.querySelector('#goPair')?.addEventListener('click', () => ctx.navigate('/pairing'));
}
