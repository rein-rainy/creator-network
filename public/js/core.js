'use strict';

/* ═══════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════ */
const CW = 158, CH = 148;
const DR = 30, AR = 22;
// person card node サイズ
const PNW = 200, PNH = 68; // director card width/height
const ANW = 200, ANH = 56; // artist card width/height
const LAYOUT_KEY = 'creator_network_layout';

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
let AN = [], AL = [];
let ALL_CREATORS = [];
let ALL_ARTISTS = [];
let aFilters = new Set(), sq = '', depth2 = false;  // aFilters: 空=全表示
let searchMode = 'filter'; // 'filter' | 'navigate'
let showDir = true, showArt = true, baseLinkStrength = 0.5;
let selId = null, hovId = null;
let sim = null, gDimRect = null, draggedNode = null, connectedToDragged = new Set();
let _lpSel = null, _nSel = null; // tick ハンドラが参照する D3 セレクション
let _preSqSnapshot = null; // 絞り込み（フィルター検索・タグ）開始直前のノード座標スナップショット
let _preSqTransform = null; // 絞り込み開始直前の表示位置（ズーム・パン）
let _zoomBehavior = null;  // draw() が #canvas に付けた d3.zoom（表示位置の変更はこれ経由で行う）

/* ═══════════════════════════════════════════
   UTILS
═══════════════════════════════════════════ */
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const lid = x => (typeof x === 'object' ? x.id : x);

