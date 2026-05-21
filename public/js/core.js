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

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
let AN = [], AL = [];
let ALL_CREATORS = [];
let aFilters = new Set(), sq = '', depth2 = false;  // aFilters: 空=全表示
let searchMode = 'filter'; // 'filter' | 'navigate'
let showDir = true, showArt = true, simTimer = null, baseLinkStrength = 0.5;
let hiddenIds = new Set();
let selId = null, hovId = null;
let sim = null, gDimRect = null, draggedNode = null, connectedToDragged = new Set();
let _lpSel = null, _nSel = null; // tick ハンドラが参照する D3 セレクション
let _preSqSnapshot = null; // 検索開始直前のノード座標スナップショット

/* ═══════════════════════════════════════════
   UTILS
═══════════════════════════════════════════ */
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const lid = x => (typeof x === 'object' ? x.id : x);

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
    const notionPageId  = (row['notionPageId']   || '').trim();
    const sns = snsRaw ? [snsFromUrl(snsRaw)].filter(Boolean) : [];
    creatorMetaMap.set(name, { role, sns, avatar, notionPageId });
  });
}

function getCreatorMeta(name) {
  return creatorMetaMap.get(name) || { role: '', sns: [], avatar: '', notionPageId: '' };
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
      ensure(did, 'director', d, { role: meta.role, sns: meta.sns, avatar: meta.avatar, notionPageId: meta.notionPageId || '' });
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
