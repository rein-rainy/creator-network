/* ═══════════════════════════════════════════
   URL のプレビュー（作品を URL から追加するときの補完）
   - YouTube：youtubei.js で動画の情報（タイトル・チャンネル・説明文）。取れなければ oEmbed
   - Vimeo：oEmbed
   - それ以外：ページの OGP（og:title / og:image / og:description）と <title>
   返す形：{ url, title, thumbnail, channel, description, provider }
═══════════════════════════════════════════ */
const http = require('http');
const https = require('https');
const { fetchJson } = require('../util/fetchJson');
const { getYoutubeClient } = require('./youtube');

const previewCache = new Map();   // 正規化した URL → 結果
const HTML_MAX_BYTES = 1.5 * 1024 * 1024;

/** YouTube の動画 ID（watch / youtu.be / shorts / embed / live / music） */
function youtubeId(u) {
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,})/);
  return m ? m[1] : null;
}

/** 社内ネットワークなどへ問い合わせさせない（http/https の公開ホストだけ） */
function assertPublicUrl(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('http か https の URL を入れてください');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('この URL は読み込めません');
  }
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) throw new Error('この URL は読み込めません');
  }
  if (host.startsWith('[')) throw new Error('この URL は読み込めません');
}

async function youtubePreview(id) {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const thumbnail = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  try {
    const yt = await getYoutubeClient();
    if (yt) {
      const { basic_info: info } = await yt.getBasicInfo(id);
      if (info?.title) {
        return {
          url, thumbnail, provider: 'YouTube',
          title: info.title,
          channel: info.author ? { name: info.author, id: info.channel_id || '' } : null,
          description: info.short_description || '',
        };
      }
    }
  } catch (error) {
    console.warn('[UrlPreview] youtubei.js 失敗、oEmbed で取り直す:', error.message);
  }
  const o = await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { label: 'YouTube oEmbed' });
  return {
    url, thumbnail, provider: 'YouTube',
    title: o.title || '',
    channel: o.author_name ? { name: o.author_name, id: '' } : null,
    description: '',
  };
}

async function vimeoPreview(url) {
  const o = await fetchJson(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`, { label: 'Vimeo oEmbed' });
  return {
    url, provider: 'Vimeo',
    title: o.title || '',
    thumbnail: o.thumbnail_url || '',
    channel: o.author_name ? { name: o.author_name, id: '' } : null,
    description: o.description || '',
  };
}

/** HTML を取ってくる（リダイレクトは 3 回まで、1.5MB まで） */
function fetchHtml(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    assertPublicUrl(u);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(u, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CreatorNetwork/1.0)', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'ja,en;q=0.8' },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('リダイレクトが多すぎます'));
        return resolve(fetchHtml(new URL(res.headers.location, u).href, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`ページを読み込めませんでした（${res.statusCode}）`)); }
      let size = 0; const chunks = [];
      res.on('data', chunk => {
        size += chunk.length;
        if (size > HTML_MAX_BYTES) { req.destroy(); return; }
        chunks.push(chunk);
      });
      res.on('close', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), finalUrl: u.href }));
      res.on('error', reject);
    });
    req.setTimeout(8000, () => req.destroy(new Error('ページの読み込みがタイムアウトしました')));
    req.on('error', reject);
  });
}

function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** <meta property|name="key" content="..."> を順不同で拾う */
function metaContent(html, keys) {
  for (const key of keys) {
    const re = new RegExp(`<meta\\b[^>]*(?:property|name)=["']${key}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    const content = tag?.match(/\bcontent=["']([^"']*)["']/i)?.[1];
    if (content) return decodeEntities(content.trim());
  }
  return '';
}

async function pagePreview(url) {
  const { html, finalUrl } = await fetchHtml(url);
  const title = metaContent(html, ['og:title', 'twitter:title'])
    || decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || '');
  const image = metaContent(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']);
  const siteName = metaContent(html, ['og:site_name']);
  return {
    url: finalUrl, provider: siteName || new URL(finalUrl).hostname.replace(/^www\./, ''),
    title,
    thumbnail: image ? new URL(image, finalUrl).href : '',
    channel: null,
    description: metaContent(html, ['og:description', 'description', 'twitter:description']),
  };
}

async function getUrlPreview(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '').trim()); } catch { throw new Error('URL の形が正しくありません'); }
  assertPublicUrl(u);

  const ytId = youtubeId(u);
  const key = ytId ? `yt:${ytId}` : u.href;
  if (previewCache.has(key)) return previewCache.get(key);

  let preview;
  if (ytId) preview = await youtubePreview(ytId);
  else if (/(^|\.)vimeo\.com$/.test(u.hostname)) preview = await vimeoPreview(u.href);
  else preview = await pagePreview(u.href);

  if (!preview.title) throw new Error('タイトルを取得できませんでした');
  previewCache.set(key, preview);
  return preview;
}

module.exports = { getUrlPreview, youtubeId };