// アイコンはすべて Font Awesome Free の Solid (https://fontawesome.com/icons/classic) に統一する。
// Font Awesome Free 7.3.1 by @fontawesome - https://fontawesome.com
// License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License)
// 名前は呼び出し側の互換のため以前の名前のまま。値は [viewBox の幅, path]（高さは 512）、右のコメントが Font Awesome の名前。
// 文字や絵文字をアイコン代わりに使わない。HTML 側は <span data-icon="name"></span> で埋め込む。
const _ICON_PATHS = {
  x:                     [384, 'M55.1 73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L147.2 256 9.9 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192.5 301.3 329.9 438.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.8 256 375.1 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192.5 210.7 55.1 73.4z'], // xmark
  plus:                  [448, 'M256 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 160-160 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l160 0 0 160c0 17.7 14.3 32 32 32s32-14.3 32-32l0-160 160 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-160 0 0-160z'], // plus
  check:                 [448, 'M434.8 70.1c14.3 10.4 17.5 30.4 7.1 44.7l-256 352c-5.5 7.6-14 12.3-23.4 13.1s-18.5-2.7-25.1-9.3l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l101.5 101.5 234-321.7c10.4-14.3 30.4-17.5 44.7-7.1z'], // check
  search:                [512, 'M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376C296.3 401.1 253.9 416 208 416 93.1 416 0 322.9 0 208S93.1 0 208 0 416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z'], // magnifying-glass
  'zoom-in':             [512, 'M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376C296.3 401.1 253.9 416 208 416 93.1 416 0 322.9 0 208S93.1 0 208 0 416 93.1 416 208zM208 112c-13.3 0-24 10.7-24 24l0 48-48 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l48 0 0 48c0 13.3 10.7 24 24 24s24-10.7 24-24l0-48 48 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-48 0 0-48c0-13.3-10.7-24-24-24z'], // magnifying-glass-plus
  'list-filter':         [512, 'M0 96C0 78.3 14.3 64 32 64l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 128C14.3 128 0 113.7 0 96zM64 256c0-17.7 14.3-32 32-32l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L96 288c-17.7 0-32-14.3-32-32zM448 416c0 17.7-14.3 32-32 32L32 448c-17.7 0-32-14.3-32-32s14.3-32 32-32l384 0c17.7 0 32 14.3 32 32z'], // bars-staggered
  funnel:                [512, 'M32 64C19.1 64 7.4 71.8 2.4 83.8S.2 109.5 9.4 118.6L192 301.3 192 416c0 8.5 3.4 16.6 9.4 22.6l64 64c9.2 9.2 22.9 11.9 34.9 6.9S320 492.9 320 480l0-178.7 182.6-182.6c9.2-9.2 11.9-22.9 6.9-34.9S492.9 64 480 64L32 64z'], // filter
  video:                 [576, 'M96 64c-35.3 0-64 28.7-64 64l0 256c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-256c0-35.3-28.7-64-64-64L96 64zM464 336l73.5 58.8c4.2 3.4 9.4 5.2 14.8 5.2 13.1 0 23.7-10.6 23.7-23.7l0-240.6c0-13.1-10.6-23.7-23.7-23.7-5.4 0-10.6 1.8-14.8 5.2L464 176 464 336z'], // video
  calendar:              [448, 'M128 0C110.3 0 96 14.3 96 32l0 32-32 0C28.7 64 0 92.7 0 128l0 48 448 0 0-48c0-35.3-28.7-64-64-64l-32 0 0-32c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 32-128 0 0-32c0-17.7-14.3-32-32-32zM0 224L0 416c0 35.3 28.7 64 64 64l320 0c35.3 0 64-28.7 64-64l0-192-448 0z'], // calendar
  'external-link':       [512, 'M320 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l82.7 0-201.4 201.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L448 109.3 448 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-160c0-17.7-14.3-32-32-32L320 0zM80 96C35.8 96 0 131.8 0 176L0 432c0 44.2 35.8 80 80 80l256 0c44.2 0 80-35.8 80-80l0-80c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 80c0 8.8-7.2 16-16 16L80 448c-8.8 0-16-7.2-16-16l0-256c0-8.8 7.2-16 16-16l80 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L80 96z'], // arrow-up-right-from-square
  'rotate-cw':           [512, 'M488 192l-144 0c-9.7 0-18.5-5.8-22.2-14.8s-1.7-19.3 5.2-26.2l46.7-46.7c-75.3-58.6-184.3-53.3-253.5 15.9-75 75-75 196.5 0 271.5s196.5 75 271.5 0c8.2-8.2 15.5-16.9 21.9-26.1 10.1-14.5 30.1-18 44.6-7.9s18 30.1 7.9 44.6c-8.5 12.2-18.2 23.8-29.1 34.7-100 100-262.1 100-362 0S-25 175 75 75c94.3-94.3 243.7-99.6 344.3-16.2L471 7c6.9-6.9 17.2-8.9 26.2-5.2S512 14.3 512 24l0 144c0 13.3-10.7 24-24 24z'], // rotate-right
  film:                  [448, 'M0 96C0 60.7 28.7 32 64 32l320 0c35.3 0 64 28.7 64 64l0 320c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64L0 96zM48 368l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0c-8.8 0-16 7.2-16 16zm304-16c-8.8 0-16 7.2-16 16l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0zM48 240l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0c-8.8 0-16 7.2-16 16zm304-16c-8.8 0-16 7.2-16 16l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0zM48 112l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16L64 96c-8.8 0-16 7.2-16 16zM352 96c-8.8 0-16 7.2-16 16l0 32c0 8.8 7.2 16 16 16l32 0c8.8 0 16-7.2 16-16l0-32c0-8.8-7.2-16-16-16l-32 0z'], // film
  play:                  [448, 'M91.2 36.9c-12.4-6.8-27.4-6.5-39.6 .7S32 57.9 32 72l0 368c0 14.1 7.5 27.2 19.6 34.4s27.2 7.5 39.6 .7l336-184c12.8-7 20.8-20.5 20.8-35.1s-8-28.1-20.8-35.1l-336-184z'], // play
  route:                 [512, 'M512 96c0 50.2-59.1 125.1-84.6 155-3.8 4.4-9.4 6.1-14.5 5L320 256c-17.7 0-32 14.3-32 32s14.3 32 32 32l96 0c53 0 96 43 96 96s-43 96-96 96l-276.4 0c8.7-9.9 19.3-22.6 30-36.8 6.3-8.4 12.8-17.6 19-27.2L416 448c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0c-53 0-96-43-96-96s43-96 96-96l39.8 0c-21-31.5-39.8-67.7-39.8-96 0-53 43-96 96-96s96 43 96 96zM117.1 489.1c-3.8 4.3-7.2 8.1-10.1 11.3l-1.8 2-.2-.2c-6 4.6-14.6 4-20-1.8-25.2-27.4-85-97.9-85-148.4 0-53 43-96 96-96s96 43 96 96c0 30-21.1 67-43.5 97.9-10.7 14.7-21.7 28-30.8 38.5l-.6 .7zM128 352a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zM416 128a32 32 0 1 0 0-64 32 32 0 1 0 0 64z'], // route
  shuffle:               [512, 'M403.8 34.4c12-5 25.7-2.2 34.9 6.9l64 64c6 6 9.4 14.1 9.4 22.6s-3.4 16.6-9.4 22.6l-64 64c-9.2 9.2-22.9 11.9-34.9 6.9S384 204.9 384 192l0-32-32 0c-10.1 0-19.6 4.7-25.6 12.8l-32.4 43.2-40-53.3 21.2-28.3C293.3 110.2 321.8 96 352 96l32 0 0-32c0-12.9 7.8-24.6 19.8-29.6zM154 296l40 53.3-21.2 28.3C154.7 401.8 126.2 416 96 416l-64 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l64 0c10.1 0 19.6-4.7 25.6-12.8L154 296zM438.6 470.6c-9.2 9.2-22.9 11.9-34.9 6.9S384 460.9 384 448l0-32-32 0c-30.2 0-58.7-14.2-76.8-38.4L121.6 172.8c-6-8.1-15.5-12.8-25.6-12.8l-64 0c-17.7 0-32-14.3-32-32S14.3 96 32 96l64 0c30.2 0 58.7 14.2 76.8 38.4L326.4 339.2c6 8.1 15.5 12.8 25.6 12.8l32 0 0-32c0-12.9 7.8-24.6 19.8-29.6s25.7-2.2 34.9 6.9l64 64c6 6 9.4 14.1 9.4 22.6s-3.4 16.6-9.4 22.6l-64 64z'], // shuffle
  'arrow-left-right':    [512, 'M502.6 150.6l-96 96c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L402.7 160 32 160c-17.7 0-32-14.3-32-32S14.3 96 32 96l370.7 0-41.4-41.4c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l96 96c12.5 12.5 12.5 32.8 0 45.3zm-397.3 352l-96-96c-12.5-12.5-12.5-32.8 0-45.3l96-96c12.5-12.5 32.8-12.5 45.3 0s12.5 32.8 0 45.3L109.3 352 480 352c17.7 0 32 14.3 32 32s-14.3 32-32 32l-370.7 0 41.4 41.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0z'], // arrow-right-arrow-left
  'arrow-right-to-line': [384, 'M21 36.8c12.9-7 28.7-6.3 41 1.8L320 208.1 320 64c0-17.7 14.3-32 32-32s32 14.3 32 32l0 384c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-144.1-258 169.6c-12.3 8.1-28 8.8-41 1.8S0 454.7 0 440L0 72C0 57.3 8.1 43.8 21 36.8z'], // forward-step
  'chevron-left':        [320, 'M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l192 192c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256 246.6 86.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-192 192z'], // chevron-left
  'chevron-right':       [320, 'M311.1 233.4c12.5 12.5 12.5 32.8 0 45.3l-192 192c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L243.2 256 73.9 86.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l192 192z'], // chevron-right
  'circle-nodes':        [512, 'M418.4 157.9c35.3-8.3 61.6-40 61.6-77.9 0-44.2-35.8-80-80-80-43.4 0-78.7 34.5-80 77.5L136.2 151.1C121.7 136.8 101.9 128 80 128 35.8 128 0 163.8 0 208s35.8 80 80 80c12.2 0 23.8-2.7 34.1-7.6L259.7 407.8c-2.4 7.6-3.7 15.8-3.7 24.2 0 44.2 35.8 80 80 80s80-35.8 80-80c0-27.7-14-52.1-35.4-66.4l37.8-207.7zM156.3 232.2c2.2-6.9 3.5-14.2 3.7-21.7l183.8-73.5c3.6 3.5 7.4 6.7 11.6 9.5L317.6 354.1c-5.5 1.3-10.8 3.1-15.8 5.5L156.3 232.2z'], // circle-nodes
  pencil:                [512, 'M36.4 353.2c4.1-14.6 11.8-27.9 22.6-38.7l181.2-181.2 33.9-33.9c16.6 16.6 51.3 51.3 104 104l33.9 33.9-33.9 33.9-181.2 181.2c-10.7 10.7-24.1 18.5-38.7 22.6L30.4 510.6c-8.3 2.3-17.3 0-23.4-6.2S-1.4 489.3 .9 481L36.4 353.2zm55.6-3.7c-4.4 4.7-7.6 10.4-9.3 16.6l-24.1 86.9 86.9-24.1c6.4-1.8 12.2-5.1 17-9.7L91.9 349.5zm354-146.1c-16.6-16.6-51.3-51.3-104-104L308 65.5C334.5 39 349.4 24.1 352.9 20.6 366.4 7 384.8-.6 404-.6S441.6 7 455.1 20.6l35.7 35.7C504.4 69.9 512 88.3 512 107.4s-7.6 37.6-21.2 51.1c-3.5 3.5-18.4 18.4-44.9 44.9z'], // pencil
};
// Font Awesome のグリフは枠いっぱいに描かれるので、四辺に 48/512 の余白を足して以前のアイコンと同じ見た目の大きさにそろえる
const _ICON_PAD = 48;
const _iconViewBox = w => `${-_ICON_PAD} ${-_ICON_PAD} ${w + _ICON_PAD * 2} ${512 + _ICON_PAD * 2}`;
const icon = (name, size = 14) => {
  const [w, d] = _ICON_PATHS[name];
  return `<svg class="icon" width="${size}" height="${size}" viewBox="${_iconViewBox(w)}" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
};

// 評価の星（Font Awesome star）
const STAR_ICON = `<svg class="star-icon" viewBox="${_iconViewBox(576)}" fill="currentColor" aria-hidden="true"><path d="M309.5-18.9c-4.1-8-12.4-13.1-21.4-13.1s-17.3 5.1-21.4 13.1L193.1 125.3 33.2 150.7c-8.9 1.4-16.3 7.7-19.1 16.3s-.5 18 5.8 24.4l114.4 114.5-25.2 159.9c-1.4 8.9 2.3 17.9 9.6 23.2s16.9 6.1 25 2L288.1 417.6 432.4 491c8 4.1 17.7 3.3 25-2s11-14.2 9.6-23.2L441.7 305.9 556.1 191.4c6.4-6.4 8.6-15.8 5.8-24.4s-10.1-14.9-19.1-16.3L383 125.3 309.5-18.9z"/></svg>`;

/** <span data-icon="name" data-size="14"> を SVG に置き換える */
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    const tpl = document.createElement('template');
    tpl.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 14);
    const svg = tpl.content.firstElementChild;
    if (el.id) svg.id = el.id;              // JS が id で表示を切り替えるものがある
    if (el.style.cssText) svg.style.cssText = el.style.cssText;
    el.replaceWith(svg);
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => hydrateIcons());
else hydrateIcons();

/* ── Notion のタグ色 ──
   /notion-data の tagColors（タグ名 → Notion の色名）を入れておき、
   タグは tagHtml() で <span class="tag" data-color="blue"> として描く。色は CSS 側で Notion と同じ値。 */
let TAG_COLORS = { categories: {}, roles: {}, affiliations: {} };
const tagColor = (name, kind = 'categories') => TAG_COLORS[kind]?.[name] || 'default';
const tagHtml = (name, kind = 'categories') =>
  `<span class="tag" data-color="${esc(tagColor(name, kind))}">${esc(name)}</span>`;

/** タグ選択ボタン（Notion の色のタグ。未選択は薄く、選択中は Notion の色そのまま）。opt は Notion の { name, color } */
function tagOptionButton(opt, kind, selected, onToggle) {
  TAG_COLORS[kind][opt.name] = opt.color;   // 最新の色で上書き
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tag-option' + (selected ? ' selected' : '');
  btn.innerHTML = `<span class="tag" data-color="${esc(opt.color || 'default')}">${esc(opt.name)}</span>`;
  btn.addEventListener('click', () => btn.classList.toggle('selected', onToggle(opt.name)));
  return btn;
}

function parseCSVLine(line) {
  const res = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i+1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { res.push(cur); cur = ''; }
    else cur += c;
  }
  return [...res, cur];
}

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const hdr = parseCSVLine(lines[0]).map(h => h.replace(/^\uFEFF/, '').trim());
  return lines.slice(1).map(l => {
    const v = parseCSVLine(l), o = {};
    hdr.forEach((h, i) => o[h] = (v[i] || '').trim());
    return o;
  });
}

function xname(s) { if (!s) return null; const m = s.match(/^(.+?)\s*\(https?:/); return m ? m[1].trim() : s.trim(); }
function xnames(s) { return s ? s.split(',').map(p => xname(p.trim())).filter(Boolean) : []; }
// サーバーが配列で渡したリレーション名を優先する（「,」を含む名前が分割されないように）
function relNames(row, key) { const a = row._relNames?.[key]; return Array.isArray(a) ? a.map(xname).filter(Boolean) : xnames(row[key] || ''); }

// SNS URL からサービス名とアイコンを判定
function snsFromUrl(url) {
  if (!url || !url.startsWith('http')) return null;
  const u = url.toLowerCase();
  if (u.includes('instagram.com'))  return { icon: '📷', label: 'Instagram', url };
  if (u.includes('x.com') || u.includes('twitter.com')) return { icon: '𝕏', label: 'X', url };
  if (u.includes('youtube.com') || u.includes('youtu.be')) return { icon: '▶', label: 'YouTube', url };
  if (u.includes('tiktok.com'))     return { icon: '♪', label: 'TikTok', url };
  if (u.includes('note.com'))       return { icon: '📝', label: 'note', url };
  return { icon: '🔗', label: 'Web', url };
}
function ytid(url) { if (!url) return null; const m = url.match(/[?&]v=([^&\s]+)/) || url.match(/youtu\.be\/([^?]+)/); return m ? m[1] : null; }
function thumbUrl(url) { const id = ytid(url); return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null; }

/* ═══════════════════════════════════════════
   CREATOR META (Name / Role / SNS テーブル)
═══════════════════════════════════════════ */
// name → { role, sns } のキャッシュ（buildGraph より先に呼ぶ）
const creatorMetaMap = new Map();

function loadCreatorMeta(rows) {
  // rows は { Name, Role, SNS, Avatar?, notionPageId? } の配列
  creatorMetaMap.clear();
  rows.forEach(row => {
    const name = (row['Name'] || '').trim(); if (!name) return;
    const role          = (row['Role']          || '').trim();
    const snsRaw        = (row['SNS']            || '').trim();
    const avatar        = (row['Avatar']         || '').trim();
    const avatarType    = row['AvatarType'] || '';
    const notionPageId  = (row['notionPageId']   || '').trim();
    const aliases       = row['Aliases'] || [];
    const affiliations  = row['Affiliations'] || [];
    const sns = snsRaw ? [snsFromUrl(snsRaw)].filter(Boolean) : [];
    creatorMetaMap.set(name, { role, sns, aliases, affiliations, avatar, avatarType, notionPageId });
  });
}

function getCreatorMeta(name) {
  return creatorMetaMap.get(name) || { role: '', sns: [], aliases: [], affiliations: [], avatar: '', avatarType: '', notionPageId: '' };
}

/* ── 所属バッジ ──
   人物カードに所属（Notion のマルチセレクト）をバッジで出し、押すと同じ所属の人を強調する。
   強調中の所属は affHL に入れ、applyHL() が人物を選んでいないときに使う。 */
let affHL = null;

/** 所属バッジの HTML。カード自体がボタンのことがあるので、ボタンを入れ子にしないよう span にする */
function affBadgesHtml(affiliations, max = Infinity) {
  return (affiliations || []).slice(0, max).map(a =>
    `<span class="tag aff-badge${affHL === a ? ' active' : ''}" role="button" tabindex="0" data-aff="${esc(a)}" data-color="${esc(tagColor(a, 'affiliations'))}" title="同じ所属（${esc(a)}）の人を強調">${esc(a)}</span>`
  ).join('');
}

/** 所属の強調を切り替える（同じバッジをもう一度押すと解除） */
function toggleAffHL(aff) {
  affHL = affHL === aff ? null : aff;
  selId = null; hovId = null;
  applyHL(null, null);
}

// バッジはカード（グラフのノード・パネルの人物ボタン）の中にあるので、カードのクリックより先にキャプチャで拾って止める
function onAffBadge(e) {
  const badge = e.target.closest?.('.aff-badge');
  if (!badge) return;
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault(); e.stopPropagation();
  toggleAffHL(badge.dataset.aff);
}
document.addEventListener('click', onAffBadge, true);
document.addEventListener('keydown', onAffBadge, true);

/** 検索語（小文字）がノードの名前か別名に含まれるか。別名は表示には使わず検索だけに使う */
function nodeMatchesQuery(n, q) {
  return n.label.toLowerCase().includes(q) || (n.aliases || []).some(a => a.toLowerCase().includes(q));
}

/* ═══════════════════════════════════════════
   GRAPH BUILD
═══════════════════════════════════════════ */
function buildGraph(rows) {
  const nm = new Map(), links = [];
  // アーティストのアイコンは Artist DB のページのカバー画像（同名のクリエイターと混ざらないよう Artist DB から直接引く）
  const artistRows = new Map(ALL_ARTISTS.map(r => [(r.Name || '').trim(), r]));

  function ensure(id, type, label, extra = {}) {
    if (!nm.has(id)) {
      nm.set(id, { id, type, label, ...extra, works: [] });
    } else {
      const node = nm.get(id);
      // avatar / ytWorkUrl は空文字で上書きしない（既存値を保持）
      const merged = { ...extra };
      if (!merged.avatar)     delete merged.avatar;
      if (!merged.ytWorkUrl)  delete merged.ytWorkUrl;
      Object.assign(node, merged);
    }
    return nm.get(id);
  }

  rows.forEach((row, i) => {
    const title = (row['Title'] || '').trim(); if (!title) return;
    const url = row['URL'] || '';
    const cats = (row['Category'] || '').split(',').map(c => c.trim()).filter(Boolean);
    const th = thumbUrl(url);
    const notionPageId = (row['_notionPageId'] || '').replace(/-/g, '');
    // Notion の並び順で振ると作品が増えたときに全部ずれるため、ページ ID で振る（最新作品の追加と同じ形）
    const wid = notionPageId ? `w_${notionPageId}` : `w${i}`;
    ensure(wid, 'work', title, { url, th, cats, notionPageId });
    relNames(row, 'Director / Creator').forEach(d => {
      const did = `d_${d}`;
      const meta = getCreatorMeta(d);
      ensure(did, 'director', d, { role: meta.role, sns: meta.sns, aliases: meta.aliases || [], affiliations: meta.affiliations || [], avatar: meta.avatar, avatarType: meta.avatarType, notionPageId: meta.notionPageId || '' });
      nm.get(did).works.push(wid);
      links.push({ source: did, target: wid, ltype: 'dir' });
    });
    relNames(row, 'Artist').forEach(a => {
      const aid = `a_${a}`;
      const meta = getCreatorMeta(a);
      const existingNode = nm.get(aid);
      // ytWorkUrl: アーティストの参加作品のうち YouTube 動画 URL を持つ最初の1本を保存
      // （既に確定済みなら上書きしない）
      const artYtUrl = existingNode?.ytWorkUrl || (ytid(url) ? url : '');
      const artistRow = artistRows.get(a);
      // artistPageId: Artist DB のページ ID。notionPageId にするとクリエイター向けの編集（名前・役割・SNS）の対象になってしまうので別名にする
      ensure(aid, 'artist', a, {
        role: meta.role, sns: meta.sns, affiliations: meta.affiliations || [], ytWorkUrl: artYtUrl,
        avatar: existingNode?.avatar || artistRow?.Avatar || '', avatarType: artistRow?.AvatarType || '',
        artistPageId: artistRow?.notionPageId || '',
      });
      nm.get(aid).works.push(wid);
      links.push({ source: aid, target: wid, ltype: 'art' });
    });
  });
  return { nodes: [...nm.values()], links };
}
