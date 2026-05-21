/* ═══════════════════════════════════════════
   DRAW
═══════════════════════════════════════════ */
function draw(nodes, links, { freeLayout = false } = {}) {
  const W = window.innerWidth, H = window.innerHeight - 48;
  d3.select('#canvas').selectAll('*').remove();
  gDimRect = null;

  const svg = d3.select('#canvas').attr('width', W).attr('height', H);
  const g = svg.append('g');

  svg.call(d3.zoom().scaleExtent([0.04, 4]).on('zoom', e => {
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
  }));
  svg.on('click', e => {
    if (e.target.tagName === 'svg' || e.target.tagName === 'SVG') {
      selId = null; hovId = null; applyHL(null, null);
      document.getElementById('info-panel').classList.remove('visible');
      document.getElementById('info-overlay').classList.remove('visible');
    }
  });

  const dimColor = document.body.dataset.theme === 'light' ? '#f2f2f7' : 'rgb(25,25,25)';
  gDimRect = g.append('rect').attr('x',-99999).attr('y',-99999).attr('width',199999).attr('height',199999)
    .attr('fill', dimColor).attr('fill-opacity', 0).attr('pointer-events', 'none')
    .style('transition', 'fill-opacity .18s');

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

  // 描画後に各pnode-cardの実幅を測定し foreignObject を中心基準で更新
  // avatar は fetchArtistAvatars() が非同期で差し込むため、ここでは寸法のみ処理
  requestAnimationFrame(() => {
    _nSel.each(function(d) {
      if (d.type === 'work') return;
      const fo = d3.select(this).select('foreignObject');
      const cardEl = this.querySelector('.pnode-card');
      if (!fo.empty() && cardEl) {
        const rect = cardEl.getBoundingClientRect();
        if (rect.width > 0) {
          const w = Math.ceil(rect.width);
          const h = Math.ceil(rect.height);
          fo.attr('width', w).attr('height', h)
            .attr('x', -w / 2).attr('y', -h / 2);
          d.fw = w; d.fh = h;
        }
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
  });

  // 既存ノードは現在位置を fx/fy で固定してからシミュに渡す。
  // これにより charge/center/link の力が一斉にかかっても既存ノードは動かない。
  // 新規ノード（x/y が未定義）のみ自然に配置される。
  // simTimer の完了タイミングで fx/fy を解除する。
  // ただし freeLayout=true（検索時など）は固定しない——シミュに自由に動かせる。
  const isFirstDraw = !sim;
  if (!freeLayout) {
    nodes.forEach(n => {
      if (n.x != null) { n.fx = n.x; n.fy = n.y; }
    });
  }

  // freeLayout（検索時）は前回の緩和後パラメータが残っているため初期値に戻す。
  // 通常の draw（初回・更新どちらも）も同様にリセットして、更新時に広がらないようにする。
  baseLinkStrength = 0.5;

  if (sim) sim.stop();
  sim = d3.forceSimulation(nodes)
      .force('link',    d3.forceLink(links).id(d => d.id)
        .distance(l => l.ltype === 'dir' ? 280 : 300)
        .strength(() => baseLinkStrength))
      .force('charge',  d3.forceManyBody().strength(-2500))
      .force('center',  d3.forceCenter(W/2, H/2))
      .force('collide', d3.forceCollide(d => d.type === 'work' ? Math.sqrt((CW/2)**2 + (CH/2)**2) + 18 : Math.sqrt((PNW/2)**2 + (PNH/2)**2) + 12))
      .alphaDecay(.015)
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

        if (_lpSel) _lpSel.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
                          .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        if (_nSel)  _nSel.attr('transform', d => `translate(${d.x},${d.y})`);
      });

  if (simTimer) clearTimeout(simTimer);
  if (!freeLayout) {
    simTimer = setTimeout(() => {
      if (sim) {
        // 既存ノードの位置固定を解除（新規ノードはここで初めて自由になる）
        sim.nodes().forEach(n => { n.fx = null; n.fy = null; });
        sim.force('charge').strength(-400).distanceMax(150);
        baseLinkStrength = 0.01;
        sim.force('link').strength(sim.force('link').strength());
        sim.velocityDecay(0.7);
        sim.force('center', null);
        sim.alpha(0.05).restart();
      }
    }, isFirstDraw ? 3000 : 800);
  } else {
    // freeLayout: 固定なしで起動したシミュをそのまま自走させる（pin 解除フェーズは不要）
    simTimer = null;
  }

  if (selId)      applyHL(selId, 'click');
  else if (hovId) applyHL(hovId, 'hover');

  const dirs = nodes.filter(n => n.type === 'director').length;
  const arts = nodes.filter(n => n.type === 'artist').length;
  const wks  = nodes.filter(n => n.type === 'work').length;
  document.getElementById('stats').innerHTML = `${dirs} creators<br>${arts} artists<br>${wks} works`;
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

  // シミュのデータを差し替え（alpha は触らない → 動かない）
  sim.stop();
  sim.nodes(nodes);
  sim.force('link').links(links);
  // link の source/target を ID→オブジェクトに解決（tick なし）
  if (sim.force('link').initialize) {
    sim.force('link').initialize(nodes, () => Math.random());
  }
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
    (d.cats || []).slice(0, 3).forEach(c => tgs.append('xhtml:span').attr('class', 'wc-tag').text(c));
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
