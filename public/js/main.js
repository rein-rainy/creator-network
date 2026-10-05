/* ═══════════════════════════════════════════
   REFRESH / INIT
═══════════════════════════════════════════ */
function refresh({ freeLayout = false } = {}) {
  const { nodes, links } = filteredData();
  selId = null; hovId = null;
  document.getElementById('info-panel').classList.remove('visible');
  draw(nodes, links, { freeLayout });
}

function showGraphOverlay() {
  const el = document.getElementById('graph-loading-overlay');
  el.classList.remove('fadeout');
  el.classList.add('visible');
}

function hideGraphOverlay(delayMs = 2000) {
  const el = document.getElementById('graph-loading-overlay');
  setTimeout(() => {
    el.classList.add('fadeout');
    el.addEventListener('transitionend', () => {
      el.classList.remove('visible', 'fadeout');
    }, { once: true });
  }, delayMs);
}

function init(rows) {
  // 作り直す前の画像を引き継ぐ（アーティストの画像などは描画後に取得するため、引き継がないと一瞬消える）
  const prevAvatar = new Map(AN.filter(n => n.avatar).map(n => [n.id, n.avatar]));
  const data = buildGraph(rows);
  AN = data.nodes; AL = data.links;
  AN.forEach(n => { if (!n.avatar && prevAvatar.has(n.id)) n.avatar = prevAvatar.get(n.id); });

  // 前回保存した配置から始める（保存がないノードだけ新しく配置される）
  AN.forEach(n => { delete n.x; delete n.y; n.vx = 0; n.vy = 0; });
  loadSavedLayout();

  // キャッシュから ytId が既知のアーティストを事前解決
  // （ytId は前回の fetch 後に node に保存されていないため、
  //   キャッシュのキーを全走査してアーティスト名で照合することはせず、
  //   fetchArtistAvatars() 内で ytId 取得後にキャッシュ保存する設計のまま進む）

  hideGraphOverlay(0);
  loadHiddenState();
  makeFilter();
  refresh();
  updateHiddenUI();
  fetchArtistAvatars();
  // Director/Creator の Instagram アバターを取得（Notionカバー画像がない場合）
  requestAnimationFrame(() => fetchDirectorIgAvatars());
  // クリエイター未登録の作品について IMDb の監督候補を調べる（自動登録はしない）
  scanDirectorSuggestions();
}

/* ═══════════════════════════════════════════
   HIDDEN STATE PERSISTENCE
═══════════════════════════════════════════ */
function saveHiddenState() {
  const labels = [...hiddenIds].map(id => AN.find(n => n.id === id)?.label).filter(Boolean);
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(labels));
}

function loadHiddenState() {
  try {
    const saved = localStorage.getItem(HIDDEN_KEY);
    if (!saved) return;
    const labels = new Set(JSON.parse(saved));
    hiddenIds.clear();
    AN.forEach(n => { if (labels.has(n.label)) hiddenIds.add(n.id); });
  } catch (e) { /* ignore */ }
}

/* ═══════════════════════════════════════════
   HIDDEN PANEL UI
═══════════════════════════════════════════ */
function updateHiddenUI() {
  document.getElementById('hp-count').textContent = `(${hiddenIds.size})`;
  const list = document.getElementById('hp-list');
  if (!list) return;
  list.innerHTML = '';
  [...hiddenIds].forEach(id => {
    const node = AN.find(n => n.id === id);
    if (!node) return;
    const typeLabel = node.type === 'director' ? 'CREATOR' : node.type === 'artist' ? 'ART' : 'WORK';
    const row = document.createElement('div');
    row.className = 'hp-item';
    row.innerHTML = `
      <span class="hp-item-type">${typeLabel}</span>
      <span class="hp-item-label" title="${esc(node.label)}">${esc(node.label)}</span>
      <button class="icon-btn-xs hp-restore" data-id="${esc(id)}" title="復元">${icon('undo-2', 14)}</button>`;
    row.querySelector('.hp-restore').addEventListener('click', () => {
      hiddenIds.delete(id); updateHiddenUI(); refresh();
      if (hiddenIds.size === 0) document.getElementById('hidden-panel').classList.remove('visible');
    });
    list.appendChild(row);
  });
  saveHiddenState();
}

/* ═══════════════════════════════════════════
   CONTEXT MENU
═══════════════════════════════════════════ */
let ctxTarget = null;
const ctxMenu = document.getElementById('ctx-menu');

