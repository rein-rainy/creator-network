/* ═══════════════════════════════════════════
   DRAW
═══════════════════════════════════════════ */

/* シミュレーションを初期レイアウト完了後の「安定状態」パラメータに戻す。
   通常 draw() 後の安定化切り替えと、検索終了時（検索ボックスが空）に共通で使う。
   検索中（freeLayout）は起動時の強い力（charge -2500 / center あり / link 0.5）が
   残るため、これを呼ばないと解除後もノードが元と違う動きをしてしまう。 */
function settleSimForces() {
  if (!sim) return;
  // 既存ノードの位置固定を解除（新規ノードはここで初めて自由になる）
  sim.nodes().forEach(n => { n.fx = null; n.fy = null; });
  sim.force('charge').strength(-400).distanceMax(150);
  baseLinkStrength = 0.01;
  sim.force('link').strength(sim.force('link').strength());
  sim.velocityDecay(0.7);
  sim.force('center', null);
}

function draw(nodes, links, { freeLayout = false } = {}) {
  const W = window.innerWidth, H = window.innerHeight - 48;
  d3.select('#canvas').selectAll('*').remove();
  gDimRect = null;

  const svg = d3.select('#canvas').attr('width', W).attr('height', H);
  const g = svg.append('g');

  _zoomBehavior = d3.zoom().scaleExtent([0.04, 4]).on('zoom', e => {
    g.attr('transform', e.transform);
    // ズーム/パン後に画面内に入った未取得ノードをオブザーバーに再登録
    if (_avatarObserver) {
      const uncached = AN.filter(n => n.type === 'artist' && !n.avatar && !_avatarFetching.has(n.id));
      for (const node of uncached) {
        const cardEl = document.querySelector(`.pnode-card[data-id="${node.id}"]`);
        if (cardEl && !_avatarFetchQueue.find(n => n.id === node.id)) {
          _avatarObserver.observe(cardEl);
        }
      }
    }
    // ズーム後に新たに画面内に入ったノードを並列取得
    {
      const uncached = AN.filter(n => n.type === 'director' && !n.avatar && !_igFetching.has(n.id) && extractInstagramUrl(n.sns));
      const nowVisible = uncached.filter(node => {
        const cardEl = document.querySelector(`.pnode-card[data-id="${node.id}"]`);
        if (!cardEl) return false;
        const rect = cardEl.getBoundingClientRect();
        return rect.top < window.innerHeight + 60 && rect.bottom > -60
            && rect.left < window.innerWidth  + 60 && rect.right  > -60;
      });
      if (nowVisible.length) {
        Promise.all(nowVisible.map(node => _fetchOneIgAvatar(node)));
      }
    }
  });
  svg.call(_zoomBehavior);
  svg.on('click', e => {
    if (e.target.tagName === 'svg' || e.target.tagName === 'SVG') {
      selId = null; hovId = null; applyHL(null, null);
      document.getElementById('info-panel').classList.remove('visible');
      document.getElementById('info-overlay').classList.remove('visible');
    }
  });

  gDimRect = g.append('rect').attr('x',-99999).attr('y',-99999).attr('width',199999).attr('height',199999)
    .style('fill', 'var(--bg-solid)').attr('fill-opacity', 0).attr('pointer-events', 'none')
    .style('transition', 'fill-opacity .18s');

  // 表示位置は #canvas 側に記憶されているが、作り直した <g> には反映されないため合わせる。
  // ずれたままだとドラッグ開始の瞬間に記憶側の位置へ飛ぶ。
  // freeLayout（検索中）はシミュが画面中央に集めるので、表示位置も初期状態に戻す。
  if (freeLayout) svg.call(_zoomBehavior.transform, d3.zoomIdentity);
  else g.attr('transform', d3.zoomTransform(svg.node()));

  const gL = g.append('g').attr('class', 'layer-links');
  const gN = g.append('g').attr('class', 'layer-nodes');

  _lpSel = gL.selectAll('line.lp').data(links).join('line')
    .attr('class', 'lp')
    .attr('stroke', d => d.ltype === 'dir' ? 'var(--link-dir)' : 'var(--link-art)')
    .attr('stroke-width', d => d.ltype === 'dir' ? 1.8 : 1)
    .attr('stroke-opacity', 0.45);

  _nSel = gN.selectAll('g.nd').data(nodes, d => d.id).join('g').attr('class', 'nd')
    .call(d3.drag()
      .on('start', (e, d) => {
        if (!e.active) sim.alphaTarget(.3).restart();
        d.fx = d.x;
        d.fy = d.y;
        draggedNode = d;
        connectedToDragged.clear();

        if (!e.sourceEvent.shiftKey) {
          // 通常ドラッグ：接続ノードにソフトヒモ拘束
          AL.forEach(l => {
            const s = lid(l.source), t = lid(l.target);
            if (s === d.id) {
              connectedToDragged.add(t);
              l._ropeLength = Math.sqrt((l.source.x - l.target.x)**2 + (l.source.y - l.target.y)**2);
            } else if (t === d.id) {
              connectedToDragged.add(s);
              l._ropeLength = Math.sqrt((l.source.x - l.target.x)**2 + (l.source.y - l.target.y)**2);
            }
          });
        }
        // Shift+ドラッグ：ヒモなし・connectedToDragged も空のまま → 完全単体移動
      })
      .on('drag',  (e, d) => {
        d.fx = e.x;
        d.fy = e.y;
      })
      .on('end',   (e, d) => {
        if (!e.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
        draggedNode = null;
        AL.forEach(l => { delete l._ropeLength; });
        connectedToDragged.clear();
      })
    )
    .on('mouseenter', (e, d) => { if (selId) return; hovId = d.id; applyHL(hovId, 'hover'); })
    .on('mouseleave', (e, d) => { if (selId) return; hovId = null; applyHL(null, null); })
    .on('click', (e, d) => {
      e.stopPropagation(); hovId = null;
      if (selId === d.id) { selId = null; applyHL(null, null); document.getElementById('info-panel').classList.remove('visible'); document.getElementById('info-overlay').classList.remove('visible'); }
      else { selId = d.id; applyHL(selId, 'click'); showPanel(d); }
    })
    .on('contextmenu', (e, d) => showCtx(e, d));

  _nSel.each(function(d) { _renderNodeContent(d3.select(this), d); });

  _fitNodeCards(_nSel);

  const hasPlaced = nodes.some(n => n.x != null);
  // 配置済みのノード同士に新しいつながりができていれば、片方を引き寄せる対象にする
  const pulled = !freeLayout && hasPlaced ? _pullForNewLinks(links) : new Set();
  // 配置済みのノードがあれば、位置のないもの（新しく増えたもの）だけを差分で配置する。
  // freeLayout（検索時など）は固定せず、シミュに自由に動かせる。
  const hasNew = !freeLayout && hasPlaced && _prepareNewNodes(nodes, links, pulled);

  // freeLayout（検索時）は前回の緩和後パラメータが残っているため初期値に戻す。
  // 通常の draw（初回・更新どちらも）も同様にリセットして、更新時に広がらないようにする。
  baseLinkStrength = 0.5;

  if (sim) sim.stop();
  sim = d3.forceSimulation(nodes)
      .force('link',    d3.forceLink(links).id(d => d.id)
        .distance(l => l.ltype === 'dir' ? 280 : 300)
        .strength(() => baseLinkStrength))
      .force('charge',  d3.forceManyBody().strength(-2500))
      // 既存ノードが固定されている差分配置では、中心へ寄せる力は新規ノードだけを動かしてしまうので掛けない
      .force('center',  freeLayout || !hasPlaced ? d3.forceCenter(W/2, H/2) : null)
      .force('collide', d3.forceCollide(d => d.type === 'work' ? Math.sqrt((CW/2)**2 + (CH/2)**2) + 18 : Math.sqrt((PNW/2)**2 + (PNH/2)**2) + 12))
      .alphaDecay(.015)
      .stop()
      .on('tick', () => {
        if (draggedNode) {
          // ── ソフトヒモ拘束 ────────────────────────────────────────────────
          // 自然長を超えた分だけ引力を速度に加算する（バネの伸び方向のみ）。
          // 慣性を残すことで「伸びてから遅れて追従」する動きになる。
          // ROPE_K  : 超過量に対する引力係数（大きいほど素早く追従）
          // ROPE_DAMPING : 速度の減衰（小さいほど慣性が強く、遅れが大きい）
          const ROPE_K       = 0.12;
          const ROPE_DAMPING = 0.72;

          AL.forEach(l => {
            if (l._ropeLength == null) return;

            const srcInDrag = lid(l.source) === draggedNode.id;

            const anchor = srcInDrag ? l.source : l.target;
            const free   = srcInDrag ? l.target : l.source;

            const dx   = free.x - anchor.x;
            const dy   = free.y - anchor.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;

            if (dist > l._ropeLength) {
              // 超過分だけ引力を速度に加算し、現在速度は減衰させる
              const excess = dist - l._ropeLength;
              const pull   = ROPE_K * excess / dist;
              free.vx = free.vx * ROPE_DAMPING - dx * pull;
              free.vy = free.vy * ROPE_DAMPING - dy * pull;
            } else {
              // 弛んでいる間は慣性を穏やかに減衰させて余韻を残す
              free.vx *= ROPE_DAMPING;
              free.vy *= ROPE_DAMPING;
            }
          });

          // ── 無関係ノードを凍結 ───────────────────────────────────────────
          sim.nodes().forEach(n => {
            if (!connectedToDragged.has(n.id) && n !== draggedNode) {
              n.vx = 0; n.vy = 0;
            }
          });
        }
        _renderPositions();
      })
      // ドラッグ後に動きが収まったら配置を保存する（検索中の一時的な配置は保存しない）
      .on('end', () => { if (!freeLayout) saveLayout(); });

  // 配置はアニメーションさせず、描画なしで一気に計算してから一度だけ描く（1 tick ≒ 2ms / 600ノード）。
  if (freeLayout) {
    // 検索中：固定なしで強い力のまま止まるまで回す
    _runToRest();
  } else if (!hasPlaced) {
    // 一から配置：強い力で広げてから、弱い力で全体をなじませる
    sim.tick(180);
    settleSimForces();
    sim.alpha(0.05);
    _runToRest();
  } else if (hasNew) {
    _relaxNewNodes();
  } else {
    // 全ノードが保存済みの位置にある（再読み込み・非表示の切り替えなど）：計算しない
    settleSimForces();
  }
  _renderPositions();
  if (!freeLayout) saveLayout();

  if (selId)      applyHL(selId, 'click');
  else if (hovId) applyHL(hovId, 'hover');

  const dirs = nodes.filter(n => n.type === 'director').length;
  const arts = nodes.filter(n => n.type === 'artist').length;
  const wks  = nodes.filter(n => n.type === 'work').length;
  document.getElementById('stats').innerHTML = `${dirs} creators<br>${arts} artists<br>${wks} works`;
}

/* ─── _renderPositions: ノード・リンクの座標を DOM に反映 ─────────────────── */
function _renderPositions() {
  if (_lpSel) _lpSel.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
                    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  if (_nSel)  _nSel.attr('transform', d => `translate(${d.x},${d.y})`);
}

/* ─── 差分配置 ───────────────────────────────────────────────────────────────
   新しく増えたノード（x/y が未定義）だけを、既存の配置を崩さずに置く。
   draw()（最新作品の追加・Notion からの更新など）と redraw()（映像への監督追加など）の両方で使う。
   1) _prepareNewNodes: 既存ノードを fx/fy で固定し、新規ノードをつながっているノードの近くに仮置きする。
      _pullForNewLinks で引き寄せたノードも固定せず、新規ノードと一緒に動かす。
      シミュに渡す前に呼ぶ（渡すと位置のないノードは原点付近に置かれ、長い線で繋がってしまう）。
   2) _relaxNewNodes: シミュに渡した後で呼ぶ。新規ノードだけを近くの力で落ち着かせてから、
      全ノードを解放して弱い力でなじませる。新規ノードの周りだけが押し広げられ、
      落ち着いている場所はほぼ動かない。これがないと追加のたびに重なりが溜まっていく。
─────────────────────────────────────────────────────────────────────────────── */
function _prepareNewNodes(nodes, links, pulled = new Set()) {
  if (!pulled.size && !nodes.some(n => n.x == null)) return false;
  // pulled（新しいつながりで引き寄せたノード）は新規ノードと一緒に動かす
  nodes.forEach(n => { if (n.x != null && !pulled.has(n)) { n.fx = n.x; n.fy = n.y; } });
  _placeNewNodes(nodes, links);
  return true;
}

function _relaxNewNodes() {
  // 遠くまで届く強い反発（-2500）だと、新規ノードが群れの外へ押し出されてしまうので近くの力だけにする
  baseLinkStrength = 0.5;
  sim.force('link').strength(sim.force('link').strength());
  sim.force('charge').strength(-400).distanceMax(150);
  sim.force('center', null);
  sim.velocityDecay(0.4);
  sim.alpha(1).tick(120);
  settleSimForces();
  sim.alpha(0.05);
  _runToRest();
}

const _runToRest = () => sim.tick(Math.ceil(Math.log(sim.alphaMin() / sim.alpha()) / Math.log(1 - sim.alphaDecay())));

/* ─── _placeNewNodes: 位置のないノードを、つながっている配置済みノードの近くに置く ───
   新規ノード同士がつながっている場合（新しい作品と新しいクリエイターなど）は、
   先に置けたほうを基準に順に置いていく。どこにもつながらないものは全体の中心に置く。
─────────────────────────────────────────────────────────────────────────────── */
function _placeNewNodes(nodes, links) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const nbrs = new Map(nodes.map(n => [n.id, []]));
  links.forEach(l => {
    const s = byId.get(lid(l.source)), t = byId.get(lid(l.target));
    if (s && t) { nbrs.get(s.id).push(t); nbrs.get(t.id).push(s); }
  });
  const jitter = () => (Math.random() - 0.5) * 300;
  let pending = nodes.filter(n => n.x == null);
  while (pending.length) {
    const rest = [];
    pending.forEach(n => {
      const placed = nbrs.get(n.id).filter(m => m.x != null);
      if (!placed.length) { rest.push(n); return; }
      n.x = placed.reduce((a, m) => a + m.x, 0) / placed.length + jitter();
      n.y = placed.reduce((a, m) => a + m.y, 0) / placed.length + jitter();
      n.vx = 0; n.vy = 0;
    });
    if (rest.length === pending.length) break;
    pending = rest;
  }
  if (!pending.length) return;
  const placed = nodes.filter(n => n.x != null);
  const cx = placed.reduce((a, m) => a + m.x, 0) / placed.length;
  const cy = placed.reduce((a, m) => a + m.y, 0) / placed.length;
  pending.forEach(n => { n.x = cx + jitter(); n.y = cy + jitter(); n.vx = 0; n.vy = 0; });
}

