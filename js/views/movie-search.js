// 影视 · TMDB 搜索页（输入片名 → 选结果 → 弹窗选 想看/已看 → 拉详情写入）
import { escapeHtml, pageHeader, toast } from '../ui.js';
import { upsertMovie } from '../supabase.js';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p';
const CC_MAP = {
  US: '美国', GB: '英国', CN: '中国大陆', HK: '中国香港', TW: '中国台湾', JP: '日本', KR: '韩国',
  FR: '法国', DE: '德国', IN: '印度', TH: '泰国', CA: '加拿大', AU: '澳大利亚',
  IT: '意大利', ES: '西班牙', RU: '俄罗斯', NZ: '新西兰', NL: '荷兰', SE: '瑞典',
  CH: '瑞士', BR: '巴西', MX: '墨西哥', DK: '丹麦', NO: '挪威', FI: '芬兰',
  BE: '比利时', AT: '奥地利', IE: '爱尔兰', PT: '葡萄牙', PL: '波兰', CZ: '捷克',
  HU: '匈牙利', GR: '希腊', TR: '土耳其', IL: '以色列', ZA: '南非',
  AR: '阿根廷', CL: '智利', CO: '哥伦比亚', PH: '菲律宾', SG: '新加坡', MY: '马来西亚',
  ID: '印度尼西亚', VN: '越南', EG: '埃及', AE: '阿联酋', SA: '沙特阿拉伯'
};

// TMDB Key 存于 localStorage（用户在自己页配置）
export function getTMDBKey() { return (localStorage.getItem('rainbow-tmdb-key') || '').trim(); }
export function setTMDBKey(k) { try { localStorage.setItem('rainbow-tmdb-key', k || ''); } catch (_) {} }

export async function render(root, ctx) {
  root.innerHTML = `
    ${pageHeader('搜索影片')}
    <div class="search-bar">
      <input class="search-input" id="q" type="search" placeholder="输入影片名，如：星际穿越" autocomplete="off">
      <button class="btn-capsule" id="searchBtn">搜索</button>
    </div>
    <div id="results" class="fade-in"><div class="placeholder"><div class="big">🔍</div><p>搜一部想看的影视吧</p></div></div>`;

  root.querySelector('#header-back')?.addEventListener('click', () => {
    if (history.length > 1) history.back(); else ctx.navigate('/movie');
  });
  const qEl = root.querySelector('#q');
  const doSearch = () => runSearch(root, ctx);
  root.querySelector('#searchBtn').addEventListener('click', doSearch);
  qEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
}

