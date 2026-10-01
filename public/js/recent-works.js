/* ═══════════════════════════════════════════
   RECENT WORKS (IMDb)
   登録済みクリエイターが IMDb で「監督」として載っている MV を
   公開日の新しい順にギャラリー表示する。
═══════════════════════════════════════════ */
const RECENT_NAMEID_CACHE_KEY  = 'creator_network_imdb_nameid_v1';
const RECENT_CREDITS_CACHE_KEY = 'creator_network_director_mvs_v2';
const RECENT_NAMEID_TTL_HIT  = 30 * 24 * 60 * 60 * 1000;
const RECENT_NAMEID_TTL_MISS =  7 * 24 * 60 * 60 * 1000;
const RECENT_CREDITS_TTL     = 12 * 60 * 60 * 1000;
const RECENT_CONCURRENCY = 3;
const RECENT_FLUSH_SIZE = 10; // この件数たまるごとにギャラリーへ差し込む

// 古いキャッシュ（直近1年版・評価なし版）は使わないので掃除する
try { ['creator_network_recent_credits_v1', 'creator_network_recent_credits_v2', 'creator_network_director_mvs_v1'].forEach(key => localStorage.removeItem(key)); } catch {}

// クリエイター名 → { at, nameId } | { at, none: true }
let _recentNameIds = {};
// nameId → { at, image, credits: [{ tt, title, year, month, day }] }
let _recentCredits = {};
// tt → { ...credit, sortKey, registered, directors: [{ name, nameId, nodeId, imdbImage }], card? }
let _recentWorks = new Map();
let _recentPending = [];        // まだギャラリーに出していない作品
let _recentDirty = new Set();   // 表示済みで監督が増えた作品
let _recentScanGen = 0;
let _recentScanning = false;
let _recentScannedNodes = null; // スキャン対象にしたグラフ（AN）— Notion 更新で差し替わったら再スキャン
let _recentThumbObserver = null;

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