function showCtx(e, d) {
  e.preventDefault(); e.stopPropagation();
  ctxTarget = d;
  document.getElementById('ctx-open').style.display = (d.type === 'work' && d.url) ? 'flex' : 'none';
  ctxMenu.style.display = 'block';
  ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  ctxMenu.style.top  = Math.min(e.clientY, window.innerHeight - 150) + 'px';
}
function hideCtx() { ctxMenu.style.display = 'none'; ctxTarget = null; }

document.addEventListener('click', hideCtx);
document.addEventListener('contextmenu', hideCtx);
ctxMenu.addEventListener('click', e => e.stopPropagation());

document.getElementById('ctx-hide').addEventListener('click', () => {
  if (!ctxTarget) return;
  hiddenIds.add(ctxTarget.id); updateHiddenUI(); refresh(); hideCtx();
});
document.getElementById('ctx-hide-connected').addEventListener('click', () => {
  if (!ctxTarget) return;
  hiddenIds.add(ctxTarget.id);
  AL.forEach(l => { const s = lid(l.source), t = lid(l.target); if (s === ctxTarget.id) hiddenIds.add(t); if (t === ctxTarget.id) hiddenIds.add(s); });
  updateHiddenUI(); refresh(); hideCtx();
});
document.getElementById('ctx-open').addEventListener('click', () => {
  if (ctxTarget?.url) window.open(ctxTarget.url, '_blank'); hideCtx();
});

/* ═══════════════════════════════════════════
   FILTER MODAL
═══════════════════════════════════════════ */
let fmCurrentTab = 'work';

function openFilterModal()  { document.getElementById('filter-modal').classList.add('visible'); document.getElementById('fm-search').value = ''; renderFmList(); }
function closeFilterModal() { document.getElementById('filter-modal').classList.remove('visible'); refresh(); }

function renderFmList() {
  const tab = fmCurrentTab;
  const q = document.getElementById('fm-search').value.trim().toLowerCase();
  const list = document.getElementById('fm-list');
  list.innerHTML = '';

  let nodes = AN.filter(n => n.type === tab);
  if (tab !== 'work') nodes = nodes.filter(n => hiddenIds.has(n.id));
  if (q) nodes = nodes.filter(n => n.label.toLowerCase().includes(q));
  nodes.sort((a, b) => a.label.localeCompare(b.label, 'ja'));

  if (nodes.length === 0 && tab !== 'work') {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:24px 12px;text-align:center;color:var(--text-dim);font-size:13px';
    empty.textContent = '非表示のノードはありません';
    list.appendChild(empty);
    document.getElementById('fm-count').textContent = `${AN.filter(n => n.type===tab).length}件すべて表示中`;
    return;
  }

  nodes.forEach(node => {
    const isVisible = !hiddenIds.has(node.id);
    const subText = tab === 'work' ? (node.cats || []).join(', ') : `${(node.works||[]).length} 作品`;
    const item = document.createElement('div');
    item.className = 'fm-item';
    item.innerHTML = `
      <div class="fm-item-label" title="${esc(node.label)}">${esc(node.label)}</div>
      ${subText ? `<div class="fm-item-sub">${esc(subText)}</div>` : ''}
      <button class="fm-toggle ${isVisible ? 'on' : ''}" data-id="${esc(node.id)}" title="${isVisible ? '非表示にする' : '表示する'}"></button>`;
    item.querySelector('.fm-toggle').addEventListener('click', function(e) {
      e.stopPropagation();
      const id = this.dataset.id;
      if (hiddenIds.has(id)) { hiddenIds.delete(id); this.classList.add('on'); }
      else { hiddenIds.add(id); this.classList.remove('on'); }
      updateHiddenUI();
      if (tab !== 'work') renderFmList();
    });
    list.appendChild(item);
  });

  const total = AN.filter(n => n.type === tab).length;
  const hidden = AN.filter(n => n.type === tab && hiddenIds.has(n.id)).length;
  document.getElementById('fm-count').textContent = hidden > 0 ? `${hidden}件非表示` : `${total}件すべて表示中`;
}

