/* ═══════════════════════════════════════════
   RECENT WORKS (IMDb)
   登録済みクリエイターが IMDb で「監督」として載っている作品のうち、
   直近1年に公開されたものをギャラリー表示する。
═══════════════════════════════════════════ */
const RECENT_NAMEID_CACHE_KEY  = 'creator_network_imdb_nameid_v1';
const RECENT_CREDITS_CACHE_KEY = 'creator_network_recent_credits_v2';
const RECENT_NAMEID_TTL_HIT  = 30 * 24 * 60 * 60 * 1000;
const RECENT_NAMEID_TTL_MISS =  7 * 24 * 60 * 60 * 1000;
const RECENT_CREDITS_TTL     = 12 * 60 * 60 * 1000;
const RECENT_CONCURRENCY = 3;
const RECENT_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

// クリエイター名 → { at, nameId } | { at, none: true }
let _recentNameIds = {};
// nameId → { at, image, credits: [{ tt, title, type, year, month, day, image }] }
let _recentCredits = {};
// tt → { ...credit, directors: [{ name, nameId, nodeId, imdbImage }] }
let _recentWorks = new Map();
let _recentScanGen = 0;
let _recentScanning = false;
let _recentScannedNodes = null; // スキャン対象にしたグラフ（AN）— Notion 更新で差し替わったら再スキャン

function _loadRecentCache() {
  try { _recentNameIds = JSON.parse(localStorage.getItem(RECENT_NAMEID_CACHE_KEY) || '{}'); } catch { _recentNameIds = {}; }
  try { _recentCredits = JSON.parse(localStorage.getItem(RECENT_CREDITS_CACHE_KEY) || '{}'); } catch { _recentCredits = {}; }
}
function _saveRecentCache() {
  try { localStorage.setItem(RECENT_NAMEID_CACHE_KEY, JSON.stringify(_recentNameIds)); } catch {}
  try { localStorage.setItem(RECENT_CREDITS_CACHE_KEY, JSON.stringify(_recentCredits)); } catch {}
}

function _recentPost(url, body) {
  return fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json()).then(d => { if (d.error) throw new Error(d.error); return d; });
}

/** 公開日（日付が欠けていれば月初・年初）と、日単位まで分かっているか */
function _recentDate(credit) {
  if (!credit.year) return null;
  return {
    date: new Date(credit.year, (credit.month || 1) - 1, credit.day || 1),
    precision: credit.day ? 'day' : credit.month ? 'month' : 'year',
  };
}

function _inRecentRange(credit, now = new Date()) {
  const d = _recentDate(credit);
  if (!d) return false;
  // 年しか分からないものは今年の作品だけ含める
  if (d.precision === 'year') return credit.year === now.getFullYear();
  if (d.date > now) return false; // 公開予定は除外
  const from = new Date(now.getTime() - RECENT_DAYS * DAY_MS);
  // 月までしか分からないものは、その月の末日が範囲内なら含める
  const end = d.precision === 'month' ? new Date(credit.year, credit.month, 0) : d.date;
  return end >= from;
}

function _formatRecentDate(credit) {
  if (!credit.year) return '';
  if (!credit.month) return String(credit.year);
  const mm = String(credit.month).padStart(2, '0');
  if (!credit.day) return `${credit.year}.${mm}`;
  return `${credit.year}.${mm}.${String(credit.day).padStart(2, '0')}`;
}