/** 並び順のキー（日付が欠けていれば月初・年初扱い）。公開日不明・公開予定は null */
function _recentSortKey(credit, now = Date.now()) {
  if (!credit.year) return null;
  const time = new Date(credit.year, (credit.month || 1) - 1, credit.day || 1).getTime();
  return time > now ? null : time;
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
/** グラフ上の同じ作品（曲名がタイトルに含まれる作品）。なければ null */
function _findRegisteredWork(credit) {
  const idx = credit.title.lastIndexOf(':');
  const song = _recentCompact(idx >= 0 ? credit.title.slice(idx + 1) : credit.title);
  if (song.length < 3) return null;
  return AN.find(n => n.type === 'work' && _recentCompact(n.label).includes(song)) || null;
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
  const { image, credits } = await _recentPost('/imdb-director-mvs', { nameId });
  _recentCredits[nameId] = { at: Date.now(), image, credits };
  return _recentCredits[nameId];
}

function _addRecentCredits(node, nameId, { image, credits }) {
  const now = Date.now();
  credits.forEach(c => {
    const sortKey = _recentSortKey(c, now);
    if (!c.tt || sortKey === null) return;
    let entry = _recentWorks.get(c.tt);
    if (!entry) {
      const workNode = _findRegisteredWork(c);
      entry = { ...c, sortKey, directors: [], workNode, registered: !!workNode };
      _recentWorks.set(c.tt, entry);
      _recentPending.push(entry);
    }
    if (!entry.directors.some(d => d.nameId === nameId)) {
      entry.directors.push({ name: node.label, nameId, nodeId: node.id, imdbImage: image || '' });
      if (entry.card) _recentDirty.add(entry);
    }
  });
}

async function scanRecentWorks({ force = false } = {}) {
  const gen = ++_recentScanGen;
  _loadRecentCache();
  _recentWorks = new Map();
  _recentPending = [];
  _recentDirty = new Set();
  _recentScanning = true;
  _recentScannedNodes = AN;
  _resetRecentGallery();

  const directors = AN.filter(n => n.type === 'director');
  let done = 0, notFound = 0, failed = 0;
  const progress = () => {
    _setRecentSub(`${_recentWorks.size} 作品 · 監督 ${done}/${directors.length} 人を確認中…`);
    if (_recentPending.length >= RECENT_FLUSH_SIZE) _flushRecentWorks();
  };
  progress();

  const queue = [...directors];
  const worker = async () => {
    while (queue.length) {
      const node = queue.shift();
      if (gen !== _recentScanGen) return;
      try {
        const nameId = await _resolveNameId(node);
        const credits = nameId ? await _fetchCredits(nameId, force) : null;
        if (gen !== _recentScanGen) return; // 再スキャンが始まったら古い結果は捨てる
        if (credits) _addRecentCredits(node, nameId, credits);
        else notFound++;
      } catch (e) {
        failed++;
        console.warn('[RecentWorks]', node.label, e.message); // 失敗はキャッシュせず次回再試行
      }
      if (gen !== _recentScanGen) return;
      done++;
      _saveRecentCache();
      progress();
    }
  };
  await Promise.all(Array.from({ length: RECENT_CONCURRENCY }, worker));
  if (gen !== _recentScanGen) return;

  _recentScanning = false;
  _flushRecentWorks();
  const notes = [`${_recentWorks.size} 作品`, `監督 ${directors.length} 人`];
  if (notFound) notes.push(`IMDb未発見 ${notFound}`);
  if (failed) notes.push(`取得失敗 ${failed}`);
  _setRecentSub(notes.join(' · '));
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

function _recentDirectorsHtml(entry, igCache) {
  return entry.directors.map((d, i) => {
    const initial = esc([...d.name][0] || '?');
    const src = _recentAvatarSrc(d, igCache);
    const img = src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : '';
    return `<span class="rw-director" data-idx="${i}" role="button" tabindex="0" title="${esc(d.name)} のフィルモグラフィー">
      <span class="avatar avatar-xs">${initial}${img}</span><span class="rw-director-name">${esc(d.name)}</span>
    </span>`;
  }).join('');
}

function _createRecentCard(entry, igCache) {
  const searchQuery = `${entry.title} Music Video`;
  const card = document.createElement('a');
  card.className = 'rw-card';
  card.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
  card.target = '_blank';
  card.rel = 'noopener';
  card.dataset.ytQuery = searchQuery;
  card.innerHTML = `
    <div class="rw-thumb-wrap">
      <div class="fmg-ph"></div>
      ${entry.registered ? '<span class="thumb-badge rw-registered">登録済み</span>' : ''}
    </div>
    <div class="rw-info">
      <div class="rw-title">${esc(entry.title)}</div>
      <div class="rw-meta">
        <span class="fmg-year">${esc(_formatRecentDate(entry))}</span>
        ${entry.rating ? `<span class="fmg-rating">${STAR_ICON}${entry.rating.toFixed(1)}</span><span class="fmg-votes">${entry.votes.toLocaleString()}票</span>` : ''}
      </div>
      <div class="rw-directors">${_recentDirectorsHtml(entry, igCache)}</div>
    </div>`;
  // カードはページ内のパネルで開く（Cmd/Ctrl クリックなどは YouTube 検索を新しいタブで）
  card.addEventListener('click', e => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openRecentWorkPanel(entry);
  });
  // 監督は後から増えることがあるので、クリック時に entry から引く
  card.querySelector('.rw-directors').addEventListener('click', e => {
    const el = e.target.closest('.rw-director');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const d = entry.directors[Number(el.dataset.idx)];
    openFilmographyModal(d.name, _recentAvatarSrc(d), { nameId: d.nameId });
  });
  return card;
}

/** サムネイルは画面に近づいたカードの分だけ YouTube に問い合わせる */
function _observeRecentThumb(card) {
  if (!_recentThumbObserver) {
    const body = document.getElementById('rw-body');
    _recentThumbObserver = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).map(e => e.target);
      if (!visible.length) return;
      visible.forEach(el => {
        _recentThumbObserver.unobserve(el);
        el.dataset.ytPending = '1';
      });
      enrichFmgYoutubeLinks(body, '.rw-card[data-yt-pending]');
      visible.forEach(el => delete el.dataset.ytPending);
    }, { root: body, rootMargin: '400px 0px' });
  }
  _recentThumbObserver.observe(card);
}