document.getElementById('filter-modal-btn').addEventListener('click', openFilterModal);
document.getElementById('fm-close').addEventListener('click', closeFilterModal);
document.getElementById('fm-done').addEventListener('click', closeFilterModal);
document.getElementById('filter-modal').addEventListener('click', e => { if (e.target === document.getElementById('filter-modal')) closeFilterModal(); });
['work', 'director', 'artist'].forEach(tab => {
  document.getElementById(`fm-tab-${tab}`).addEventListener('click', () => {
    fmCurrentTab = tab;
    document.querySelectorAll('.fm-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`fm-tab-${tab}`).classList.add('active');
    renderFmList();
  });
});
document.getElementById('fm-search').addEventListener('input', renderFmList);

/* ═══════════════════════════════════════════
   TOPBAR EVENTS
═══════════════════════════════════════════ */
/* ── search-mode toggle ── */
function updateSearchModeBtn() {
  const isFilter = searchMode === 'filter';
  const btn = document.getElementById('search-mode-btn');
  document.getElementById('smb-icon-filter').style.display = isFilter ? '' : 'none';
  document.getElementById('smb-icon-nav').style.display    = isFilter ? 'none' : '';
  btn.classList.toggle('active', !isFilter);
  btn.title = isFilter ? '検索モード: フィルター' : '検索モード: 移動';
}

/** navigateモード: 一致ノードをハイライトし、その重心にズームで移動する */
function navigateToMatches(q) {
  if (!q) {
    // クリア: ハイライト解除
    applyHL(null, null);
    return;
  }
  const ql = q.toLowerCase();
  const matched = AN.filter(n => !hiddenIds.has(n.id) && n.label.toLowerCase().includes(ql));
  if (!matched.length) { applyHL(null, null); return; }

  // 複数一致の場合は重心を計算、単一なら applyHL でハイライト
  if (matched.length === 1) {
    applyHL(matched[0].id, 'hover');
  } else {
    // 全体ハイライト: 一致ノードを浮かび上がらせる
    const matchedIds = new Set(matched.map(n => n.id));
    // リンクで繋がる隣接ノードも含める
    const expanded = new Set(matchedIds);
    AL.forEach(l => {
      const s = lid(l.source), t = lid(l.target);
      if (matchedIds.has(s)) expanded.add(t);
      if (matchedIds.has(t)) expanded.add(s);
    });
    if (gDimRect) gDimRect.attr('fill-opacity', 0.75);
    document.querySelectorAll('.wcard').forEach(el => {
      el.classList.remove('hl-dir','hl-art','hl-both','dim');
      if (!expanded.has(el.dataset.id)) el.classList.add('dim');
    });
    d3.selectAll('g.nd').each(function(d) {
      if (d.type === 'work') return;
      d3.select(this).style('opacity', expanded.has(d.id) ? 1 : 0.08);
    });
    d3.selectAll('line.lp').each(function(d) {
      const s = lid(d.source), t = lid(d.target);
      const active = expanded.has(s) && expanded.has(t);
      d3.select(this).attr('stroke-opacity', active ? 1 : 0.04)
        .attr('stroke-width', active ? (d.ltype==='dir' ? 2.8 : 2.0) : (d.ltype==='dir' ? 1.8 : 1.0));
    });
  }

  // 重心に向かってズーム移動
  const xs = matched.map(n => n.x).filter(v => v != null);
  const ys = matched.map(n => n.y).filter(v => v != null);
  if (!xs.length) return;
  const cx = xs.reduce((a,b) => a+b, 0) / xs.length;
  const cy = ys.reduce((a,b) => a+b, 0) / ys.length;
  const W = window.innerWidth, H = window.innerHeight - 48;
  const svg = d3.select('#canvas');
  const currentZoom = d3.zoomTransform(svg.node());
  const k = Math.max(currentZoom.k, 0.8); // 現在のズームが大きければ維持、小さければ0.8に
  svg.transition().duration(500)
    .call(_zoomBehavior.transform, d3.zoomIdentity.translate(W/2 - k*cx, H/2 - k*cy).scale(k));
}

// 検索前の表示位置に戻す（検索中は freeLayout の draw() で初期位置にリセットされている）
function restorePreSqTransform() {
  if (!_preSqTransform) return;
  d3.select('#canvas').call(_zoomBehavior.transform, _preSqTransform);
  _preSqTransform = null;
}

document.getElementById('search-mode-btn').addEventListener('click', () => {
  searchMode = searchMode === 'filter' ? 'navigate' : 'filter';
  updateSearchModeBtn();

  // モード切替時に現在の検索クエリで再適用
  if (sq) {
    if (searchMode === 'filter') {
      refresh({ freeLayout: true });
    } else {
      // filterモードから抜けるので全ノードを戻す
      if (_preSqSnapshot) {
        AN.forEach(n => { const s = _preSqSnapshot[n.id]; if (s) { n.x = s.x; n.y = s.y; n.vx = 0; n.vy = 0; } });
        _preSqSnapshot = null;
      }
      const { nodes, links } = filteredData();
      redraw(nodes, links);
      settleSimForces();  // 検索中に強まった力学パラメータを元の安定状態へ戻す
      restorePreSqTransform();
      navigateToMatches(sq);
    }
  }
});

document.getElementById('search-box').addEventListener('input', e => {
  const prev = sq;
  sq = e.target.value.trim();
  document.getElementById('search-wrap').classList.toggle('filled', !!e.target.value);

  if (searchMode === 'navigate') {
    // navigateモード: フィルターせずハイライト＋移動
    if (!sq) applyHL(null, null);
    else navigateToMatches(sq);
    return;
  }

  // filterモード（従来の動作）
  if (!prev && sq) {
    _preSqSnapshot = {};
    AN.forEach(n => { if (n.x != null) _preSqSnapshot[n.id] = { x: n.x, y: n.y }; });
    _preSqTransform = d3.zoomTransform(document.getElementById('canvas'));
  }

  if (!sq && _preSqSnapshot) {
    AN.forEach(n => {
      const s = _preSqSnapshot[n.id];
      if (s) { n.x = s.x; n.y = s.y; n.vx = 0; n.vy = 0; }
    });
    _preSqSnapshot = null;
    const { nodes, links } = filteredData();
    redraw(nodes, links);
    settleSimForces();  // 検索中に強まった力学パラメータを元の安定状態へ戻す
    restorePreSqTransform();
  } else {
    refresh({ freeLayout: true });
  }
});

const _searchClear = document.getElementById('search-clear');
_searchClear.addEventListener('mousedown', e => e.preventDefault()); // フォーカス状態を変えない
_searchClear.addEventListener('click', () => {
  const box = document.getElementById('search-box');
  box.value = '';
  box.dispatchEvent(new Event('input'));
});

function stopYtIframe() {
  const fr = document.getElementById('yt-iframe');
  if (fr) { const s = fr.src; fr.src = ''; fr.src = s; }
}

function closeInfoPanel() {
  stopYtIframe();
  document.getElementById('info-panel').classList.remove('visible', 'above-gallery');
  document.getElementById('info-overlay').classList.remove('visible', 'above-gallery');
  selId = null; hovId = null; applyHL(null, null);
}

document.getElementById('pc').addEventListener('click', closeInfoPanel);
document.getElementById('info-overlay').addEventListener('click', closeInfoPanel);

document.getElementById('depth-tog').addEventListener('click', () => {
  depth2 = !depth2;
  document.getElementById('depth-tog').classList.toggle('on', depth2);
  if (selId) applyHL(selId, 'click'); else if (hovId) applyHL(hovId, 'hover');
});

document.getElementById('theme-btn').addEventListener('click', () => {
  const dark = document.body.dataset.theme === 'dark';
  document.body.dataset.theme = dark ? 'light' : 'dark';
  document.getElementById('theme-btn').textContent = dark ? '◑' : '◐';
});

document.addEventListener('click', e => {
  const panel = document.getElementById('dir-suggest-panel');
  if (panel.classList.contains('visible') && !panel.contains(e.target)) panel.classList.remove('visible');
});

document.getElementById('hidden-btn').addEventListener('click', () => {
  document.getElementById('hidden-panel').classList.toggle('visible');
});

document.getElementById('hp-restore-all').addEventListener('click', () => {
  hiddenIds.clear(); updateHiddenUI(); refresh();
  document.getElementById('hidden-panel').classList.remove('visible');
});

document.getElementById('fi0').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader(); r.onload = ev => init(parseCSV(ev.target.result)); r.readAsText(f, 'UTF-8');
});