/* ─── 配置の保存・復元 ──────────────────────────────────────────────────────
   再読み込みのたびに一から配置し直さないよう、ノードの座標を localStorage に保存する。
   作品の id（w0, w1…）は Notion の並び順で振られ、作品が増えるとずれるため、
   作品は Notion のページ ID（なければタイトル）をキーにする。人物は名前入りの id のまま。
─────────────────────────────────────────────────────────────────────────────── */
const _layoutKey = n => n.type === 'work' ? `w:${n.notionPageId || n.label}` : n.id;

// リンクを、保存用のキー（両端の _layoutKey）にする。source/target は id でもノードでもよい
function _linkKey(l, byId) {
  const s = typeof l.source === 'object' ? l.source : byId.get(l.source);
  const t = typeof l.target === 'object' ? l.target : byId.get(l.target);
  return s && t ? `${_layoutKey(s)}|${_layoutKey(t)}` : null;
}

function _readLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
    return { pos: saved.pos || {}, links: saved.links ? new Set(saved.links) : null };
  } catch (e) { return { pos: {}, links: null }; }
}

function loadSavedLayout() {
  const { pos } = _readLayout();
  AN.forEach(n => {
    const p = pos[_layoutKey(n)];
    if (p) { n.x = p[0]; n.y = p[1]; }
  });
}