function _resetRecentGallery() {
  _recentThumbObserver?.disconnect();
  _recentThumbObserver = null;
  const body = document.getElementById('rw-body');
  body.scrollTop = 0;
  body.innerHTML = `<div class="rw-grid"></div>
    <div class="fm2-loading" id="rw-loading"><div class="spinner"></div>IMDb を確認中…</div>`;
}

/** たまった作品を新しい順の位置に差し込む。表示済みのカードは作り直さない（チラつき防止） */
function _flushRecentWorks() {
  const grid = document.querySelector('#rw-body .rw-grid');
  if (!grid) return;
  const igCache = loadIgAvatarCache();

  _recentDirty.forEach(entry => {
    entry.card.querySelector('.rw-directors').innerHTML = _recentDirectorsHtml(entry, igCache);
  });
  _recentDirty.clear();

  const pending = _recentPending.sort((a, b) => b.sortKey - a.sortKey);
  _recentPending = [];
  // 既存カードも新しい順に並んでいるので、マージしながら挿入位置を進める
  let cursor = grid.firstElementChild;
  pending.forEach(entry => {
    while (cursor && _recentWorks.get(cursor.dataset.tt)?.sortKey >= entry.sortKey) {
      cursor = cursor.nextElementSibling;
    }
    entry.card = _createRecentCard(entry, igCache);
    entry.card.dataset.tt = entry.tt;
    grid.insertBefore(entry.card, cursor);
    _observeRecentThumb(entry.card);
  });

  const loading = document.getElementById('rw-loading');
  if (!_recentScanning) {
    loading?.remove();
    if (!_recentWorks.size) grid.outerHTML = `<div class="fm2-empty">MV が見つかりませんでした</div>`;
  } else if (loading && _recentWorks.size) {
    // 作品が出始めたらスピナーは一覧の下に小さく残す
    loading.classList.add('rw-loading-more');
  }
}

/* ── 作品パネル（ギャラリーの上に開く） ───────── */
const RECENT_DEFAULT_TAGS = ['MV'];
let _workCategoryOptions = null; // Promise<[{ name, color }]>
let _recentGraphDirty = false;   // 保存した作品をギャラリーを閉じたときにグラフへ反映する

function _loadWorkCategoryOptions() {
  if (!_workCategoryOptions) {
    _workCategoryOptions = fetch('/notion-work-categories').then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); return d.options; })
      .catch(e => { _workCategoryOptions = null; throw e; });
  }
  return _workCategoryOptions;
}

/** YouTube の動画（サムネイル取得と同じ検索。結果は共有キャッシュに入る） */
async function _recentYoutube(entry) {
  const query = `${entry.title} Music Video`;
  if (!_fmgYoutubeCache.has(query)) {
    const data = await _recentPost('/youtube-video-search', { titles: [query] });
    _fmgYoutubeCache.set(query, data.results?.[query] || null);
  }
  return _fmgYoutubeCache.get(query);
}

/** IMDb の「Artist feat. X: Song」から、Notion に登録済みのアーティストを探す */
function _matchArtists(entry) {
  const idx = entry.title.lastIndexOf(':');
  if (idx < 0) return [];
  const artistPart = entry.title.slice(0, idx);
  const names = [artistPart, ...artistPart.split(/\s*(?:,|&|×|\bfeat\.?|\bft\.?|\bx\b|\band\b)\s*/i)]
    .map(_recentCompact).filter(name => name.length >= 2);
  const found = new Map();
  ALL_ARTISTS.forEach(artist => {
    const key = _recentCompact(artist.Name);
    if (key && artist.notionPageId && names.some(name => key === name || key.startsWith(name))) {
      found.set(artist.notionPageId, artist);
    }
  });
  return [...found.values()];
}

function _artistPerson(a) {
  return { name: a.Name, notionPageId: a.notionPageId, avatar: a.Avatar || '', role: '' };
}

function _creatorNode(p) {
  return AN.find(n => n.type === 'director' && p.notionPageId && n.notionPageId === p.notionPageId)
      || AN.find(n => n.id === `d_${p.name}`);
}

/** 保存フォームの人物欄（小さいアイコン＋名前のピル、× で外す、最後に ＋）。
    list を直接書き換える。再描画は _editablePeople.render(el) */
