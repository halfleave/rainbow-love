// 影视记录（条目同步去重·影评按人一份；添加走 TMDB 搜索）
import {
  escapeHtml, confirmDialog, toast
} from '../ui.js';
import {
  loadMovies, loadMyReviews, setMovieWatched, deleteMovie,
  loadReviewsForMovie, upsertReview
} from '../supabase.js';

// 内存状态
let list = [];          // 当前 tab 的影视列表（含未同步本地项）
let myRatings = {};     // movie_id -> 我的评分（列表快速展示）
let tab = 'want';       // want | watched

// ---------------- 列表渲染 ----------------
export async function render(root, ctx) {
  root.innerHTML = `
    <div class="page-head fade-in">
      <h1 class="page-title">影视</h1>
      <div class="seg" id="seg">
        <button data-t="want" class="${tab === 'want' ? 'on' : ''}">想看</button>
        <button data-t="watched" class="${tab === 'watched' ? 'on' : ''}">已看</button>
      </div>
    </div>
    <div id="movieList" class="fade-in"></div>
    <button class="fab" id="movieFab" aria-label="添加影视">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
    </button>`;

  root.querySelector('#movieFab').addEventListener('click', () => ctx.navigate('/movie-search'));
  root.querySelector('#seg').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.t === tab) return;
      tab = b.dataset.t;
      root.querySelector('#seg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      renderList(root, ctx);
    });
  });

  await renderList(root, ctx);
}

async function renderList(root, ctx) {
  const box = root.querySelector('#movieList');
  box.innerHTML = `<div class="placeholder"><div class="big">🌸</div><p>加载中…</p></div>`;
  try {
    const [movies, reviews] = await Promise.all([
      loadMovies(ctx.coupleId, tab === 'watched'),
      loadMyReviews(ctx.coupleId, ctx.me.id)
    ]);
    list = movies;
    myRatings = {};
    reviews.forEach((r) => { if (r.rating != null) myRatings[r.movie_id] = r.rating; });
  } catch (e) {
    box.innerHTML = `<div class="placeholder"><div class="big">🌧️</div><p>加载失败：${escapeHtml(e.message || e)}</p></div>`;
    return;
  }
  renderFromState(root, ctx);
}

