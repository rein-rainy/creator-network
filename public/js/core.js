'use strict';

/* ═══════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════ */
const CW = 158, CH = 148;
const DR = 30, AR = 22;
// person card node サイズ
const PNW = 200, PNH = 68; // director card width/height
const ANW = 200, ANH = 56; // artist card width/height
const HIDDEN_KEY = 'creator_network_hidden_labels';
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
let hiddenIds = new Set();
let selId = null, hovId = null;
let sim = null, gDimRect = null, draggedNode = null, connectedToDragged = new Set();
let _lpSel = null, _nSel = null; // tick ハンドラが参照する D3 セレクション
let _preSqSnapshot = null; // 検索開始直前のノード座標スナップショット
let _preSqTransform = null; // 検索開始直前の表示位置（ズーム・パン）
let _zoomBehavior = null;  // draw() が #canvas に付けた d3.zoom（表示位置の変更はこれ経由で行う）

/* ═══════════════════════════════════════════
   UTILS
═══════════════════════════════════════════ */
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const lid = x => (typeof x === 'object' ? x.id : x);

// アイコンはすべて Lucide (https://lucide.dev, stroke 2 / 24px グリッド) に統一する。
// 文字や絵文字をアイコン代わりに使わない。HTML 側は <span data-icon="name"></span> で埋め込む。
const _ICON_PATHS = {
  x:              '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus:           '<path d="M5 12h14"/><path d="M12 5v14"/>',
  check:          '<path d="M20 6 9 17l-5-5"/>',
  search:         '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'zoom-in':      '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
  'list-filter':  '<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>',
  funnel:         '<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>',
  'layout-grid':  '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  contrast:       '<circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/>',
  'eye-off':      '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  video:          '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  calendar:       '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  'external-link':'<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'rotate-cw':    '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  'undo-2':       '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  film:           '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  link:           '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  play:           '<polygon points="6 3 20 12 6 21 6 3"/>',
  route:          '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  shuffle:        '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-7.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>',
  'arrow-left-right': '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  'arrow-right-to-line': '<path d="M17 12H3"/><path d="m11 18 6-6-6-6"/><path d="M21 5v14"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right':'<path d="m9 18 6-6-6-6"/>',
  pencil:         '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
};
const icon = (name, size = 14) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_ICON_PATHS[name]}</svg>`;

// 評価の星（Lucide star を塗りつぶし）
const STAR_ICON = '<svg class="star-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>';

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
let TAG_COLORS = { categories: {}, roles: {} };
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
    const sns = snsRaw ? [snsFromUrl(snsRaw)].filter(Boolean) : [];
    creatorMetaMap.set(name, { role, sns, avatar, avatarType, notionPageId });
  });
}

function getCreatorMeta(name) {
  return creatorMetaMap.get(name) || { role: '', sns: [], avatar: '', avatarType: '', notionPageId: '' };
}

/* ═══════════════════════════════════════════
   GRAPH BUILD
═══════════════════════════════════════════ */
function buildGraph(rows) {
  const nm = new Map(), links = [];

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
    const wid = `w${i}`;
    const notionPageId = (row['_notionPageId'] || '').replace(/-/g, '');
    ensure(wid, 'work', title, { url, th, cats, notionPageId });
    xnames(row['Director / Creator'] || '').forEach(d => {
      const did = `d_${d}`;
      const meta = getCreatorMeta(d);
      ensure(did, 'director', d, { role: meta.role, sns: meta.sns, avatar: meta.avatar, avatarType: meta.avatarType, notionPageId: meta.notionPageId || '' });
      nm.get(did).works.push(wid);
      links.push({ source: did, target: wid, ltype: 'dir' });
    });
    xnames(row['Artist'] || '').forEach(a => {
      const aid = `a_${a}`;
      const meta = getCreatorMeta(a);
      const existingNode = nm.get(aid);
      // ytWorkUrl: アーティストの参加作品のうち YouTube 動画 URL を持つ最初の1本を保存
      // （既に確定済みなら上書きしない）
      const artYtUrl = existingNode?.ytWorkUrl || (ytid(url) ? url : '');
      ensure(aid, 'artist', a, { role: meta.role, sns: meta.sns, avatar: existingNode?.avatar || '', ytWorkUrl: artYtUrl });
      nm.get(aid).works.push(wid);
      links.push({ source: aid, target: wid, ltype: 'art' });
    });
  });
  return { nodes: [...nm.values()], links };
}
