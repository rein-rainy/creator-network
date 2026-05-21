/* ═══════════════════════════════════════════
   FILTER
═══════════════════════════════════════════ */
function visibleNodeIds() {
  return new Set(AN.filter(n => {
    if (hiddenIds.has(n.id)) return false;
    if (n.type === 'director') return showDir;
    if (n.type === 'artist')   return showArt;
    return true;
  }).map(n => n.id));
}

function filteredData() {
  const vids = visibleNodeIds();
  let nodes = AN.filter(n => vids.has(n.id));
  let links = AL.filter(l => vids.has(lid(l.source)) && vids.has(lid(l.target)));

  if (aFilters.size > 0) {
    const wids = new Set(nodes.filter(n => n.type === 'work' && (n.cats || []).some(c => aFilters.has(c))).map(n => n.id));
    const keep = new Set();
    links.forEach(l => { const s = lid(l.source), t = lid(l.target); if (wids.has(s) || wids.has(t)) { keep.add(s); keep.add(t); } });
    nodes = nodes.filter(n => keep.has(n.id));
    links = links.filter(l => keep.has(lid(l.source)) && keep.has(lid(l.target)));
  }

  if (sq && searchMode === 'filter') {
    const q = sq.toLowerCase();
    const direct = new Set(nodes.filter(n => n.label.toLowerCase().includes(q)).map(n => n.id));
    const exp = new Set(direct);
    links.forEach(l => { const s = lid(l.source), t = lid(l.target); if (direct.has(s)) exp.add(t); if (direct.has(t)) exp.add(s); });
    nodes = nodes.filter(n => exp.has(n.id));
    links = links.filter(l => exp.has(lid(l.source)) && exp.has(lid(l.target)));
  }

  return { nodes, links };
}

/* ═══════════════════════════════════════════
   HIGHLIGHT
═══════════════════════════════════════════ */
function hlSet(nodeId) {
  if (!nodeId) return null;
  const vids = visibleNodeIds();
  const visLinks = AL.filter(l => vids.has(lid(l.source)) && vids.has(lid(l.target)));
  const ns = new Set([nodeId]), ls = new Set();

  visLinks.forEach(l => {
    const s = lid(l.source), t = lid(l.target);
    if (s === nodeId || t === nodeId) { ns.add(s); ns.add(t); ls.add(l); }
  });

  if (depth2) {
    [...ns].filter(id => id !== nodeId).forEach(nid => {
      visLinks.forEach(l => {
        const s = lid(l.source), t = lid(l.target);
        if (s === nid || t === nid) { ns.add(s); ns.add(t); ls.add(l); }
      });
    });
  }

  return { ns, ls };
}

function applyHL(activeId, mode) {
  const hl = activeId ? hlSet(activeId) : null;

  if (gDimRect) gDimRect.attr('fill-opacity', !hl ? 0 : mode === 'click' ? .88 : .75);

  document.querySelectorAll('.wcard').forEach(el => {
    const id = el.dataset.id;
    el.classList.remove('hl-dir', 'hl-art', 'hl-both', 'dim');
    if (!hl) return;
    if (!hl.ns.has(id)) { el.classList.add('dim'); return; }
    let d = false, a = false;
    AL.forEach(l => { const s = lid(l.source), t = lid(l.target); if ((s===id||t===id) && hl.ls.has(l)) { if (l.ltype==='dir') d=true; else a=true; } });
    el.classList.add(d && a ? 'hl-both' : d ? 'hl-dir' : 'hl-art');
  });

  d3.selectAll('g.nd').each(function(d) {
    if (d.type === 'work') return;
    const active = !hl || hl.ns.has(d.id);
    d3.select(this).style('opacity', active ? 1 : 0.08);
  });

  d3.selectAll('line.lp').each(function(d) {
    const active = !hl || hl.ls.has(d);
    d3.select(this)
      .attr('stroke-opacity', active ? 1 : 0.04)
      .attr('stroke-width', active && hl ? (d.ltype==='dir' ? 2.8 : 2.0) : (d.ltype==='dir' ? 1.8 : 1.0));
  });
}
