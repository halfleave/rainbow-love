// 首启个人资料引导（第3步）：设置昵称 + 代表色，可跳过
import { createSingleSpace } from '../supabase.js';
import { toast, escapeHtml } from '../ui.js';

const COLORS = ['#E86A92', '#F4A261', '#A3C9A8', '#8E7DBE', '#5BA4CF', '#E9C46A'];

export async function render(root, ctx) {
  let nick = (ctx.me && ctx.me.nickname && ctx.me.nickname !== '我') ? ctx.me.nickname : '';
  let color = (ctx.me && ctx.me.color) || '#E86A92';

  root.innerHTML = `
    <div class="onboarding fade-in">
      <div class="big">🌈</div>
      <h2 class="page-title">先认识一下你</h2>
      <p class="page-sub">设置昵称和代表色（随时可在「我的」里修改）。<br>你也可以一个人先用起来。</p>

      <label class="field-label">昵称</label>
      <input id="nick" class="text-input" maxlength="12" placeholder="例如：闲敲 / 小花" value="${escapeHtml(nick)}">

      <label class="field-label">代表色</label>
      <div class="color-row" id="colors">
        ${COLORS.map((c) => `<button class="color-dot ${c === color ? 'active' : ''}" data-c="${c}" style="--c:${c}"></button>`).join('')}
      </div>

      <button class="btn primary block" id="save" style="margin-top:20px">进入彩虹</button>
      <button class="btn ghost block" id="skip">稍后再说</button>
    </div>`;

  const dots = root.querySelectorAll('.color-dot');
  dots.forEach((d) => d.addEventListener('click', () => {
    color = d.dataset.c;
    dots.forEach((x) => x.classList.toggle('active', x === d));
  }));

  const save = async () => {
    const name = root.querySelector('#nick').value.trim();
    if (!name) { toast('给个昵称吧～'); return; }
    try {
      // 直接用 RPC 原子创建/更新单人空间，避免 session 漂移导致 upsert RLS 失败
      const updated = await createSingleSpace(name, color);
      await ctx.applyProfile(updated);
      toast('开始吧～');
      ctx.navigate('/home');
    } catch (e) {
      console.error(e);
      toast('保存失败：' + (e.message || e));
    }
  };

  const skip = () => {
    // 不强制保存，直接进首页；默认昵称/颜色保留，之后可在「我的」修改
    ctx.navigate('/home');
  };

  root.querySelector('#save').addEventListener('click', save);
  root.querySelector('#skip').addEventListener('click', skip);
}