async function runSearch(root, ctx) {
  const q = root.querySelector('#q').value.trim();
  if (!q) { toast('输入影片名'); return; }
  const key = getTMDBKey();
  if (!key) { toast('请先在「我的 → API 管理」配置 TMDB Key'); return; }
  const box = root.querySelector('#results');
  box.innerHTML = `<div class="placeholder"><p>搜索中…</p></div>`;

  const url = `${TMDB_API_BASE}/search/movie?api_key=${encodeURIComponent(key)}&language=zh-CN&include_adult=false&query=${encodeURIComponent(q)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    renderResults(root, ctx, data.results || []);
  } catch (e) {
    box.innerHTML = `<div class="placeholder"><div class="big">🌧️</div><p>搜索失败：${escapeHtml(e.message || e)}</p></div>`;
  }
}

function renderResults(root, ctx, results) {
  const box = root.querySelector('#results');
  if (!results.length) {
    box.innerHTML = `<div class="placeholder"><div class="big">🤔</div><p>没找到匹配结果</p></div>`;
    return;
  }
  box.innerHTML = `<div class="tmdb-list">${results.slice(0, 20).map(resultHtml).join('')}</div>`;
  box.querySelectorAll('.tr-add').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAddSheet(root, ctx, btn.dataset.id);
    });
  });
}

function resultHtml(item) {
  const poster = item.poster_path ? TMDB_IMG_BASE + '/w154' + item.poster_path : '';
  const name = item.title || item.original_title || '';
  const date = item.release_date || '';
  const vote = (typeof item.vote_average === 'number' && item.vote_average) ? `<span class="tr-vote">★ ${item.vote_average.toFixed(1)}</span>` : '';
  return `
    <div class="tmdb-result" data-id="${item.id}">
      <div class="tr-poster">${poster ? `<img src="${escapeHtml(poster)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<div class="tr-ph">🎬</div>'}</div>
      <div class="tr-info">
        <div class="tr-title">${escapeHtml(name)}</div>
        ${date || vote ? `<div class="tr-meta">${date ? escapeHtml(date) : ''} ${vote}</div>` : ''}
      </div>
      <button class="icon-btn tr-add" data-id="${item.id}" aria-label="添加">＋</button>
    </div>`;
}

// 拉详情（分级 + 预告片；不拉 images，避免剧照/logo 撑大数据）
async function loadDetail(key, id) {
  const base = `${TMDB_API_BASE}/movie/${id}`;
  const url = `${base}?api_key=${encodeURIComponent(key)}&language=zh-CN&append_to_response=release_dates,videos`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  let d = await r.json();
  if (!d.overview || !d.overview.trim()) {
    try {
      const fb = await fetch(`${base}?api_key=${encodeURIComponent(key)}&language=en-US`).then((x) => x.ok ? x.json() : null);
      if (fb) { d.overview = fb.overview || d.overview; d.title = d.title || fb.title; }
    } catch (_) {}
  }
  return d;
}

function buildMeta(d) {
  const date = d.release_date || '';
  const year = date.slice(0, 4);
  const countries = (d.production_countries || []).map((c) => CC_MAP[c.iso_3166_1] || c.name);
  const genres = (d.genres || []).map((g) => g.name);
  let cert = '';
  if (d.release_dates && d.release_dates.results) {
    const us = (d.release_dates.results || []).find((r) => r.iso_3166_1 === 'US');
    if (us) { const c = (us.release_dates || []).find((x) => x.certification); cert = c ? c.certification : ''; }
  }
  let trailerKey = '';
  if (d.videos && d.videos.results) {
    const yt = d.videos.results.filter((v) => v.site === 'YouTube' && v.key);
    const tr = yt.find((v) => v.type === 'Trailer' && v.official) || yt.find((v) => v.type === 'Trailer') || yt[0];
    if (tr) trailerKey = tr.key;
  }
  // 仅保留海报（movies.poster 列）+ 文本元数据，剧照/logo 不再入库，控制数据体积
  return {
    original_title: d.original_title || d.title || '',
    year,
    runtime: d.runtime || '',
    overview: d.overview || '',
    certification: cert,
    countries,
    genres,
    trailer_key: trailerKey
  };
}

function detailHeadHtml(d) {
  const poster = d.poster_path ? TMDB_IMG_BASE + '/w342' + d.poster_path : '';
  const year = (d.release_date || '').slice(0, 4);
  return `
    <div class="md-hero">
      <div class="movie-poster">${poster ? `<img src="${escapeHtml(poster)}" alt="" onerror="this.parentNode.classList.add('noimg')">` : '<span class="poster-ph">🎬</span>'}</div>
      <div class="md-title">${escapeHtml(d.title || '')}</div>
      ${d.original_title && d.original_title !== d.title ? `<div class="md-orig">原名：${escapeHtml(d.original_title)}</div>` : ''}
      ${year ? `<div class="md-orig">${escapeHtml(year)}</div>` : ''}
    </div>`;
}

async function openAddSheet(root, ctx, id) {
  const key = getTMDBKey();
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head">
        <button class="sheet-close" id="sheetClose">×</button>
        <span class="sheet-title">添加到影视</span>
        <button class="sheet-action" id="saveBtn">添加</button>
      </div>
      <div class="sheet-body">
        <div id="addMeta"><div class="placeholder"><p>获取详情中…</p></div></div>
        <label class="form-row">
          <span class="form-label">状态</span>
          <div class="seg" id="fStatus">
            <button data-v="false" class="on">想看</button>
            <button data-v="true">已看</button>
          </div>
        </label>
      </div>
    </div>`;
  root.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const close = () => { overlay.remove(); document.body.style.overflow = ''; };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#sheetClose').addEventListener('click', close);

  const statusSeg = overlay.querySelector('#fStatus');
  statusSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    statusSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  }));

  let detail = null;
  try {
    detail = await loadDetail(key, id);
    overlay.querySelector('#addMeta').innerHTML = detailHeadHtml(detail);
  } catch (e) {
    overlay.querySelector('#addMeta').innerHTML = `<p class="tip">获取详情失败：${escapeHtml(e.message || e)}</p>`;
  }

  overlay.querySelector('#saveBtn').addEventListener('click', async () => {
    if (!detail) { toast('详情未加载，无法添加'); return; }
    const watched = statusSeg.querySelector('.on').dataset.v === 'true';
    const meta = buildMeta(detail);
    const btn = overlay.querySelector('#saveBtn');
    btn.disabled = true; btn.textContent = '添加中…';
    try {
      await upsertMovie({
        coupleId: ctx.coupleId,
        externalId: 'tmdb:' + detail.id,
        title: detail.title || detail.original_title || '未命名',
        poster: detail.poster_path ? TMDB_IMG_BASE + '/w342' + detail.poster_path : null,
        watched,
        meta,
        officialRating: (typeof detail.vote_average === 'number') ? Number(detail.vote_average.toFixed(1)) : null
      });
      toast('已添加 🎬');
      close();
      ctx.navigate('/movie');
    } catch (e) {
      toast('添加失败：' + (e.message || e));
      btn.disabled = false; btn.textContent = '添加';
    }
  });
}