window.addEventListener('resize', () => { if (AN.length) { const { nodes, links } = filteredData(); draw(nodes, links); } });

/* ═══════════════════════════════════════════
   NOTION SYNC
═══════════════════════════════════════════ */
// トークンはサーバー側 (server.js) で管理。ブラウザには持たない。

function showToast(msg, type = 'ok', duration = 3200) {
  const el = document.getElementById('notion-toast');
  el.textContent = msg; el.className = 'show ' + type; el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; el.className = ''; }, duration);
}

/* ── Notion との同期 ──
   開き直したときは前回取得したデータですぐに描き、裏で Notion から取得し直して変わった分だけ反映する。
   開いている間も定期的に変更を確認し、Notion で作品などが追加・編集されたら同じように反映する。
   配置は保存してあるので、作り直しても既存ノードの位置はそのままで、増えたノードだけが差分配置される。 */
const NOTION_CACHE_KEY = 'creator_network_notion_data';
const NOTION_POLL_MS = 30 * 1000;            // 変更確認の間隔（Notion への問い合わせは1回につき3件）
const NOTION_FULL_SYNC_MS = 10 * 60 * 1000;  // 変更確認では拾えない削除などのため、この間隔で丸ごと取り直す
let _pendingNotionData = null;  // 操作中のため反映を待っている取得結果 { data, graphSize }
let _notionSignature = null;    // 最後に取得したときの変更確認の目印
let _notionSyncing = false;
let _refreshRequested = false;  // 裏での取得中に更新ボタンが押された
let _lastFullSync = 0;
let _appliedDataSig = null;     // 今の画面を作ったデータ（比較用。反映を見送った取得結果と区別するため保存データとは別に持つ）

