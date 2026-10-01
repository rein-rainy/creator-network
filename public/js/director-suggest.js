/* ═══════════════════════════════════════════
   DIRECTOR SUGGESTIONS (IMDb)
   クリエイター未登録の作品を IMDb で調べ、監督が見つかれば「候補」として知らせる。
   自動では紐づけない — 作品パネルで内容を確認してから手動で登録する。
═══════════════════════════════════════════ */
const DIR_SUGGEST_CACHE_KEY     = 'creator_network_dir_suggest_v1';
const DIR_SUGGEST_DISMISSED_KEY = 'creator_network_dir_suggest_dismissed';
const DIR_SUGGEST_TTL_HIT  = 14 * 24 * 60 * 60 * 1000;
const DIR_SUGGEST_TTL_MISS =  7 * 24 * 60 * 60 * 1000;

// 作品タイトル → { at, tt, title, year, directors: [{ id, name, image }] } | { at, none: true }
let _dirSuggestCache = {};
let _dirSuggestDismissed = new Set(); // 作品タイトル
let _dirSuggestScanGen = 0;

function _loadDirSuggestState() {
  try { _dirSuggestCache = JSON.parse(localStorage.getItem(DIR_SUGGEST_CACHE_KEY) || '{}'); } catch { _dirSuggestCache = {}; }
  try { _dirSuggestDismissed = new Set(JSON.parse(localStorage.getItem(DIR_SUGGEST_DISMISSED_KEY) || '[]')); } catch { _dirSuggestDismissed = new Set(); }
}
function _saveDirSuggestCache() {
  try { localStorage.setItem(DIR_SUGGEST_CACHE_KEY, JSON.stringify(_dirSuggestCache)); } catch {}
}
function _saveDirSuggestDismissed() {
  try { localStorage.setItem(DIR_SUGGEST_DISMISSED_KEY, JSON.stringify([..._dirSuggestDismissed])); } catch {}
}

function _workHasCreator(work) {
  return AL.some(l => l.ltype === 'dir' && (lid(l.target) === work.id || lid(l.source) === work.id));
}

/** この作品に表示すべき監督候補（なければ null） */
function dirSuggestFor(work) {
  if (!work || work.type !== 'work') return null;
  if (_dirSuggestDismissed.has(work.label) || _workHasCreator(work)) return null;
  const entry = _dirSuggestCache[work.label];
  return entry && !entry.none && entry.directors?.length ? entry : null;
}

async function _lookupDirectors(title) {
  const post = (url, body) => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json());
  const s = await post('/imdb-search', { title });
  if (s.error) throw new Error(s.error);
  if (!s.tt) return { at: Date.now(), none: true };
  const c = await post('/imdb-crew', { tt: s.tt });
  if (c.error) throw new Error(c.error);
  if (!c.directors?.length) return { at: Date.now(), none: true };
  return { at: Date.now(), tt: s.tt, title: c.title || '', year: c.year || '', directors: c.directors };
}

/** クリエイター未登録の作品をバックグラウンドで順に調べる（結果は localStorage にキャッシュ） */
async function scanDirectorSuggestions() {
  const gen = ++_dirSuggestScanGen;
  _loadDirSuggestState();
  refreshDirSuggestUI();

  const now = Date.now();
  const targets = AN.filter(n => n.type === 'work' && !_workHasCreator(n) && !_dirSuggestDismissed.has(n.label))
    .filter(n => {
      const e = _dirSuggestCache[n.label];
      return !e || now - e.at > (e.none ? DIR_SUGGEST_TTL_MISS : DIR_SUGGEST_TTL_HIT);
    });

  for (const work of targets) {
    if (gen !== _dirSuggestScanGen) return; // 再読み込みで新しいスキャンが始まった
    try {
      _dirSuggestCache[work.label] = await _lookupDirectors(work.label);
      _saveDirSuggestCache();
      if (dirSuggestFor(work)) refreshDirSuggestUI();
    } catch (e) {
      console.warn('[DirSuggest]', work.label, e.message); // 失敗はキャッシュせず次回再試行
    }
  }
}