function _editablePeople(el, list, { onAdd, addLabel = '追加', avatarClass = '' } = {}) {
  el._people = { list, onAdd, addLabel, avatarClass };
  _editablePeople.render(el);
}
_editablePeople.render = el => {
  const { list, onAdd, addLabel, avatarClass } = el._people;
  el.innerHTML = list.map((p, i) => {
    const img = p.avatar ? `<img src="${esc(p.avatar)}" alt="" onerror="this.remove()">` : '';
    return `<span class="person-pill" title="${esc(p.role ? `${p.name}（${p.role}）` : p.name)}">
      <span class="avatar avatar-pill${avatarClass}">${esc([...p.name][0] || '?')}${img}</span>
      <span class="person-pill-name">${esc(p.name)}</span>
      <button class="tag-remove" data-idx="${i}" title="${esc(p.name)}を外す">${icon('x', 12)}</button>
    </span>`;
  }).join('') + `<button class="prop-add" title="${esc(addLabel)}">${icon('plus', 14)}</button>`;
  el.querySelectorAll('.tag-remove').forEach(btn => btn.addEventListener('click', () => {
    list.splice(Number(btn.dataset.idx), 1);
    _editablePeople.render(el);
  }));
  const addBtn = el.querySelector('.prop-add');
  addBtn.addEventListener('click', () => onAdd(addBtn));
};

function _raiseInfoPanel() {
  document.getElementById('info-panel').classList.add('above-gallery');
  document.getElementById('info-overlay').classList.add('above-gallery');
}