// 画面上の編集（作品や監督の追加・削除）を検知するための目印
const _graphSize = () => `${AN.length}:${AL.length}`;

function applyNotionData(data, { relayout = false } = {}) {
  ALL_CREATORS = data.creators || [];
  ALL_ARTISTS = data.artists || [];
  if (data.tagColors) TAG_COLORS = data.tagColors;
  // creators / artists フィールドがあればメタ情報を先に読み込む
  const allPersons = [...ALL_CREATORS, ...ALL_ARTISTS];
  if (allPersons.length) loadCreatorMeta(allPersons);
  if (relayout) resetLayout();
  else if (AN.length) saveLayout(); // 作り直す直前の配置（ドラッグ直後など）を確実に引き継ぐ
  init(data.results);
  _appliedDataSig = _notionDataSig(JSON.stringify(data));
}

// Notion のファイル画像は取得のたびに署名の違う URL になるため、比較では署名部分を無視する
const _notionDataSig = json => json.replace(/(https:\/\/prod-files-secure\.s3[^"?]*)\?[^"]*/g, '$1');

// 検索・ドラッグ・パネルやモーダルの表示中に作り直すと、表示が飛んだり入力中の内容が消えたりするので待つ
function _isUserBusy() {
  if (sq || draggedNode) return true;
  if (['info-panel', 'filter-modal', 'hidden-panel', 'recent-overlay', 'path-overlay', 'dir-suggest-panel']
      .some(id => document.getElementById(id)?.classList.contains('visible'))) return true;
  if (document.querySelector('#tag-filter-dropdown.open, #ctx-menu[style*="block"]')) return true;
  return false;
}

function _applyWhenIdle(data, graphSize) {
  const first = !_pendingNotionData;
  _pendingNotionData = { data, graphSize };
  if (!first) return;
  const tryApply = () => {
    if (!_pendingNotionData) return;
    // 取得を始めてから画面上で作品や監督を追加・削除した場合、取得結果のほうが古い可能性があるので反映しない
    // （Notion への書き込みが済めば次の変更確認で取り直される）
    if (_pendingNotionData.graphSize !== _graphSize()) { _pendingNotionData = null; return; }
    if (_isUserBusy()) { setTimeout(tryApply, 1500); return; }
    const { data: d } = _pendingNotionData; _pendingNotionData = null;
    applyNotionData(d);
  };
  tryApply();
}

/* background: 裏での取得（開き直したとき・変更確認）。変わった分だけ、操作の邪魔にならないときに反映する
   relayout:   更新ボタン。最新を取得してから、全体を一から配置し直す */
async function fetchFromNotionAPI({ background = false, relayout = false } = {}) {
  if (_notionSyncing) {
    // 裏での取得が終わってから改めて取得する（その取得結果は古いかもしれないので使わない）
    if (relayout) { _refreshRequested = true; _setSyncBtnLoading(true); }
    return;
  }
  _notionSyncing = true;
  if (!background) showGraphOverlay();
  if (relayout) _setSyncBtnLoading(true);
  const graphSize = _graphSize();
  try {
    const r = await fetch('/notion-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { signature, ...data } = await r.json();
    if (data.error) throw new Error(data.error);
    if (!data.results?.length) throw new Error('データが0件です');
    _notionSignature = signature;
    _lastFullSync = Date.now();

    const json = JSON.stringify(data);
    try { localStorage.setItem(NOTION_CACHE_KEY, json); } catch {}
    localStorage.setItem('notion_last_sync', new Date().toLocaleString('ja-JP'));

    if (!background) applyNotionData(data, { relayout });
    // 裏での取得：内容が同じなら作り直さない。ただし画像の URL は失効するので新しいものに差し替える
    else if (_notionDataSig(json) === _appliedDataSig) _refreshNotionAvatars(data);
    else _applyWhenIdle(data, graphSize);
  } catch (e) {
    console.error('[Notion]', e);
    // 裏での取得の失敗は次の確認で取り直すので、知らせるのは画面にまだ何もないときだけ
    if (!background) {
      const msg = (e.message.includes('Failed to fetch') || e.message.includes('NetworkError'))
        ? 'CORSエラー: server.js をご利用ください' : `✗ ${e.message}`;
      showToast(msg, 'err', 6000);
      hideGraphOverlay(0);
    }
  } finally {
    _notionSyncing = false;
    if (_refreshRequested) { _refreshRequested = false; fetchFromNotionAPI({ relayout: true }); }
    else if (relayout) _setSyncBtnLoading(false);
  }
}

function _setSyncBtnLoading(on) {
  const btn = document.getElementById('notion-sync-btn');
  btn.classList.toggle('loading', on);
  btn.querySelector('span:last-child').textContent = on ? '取得中…' : '更新';
}

// 変更確認：Notion で最後に編集されたページが前回の取得時から変わっていれば取り直す
async function checkNotionChanges() {
  if (document.hidden || _notionSyncing) return;
  // まだ一度も描けていない（最初の取得に失敗した）ときは取得からやり直す
  if (!AN.length) { fetchFromNotionAPI(); return; }
  if (Date.now() - _lastFullSync >= NOTION_FULL_SYNC_MS) { fetchFromNotionAPI({ background: true }); return; }
  try {
    const r = await fetch('/notion-changes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { signature } = await r.json();
    if (signature && signature !== _notionSignature) fetchFromNotionAPI({ background: true });
  } catch (e) {
    console.warn('[Notion] 変更確認に失敗', e.message);
  }
}
setInterval(checkNotionChanges, NOTION_POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkNotionChanges(); });

// 内容が変わっていないときに、期限付きの画像 URL だけを新しいものに差し替える
function _refreshNotionAvatars(data) {
  ALL_CREATORS = data.creators || [];
  ALL_ARTISTS = data.artists || [];
  loadCreatorMeta([...ALL_CREATORS, ...ALL_ARTISTS]);
  AN.forEach(n => {
    // Notion にアップロードした画像（avatarType: file）だけが期限付き。Instagram から取った画像などは触らない
    if (n.type !== 'director' || n.avatarType !== 'file') return;
    const avatar = getCreatorMeta(n.label).avatar;
    if (!avatar || avatar === n.avatar) return;
    n.avatar = avatar;
    // 失効した URL で読み込みに失敗し、イニシャル表示に替わっていることもあるので画像ごと入れ直す
    const avatarDiv = document.querySelector(`.pnode-card[data-id="${CSS.escape(n.id)}"] .pnode-avatar`);
    if (!avatarDiv) return;
    const initial = [...n.label][0] || '?';
    const img = document.createElement('img');
    img.src = avatar; img.alt = '';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover';
    img.onerror = () => { avatarDiv.innerHTML = `<span class="pnode-initial">${esc(initial)}</span>`; };
    avatarDiv.replaceChildren(img);
  });
}

// 開き直したとき：前回のデータがあればすぐに描き、裏で取得し直す。なければ今まで通り取得してから描く
function loadInitialData() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(NOTION_CACHE_KEY) || 'null'); } catch {}
  if (!cached?.results?.length) { fetchFromNotionAPI(); return; }
  try {
    applyNotionData(cached);
  } catch (e) {
    console.error('[Notion cache]', e);
    fetchFromNotionAPI();
    return;
  }
  fetchFromNotionAPI({ background: true });
}

// 更新ボタン：Notion から最新を取得し、全体を一から配置し直す
document.getElementById('notion-sync-btn').addEventListener('click', () => fetchFromNotionAPI({ relayout: true }));
updateSearchModeBtn();
window.addEventListener('load', loadInitialData);