function saveLayout() {
  if (_preSqSnapshot) return; // 検索中の一時的な配置は保存しない
  try {
    const { pos: saved } = _readLayout();
    const pos = {};
    // 非表示などで今回描いていないノードは前回の位置を引き継ぐ。もう存在しないノードは捨てる
    AN.forEach(n => {
      const k = _layoutKey(n);
      if (n.x != null) pos[k] = [Math.round(n.x), Math.round(n.y)];
      else if (saved[k]) pos[k] = saved[k];
    });
    // つながりも保存し、次に配置済みのノード同士に新しいつながりができたかを判定する
    const byId = new Map(AN.map(n => [n.id, n]));
    const links = AL.map(l => _linkKey(l, byId)).filter(Boolean);
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ pos, links }));
  } catch (e) { /* 保存できなくても表示には影響しない */ }
}

/* 保存時にはなかったつながりのうち、両端とも配置済みのものを返す。
   片方が新しいノードなら差分配置で近くに置かれるので含めない。
   保存につながりがない（この仕組みより前の保存）ときは判定できないので空を返す。 */
function _newLinksBetweenPlaced(links) {
  if (_preSqSnapshot) return [];
  const { links: saved } = _readLayout();
  if (!saved) return [];
  const byId = new Map(AN.map(n => [n.id, n]));
  return links.filter(l => {
    const s = typeof l.source === 'object' ? l.source : byId.get(l.source);
    const t = typeof l.target === 'object' ? l.target : byId.get(l.target);
    return s && t && s.x != null && t.x != null && !saved.has(_linkKey(l, byId));
  });
}

