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
  const data = buildGraph(rows);
  AN = data.nodes; AL = data.links;

  // 更新時も初回と同じ初期配置から始めるため、座標・速度をリセット
  AN.forEach(n => { delete n.x; delete n.y; n.vx = 0; n.vy = 0; });

  // キャッシュから ytId が既知のアーティストを事前解決
  // （ytId は前回の fetch 後に node に保存されていないため、
  //   キャッシュのキーを全走査してアーティスト名で照合することはせず、
  //   fetchArtistAvatars() 内で ytId 取得後にキャッシュ保存する設計のまま進む）

  hideGraphOverlay(2000);
  loadHiddenState();
  makeFilter();
  refresh();
  updateHiddenUI();
  fetchArtistAvatars();
  // Director/Creator の Instagram アバターを取得（Notionカバー画像がない場合）
  requestAnimationFrame(() => fetchDirectorIgAvatars());
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
      <button class="hp-restore" data-id="${esc(id)}" title="復元">↩</button>`;
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
  btn.style.background    = isFilter ? 'var(--bg3)' : 'var(--accent)';
  btn.style.color         = isFilter ? 'var(--text-2)' : 'rgb(28,28,30)';
  btn.title = isFilter ? '検索モード：フィルター（クリックで移動モードへ）' : '検索モード：移動（クリックでフィルターモードへ）';
  document.getElementById('search-box').placeholder = isFilter ? '検索（フィルター）...' : '検索（移動）...';
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
    .call(d3.zoom().scaleExtent([0.04,4]).on('zoom', e => {
      svg.select('g').attr('transform', e.transform);
    }).transform, d3.zoomIdentity.translate(W/2 - k*cx, H/2 - k*cy).scale(k));
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
      navigateToMatches(sq);
    }
  }
});

document.getElementById('search-box').addEventListener('input', e => {
  const prev = sq;
  sq = e.target.value.trim();

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
  }

  if (!sq && _preSqSnapshot) {
    AN.forEach(n => {
      const s = _preSqSnapshot[n.id];
      if (s) { n.x = s.x; n.y = s.y; n.vx = 0; n.vy = 0; }
    });
    _preSqSnapshot = null;
    const { nodes, links } = filteredData();
    redraw(nodes, links);
  } else {
    refresh({ freeLayout: true });
  }
});

function stopYtIframe() {
  const fr = document.getElementById('yt-iframe');
  if (fr) { const s = fr.src; fr.src = ''; fr.src = s; }
}

function closeInfoPanel() {
  stopYtIframe();
  document.getElementById('info-panel').classList.remove('visible');
  document.getElementById('info-overlay').classList.remove('visible');
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

async function fetchFromNotionAPI() {
  showGraphOverlay();
  const btn = document.getElementById('notion-sync-btn');
  const label = btn.querySelector('span:last-child');
  btn.classList.add('loading'); label.textContent = '取得中…';
  try {
    const r = await fetch('/notion-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    if (!data.results?.length) throw new Error('データが0件です');
    ALL_CREATORS = data.creators || [];
    // creators / artists フィールドがあればメタ情報を先に読み込む
    const allPersons = [...ALL_CREATORS, ...(data.artists ?? [])];

    if (allPersons.length) loadCreatorMeta(allPersons);
    init(data.results);
    localStorage.setItem('notion_last_sync', new Date().toLocaleString('ja-JP'));
  } catch (e) {
    console.error('[Notion]', e);
    const msg = (e.message.includes('Failed to fetch') || e.message.includes('NetworkError'))
      ? 'CORSエラー: server.js をご利用ください' : `✗ ${e.message}`;
    showToast(msg, 'err', 6000);
    hideGraphOverlay(0);
  } finally {
    btn.classList.remove('loading'); label.textContent = '更新';
  }
}

document.getElementById('notion-sync-btn').addEventListener('click', fetchFromNotionAPI);
updateSearchModeBtn();
window.addEventListener('load', fetchFromNotionAPI);