/** IMDb の「Artist: Song」形式から曲名部分を取り出して比較用に詰める */
function _recentCompact(str) {
  return (str || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
}
function _isRegisteredWork(credit) {
  const idx = credit.title.lastIndexOf(':');
  const song = _recentCompact(idx >= 0 ? credit.title.slice(idx + 1) : credit.title);
  if (song.length < 3) return false;
  return AN.some(n => n.type === 'work' && _recentCompact(n.label).includes(song));
}

async function _resolveNameId(node) {
  const cached = _recentNameIds[node.label];
  const now = Date.now();
  if (cached && now - cached.at < (cached.none ? RECENT_NAMEID_TTL_MISS : RECENT_NAMEID_TTL_HIT)) {
    return cached.none ? null : cached.nameId;
  }
  // 関わった作品のクレジットから本人を特定する（同名人物の誤一致を防ぐ）
  const d = await _recentPost('/imdb-name-search', { name: node.label, workTitles: linkedWorkTitles(node.id) });
  _recentNameIds[node.label] = d.nameId ? { at: now, nameId: d.nameId } : { at: now, none: true };
  return d.nameId || null;
}

async function _fetchCredits(nameId, force) {
  const cached = _recentCredits[nameId];
  if (!force && cached && Date.now() - cached.at < RECENT_CREDITS_TTL) return cached;
  const { image, credits } = await _recentPost('/imdb-recent-credits', { nameId });
  // 1年より前のものは使わないので保存しない
  const minYear = new Date().getFullYear() - 1;
  const kept = credits.filter(c => c.year && c.year >= minYear);
  _recentCredits[nameId] = { at: Date.now(), image, credits: kept };
  return _recentCredits[nameId];
}

function _addRecentCredits(node, nameId, { image, credits }) {
  credits.forEach(c => {
    if (!c.tt || !_inRecentRange(c)) return;
    let entry = _recentWorks.get(c.tt);
    if (!entry) {
      entry = { ...c, directors: [], registered: _isRegisteredWork(c) };
      _recentWorks.set(c.tt, entry);
    }
    if (!entry.directors.some(d => d.nameId === nameId)) {
      entry.directors.push({ name: node.label, nameId, nodeId: node.id, imdbImage: image || '' });
    }
  });
}

async function scanRecentWorks({ force = false } = {}) {
  const gen = ++_recentScanGen;
  _loadRecentCache();
  _recentWorks = new Map();
  _recentScanning = true;
  _recentScannedNodes = AN;

  const directors = AN.filter(n => n.type === 'director');
  let done = 0, notFound = 0, failed = 0, renderedSize = -1;
  const progress = () => {
    if (gen !== _recentScanGen) return;
    _setRecentSub(`監督 ${done}/${directors.length} 人を確認中…`);
    // 作品が増えたときだけ描き直す（サムネイルのちらつき防止）
    if (_recentWorks.size === renderedSize) return;
    renderedSize = _recentWorks.size;
    renderRecentWorks();
  };
  progress();

  const queue = [...directors];
  const worker = async () => {
    while (queue.length) {
      const node = queue.shift();
      if (gen !== _recentScanGen) return;
      try {
        const nameId = await _resolveNameId(node);
        if (nameId) _addRecentCredits(node, nameId, await _fetchCredits(nameId, force));
        else notFound++;
      } catch (e) {
        failed++;
        console.warn('[RecentWorks]', node.label, e.message); // 失敗はキャッシュせず次回再試行
      }
      done++;
      _saveRecentCache();
      progress();
    }
  };
  await Promise.all(Array.from({ length: RECENT_CONCURRENCY }, worker));
  if (gen !== _recentScanGen) return;

  _recentScanning = false;
  const notes = [`${_recentWorks.size} 作品`, `監督 ${directors.length} 人`];
  if (notFound) notes.push(`IMDb未発見 ${notFound}`);
  if (failed) notes.push(`取得失敗 ${failed}`);
  _setRecentSub(notes.join(' · '));
  renderRecentWorks();
}

/* ── UI ─────────────────────────────────────── */
function _setRecentSub(text) {
  document.getElementById('rw-sub').textContent = text;
}

/** アイコンはグラフと同じ画像（Instagram キャッシュ含む）を優先し、なければ IMDb の顔写真 */
function _recentAvatarSrc(d, igCache = loadIgAvatarCache()) {
  const node = AN.find(n => n.id === d.nodeId);
  if (node?.avatar) return node.avatar;
  const ig = igCache[node?.notionPageId || d.nodeId];
  if (ig?.startsWith('data:')) return ig;
  return d.imdbImage ? imdbProxyImg(d.imdbImage) : '';
}

function _recentAvatarHtml(d, igCache) {
  const initial = esc([...d.name][0] || '?');
  const src = _recentAvatarSrc(d, igCache);
  const img = src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="rw-avatar"><span>${initial}</span>${img}</span>`;
}

function renderRecentWorks() {
  const body = document.getElementById('rw-body');
  const items = [..._recentWorks.values()].sort((a, b) => _recentDate(b).date - _recentDate(a).date);
  if (!items.length) {
    body.innerHTML = _recentScanning
      ? `<div class="fm2-loading"><div class="fm2-spinner"></div>IMDb を確認中…</div>`
      : `<div class="fm2-empty">直近1年に公開された作品は見つかりませんでした</div>`;
    return;
  }

  // 再描画でスクロール位置が飛ばないよう保持する
  const scrollTop = body.scrollTop;
  const igCache = loadIgAvatarCache();
  body.innerHTML = `<div class="rw-grid">${items.map(c => {
    const searchQuery = `${c.title} ${fmgTypeLabel(c.type)}`;
    const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
    const directorsHtml = c.directors.map((d, i) =>
      `<span class="rw-director" data-idx="${i}" role="button" tabindex="0" title="${esc(d.name)} のフィルモグラフィー">
        ${_recentAvatarHtml(d, igCache)}<span class="rw-director-name">${esc(d.name)}</span>
      </span>`).join('');
    return `<a class="rw-card" href="${esc(youtubeUrl)}" target="_blank" rel="noopener" data-yt-query="${esc(searchQuery)}" data-tt="${esc(c.tt)}">
      <div class="rw-thumb-wrap">
        <div class="fmg-ph"></div>
        ${c.registered ? '<span class="rw-registered">登録済み</span>' : ''}
      </div>
      <div class="rw-info">
        <div class="rw-title">${esc(c.title)}</div>
        <div class="rw-meta">
          <span class="fmg-year">${esc(_formatRecentDate(c))}</span>
          <span class="fmg-type">${esc(fmgTypeLabel(c.type))}</span>
        </div>
        <div class="rw-directors">${directorsHtml}</div>
      </div>
    </a>`;
  }).join('')}</div>`;
  body.scrollTop = scrollTop;

  body.querySelectorAll('.rw-card').forEach(card => {
    const credit = _recentWorks.get(card.dataset.tt);
    card.querySelectorAll('.rw-director').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const d = credit.directors[Number(el.dataset.idx)];
        openFilmographyModal(d.name, _recentAvatarSrc(d), { nameId: d.nameId });
      });
    });
  });
  enrichFmgYoutubeLinks(body, '.rw-card[data-yt-query]');
}

function openRecentWorks() {
  document.getElementById('recent-overlay').classList.add('visible');
  // 同じグラフでスキャン中・スキャン済みなら結果をそのまま表示する
  if (_recentScannedNodes === AN) renderRecentWorks();
  else scanRecentWorks();
}

function closeRecentWorks() {
  document.getElementById('recent-overlay').classList.remove('visible');
}

document.getElementById('recent-btn').addEventListener('click', openRecentWorks);
document.getElementById('rw-close').addEventListener('click', closeRecentWorks);
document.getElementById('rw-refresh').addEventListener('click', () => scanRecentWorks({ force: true }));
document.getElementById('recent-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('recent-overlay')) closeRecentWorks();
});