function openRecentWorkPanel(entry) {
  _raiseInfoPanel();
  // 登録済みの作品は通常の作品パネルをそのまま開く
  if (entry.workNode && AN.includes(entry.workNode)) {
    showPanel(entry.workNode);
    return;
  }

  document.getElementById('pt').textContent = 'WORK';
  const pnEl = document.getElementById('pn');
  pnEl.textContent = entry.title;
  pnEl.ondblclick = null; pnEl.title = ''; pnEl.style.cursor = '';
  document.getElementById('ph-avatar').style.display = 'none';
  ['pc-hide', 'pc-search', 'pc-notion'].forEach(id => { document.getElementById(id).style.display = 'none'; });

  const panelId = `imdb_rw_${Date.now()}`;
  const igCache = loadIgAvatarCache();
  // 保存する人物（{ name, notionPageId, avatar, role }）。初期値は IMDb の監督と、タイトルから一致したアーティスト
  const creators = entry.directors.map(d => {
    const node = AN.find(n => n.id === d.nodeId);
    return { name: d.name, notionPageId: node?.notionPageId || '', avatar: _recentAvatarSrc(d, igCache), role: node?.role || '' };
  });
  const artists = _matchArtists(entry).map(_artistPerson);

  document.getElementById('pc2').innerHTML = `
    <div class="player" id="rw-player"><div class="player-msg"><div class="spinner"></div>動画を検索中…</div></div>
    <div class="panel-meta">
      <span class="chip">${esc(_formatRecentDate(entry))}</span>
      ${entry.rating ? `<span class="fmg-rating">${STAR_ICON}${entry.rating.toFixed(1)}</span><span class="fmg-votes">${entry.votes.toLocaleString()}票</span>` : ''}
    </div>
    <div class="panel-section" id="rw-save">
      <div class="section-label"><span>Notion に保存</span></div>
      <div class="prop-list">
        <div class="prop-row"><div class="prop-label">カテゴリ</div><div class="prop-value" id="rw-save-tags"></div></div>
        <div class="prop-row"><div class="prop-label">クリエイター</div><div class="prop-value" id="rw-creators"></div></div>
        <div class="prop-row"><div class="prop-label">アーティスト</div><div class="prop-value" id="rw-artists"></div></div>
      </div>
      <button class="btn btn-primary btn-block prop-submit" id="rw-save-btn">Notion に保存</button>
    </div>
    ${imdbSectionHtml(panelId)}`;

  const panel = document.getElementById('info-panel');
  panel.classList.add('mode-modal', 'visible');
  panel.classList.remove('mode-side');
  panel.scrollTop = 0;
  document.getElementById('info-overlay').classList.add('visible');

  // クリエイター
  const creatorsEl = document.getElementById('rw-creators');
  _editablePeople(creatorsEl, creators, {
    addLabel: 'クリエイターを追加',
    onAdd: anchor => {
      const chosen = new Set(creators.map(p => p.notionPageId));
      showPersonPicker(anchor, {
        people: ALL_CREATORS.filter(c => !chosen.has(c.notionPageId)),
        onPick: c => {
          creators.push({ name: c.Name, notionPageId: c.notionPageId, avatar: c.Avatar || '', role: c.Role || '' });
          _editablePeople.render(creatorsEl);
        },
      });
    },
  });

  // アーティスト（既存から選ぶか、名前を入れて新規作成）
  const artistsEl = document.getElementById('rw-artists');
  _editablePeople(artistsEl, artists, {
    avatarClass: ' art',
    addLabel: 'アーティストを追加',
    onAdd: anchor => {
      const chosen = new Set(artists.map(p => p.notionPageId));
      showPersonPicker(anchor, {
        people: ALL_ARTISTS.filter(a => !chosen.has(a.notionPageId)),
        avatarClass: ' art',
        onPick: artist => {
          artists.push(_artistPerson(artist));
          _editablePeople.render(artistsEl);
        },
        onCreate: async name => {
          try {
            const res = await _recentPost('/notion-create-artist', { name });
            let artist = ALL_ARTISTS.find(a => a.notionPageId === res.artistPageId);
            if (!artist) {
              artist = { Name: name, Role: '', SNS: '', Avatar: '', notionPageId: res.artistPageId };
              ALL_ARTISTS.push(artist);
            }
            if (!artists.some(p => p.notionPageId === artist.notionPageId)) artists.push(_artistPerson(artist));
            if (artistsEl.isConnected) _editablePeople.render(artistsEl);
            showToast(res.alreadyExists ? `既存のアーティスト「${name}」を使います` : `アーティスト「${name}」を作成しました`);
          } catch (e) {
            showToast(`✗ アーティストを作成できませんでした: ${e.message}`, 'err', 6000);
          }
        },
      });
    },
  });

  // プレイヤー（ページ内で再生）
  const playerEl = document.getElementById('rw-player');
  _recentYoutube(entry).then(yt => {
    if (!playerEl.isConnected) return;
    const vid = ytid(yt?.url);
    playerEl.innerHTML = vid
      ? `<iframe id="yt-iframe" src="https://www.youtube.com/embed/${esc(vid)}?autoplay=0&modestbranding=1&rel=0&iv_load_policy=3" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
      : `<div class="player-msg">YouTube で動画が見つかりませんでした</div>`;
  }).catch(() => {
    if (playerEl.isConnected) playerEl.innerHTML = `<div class="player-msg">動画の検索に失敗しました</div>`;
  });

  // IMDb 情報（tt は分かっているので検索を飛ばす）
  _imdbTtCache.set(entry.title, entry.tt);
  fetchImdbInfo(panelId, entry.title, null);

  // カテゴリ（選んだタグ＋追加ボタン。追加はドロップダウンから）
  const selected = new Set(RECENT_DEFAULT_TAGS);
  const tagsEl = document.getElementById('rw-save-tags');
  let categoryOptions = [];
  const renderTags = () => {
    tagsEl.innerHTML = [...selected].map(name => `
      <span class="tag" data-color="${esc(tagColor(name))}">${esc(name)}<button class="tag-remove" data-name="${esc(name)}" title="${esc(name)}を外す">${icon('x', 12)}</button></span>`).join('')
      + `<button class="prop-add" title="カテゴリを追加">${icon('plus', 14)}</button>`;
    tagsEl.querySelectorAll('.tag-remove').forEach(btn => btn.addEventListener('click', () => {
      selected.delete(btn.dataset.name);
      renderTags();
    }));
    const addBtn = tagsEl.querySelector('.prop-add');
    addBtn.addEventListener('click', () => showPicker(addBtn, {
      items: () => categoryOptions.filter(o => !selected.has(o.name)),
      label: o => o.name,
      itemHtml: o => `<span class="tag" data-color="${esc(o.color || 'default')}">${esc(o.name)}</span>`,
      onPick: o => { selected.add(o.name); renderTags(); },
      keepOpen: true,
    }));
  };
  renderTags();
  _loadWorkCategoryOptions().then(options => {
    categoryOptions = options;
    options.forEach(o => { TAG_COLORS.categories[o.name] = o.color; });
    if (tagsEl.isConnected) renderTags();
  }).catch(e => showToast(`✗ カテゴリを読み込めませんでした: ${e.message}`, 'err', 6000));

  const saveBtn = document.getElementById('rw-save-btn');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      await _saveRecentWork(entry, [...selected], creators, artists);
      showToast('Notion に保存しました');
      if (document.getElementById('rw-save')?.isConnected) openRecentWorkPanel(entry); // 通常の作品パネルに切り替える
    } catch (e) {
      console.error('[RecentWorks Save]', e);
      showToast(`✗ 保存に失敗しました: ${e.message}`, 'err', 6000);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Notion に保存';
    }
  });
}

/** Notion に作品を作り、グラフのデータにも同じ形で加える */
async function _saveRecentWork(entry, categories, creators, artists) {
  const yt = await _recentYoutube(entry).catch(() => null);
  const vid = ytid(yt?.url);
  const creatorPageIds = creators.map(p => p.notionPageId).filter(Boolean);
  const res = await _recentPost('/notion-create-work', {
    title: yt?.title || entry.title,
    url: yt?.url || '',
    coverUrl: vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : '',
    categories,
    creatorPageIds,
    artistPageIds: artists.map(a => a.notionPageId),
  });
  if (res.alreadyExists) showToast('Notion の既存の作品を使います');

  const wid = `w_${res.workPageId.replace(/-/g, '')}`;
  let workNode = AN.find(n => n.id === wid);
  if (!workNode) {
    const url = yt?.url || '';
    workNode = {
      id: wid, type: 'work', label: yt?.title || entry.title, url, th: thumbUrl(url), cats: categories,
      notionPageId: res.workPageId.replace(/-/g, ''), works: [], _creatorRelIds: creatorPageIds,
    };
    AN.push(workNode);
    creators.forEach(p => {
      let node = _creatorNode(p);
      if (!node) {
        const meta = getCreatorMeta(p.name);
        node = { id: `d_${p.name}`, type: 'director', label: p.name, role: p.role || meta.role, sns: meta.sns,
                 avatar: p.avatar, notionPageId: p.notionPageId, works: [] };
        AN.push(node);
      }
      node.works.push(wid);
      AL.push({ source: node.id, target: wid, ltype: 'dir' });
    });
    artists.forEach(artist => {
      const aid = `a_${artist.name}`;
      let node = AN.find(n => n.id === aid);
      if (!node) {
        const meta = getCreatorMeta(artist.name);
        node = { id: aid, type: 'artist', label: artist.name, role: meta.role, sns: meta.sns, avatar: '', works: [] };
        AN.push(node);
      }
      node.works.push(wid);
      AL.push({ source: aid, target: wid, ltype: 'art' });
    });
    _recentGraphDirty = true;
  }

  entry.workNode = workNode;
  entry.registered = true;
  const thumbWrap = entry.card?.querySelector('.rw-thumb-wrap');
  if (thumbWrap && !thumbWrap.querySelector('.rw-registered')) {
    thumbWrap.insertAdjacentHTML('beforeend', '<span class="thumb-badge rw-registered">登録済み</span>');
  }
}

function openRecentWorks() {
  document.getElementById('recent-overlay').classList.add('visible');
  // 同じグラフでスキャン中・スキャン済みなら、表示済みのギャラリーをそのまま見せる
  if (_recentScannedNodes !== AN) scanRecentWorks();
}

function closeRecentWorks() {
  document.getElementById('recent-overlay').classList.remove('visible');
  // ギャラリーから保存した作品をグラフに描き足す
  if (_recentGraphDirty) {
    _recentGraphDirty = false;
    refresh();
  }
}

document.getElementById('recent-btn').addEventListener('click', openRecentWorks);
document.getElementById('rw-close').addEventListener('click', closeRecentWorks);
document.getElementById('rw-refresh').addEventListener('click', () => scanRecentWorks({ force: true }));
document.getElementById('recent-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('recent-overlay')) closeRecentWorks();
});