/* 配置済みのノード同士に新しいつながりができた（既存の監督を別の映像に追加した、など）とき、
   そのままだと長い線で変な角度に繋がるので、片側を相手の近くへ引き寄せる。動かしたノードの集合を返す。
   - つながったことで別々の塊が一つになる場合：小さいほうの塊を形を保ったまま平行移動し、
     相手の外側（相手のつながり先と反対側）に付ける。監督だけ動かすと元の作品との線が長くなるため、塊ごと動かす。
   - すでに同じ塊の中にある場合（K-POP の作品を海外の監督が手がけた、など）：動かさない。
     中間に置き直すと、作品が何もない場所に浮いて長い線が2本になるため、
     元の塊のそばに残して、離れた界隈をつなぐ長い線1本にしておく。
   動かしたノードは差分配置で周りとなじませる。 */
function _pullForNewLinks(links) {
  const pulled = new Set();
  const fresh = _newLinksBetweenPlaced(links);
  if (!fresh.length) return pulled;
  const byId = new Map(AN.map(n => [n.id, n]));
  const node = x => typeof x === 'object' ? x : byId.get(x);
  const freshSet = new Set(fresh);
  // 新しいつながりを除いた隣接関係（塊の判定用）
  const adj = new Map();
  const add = (m, a, b) => { if (!m.has(a)) m.set(a, []); m.get(a).push(b); };
  links.forEach(l => {
    const s = node(l.source), t = node(l.target);
    if (!s || !t) return;
    if (!freshSet.has(l)) { add(adj, s, t); add(adj, t, s); }
  });
  const component = start => {
    const seen = new Set([start]), q = [start];
    while (q.length) for (const m of adj.get(q.pop()) || []) if (!seen.has(m)) { seen.add(m); q.push(m); }
    return seen;
  };

  fresh.forEach(l => {
    const s = node(l.source), t = node(l.target);
    if (s.x == null || t.x == null) return;
    const cs = component(s);
    if (!cs.has(t)) {
      const ct = component(t);
      const [mover, other, comp] = cs.size <= ct.size ? [s, t, cs] : [t, s, ct];
      // 相手のつながり先の重心と反対側へ、リンクの長さぶん離して付ける
      const nb = (adj.get(other) || []).filter(m => m.x != null);
      let ux = 0, uy = 0;
      if (nb.length) {
        ux = other.x - nb.reduce((a, m) => a + m.x, 0) / nb.length;
        uy = other.y - nb.reduce((a, m) => a + m.y, 0) / nb.length;
      }
      const len = Math.hypot(ux, uy);
      if (len < 1) { const a = Math.random() * 2 * Math.PI; ux = Math.cos(a); uy = Math.sin(a); }
      else { ux /= len; uy /= len; }
      const dx = other.x + ux * 290 - mover.x, dy = other.y + uy * 290 - mover.y;
      comp.forEach(n => {
        if (n.x == null) return;
        n.x += dx; n.y += dy; n.vx = 0; n.vy = 0; n.fx = null; n.fy = null;
        pulled.add(n);
      });
    }
  });
  return pulled;
}

