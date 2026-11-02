/* ═══════════════════════════════════════════
   MOBILE（600px 以下）
   - 下のナビ（#mobile-bar）：トップバーの各ボタンを押す。オン・開いている・件数・読み込み中の状態を写す
   - タグの絞り込み・監督候補のシートを開いている間は、後ろを暗くする（暗い所を押すと閉じる）
   - パネル・モーダルのシートは、取っ手や見出しを下に引くと閉じる
   - 人物を選んだら、その人物がシートに隠れないようにグラフを動かす
   - ロゴの長押しで編集モードのログイン（PC の Shift+E と同じ）
═══════════════════════════════════════════ */
const isMobileLayout = () => MOBILE_MQ.matches;

/* ── 下のナビ ── */
(function setupMobileBar() {
  const tagDd = document.getElementById('tag-filter-dropdown');
  const dsPanel = document.getElementById('dir-suggest-panel');
  // トップバーは登場アニメーション（transform / filter）で position: fixed の基準になってしまうため、
  // その中にあるとシートを画面の下に置けない。body の直下へ移す（PC でもトップバーは左上にあるので位置は変わらない）
  document.body.appendChild(tagDd);

  // 別のメニューを開く前に、開いているシートを閉じる（ナビのボタンは押しても外側のクリックにならないため）
  function closeSheetsExcept(targetId) {
    if (targetId !== 'tag-filter-btn') closeTagDropdown();
    if (targetId !== 'dir-suggest-btn') dsPanel.classList.remove('visible');
    hideCtx();
  }

  document.querySelectorAll('#mobile-bar .mb-item').forEach(item => {
    const target = document.getElementById(item.dataset.target);
    if (!target) { item.hidden = true; return; }
    const count = item.querySelector('.tb-count');

    const sync = () => {
      item.classList.toggle('active', target.classList.contains('active'));
      item.classList.toggle('loading', target.classList.contains('loading'));
      const open = target.classList.contains('open')
        || (item.dataset.target === 'dir-suggest-btn' && dsPanel.classList.contains('visible'));
      item.classList.toggle('open', open);
      if (target.hasAttribute('aria-pressed')) item.setAttribute('aria-pressed', target.getAttribute('aria-pressed'));
      if (item.dataset.target === 'dir-suggest-btn') {
        item.hidden = target.style.display === 'none' || getComputedStyle(target).display === 'none';
      }
      const tc = target.querySelector('.tb-count');
      if (count && tc) count.textContent = tc.textContent;
      item.title = target.title || '';
    };
    const obs = { attributes: true, childList: true, subtree: true, characterData: true };
    new MutationObserver(sync).observe(target, obs);
    if (item.dataset.target === 'dir-suggest-btn') {
      new MutationObserver(sync).observe(dsPanel, { attributes: true, attributeFilter: ['class'] });
      new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    sync();

    item.addEventListener('click', e => {
      e.stopPropagation();
      closeSheetsExcept(item.dataset.target);
      target.click();
    });
  });

  /* ── シートの後ろの暗幕 ── */
  const scrim = document.getElementById('sheet-scrim');
  const updateScrim = () => {
    const open = isMobileLayout() && (tagDd.classList.contains('open') ? tagDd
      : dsPanel.classList.contains('visible') ? dsPanel : null);
    scrim.classList.toggle('visible', !!open);
  };
  [tagDd, dsPanel].forEach(el => new MutationObserver(updateScrim).observe(el, { attributes: true, attributeFilter: ['class'] }));
  MOBILE_MQ.addEventListener('change', updateScrim);
  // 暗幕を押すと document の「外側を押したら閉じる」処理が働いてシートが閉じる
})();

/* ── 検索欄の案内文：スマホの幅に収まる短さにする ── */
(function setupSearchPlaceholder() {
  const box = document.getElementById('search-box');
  const full = box.placeholder;
  const apply = () => { box.placeholder = isMobileLayout() ? 'クリエイター・作品' : full; };
  MOBILE_MQ.addEventListener('change', apply);
  apply();
})();

/* ── 下に引いて閉じるシート ──
   取っ手・見出しからはいつでも、中身からはスクロールが一番上のときだけ引ける。
   横に動かしたとき（横スクロールの一覧など）や入力欄では引かない */
function makeSheetSwipeClosable(sheet, onClose, scrollSel) {
  let startX = 0, startY = 0, dy = 0, t0 = 0, dragging = false, decided = true, scroller = null;

  sheet.addEventListener('touchstart', e => {
    decided = true; dragging = false;
    if (!isMobileLayout() || e.touches.length !== 1) return;
    if (e.target.closest('input, textarea, iframe, .person-list, .pf-options, .fm2-tabs')) return;
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; dy = 0; t0 = performance.now();
    scroller = scrollSel ? e.target.closest(scrollSel) : null;
    decided = false;
  }, { passive: true });

  sheet.addEventListener('touchmove', e => {
    if (decided && !dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    dy = t.clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      decided = true;
      if (!(dy > 0 && Math.abs(dy) > Math.abs(dx) && (!scroller || scroller.scrollTop <= 0))) return;
      dragging = true;
      sheet.style.transition = 'none';
      sheet.style.animation = 'none';
    }
    e.preventDefault();
    sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    const h = sheet.offsetHeight;
    const v = dy / Math.max(1, performance.now() - t0);   // px/ms
    const reset = () => { sheet.style.transition = ''; sheet.style.transform = ''; sheet.style.animation = ''; };
    sheet.style.transition = 'transform .22s cubic-bezier(0.32, 0.72, 0, 1)';
    if (dy > h * 0.3 || (v > 0.5 && dy > 40)) {
      sheet.style.transform = `translateY(${h}px)`;
      setTimeout(() => { onClose(); reset(); }, 200);
    } else {
      sheet.style.transform = '';
      setTimeout(reset, 240);
    }
  };
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
}

makeSheetSwipeClosable(document.getElementById('info-panel'), closeInfoPanel, '#pc2');
document.querySelectorAll('.fm2-modal').forEach(modal => {
  const handle = document.createElement('div');
  handle.className = 'sheet-handle';
  handle.setAttribute('aria-hidden', 'true');
  modal.prepend(handle);
  const closeBtn = modal.querySelector('.fm2-header > .close-btn');
  makeSheetSwipeClosable(modal, () => closeBtn?.click(), '.fm2-body, #pf-body');
});

/* ── 選んだ人物がシートに隠れないよう、見えている領域の中央へグラフを動かす ── */
function revealNodeAboveSheet(d) {
  const panel = document.getElementById('info-panel');
  const svg = document.getElementById('canvas');
  if (!panel.classList.contains('visible') || d.x == null || !_zoomBehavior) return;
  const cr = svg.getBoundingClientRect();
  // シートの上端（出てくるアニメーション中でも最終位置で計算する）
  const sheetTop = window.innerHeight - (parseFloat(getComputedStyle(panel).bottom) || 0) - panel.offsetHeight;
  const visibleBottom = Math.min(cr.bottom, sheetTop);
  const t = d3.zoomTransform(svg);
  const sx = cr.left + t.applyX(d.x), sy = cr.top + t.applyY(d.y);
  const m = 48;
  if (sy > cr.top + m && sy < visibleBottom - m && sx > cr.left + m && sx < cr.right - m) return;
  const tx = cr.left + cr.width / 2, ty = (cr.top + visibleBottom) / 2;
  d3.select(svg).transition().duration(450).ease(d3.easeCubicOut)
    .call(_zoomBehavior.translateBy, (tx - sx) / t.k, (ty - sy) / t.k);
}
const _showPanelDesktop = showPanel;
showPanel = function (d) {
  _showPanelDesktop.apply(this, arguments);
  if (isMobileLayout() && d && d.type !== 'work') requestAnimationFrame(() => revealNodeAboveSheet(d));
};

/* ── ロゴの長押しで編集モード（Shift+E と同じ処理を呼ぶ） ── */
(function setupLogoLongPress() {
  const logo = document.querySelector('#topbar .logo');
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; };
  logo.addEventListener('touchstart', () => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', code: 'KeyE', shiftKey: true, bubbles: true }));
    }, 700);
  }, { passive: true });
  ['touchend', 'touchcancel', 'touchmove'].forEach(ev => logo.addEventListener(ev, cancel, { passive: true }));
  logo.addEventListener('contextmenu', e => e.preventDefault());
})();
