// 我的 · API 管理（当前配置 TMDB Key，存 localStorage）
import { escapeHtml, pageHeader, toast } from '../ui.js';
import { getTMDBKey, setTMDBKey } from './movie-search.js';

export async function render(root, ctx) {
  const cur = getTMDBKey();
  root.innerHTML = `
    ${pageHeader('API 管理')}
    <div class="card">
      <div class="section-title">TMDB（影视搜索）</div>
      <p class="tip">用于影视页搜索影片、自动获取海报/剧情/评分等。Key 由本人设备本地保存，不会上传到云端。</p>
      <label class="form-row" style="margin-top:10px">
        <span class="form-label">TMDB Key</span>
        <div class="input-wrap">
          <input class="form-input" id="fKey" type="text" inputmode="text" placeholder="粘贴 TMDB API Key" value="${escapeHtml(cur)}">
          <button type="button" class="input-clear" id="fClear" aria-label="清空">×</button>
        </div>
      </label>
      <div class="api-status" id="apiStatus">${cur ? '✅ 已配置' : '⚠️ 未配置'}</div>
      <button class="btn-capsule block" id="saveBtn">保存</button>
    </div>
    <p class="tip center">获取地址：themoviedb.org → 设置 → API → API Key（v3 auth）</p>`;

  root.querySelector('#header-back')?.addEventListener('click', () => {
    if (history.length > 1) history.back(); else ctx.navigate('/mine');
  });

  const keyInput = root.querySelector('#fKey');
  const clearBtn = root.querySelector('#fClear');
  const syncClear = () => { clearBtn.style.display = keyInput.value ? '' : 'none'; };
  clearBtn.addEventListener('click', () => { keyInput.value = ''; keyInput.focus(); syncClear(); });
  keyInput.addEventListener('input', syncClear);
  syncClear();

  root.querySelector('#saveBtn').addEventListener('click', () => {
    const k = keyInput.value.trim();
    setTMDBKey(k);
    root.querySelector('#apiStatus').textContent = k ? '✅ 已配置' : '⚠️ 未配置';
    toast(k ? '已保存' : '已清除');
  });
}