/* ─── resetLayout: 保存した配置を捨てる（更新ボタン）。次の draw() で一から配置される ─── */
function resetLayout() {
  AN.forEach(n => { delete n.x; delete n.y; n.vx = 0; n.vy = 0; n.fx = null; n.fy = null; });
  try { localStorage.removeItem(LAYOUT_KEY); } catch (e) { /* ignore */ }
  // 一から配置すると画面中央を基準に並ぶので、表示位置も初期状態に戻す
  if (_zoomBehavior) d3.select('#canvas').call(_zoomBehavior.transform, d3.zoomIdentity);
}

/* ─── redraw: 位置を維持したまま SVG と シミュのデータだけ更新 ───────────────
   フィルター・非表示・ノード追加/削除・検索など、
   配置を変えたくないすべての再描画はこちらを呼ぶ。
   draw() が一度も呼ばれていない場合（sim === null）はフォールバックで draw() を使う。
─────────────────────────────────────────────────────────────────────────────── */
function redraw(nodes, links) {
  if (!sim) { draw(nodes, links); return; }

  const svg = d3.select('#canvas');
  const g   = svg.select('g');
  if (g.empty()) { draw(nodes, links); return; }

  const gL = g.select('.layer-links');
  const gN = g.select('.layer-nodes');

  // リンク線を差し替え
  _lpSel = gL.selectAll('line.lp').data(links, d => `${lid(d.source)}-${lid(d.target)}`)
    .join('line')
    .attr('class', 'lp')
    .attr('stroke', d => d.ltype === 'dir' ? 'var(--link-dir)' : 'var(--link-art)')
    .attr('stroke-width', d => d.ltype === 'dir' ? 1.8 : 1)
    .attr('stroke-opacity', 0.45);

  // ノードグループを差し替え（既存ノードは DOM を再利用、追加分だけ生成）
  _nSel = gN.selectAll('g.nd').data(nodes, d => d.id)
    .join(
      enter => {
        const grp = enter.append('g').attr('class', 'nd');
        grp.call(d3.drag()
          .on('start', (e, d) => {
            if (!e.active) sim.alphaTarget(.3).restart();
            d.fx = d.x; d.fy = d.y;
            draggedNode = d; connectedToDragged.clear();
            if (!e.sourceEvent.shiftKey) {
              AL.forEach(l => {
                const s = lid(l.source), t = lid(l.target);
                if (s === d.id) { connectedToDragged.add(t); l._ropeLength = Math.sqrt((l.source.x-l.target.x)**2+(l.source.y-l.target.y)**2); }
                else if (t === d.id) { connectedToDragged.add(s); l._ropeLength = Math.sqrt((l.source.x-l.target.x)**2+(l.source.y-l.target.y)**2); }
              });
            }
          })
          .on('drag', (e, d) => {
            d.fx = e.x; d.fy = e.y;
          })
          .on('end', (e, d) => {
            if (!e.active) sim.alphaTarget(0);
            d.fx = null; d.fy = null; draggedNode = null;
            AL.forEach(l => { delete l._ropeLength; });
            connectedToDragged.clear();
          })
        )
        .on('mouseenter', (e, d) => { if (selId) return; hovId = d.id; applyHL(hovId, 'hover'); })
        .on('mouseleave', (e, d) => { if (selId) return; hovId = null; applyHL(null, null); })
        .on('click', (e, d) => {
          e.stopPropagation(); hovId = null;
          if (selId === d.id) { selId = null; applyHL(null, null); document.getElementById('info-panel').classList.remove('visible'); document.getElementById('info-overlay').classList.remove('visible'); }
          else { selId = d.id; applyHL(selId, 'click'); showPanel(d); }
        })
        .on('contextmenu', (e, d) => showCtx(e, d));

        grp.each(function(d) { _renderNodeContent(d3.select(this), d); });
        return grp;
      },
      update => update,
      exit   => exit.remove()
    );
  _fitNodeCards(_nSel);

  // 新しく加わったノード（監督の追加など）と、新しいつながりで引き寄せるノードは差分配置する
  const hasNew = _prepareNewNodes(nodes, links, _pullForNewLinks(links));

  // シミュのデータを差し替え（新規ノードがなければ alpha は触らない → 動かない）
  sim.stop();
  sim.nodes(nodes);
  sim.force('link').links(links);
  // link の source/target を ID→オブジェクトに解決（tick なし）
  if (sim.force('link').initialize) {
    sim.force('link').initialize(nodes, () => Math.random());
  }
  if (hasNew) _relaxNewNodes();
  saveLayout(); // つながりが減った場合も記録しておく（同じつながりを付け直したときに判定できるように）
  // 解決後の座標で DOM を再反映
  _nSel.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
  _lpSel.attr('x1', d => (typeof d.source === 'object' ? d.source.x : 0))
        .attr('y1', d => (typeof d.source === 'object' ? d.source.y : 0))
        .attr('x2', d => (typeof d.target === 'object' ? d.target.x : 0))
        .attr('y2', d => (typeof d.target === 'object' ? d.target.y : 0));

  const dirs = nodes.filter(n => n.type === 'director').length;
  const arts = nodes.filter(n => n.type === 'artist').length;
  const wks  = nodes.filter(n => n.type === 'work').length;
  document.getElementById('stats').innerHTML = `${dirs} creators<br>${arts} artists<br>${wks} works`;

  if (selId)      applyHL(selId, 'click');
  else if (hovId) applyHL(hovId, 'hover');
}

