/* ═══════════════════════════════════════════
   TAG FILTER DROPDOWN
═══════════════════════════════════════════ */
function updateTagFilterBtn() {
  const btn = document.getElementById('tag-filter-btn');
  btn.classList.toggle('active', aFilters.size > 0);
  // title でフィルター数をツールチップに表示
  btn.title = aFilters.size > 0 ? `タグで絞り込み中 (${aFilters.size}件)` : 'タグで絞り込み';
}

function renderTagDropdown() {
  const dd = document.getElementById('tag-filter-dropdown');
  const cats = new Set();
  AN.filter(n => n.type === 'work').forEach(n => (n.cats || []).forEach(c => cats.add(c)));
  const sorted = [...cats].sort();
  dd.innerHTML = '';

  // 「すべてクリア」行
  if (aFilters.size > 0) {
    const clear = document.createElement('div');
    clear.className = 'tfd-item';
    clear.innerHTML = `${icon('x', 14)}<span>絞り込みをクリア</span>`;
    clear.addEventListener('click', e => {
      e.stopPropagation();
      const was = isLayoutFiltered();
      aFilters.clear();
      updateTagFilterBtn();
      renderTagDropdown();
      applyFilterLayout(was);
    });
    dd.appendChild(clear);
    const sep = document.createElement('div');
    sep.className = 'tfd-sep';
    dd.appendChild(sep);
  }

  sorted.forEach(cat => {
    const item = document.createElement('div');
    item.className = 'tfd-item' + (aFilters.has(cat) ? ' checked' : '');
    item.innerHTML = `<div class="tfd-check"></div>${tagHtml(cat)}`;
    item.addEventListener('click', e => {
      e.stopPropagation();
      const was = isLayoutFiltered();
      if (aFilters.has(cat)) aFilters.delete(cat); else aFilters.add(cat);
      updateTagFilterBtn();
      renderTagDropdown();
      applyFilterLayout(was);
    });
    dd.appendChild(item);
  });
}

function makeFilter() {
  renderTagDropdown();
  updateTagFilterBtn();
}

// ドロップダウン開閉
const _tfBtn = document.getElementById('tag-filter-btn');
const _tfDd  = document.getElementById('tag-filter-dropdown');

function openTagDropdown() {
  renderTagDropdown();
  // ボタンの位置に合わせて dropdown を配置
  const rect = _tfBtn.getBoundingClientRect();
  _tfDd.style.top  = (rect.bottom + 6) + 'px';
  _tfDd.style.left = rect.left + 'px';
  _tfBtn.classList.add('open');
  _tfDd.classList.add('open');
}
function closeTagDropdown() {
  _tfBtn.classList.remove('open');
  _tfDd.classList.remove('open');
}

_tfBtn.addEventListener('click', e => {
  e.stopPropagation();
  _tfDd.classList.contains('open') ? closeTagDropdown() : openTagDropdown();
});
document.addEventListener('click', e => {
  if (!_tfDd.contains(e.target) && e.target !== _tfBtn) closeTagDropdown();
});