/* ── UI ─────────────────────────────────────── */
function refreshDirSuggestUI() {
  const works = AN.filter(n => dirSuggestFor(n));

  // グラフ上の作品カードにバッジ
  document.querySelectorAll('.wcard[data-id]').forEach(card => {
    const work = AN.find(n => n.id === card.dataset.id);
    const has = !!dirSuggestFor(work);
    const badge = card.querySelector('.wc-suggest');
    if (has && !badge) {
      const b = document.createElement('div');
      b.className = 'wc-suggest';
      b.title = 'IMDbに監督候補あり';
      b.textContent = '監督候補';
      card.appendChild(b);
    } else if (!has && badge) {
      badge.remove();
    }
  });

  // トップバーのボタンとリスト
  const btn = document.getElementById('dir-suggest-btn');
  btn.style.display = works.length ? 'flex' : 'none';
  document.getElementById('dir-suggest-count').textContent = works.length;
  document.getElementById('ds-count').textContent = works.length ? `(${works.length})` : '';
  if (!works.length) document.getElementById('dir-suggest-panel').classList.remove('visible');

  const list = document.getElementById('ds-list');
  list.innerHTML = '';
  works.forEach(work => {
    const s = dirSuggestFor(work);
    const row = document.createElement('div');
    row.className = 'hp-item ds-item';
    row.innerHTML = `
      <div class="ds-item-text">
        <div class="hp-item-label">${esc(work.label)}</div>
        <div class="ds-item-sub">${esc(s.directors.map(d => d.name).join(' / '))}</div>
      </div>
      <button class="icon-btn-xs ds-dismiss" title="この候補を無視">${icon('x', 14)}</button>`;
    row.addEventListener('click', () => {
      document.getElementById('dir-suggest-panel').classList.remove('visible');
      selId = work.id;
      applyHL(selId, 'click');
      showPanel(work);
    });
    row.querySelector('.ds-dismiss').addEventListener('click', e => {
      e.stopPropagation();
      dismissDirSuggest(work);
    });
    list.appendChild(row);
  });
}

function dismissDirSuggest(work) {
  _dirSuggestDismissed.add(work.label);
  _saveDirSuggestDismissed();
  refreshDirSuggestUI();
  const slot = document.getElementById('dir-suggest-slot');
  if (slot) slot.innerHTML = '';
}

/** 作品パネル内の「IMDb 監督候補」セクション */
function renderDirSuggestSection(work) {
  const slot = document.getElementById('dir-suggest-slot');
  if (!slot) return;
  const s = dirSuggestFor(work);
  if (!s) { slot.innerHTML = ''; return; }

  const imdbLabel = `${s.title}${s.year ? ` (${s.year})` : ''}`;
  let html = `<div class="panel-section ds-section">
    <div class="section-label">
      <span>IMDb 監督候補</span>
      <button class="btn btn-ghost" id="ds-ignore">無視</button>
    </div>
    <div class="ds-note"><a class="text-link" href="https://www.imdb.com/title/${esc(s.tt)}/" target="_blank" rel="noopener noreferrer">${esc(imdbLabel)}</a></div>
    <div class="ds-people">`;
  s.directors.forEach((p, i) => {
    const existing = findExistingCreatorByName(p.name);
    const initial = [...p.name][0] || '?';
    const img = p.image ? `<img src="${esc(imdbProxyImg(p.image))}" alt="" onerror="this.remove()">` : '';
    html += `<div class="ds-person">
      <span class="avatar">${esc(initial)}${img}</span>
      <div class="person-card-text">
        <div class="person-card-name">${esc(p.name)}</div>
        <div class="person-card-role">${existing ? `既存: ${esc(existing.Name)}` : '新規'}</div>
      </div>
      <button class="btn btn-primary ds-add" data-idx="${i}">登録</button>
    </div>`;
  });
  html += `</div></div>`;
  slot.innerHTML = html;

  slot.querySelector('#ds-ignore').addEventListener('click', () => dismissDirSuggest(work));
  slot.querySelectorAll('.ds-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = s.directors[Number(btn.dataset.idx)];
      // 登録後は作品にクリエイターが付くので候補は自動的に消える
      addImdbPersonToWork(work, p.name, p.image || '');
      refreshDirSuggestUI();
    });
  });
}

document.getElementById('dir-suggest-btn').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('dir-suggest-panel').classList.toggle('visible');
});
