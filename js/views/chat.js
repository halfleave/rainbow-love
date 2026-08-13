// 聊天（第3步基础：未配对引导；完整功能第4步）
export async function render(root, ctx) {
  const paired = ctx.isPaired();
  root.innerHTML = `
    <div class="page-head fade-in">
      <h1 class="page-title">聊天</h1>
      <p class="page-sub">实时连接彼此</p>
    </div>
    ${paired ? `
      <div class="placeholder">
        <div class="big">💬</div>
        <p>实时聊天（文字 / 图片 / 在线 / 已读）<br>将在第 4 步实现</p>
      </div>
    ` : `
      <div class="placeholder">
        <div class="big">🔒</div>
        <p>配对后即可和 TA 实时聊天<br>
        <button class="btn ghost" id="goPair">去配对</button></p>
      </div>
    `}`;

  root.querySelector('#goPair')?.addEventListener('click', () => ctx.navigate('/pairing'));
}
