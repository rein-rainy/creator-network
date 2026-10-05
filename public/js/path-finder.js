/* ═══════════════════════════════════════════
   PATH FINDER
   作品A → 作品B の最短のつながりを、作品・監督・アーティストを
   交互にたどる一本の横長のチェーンで見せる。
   グラフ（AN / AL）は「作品 ↔ 人」の二部グラフなので、BFS で最短経路を出す。
═══════════════════════════════════════════ */
const PATH_MAX_ROUTES = 200;   // 最短経路が大量にあるときの列挙上限
const PATH_PICK_LIMIT = 30;    // 候補リストに出す件数

let _pathSel = { a: null, b: null };   // 選択中の作品ノード
let _pathRoutes = [];                  // [[nodeId, ...], ...] 最短経路の一覧
let _pathRouteIdx = 0;
let _pathTotal = 0;                    // 最短経路の総数（上限で打ち切る前）

/* ── グラフ ── */
function _pathAdjacency() {
  const adj = new Map();
  const add = (a, b, ltype) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ id: b, ltype });
  };
  AL.forEach(l => {
    const s = lid(l.source), t = lid(l.target);
    add(s, t, l.ltype); add(t, s, l.ltype);
  });
  return adj;
}

/** A から B への最短経路をすべて（上限まで）返す。経路は nodeId の配列 */
function findShortestPaths(fromId, toId) {
  if (fromId === toId) return { routes: [[fromId]], total: 1 };
  const adj = _pathAdjacency();
  const dist = new Map([[fromId, 0]]);
  const preds = new Map();           // nodeId → 一つ手前のノード（最短経路上のもの全部）
  const count = new Map([[fromId, 1]]);
  let frontier = [fromId];
  while (frontier.length && !dist.has(toId)) {
    const next = [];
    for (const u of frontier) {
      for (const { id: v } of adj.get(u) || []) {
        if (!dist.has(v)) {
          dist.set(v, dist.get(u) + 1);
          preds.set(v, [u]);
          count.set(v, count.get(u));
          next.push(v);
        } else if (dist.get(v) === dist.get(u) + 1) {
          preds.get(v).push(u);
          count.set(v, count.get(v) + count.get(u));
        }
      }
    }
    frontier = next;
  }
  if (!dist.has(toId)) return { routes: [], total: 0 };

  // B から手前へたどって経路を組み立てる
  const routes = [];
  const walk = (id, tail) => {
    if (routes.length >= PATH_MAX_ROUTES) return;
    if (id === fromId) { routes.push([fromId, ...tail]); return; }
    for (const p of preds.get(id)) walk(p, [id, ...tail]);
  };
  walk(toId, []);
  return { routes, total: count.get(toId) };
}

function _pathLinkType(a, b) {
  const l = AL.find(l => {
    const s = lid(l.source), t = lid(l.target);
    return (s === a && t === b) || (s === b && t === a);
  });
  return l?.ltype || 'dir';
}

/* ── 作品の選択 ── */
function _pathWorkSub(work) {
  const artists = AL.filter(l => l.ltype === 'art' && lid(l.target) === work.id)
    .map(l => AN.find(n => n.id === lid(l.source))?.label).filter(Boolean);
  return artists.join(', ');
}