/* ─── _fitNodeCards: 人物カードの実幅を測り foreignObject を中心基準に合わせる ───
   カードは中身の幅に縮むため、測らないと線の集まる中心から左にずれる。
   レイアウト上の寸法（computed style）はズーム倍率の影響を受けず、別タブ表示中（rAF 停止）でも測れるので、
   描画直後にその場で測る。avatar は fetchArtistAvatars() が非同期で差し込む。
─────────────────────────────────────────────────────────────────────────────── */
function _fitNodeCards(sel) {
  sel.each(function(d) {
    if (d.type === 'work') return;
    const fo = d3.select(this).select('foreignObject');
    const cardEl = this.querySelector('.pnode-card');
    if (!fo.empty() && cardEl && cardEl.offsetWidth > 0) {
      // offsetWidth は整数に丸められ、切り捨て側だと文字が折り返すため小数の実寸を切り上げる
      const cs = getComputedStyle(cardEl);
      const w = Math.ceil(parseFloat(cs.width));
      const h = Math.ceil(parseFloat(cs.height));
      fo.attr('width', w).attr('height', h)
        .attr('x', -w / 2).attr('y', -h / 2);
      d.fw = w; d.fh = h;
    }
    // node.avatar が既にある場合（前回 fetch 済み）は即反映
    if (d.avatar) {
      const avatarDiv = this.querySelector('.pnode-avatar');
      if (avatarDiv && !avatarDiv.querySelector('img')) {
        avatarDiv.innerHTML = '';
        const img = document.createElement('img');
        img.src = d.avatar; img.alt = '';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover';
        const initial = [...d.label][0] || '?';
        img.onerror = () => { avatarDiv.innerHTML = `<span class="pnode-initial">${initial}</span>`; };
        avatarDiv.appendChild(img);
      }
    }
  });
}