function renderFromState(root, ctx) {
  const box = root.querySelector('#movieList');
  if (!list.length) {
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-emoji">${tab === 'want' ? '🎬' : '🍿'}</div>
        <p class="empty-text">${tab === 'want' ? '还没有想看的影视，去搜一部吧' : '还没有已看的影视'}</p>
        <button class="btn-capsule empty-add">添加影视</button>
      </div>`;
    box.querySelector('.empty-add').addEventListener('click', () => ctx.navigate('/movie-search'));
    return;
  }

  box.innerHTML = `<div class="movie-list">${list.map(cardHtml).join('')}</div>`;
  box.querySelectorAll('.movie-card').forEach((el) => {
    el.addEventListener('click', () => {
      const m = list.find((x) => x.id === el.dataset.id);
      openDetail(root, ctx, m);
    });
  });
}

function cardHtml(m) {
  const r = myRatings[m.id];
  const rating = r != null ? `<span class="movie-star">★ ${Number(r).toFixed(1)}</span>` : '<span class="movie-norate">未评分</span>';
  const poster = m.poster
    ? `<img src="${escapeHtml(m.poster)}" alt="" onerror="this.parentNode.classList.add('noimg')">`
    : `<span class="poster-ph">🎬</span>`;
  return `
    <div class="movie-card" data-id="${m.id}">
      <div class="movie-poster">${poster}</div>
      <div class="movie-info">
        <div class="movie-title">${escapeHtml(m.title)}</div>
        <div class="movie-rating">${rating}</div>
      </div>
      <span class="chev">›</span>
    </div>`;
}

// ---------------- 详情 sheet（TMDB 信息 + 双方评价） ----------------
async function openDetail(root, ctx, m) {
  const meta = m.meta || {};
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head">
        <button class="sheet-close" id="sheetClose">×</button>
        <span class="sheet-title">影视详情</span>
        <span style="width:40px"></span>
      </div>
      <div class="sheet-body">
        <div class="md-hero">
          <div class="movie-poster">${m.poster ? `<img src="${escapeHtml(m.poster)}" alt="" onerror="this.parentNode.classList.add('noimg')">` : '<span class="poster-ph">🎬</span>'}</div>
          <div class="md-title">${escapeHtml(m.title)}</div>
          ${meta.original_title && meta.original_title !== m.title ? `<div class="md-orig">原名：${escapeHtml(meta.original_title)}</div>` : ''}
          <span class="badge md-status">${m.watched ? '已看' : '想看'}</span>
        </div>
        <div id="detailMeta">${metaHtml(meta)}</div>
        ${meta.trailer_key ? `<a class="btn-text md-trailer" href="https://www.youtube.com/watch?v=${escapeHtml(meta.trailer_key)}" target="_blank" rel="noopener">▶ 看预告片</a>` : ''}
        <div id="detailBody"><div class="placeholder"><p>加载中…</p></div></div>
      </div>
    </div>`;
  root.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const close = () => { overlay.remove(); document.body.style.overflow = ''; };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#sheetClose').addEventListener('click', close);

  // 载入双方影评
  let reviews = [];
  try { reviews = await loadReviewsForMovie(ctx.coupleId, m.id); } catch (_) {}
  const mine = ctx.me ? reviews.find((r) => r.owner_id === ctx.me.id) : null;
  const partner = (ctx.isPaired() && ctx.partner) ? reviews.find((r) => r.owner_id === ctx.partner.id) : null;

  const body = overlay.querySelector('#detailBody');
  body.innerHTML = `
    <div class="review-block">
      <div class="review-head">我的评价</div>
      <div class="stars" id="myStars" data-val="${mine && mine.rating ? mine.rating : 0}">${starHtml(mine && mine.rating ? mine.rating : 0)}</div>
      <textarea class="form-input" id="myReview" rows="3" placeholder="写点观后感（选填）" maxlength="200">${mine && mine.review ? escapeHtml(mine.review) : ''}</textarea>
      <button class="btn-capsule block" id="saveReview">保存我的评价</button>
    </div>
    ${partner ? `
    <div class="review-block">
      <div class="review-head" style="color:${escapeHtml(ctx.partner.color || '#999')}">${escapeHtml(ctx.partner.nickname || 'TA')} 的</div>
      <div class="partner-review">
        ${partner.rating != null ? `<span class="movie-star">★ ${Number(partner.rating).toFixed(1)}</span>` : '<span class="movie-norate">未评分</span>'}
        ${partner.review ? `<p class="review-text">${escapeHtml(partner.review)}</p>` : ''}
      </div>
    </div>` : (ctx.isPaired() ? '<p class="tip">TA 还没写评价</p>' : '<p class="tip">配对后可看到 TA 的评分</p>')}
    <div class="detail-actions">
      <button class="btn-text" id="toggleWatch">${m.watched ? '标为想看' : '标记已看'}</button>
      <button class="btn-text danger" id="delBtn">删除</button>
    </div>`;

  const myStars = body.querySelector('#myStars');
  bindStars(myStars, () => {});
  body.querySelector('#saveReview').addEventListener('click', async () => {
    const rating = Number(myStars.querySelectorAll('.star.on').length) || null;
    const review = body.querySelector('#myReview').value.trim();
    const btn = body.querySelector('#saveReview');
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      await upsertReview({ coupleId: ctx.coupleId, movieId: m.id, rating, review });
      toast('已保存');
      if (rating != null) myRatings[m.id] = rating;
      renderFromState(root, ctx);
      close();
    } catch (e) {
      toast('保存失败：' + (e.message || e));
      btn.disabled = false; btn.textContent = '保存我的评价';
    }
  });

  body.querySelector('#toggleWatch').addEventListener('click', async () => {
    try {
      await setMovieWatched(m.id, !m.watched);
      toast(m.watched ? '已标为想看' : '已标记已看');
      close();
      await renderList(root, ctx);
    } catch (e) { toast('操作失败：' + (e.message || e)); }
  });

  body.querySelector('#delBtn').addEventListener('click', async () => {
    const ok = await confirmDialog('删除影视', '删除后双方都看不到，确定吗？');
    if (!ok) return;
    if (String(m.id).startsWith('local-')) {
      list = list.filter((x) => x.id !== m.id);
      renderFromState(root, ctx); toast('已删除'); close(); return;
    }
    try {
      await deleteMovie(m.id);
      toast('已删除'); close(); await renderList(root, ctx);
    } catch (e) { toast('删除失败：' + (e.message || e)); }
  });
}

function metaHtml(meta) {
  if (!meta || (!meta.year && !meta.runtime && !meta.overview && !meta.countries && !meta.genres && !meta.certification)) return '';
  const rows = [];
  if (meta.year) rows.push(`<span class="md-item">📅 ${escapeHtml(meta.year)}</span>`);
  if (meta.runtime) rows.push(`<span class="md-item">⏱ ${escapeHtml(meta.runtime)} 分钟</span>`);
  if (meta.certification) rows.push(`<span class="md-item">🔞 ${escapeHtml(meta.certification)}</span>`);
  if (meta.countries && meta.countries.length) rows.push(`<span class="md-item">🌍 ${escapeHtml(meta.countries.join(' / '))}</span>`);
  if (meta.genres && meta.genres.length) rows.push(`<span class="md-item">🏷 ${escapeHtml(meta.genres.join(' / '))}</span>`);
  let html = '';
  if (rows.length) html += `<div class="md-meta">${rows.join('')}</div>`;
  if (meta.overview) html += `<p class="md-overview">${escapeHtml(meta.overview)}</p>`;
  return html;
}

function starHtml(val) {
  let s = '';
  for (let i = 1; i <= 5; i++) s += `<span class="star ${i <= val ? 'on' : ''}" data-v="${i}">★</span>`;
  return s;
}
function bindStars(box, cb) {
  box.querySelectorAll('.star').forEach((s) => s.addEventListener('click', () => {
    const v = Number(s.dataset.v);
    let cur = box.querySelectorAll('.star.on').length;
    cur = cur === v ? 0 : v;
    box.innerHTML = starHtml(cur);
    bindStars(box, cb);
    cb(cur);
  }));
}