function _pathSetupPicker(slot) {
  const wrap   = document.getElementById(`pf-pick-${slot}`);
  const input  = wrap.querySelector('.pf-input');
  const list   = wrap.querySelector('.pf-options');
  let items = [], active = 0;

  const close = () => { list.classList.remove('visible'); };
  const choose = work => {
    _pathSel[slot] = work;
    input.value = work.label;
    wrap.classList.add('filled');
    close();
    input.blur();
    renderPathResult();
  };
  const highlight = () => list.querySelectorAll('.pf-option').forEach((el, i) => el.classList.toggle('active', i === active));
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const works = AN.filter(n => n.type === 'work');
    items = (q
      ? works.filter(w => w.label.toLowerCase().includes(q) || _pathWorkSub(w).toLowerCase().includes(q))
      : works.slice().sort((a, b) => a.label.localeCompare(b.label, 'ja'))
    ).slice(0, PATH_PICK_LIMIT);
    active = 0;
    list.innerHTML = items.length ? items.map((w, i) => `
      <button type="button" class="pf-option${i === 0 ? ' active' : ''}" data-i="${i}">
        ${w.th ? `<img class="pf-option-thumb" src="${esc(w.th)}" alt="" loading="lazy">` : `<span class="pf-option-thumb">${icon('film', 14)}</span>`}
        <span class="pf-option-text">
          <span class="pf-option-title">${esc(w.label)}</span>
          <span class="pf-option-sub">${esc(_pathWorkSub(w))}</span>
        </span>
      </button>`).join('') : '<div class="pf-option-empty">一致する作品がありません</div>';
    list.querySelectorAll('.pf-option').forEach(el => {
      el.addEventListener('mousedown', e => e.preventDefault()); // blur より先に選ぶ
      el.addEventListener('click', () => choose(items[Number(el.dataset.i)]));
    });
    list.classList.add('visible');
  };

  input.addEventListener('focus', () => { input.select(); render(); });
  input.addEventListener('input', () => { wrap.classList.remove('filled'); render(); });
  input.addEventListener('blur', () => {
    close();
    // 選び直さずに離れたら、選択中の作品名に戻す
    input.value = _pathSel[slot]?.label || '';
    wrap.classList.toggle('filled', !!_pathSel[slot]);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); highlight(); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') { e.stopPropagation(); input.blur(); }
    else return;
    list.querySelector('.pf-option.active')?.scrollIntoView({ block: 'nearest' });
  });

  return { set: work => { _pathSel[slot] = work; input.value = work?.label || ''; wrap.classList.toggle('filled', !!work); } };
}

const _pathPickers = { a: _pathSetupPicker('a'), b: _pathSetupPicker('b') };

/* ── 結果の描画 ── */
function _pathWorkCard(n) {
  const tags = (n.cats || []).slice(0, 3).map(c => `<span class="tag wc-tag" data-color="${esc(tagColor(c))}">${esc(c)}</span>`).join('');
  return `
    <div class="wcard pf-card pf-work" data-id="${esc(n.id)}" title="${esc(n.label)}">
      ${n.th ? `<img class="wc-img" src="${esc(n.th)}" alt="">` : `<div class="wc-ph">${icon('film', 20)}</div>`}
      <div class="wc-bd">
        <div class="wc-tt">${esc(n.label)}</div>
        <div class="wc-tags">${tags}</div>
      </div>
    </div>`;
}

function _pathPersonCard(n) {
  const isDir = n.type === 'director';
  const col = isDir ? 'var(--node-dir)' : 'var(--node-art)';
  const initial = esc([...n.label][0] || '?');
  const avatar = n.avatar
    ? `<img src="${esc(n.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'pnode-initial',textContent:'${initial}'}))">`
    : `<span class="pnode-initial">${initial}</span>`;
  return `
    <div class="pnode-card pf-card pf-person" data-id="${esc(n.id)}" style="border-color:${col}" title="${esc(n.label)}">
      <div class="pnode-avatar" style="background:${col}">${avatar}</div>
      <div class="pnode-text">
        <div class="pnode-name">${esc(n.label)}</div>
        <div class="pnode-role">${esc(isDir ? (n.role || 'Creator') : 'Artist')}</div>
      </div>
    </div>`;
}

function _pathEdge(ltype) {
  const label = ltype === 'dir' ? '制作' : '出演';
  return `<div class="pf-edge ${ltype}"><span class="pf-edge-label">${label}</span><span class="pf-edge-line"></span></div>`;
}

function renderPathResult() {
  const body = document.getElementById('pf-body');
  const sub  = document.getElementById('pf-sub');
  const nav  = document.getElementById('pf-route-nav');
  const { a, b } = _pathSel;
  nav.hidden = true;

  if (!a || !b) {
    sub.textContent = '';
    body.innerHTML = `<div class="fm2-empty">${a || b ? 'もう一方の作品を選んでください' : '2つの作品を選ぶと、そのあいだをつなぐ<br>監督・アーティストの最短ルートを表示します'}</div>`;
    return;
  }
  if (a.id === b.id) {
    sub.textContent = '';
    body.innerHTML = '<div class="fm2-empty">同じ作品が選ばれています</div>';
    return;
  }

  const { routes, total } = findShortestPaths(a.id, b.id);
  _pathRoutes = routes; _pathTotal = total; _pathRouteIdx = 0;
  if (!routes.length) {
    sub.textContent = '';
    body.innerHTML = '<div class="fm2-empty">この2作品をつなぐルートは見つかりませんでした</div>';
    return;
  }
  _renderPathRoute();
}