/* ─── _renderNodeContent: ノード1つ分の内部 DOM を構築 ─────────────────────── */
function _renderNodeContent(grp, d) {
  if (d.type === 'work') {
    const fo = grp.append('foreignObject').attr('width', CW).attr('height', CH).attr('x', -CW/2).attr('y', -CH/2);
    const card = fo.append('xhtml:div').attr('class', 'wcard').attr('data-id', d.id);
    if (d.th) {
      card.append('xhtml:img').attr('class', 'wc-img').attr('src', d.th)
        .on('error', function() { d3.select(this).remove(); card.insert('xhtml:div', ':first-child').attr('class', 'wc-ph').text('🎬'); });
    } else {
      card.append('xhtml:div').attr('class', 'wc-ph').text('🎬');
    }
    const bd = card.append('xhtml:div').attr('class', 'wc-bd');
    bd.append('xhtml:div').attr('class', 'wc-tt').text(d.label);
    const tgs = bd.append('xhtml:div').attr('class', 'wc-tags');
    (d.cats || []).slice(0, 3).forEach(c => tgs.append('xhtml:span').attr('class', 'tag wc-tag').attr('data-color', tagColor(c)).text(c));
    if (dirSuggestFor(d)) card.append('xhtml:div').attr('class', 'wc-suggest').attr('title', 'IMDbに監督候補あり').text('監督候補');
  } else {
    const isDir = d.type === 'director';
    const col   = isDir ? 'var(--node-dir)' : 'var(--node-art)';
    const cardW = isDir ? PNW : ANW;
    const cardH = isDir ? PNH : ANH;
    const initial = [...d.label][0] || '?';
    grp.append('circle').attr('r', 1).attr('fill', 'none').attr('stroke', 'none');
    const fo = grp.append('foreignObject').attr('width', cardW).attr('height', cardH).attr('x', -cardW/2).attr('y', -cardH/2);
    const card = fo.append('xhtml:div').attr('class', 'pnode-card').attr('data-id', d.id).style('border-color', col);
    const avatarDiv = card.append('xhtml:div').attr('class', 'pnode-avatar').style('background', col);
    if (d.avatar) {
      avatarDiv.append('xhtml:img').attr('src', d.avatar).attr('alt', '').style('width','100%').style('height','100%').style('object-fit','cover')
        .on('error', function() { d3.select(this).remove(); avatarDiv.append('xhtml:span').attr('class','pnode-initial').text(initial); });
    } else {
      avatarDiv.append('xhtml:span').attr('class', 'pnode-initial').text(initial);
    }
    const textDiv = card.append('xhtml:div').attr('class', 'pnode-text');
    textDiv.append('xhtml:div').attr('class', 'pnode-name').text(d.label);
    if (isDir) textDiv.append('xhtml:div').attr('class', 'pnode-role').text(d.role || 'Creator');
  }
}