function _renderPathRoute() {
  const route = _pathRoutes[_pathRouteIdx];
  const nodes = route.map(id => AN.find(n => n.id === id));
  const people = nodes.filter(n => n.type !== 'work').length;

  document.getElementById('pf-sub').textContent =
    `${people}人を経由してつながる` + (_pathTotal > 1 ? ` · 最短ルート ${_pathTotal.toLocaleString()}通り` : '');

  const nav = document.getElementById('pf-route-nav');
  nav.hidden = _pathRoutes.length < 1 || _pathTotal < 2;
  document.getElementById('pf-route-count').textContent =
    `${_pathRouteIdx + 1} / ${_pathRoutes.length}${_pathTotal > _pathRoutes.length ? '+' : ''}`;

  let html = '';
  nodes.forEach((n, i) => {
    if (i > 0) html += _pathEdge(_pathLinkType(route[i - 1], n.id));
    html += n.type === 'work' ? _pathWorkCard(n) : _pathPersonCard(n);
  });
  const body = document.getElementById('pf-body');
  body.innerHTML = `<div class="pf-track">${html}</div>`;

  body.querySelectorAll('.pf-card, .pf-edge').forEach((el, i) => el.style.animationDelay = `${i * 45}ms`);
  body.querySelectorAll('.pf-card').forEach(el => el.addEventListener('click', () => {
    const node = AN.find(n => n.id === el.dataset.id);
    if (!node) return;
    showPanel(node);
    _raiseInfoPanel();
  }));
  // 長いチェーンは先頭から見せる
  body.scrollLeft = 0;
}

function _pathStepRoute(delta) {
  if (!_pathRoutes.length) return;
  _pathRouteIdx = (_pathRouteIdx + delta + _pathRoutes.length) % _pathRoutes.length;
  _renderPathRoute();
}

/* ── モーダル ── */
function openPathFinder() {
  document.getElementById('path-overlay').classList.add('visible');
  // Notion 更新でノードが作り直されていたら、同じ作品名のものに差し替える
  ['a', 'b'].forEach(slot => {
    const cur = _pathSel[slot];
    if (cur && !AN.includes(cur)) _pathPickers[slot].set(AN.find(n => n.type === 'work' && n.label === cur.label) || null);
  });
  renderPathResult();
  if (!_pathSel.a) document.querySelector('#pf-pick-a .pf-input').focus();
}

function closePathFinder() {
  document.getElementById('path-overlay').classList.remove('visible');
}

function _pathRandomPair() {
  const works = AN.filter(n => n.type === 'work');
  if (works.length < 2) return;
  const pick = () => works[Math.floor(Math.random() * works.length)];
  // つながっていない組み合わせ（人が登録されていない作品など）はなるべく避ける
  let a, b;
  for (let i = 0; i < 40; i++) {
    a = pick(); b = pick();
    if (a !== b && findShortestPaths(a.id, b.id).routes.length) break;
  }
  _pathPickers.a.set(a); _pathPickers.b.set(b);
  renderPathResult();
}

document.getElementById('path-btn').addEventListener('click', openPathFinder);
document.getElementById('pf-close').addEventListener('click', closePathFinder);
document.getElementById('pf-swap').addEventListener('click', () => {
  const { a, b } = _pathSel;
  _pathPickers.a.set(b); _pathPickers.b.set(a);
  renderPathResult();
});
document.getElementById('pf-random').addEventListener('click', _pathRandomPair);
document.getElementById('pf-prev').addEventListener('click', () => _pathStepRoute(-1));
document.getElementById('pf-next').addEventListener('click', () => _pathStepRoute(1));
// 長いチェーンは縦ホイールでも横に送れるようにする
document.getElementById('pf-body').addEventListener('wheel', e => {
  const body = e.currentTarget;
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || body.scrollWidth <= body.clientWidth) return;
  e.preventDefault();
  body.scrollLeft += e.deltaY;
}, { passive: false });
document.getElementById('path-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('path-overlay')) closePathFinder();
});
document.addEventListener('keydown', e => {
  if (!document.getElementById('path-overlay').classList.contains('visible')) return;
  if (document.getElementById('info-panel').classList.contains('visible')) return;
  if (e.target.closest('input')) return;
  if (e.key === 'Escape') closePathFinder();
  else if (e.key === 'ArrowLeft')  _pathStepRoute(-1);
  else if (e.key === 'ArrowRight') _pathStepRoute(1);
});
