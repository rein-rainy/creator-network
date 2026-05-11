/**
 * Creator Network — ローカルサーバー
 * 起動: node server.js
 * アクセス: http://localhost:3000
 */
require('dotenv').config();

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const https = require('https');
// child_process は YouTube.js 移行後不要

const PORT              = process.env.PORT || 3000;
const NOTION_TOKEN      = process.env.NOTION_TOKEN;
const DEEPL_API_KEY     = process.env.DEEPL_API_KEY;
const YOUTUBE_API_KEY   = process.env.YOUTUBE_API_KEY;
const RAPIDAPI_KEY      = process.env.RAPIDAPI_KEY;
const DB_WORKS       = '18860905b37f80358899e51e4e514f92'; // メイン（作品）
const DB_CREATORS    = '18860905b37f8093954fdb1bb9602c18'; // クリエイター (Director / Creator)
const DB_ARTISTS     = '2d260905b37f80fbae0de6cb61a03091'; // アーティスト (Artist)

// Check if we're running on Heroku
const IS_HEROKU = !!process.env.DYNO;
const isProduction = process.env.NODE_ENV === 'production' || IS_HEROKU;

const HTML_FILE      = path.join(__dirname, 'creator-network.html');

// ⚠️ NOTION_TOKEN は起動時には必須ではなく、エンドポイント呼び出し時に確認される
// これにより Heroku でアプリが起動に失敗することを回避
if (!NOTION_TOKEN) {
  console.warn('[Warning] 環境変数 NOTION_TOKEN が設定されていません。');
  console.warn('[Warning] /notion-* エンドポイントは動作しません。');
  if (!isProduction) {
    console.warn('[Info] ローカル開発の場合: NOTION_TOKEN=your_token node server.js');
  }
}

function imdbSuggestionUrl(query) {
  const encoded = encodeURIComponent(query).replace(/%20/g, '_');
  const first = (encoded[0] || 'x').toLowerCase();
  const bucket = /^[a-z0-9]$/.test(first) ? first : 'x';
  return `https://v3.sg.media-imdb.com/suggestion/${bucket}/${encoded}.json`;
}

const youtubeVideoCache = new Map();

// ─── Notion API リクエスト ────────────────────────────────────────────────────
function notionRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.notion.com',
      path: apiPath,
      method,
      headers: {
        'Authorization':  `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(postData || ''),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// ─── DBを全件取得 → { pageId: titleString } のMapを返す ──────────────────────
async function fetchPersonDB(dbId, label) {
  const map     = {};
  const persons = [];
  let cursor  = undefined;
  let hasMore = true;
  let total   = 0;

  while (hasMore) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const r = await notionRequest('POST', `/v1/databases/${dbId}/query`, body);
    if (r.status !== 200) throw new Error(`${label} DB取得失敗: ${r.status}`);

    for (const page of r.body.results) {
      const props = page.properties;

      // Name（titleプロパティを自動検出）
      let name = '';
      for (const prop of Object.values(props)) {
        if (prop.type === 'title' && prop.title?.length) {
          name = prop.title.map(t => t.plain_text).join('');
          break;
        }
      }
      if (!name) name = page.id;
      map[page.id] = name;

      // Role（select / rich_text / multi_select に対応）
      const roleProp = props['Role'] ?? props['役職'];
      let role = '';
      if (roleProp?.type === 'select')           role = roleProp.select?.name ?? '';
      else if (roleProp?.type === 'rich_text')   role = roleProp.rich_text.map(t => t.plain_text).join('');
      else if (roleProp?.type === 'multi_select') role = roleProp.multi_select.map(s => s.name).join(', ');

      // SNS（url / rich_text に対応）
      const snsProp = props['SNS'] ?? props['sns'];
      let sns = '';
      if (snsProp?.type === 'url')             sns = snsProp.url ?? '';
      else if (snsProp?.type === 'rich_text')  sns = snsProp.rich_text.map(t => t.plain_text).join('');

      // カバー画像はアバターとして使用しない（Instagram プロフィール画像を優先）
      persons.push({ Name: name, Role: role, SNS: sns, Avatar: '', notionPageId: page.id });
    }

    hasMore = r.body.has_more;
    cursor  = r.body.next_cursor;
    total  += r.body.results.length;
  }

  console.log(`  [${label}] ${total} 件`);
  return { map, persons };
}

// ─── 作品DBを全件取得 ─────────────────────────────────────────────────────────
async function fetchWorks() {
  const results = [];
  let cursor  = undefined;
  let hasMore = true;

  while (hasMore) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const r = await notionRequest('POST', `/v1/databases/${DB_WORKS}/query`, body);
    if (r.status !== 200) throw new Error(`作品DB取得失敗: ${r.status}`);

    results.push(...r.body.results);
    hasMore = r.body.has_more;
    cursor  = r.body.next_cursor;
  }

  console.log(`  [作品] ${results.length} 件`);
  return results;
}

// ─── プロパティ値を文字列に変換 ───────────────────────────────────────────────
function extractValue(prop, creatorMap, artistMap) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':        return prop.title.map(t => t.plain_text).join('');
    case 'rich_text':    return prop.rich_text.map(t => t.plain_text).join('');
    case 'number':       return prop.number ?? '';
    case 'select':       return prop.select?.name ?? '';
    case 'multi_select': return prop.multi_select.map(s => s.name).join(', ');
    case 'date':         return prop.date?.start ?? '';
    case 'checkbox':     return prop.checkbox ? 'TRUE' : 'FALSE';
    case 'url':          return prop.url ?? '';
    case 'email':        return prop.email ?? '';
    case 'phone_number': return prop.phone_number ?? '';
    case 'formula':      return prop.formula?.string ?? String(prop.formula?.number ?? '');
    case 'people':       return prop.people.map(p => p.name ?? '').join(', ');
    case 'files':        return prop.files.map(f => f.name).join(', ');
    case 'status':       return prop.status?.name ?? '';
    case 'relation':
      // creatorMap → artistMap → IDの順で名前を解決
      return prop.relation
        .map(r => creatorMap[r.id] ?? artistMap[r.id] ?? r.id)
        .join(', ');
    case 'rollup': {
      const ru = prop.rollup;
      if (ru?.type === 'array') return ru.array.map(i => extractValue(i, creatorMap, artistMap)).join(', ');
      if (ru?.type === 'number') return String(ru.number ?? '');
      return '';
    }
    default: return '';
  }
}

// ─── クリエイターリレーションのプロパティ名を取得 ────────────────────────────
async function getCreatorRelPropName() {
  console.log('[Notion] リレーションプロパティ名を自動検出中...');
  const r = await notionRequest('GET', `/v1/databases/${DB_WORKS}`);
  if (r.status !== 200) return null;
  const creatorDbIdNorm = DB_CREATORS.replace(/-/g, '').toLowerCase();
  for (const [name, prop] of Object.entries(r.body.properties)) {
    if (prop.type === 'relation' && prop.relation?.database_id) {
      const relDbId = prop.relation.database_id.replace(/-/g, '').toLowerCase();
      if (relDbId === creatorDbIdNorm) {
        console.log(`[Notion] 検出完了: "${name}"`);
        return name;
      }
    }
  }
  return null;
}

// ─── メイン処理 ───────────────────────────────────────────────────────────────
async function buildData(targetDb = 'all') {
  let works = [];
  let creatorResult = { map: {}, persons: [] };
  let artistResult = { map: {}, persons: [] };

  if (targetDb === 'creators') {
    console.log('[Notion] Creator DBのみ取得中...');
    creatorResult = await fetchPersonDB(DB_CREATORS, 'Creator');
  } else {
    console.log('[Notion] 3つのDBを並列取得中...');
    [works, creatorResult, artistResult] = await Promise.all([
      fetchWorks(),
      fetchPersonDB(DB_CREATORS, 'Creator'),
      fetchPersonDB(DB_ARTISTS,  'Artist'),
    ]);
  }
  const creatorMap = creatorResult.map; // creators のみの場合も空ではない
  const artistMap  = artistResult.map;   // creators のみの場合も空ではない
  const creators   = creatorResult.persons;
  const artists    = artistResult.persons;

  // キー一覧（列順保持）
  const keySet = new Set();
  works.forEach(p => Object.keys(p.properties).forEach(k => keySet.add(k)));
  const keys = [...keySet];

  // クリエイターリレーションのプロパティ名を特定
  let creatorRelProp = 'Director / Creator'; // デフォルト値
  if (targetDb !== 'creators') { // creators のみ取得時は作品データがないためスキップ
    // 一度全プロパティを見て、リレーション先がクリエイターDBのものを探す
    if (works.length > 0) {
      const firstPage = works[0];
      for (const [name, prop] of Object.entries(firstPage.properties)) {
        if (prop.type === 'relation') {
          // prop.relation は現在の値の配列だが、database_id はここにはない
          // なので名前ベース、もしくは適当な ID が creatorMap にあるかで判断する
          const hasCreatorId = prop.relation.some(r => creatorMap[r.id]);
          if (hasCreatorId) { creatorRelProp = name; break; }
        }
      }
    }
    // 見つからなかった場合は明示的にDBスキーマから取得
    if (creatorRelProp === 'Director / Creator') { // デフォルト値のままなら検出を試みる
      creatorRelProp = await getCreatorRelPropName() || 'Director / Creator';
    }
  }

  // 行データに変換
  const rows = works.map(page => {
    const row = {};
    keys.forEach(k => { // works が空の場合はこのループは実行されない
      row[k] = extractValue(page.properties[k], creatorMap, artistMap);
    });
    row['_notionPageId'] = page.id; // Notionページへのリンク用
    
    // 現在紐づいているクリエイターID配列を保持
    const relProp = page.properties[creatorRelProp];
    row['_creatorRelIds'] = (relProp?.type === 'relation') ? relProp.relation.map(r => r.id) : [];
    row['_creatorRelPropName'] = creatorRelProp;

    return row;
  });

  console.log(`[Notion] 完了 — 作品 ${rows.length} 件 / Creator ${creators.length} 件 / Artist ${artists.length} 件`);
  return { rows, creators, artists, count: rows.length };
}


// ─── Instagram プロフィール画像取得 ──────────────────────────────────────────
//
// RapidAPI (instagram120.p.rapidapi.com) を使用してプロフィール画像URLを取得する。
// 環境変数 RAPIDAPI_KEY が必要。
//
// メモリキャッシュ（igAvatarCache）で同一ユーザーの重複リクエストを防止。
// キャッシュには { profilePicUrl, expireAt } を格納し、1時間で無効化。

const IG_CACHE_TTL_MS = 60 * 60 * 1000; // 1時間
const igAvatarCache   = new Map();        // username → { profilePicUrl, expireAt }

// Instagram URL → username を抽出
// 例: https://www.instagram.com/youngji_02/ → "youngji_02"
function extractIgUsername(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('instagram.com')) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[0] || null;
  } catch {
    return null;
  }
}

// ユーザー名 → プロフィール画像URLを取得（RapidAPI経由・メモリキャッシュ付き）
async function fetchIgProfilePic(username) {
  if (!username) return null;

  // キャッシュチェック
  const cached = igAvatarCache.get(username);
  if (cached && Date.now() < cached.expireAt) {
    console.log(`[IG] "${username}": キャッシュヒット`);
    return cached.profilePicUrl;
  }

  if (!RAPIDAPI_KEY) {
    console.warn('[IG] RAPIDAPI_KEY が未設定のためスキップ');
    return null;
  }

  return new Promise((resolve) => {
    const postData = JSON.stringify({ username });
    const options = {
      hostname: 'instagram120.p.rapidapi.com',
      path:     '/api/instagram/profile',
      method:   'POST',
      headers: {
        'Content-Type':    'application/json',
        'Content-Length':  Buffer.byteLength(postData),
        'x-rapidapi-host': 'instagram120.p.rapidapi.com',
        'x-rapidapi-key':  RAPIDAPI_KEY,
      },
    };

    const req = https.request(options, (igRes) => {
      let data = '';
      igRes.on('data', c => data += c);
      igRes.on('end', () => {
        try {
          if (igRes.statusCode !== 200) {
            console.warn(`[IG] "${username}": HTTP ${igRes.statusCode}`);
            return resolve(null);
          }
          const json = JSON.parse(data);
          const user = json?.result;
          if (!user) {
            console.warn(`[IG] "${username}": ユーザーが見つかりません`);
            return resolve(null);
          }
          // HD画像を優先し、なければ通常画像を使用
          const profilePicUrl = user.profile_pic_url_hd || user.profile_pic_url || null;
          console.log(`[IG] "${username}": 取得成功 → ${profilePicUrl}`);

          // キャッシュに保存
          igAvatarCache.set(username, { profilePicUrl, expireAt: Date.now() + IG_CACHE_TTL_MS });
          resolve(profilePicUrl);
        } catch (e) {
          console.warn(`[IG] "${username}": レスポンス解析失敗: ${e.message}`);
          resolve(null);
        }
      });
    });
    req.on('error', (e) => {
      console.warn(`[IG] "${username}": リクエストエラー: ${e.message}`);
      resolve(null);
    });
    req.write(postData);
    req.end();
  });
}
// ─── Spotify API (RapidAPI) でアーティスト名からアバター画像URLを取得 ─────────
//
// フロー:
//   1. Spotify Search API (RapidAPI) でアーティストを検索し、
//      最初に見つかったアーティストの画像URLを返す。

const SPOTIFY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24時間
const spotifyAvatarCache   = new Map();         // artistName -> { imageUrl, artistName, expireAt }

async function searchArtistImage(artistName, workTitles = []) {
  // キャッシュチェック
  const cached = spotifyAvatarCache.get(artistName);
  if (cached && Date.now() < cached.expireAt) {
    console.log(`[Spotify] "${artistName}": キャッシュヒット`);
    return { imageUrl: cached.imageUrl, artistName: cached.artistName };
  }

  return new Promise((resolve) => {
    const options = {
      hostname: 'spotify23.p.rapidapi.com',
      path: `/search/?q=${encodeURIComponent(artistName)}&type=artists&offset=0&limit=1`,
      method: 'GET',
      headers: {
        'x-rapidapi-host': 'spotify23.p.rapidapi.com',
        'x-rapidapi-key':  RAPIDAPI_KEY,
      },
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', async () => {
        try {
          const json = JSON.parse(data);
          const artistData = json.artists?.items?.[0]?.data;
          if (!artistData) {
            console.warn(`[Spotify] "${artistName}" が見つかりませんでした`);
            return resolve(null);
          }
          const imageUrl = artistData.visuals?.avatarImage?.sources?.[0]?.url;
          const nameInApi = artistData.profile?.name || artistName;
          if (imageUrl) {
            console.log(`[Spotify] "${artistName}" 取得成功 → ${imageUrl}`);
            spotifyAvatarCache.set(artistName, {
              imageUrl,
              artistName: nameInApi,
              expireAt: Date.now() + SPOTIFY_CACHE_TTL_MS
            });
            return resolve({ imageUrl, artistName: nameInApi });
          }
          console.warn(`[Spotify] "${artistName}" 画像が見つかりませんでした`);
          resolve(null);
        } catch (e) {
          console.warn(`[Spotify] "${artistName}" レスポンス解析失敗: ${e.message}`);
          resolve(null);
        }
      });
    }).on('error', (e) => {
      console.warn(`[Spotify] "${artistName}" リクエストエラー: ${e.message}`);
      resolve(null);
    });
  });
}

// 画像URLをプロキシして返す（CORS回避）
function proxyImage(imageUrl, res) {
  try {
    const parsed = new URL(imageUrl);
    https.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET' },
      (upstream) => {
        if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
          proxyImage(upstream.headers.location, res);
          return;
        }
        res.writeHead(upstream.statusCode === 200 ? 200 : upstream.statusCode, {
          'Content-Type': upstream.headers['content-type'] || 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
        });
        upstream.pipe(res);
      }
    ).on('error', (e) => {
      console.error('[Img] プロキシエラー:', e.message);
      res.writeHead(502); res.end();
    }).end();
  } catch (e) {
    console.error('[Img] URL解析エラー:', e.message);
    res.writeHead(400); res.end();
  }
}

// ─── HTTPサーバー ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ─── /avatar : アーティスト名 → Spotify画像URL を返す ───────────────────────
  // リクエスト body: { artistName: string, workTitles?: string[] }
  // レスポンス:     { imageUrl, artistName }
  if (req.method === 'POST' && req.url === '/avatar') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { artistName, workTitles = [] } = JSON.parse(body);
        if (!artistName) throw new Error('artistName が指定されていません');

        const result = await searchArtistImage(artistName, workTitles);
        if (!result || !result.imageUrl) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `"${artistName}" の画像が見つかりませんでした` }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error('[Avatar Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /avatar-batch : 複数アーティストを並列で一括取得 ────────────────────────
  // リクエスト body: { artists: [{ artistName: string, workTitles?: string[] }] }
  // レスポンス:     { results: { [artistName]: { imageUrl, artistName } | null } }
  if (req.method === 'POST' && req.url === '/avatar-batch') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { artists = [] } = JSON.parse(body);
        if (!artists.length) throw new Error('artists が空です');

        const CONCURRENCY = 5;  // 同時リクエスト数
        const DELAY_MS    = 100; // 各リクエスト間の待機時間(ms)
        console.log(`[Batch] ${artists.length}件を並列${CONCURRENCY}で取得開始`);

        const results = {};
        for (let i = 0; i < artists.length; i += CONCURRENCY) {
          const chunk = artists.slice(i, i + CONCURRENCY);
          const settled = await Promise.all(
            chunk.map(({ artistName, workTitles = [] }) =>
              searchArtistImage(artistName, workTitles)
                .then(r => ({ artistName, result: r }))
                .catch(() => ({ artistName, result: null }))
            )
          );
          settled.forEach(({ artistName, result }) => { results[artistName] = result; });
          if (i + CONCURRENCY < artists.length) {
            await new Promise(r => setTimeout(r, DELAY_MS));
          }
        }

        const successCount = Object.values(results).filter(Boolean).length;
        console.log(`[Batch] 完了 — 取得成功: ${successCount}/${artists.length}件`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch (e) {
        console.error('[Batch Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /avatar-img/ : 画像をプロキシして返す ───────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/avatar-img/')) {
    const encoded = req.url.slice('/avatar-img/'.length).split('?')[0];
    if (!encoded) { res.writeHead(400); res.end('imageUrl required'); return; }

    let imageUrl;
    try {
      imageUrl = Buffer.from(encoded, 'base64').toString('utf-8');
      new URL(imageUrl); // 妥当性チェック
    } catch {
      res.writeHead(400); res.end('invalid imageUrl'); return;
    }

    proxyImage(imageUrl, res);
    return;
  }

  // ─── /ig-avatar : Instagram URL → プロフィール画像URL を返す ─────────────────
  // リクエスト body: { instagramUrl: string }  または  { username: string }
  // レスポンス:     { proxyUrl: string }  ← /avatar-img/<base64> 形式
  if (req.method === 'POST' && req.url === '/ig-avatar') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { instagramUrl, username: rawUsername } = JSON.parse(body);

        // URL または直接 username のどちらでも受け付ける
        const username = rawUsername || extractIgUsername(instagramUrl);
        if (!username) throw new Error('有効な Instagram URL または username が必要です');

        const profilePicUrl = await fetchIgProfilePic(username);
        if (!profilePicUrl) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `"${username}" のプロフィール画像が見つかりませんでした` }));
          return;
        }

        // フロントエンドが /avatar-img/<base64> 形式でプロキシ経由で取得できるようURLを返す
        const proxyUrl = `/avatar-img/${Buffer.from(profilePicUrl).toString('base64')}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ proxyUrl, profilePicUrl, username }));
      } catch (e) {
        console.error('[IG Avatar Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /ig-avatar-batch : 複数の Instagram URL を一括取得 ──────────────────────
  // リクエスト body: { items: [{ notionPageId, instagramUrl }] }
  // レスポンス:     { results: { notionPageId → { proxyUrl } | null } }
  if (req.method === 'POST' && req.url === '/ig-avatar-batch') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { items = [] } = JSON.parse(body);
        if (!items.length) throw new Error('items が空です');

        const CONCURRENCY = 3; // Instagram はレート制限が厳しいため低めに設定
        const DELAY_MS    = 300;
        console.log(`[IG Batch] ${items.length}件を並列${CONCURRENCY}で取得開始`);

        const results = {};
        for (let i = 0; i < items.length; i += CONCURRENCY) {
          const chunk = items.slice(i, i + CONCURRENCY);
          const settled = await Promise.all(
            chunk.map(async ({ notionPageId, instagramUrl }) => {
              const username = extractIgUsername(instagramUrl);
              if (!username) return { notionPageId, result: null };
              const profilePicUrl = await fetchIgProfilePic(username).catch(() => null);
              if (!profilePicUrl) return { notionPageId, result: null };
              const proxyUrl = `/avatar-img/${Buffer.from(profilePicUrl).toString('base64')}`;
              return { notionPageId, result: { proxyUrl, profilePicUrl, username } };
            })
          );
          settled.forEach(({ notionPageId, result }) => { results[notionPageId] = result; });
          if (i + CONCURRENCY < items.length) {
            await new Promise(r => setTimeout(r, DELAY_MS));
          }
        }

        const successCount = Object.values(results).filter(Boolean).length;
        console.log(`[IG Batch] 完了 — 取得成功: ${successCount}/${items.length}件`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch (e) {
        console.error('[IG Batch Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /imdb-img/ : IMDb画像をプロキシして返す（/avatar-img/ と同じ実装） ────────
  if (req.method === 'GET' && req.url.startsWith('/imdb-img/')) {
    const encoded = req.url.slice('/imdb-img/'.length).split('?')[0];
    if (!encoded) { res.writeHead(400); res.end('imageUrl required'); return; }

    let imageUrl;
    try {
      imageUrl = Buffer.from(encoded, 'base64').toString('utf-8');
      new URL(imageUrl); // 妥当性チェック
    } catch {
      res.writeHead(400); res.end('invalid imageUrl'); return;
    }

    proxyImage(imageUrl, res);
    return;
  }

  // ─── /youtube-video-search : YouTube.js でタイトル検索 → 動画情報取得 ──────
  // リクエスト body: { titles: string[] }
  // レスポンス:     { results: { [title]: { url, thumbnail, title } | null } }
  //
  // 最適化ポイント:
  //   - youtubei.js (YouTube.js) を使用（yt-dlp プロセス起動コスト不要）
  //   - CONCURRENCY=5: 同時リクエスト数を制限してレート制限を回避
  //   - 結果はタイトル順で先頭1件ずつキャッシュ・マッピング
  //
  // セットアップ: npm install youtubei.js
  if (req.method === 'POST' && req.url === '/youtube-video-search') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { titles = [] } = JSON.parse(body);
        const uniqueTitles = [...new Set(titles.map(t => String(t || '').trim()).filter(Boolean))].slice(0, 100);
        const startTime = Date.now();

        // キャッシュ済みを除外
        const uncached = uniqueTitles.filter(t => !youtubeVideoCache.has(t));
        const results = {};
        uniqueTitles.forEach(t => {
          if (youtubeVideoCache.has(t)) results[t] = youtubeVideoCache.get(t);
        });

        console.log(`[YouTube.js] 全体開始 titles=${uniqueTitles.length} (キャッシュ済み=${uniqueTitles.length - uncached.length} 未取得=${uncached.length})`);

        // YouTube.js を遅延ロード（初回のみInnerTubeクライアントを初期化）
        // generate_session_locally: true でYouTubeへの初期リクエストを回避。
        // これにより Heroku など外向きリクエストが制限される環境でも初期化できる。
        // client_version を手動指定すると api_version が null になり
        // /youtubei/vnull/search という不正URLが生成されるため指定しない。
        if (!global._ytInitPromise) {
          global._ytInitPromise = (async () => {
            try {
              const { Innertube } = await import('youtubei.js');
              const client = await Innertube.create({
                generate_session_locally: true, // ネットワーク不要でセッション生成
                retrieve_player: false,
              });
              console.log('[YouTube.js] Innertube クライアント初期化完了');
              return client;
            } catch (initError) {
              console.error('[YouTube.js] クライアント初期化失敗:', initError.message);
              return null;
            }
          })();
        }
        const yt = await global._ytInitPromise;
        // 初期化に失敗していた場合は次回リクエスト時に再試行できるようリセット
        if (!yt) global._ytInitPromise = null;

        // YouTube検索が利用可能か確認
        if (!yt) {
          console.warn('[YouTube.js] YouTube API が初期化されていません。キャッシュを返します。');
          const totalDuration = Date.now() - startTime;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ results, warning: 'YouTube API unavailable' }));
          return;
        }

        // 1タイトルを検索して先頭1件の動画情報を返す
        async function ytJsSearch(title) {
          const t0 = Date.now();
          try {
            if (!yt) {
              console.warn(`[YouTube.js] "${title}" yt クライアント未初期化`);
              return null;
            }

            const searchResults = await yt.search(title, { type: 'video' });
            const duration = Date.now() - t0;
            console.log(`[YouTube.js] "${title}" 実行時間: ${duration}ms`);

            const videos = searchResults.videos ?? [];
            const video = videos[0] ?? null;
            if (!video || !video.id) return null;

            const thumbnail = video.best_thumbnail?.url
              ?? video.thumbnails?.[0]?.url
              ?? `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`;

            return {
              url: `https://www.youtube.com/watch?v=${video.id}`,
              thumbnail,
              title: video.title?.text ?? title,
            };
          } catch (e) {
            const duration = Date.now() - t0;
            // 詳細なエラー情報をログ出力
            const errorMsg = e.message || String(e);
            const errorStatus = e.status || 'unknown';
            console.warn(`[YouTube.js] "${title}" 検索失敗 (${duration}ms): ${errorMsg} (status: ${errorStatus})`);
            return null;
          }
        }

        // CONCURRENCY=5: 同時リクエスト数を制限しながら並列処理
        const CONCURRENCY = 5;
        const DELAY_MS    = 100; // 各チャンク間の待機時間(ms)

        for (let i = 0; i < uncached.length; i += CONCURRENCY) {
          const chunk = uncached.slice(i, i + CONCURRENCY);
          const chunkResults = await Promise.all(chunk.map(t => ytJsSearch(t)));
          chunkResults.forEach((result, j) => {
            const title = chunk[j];
            youtubeVideoCache.set(title, result);
            results[title] = result;
          });
          if (i + CONCURRENCY < uncached.length) {
            await new Promise(r => setTimeout(r, DELAY_MS));
          }
        }

        const totalDuration = Date.now() - startTime;
        const successCount = Object.values(results).filter(Boolean).length;
        console.log(`[YouTube.js] 全体完了: ${totalDuration}ms (成功=${successCount}/${uniqueTitles.length})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch (e) {
        console.error('[YouTube.js Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /imdb-search : タイトル → IMDB musicVideo tt ID を取得 ─────────────────
  // リクエスト body: { title: string }
  // レスポンス:     { tt, title, year, image } | { notFound: true } | { error }
  if (req.method === 'POST' && req.url === '/imdb-search') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { title } = JSON.parse(body);
        if (!title) throw new Error('title が指定されていません');

        // ── クエリ候補を生成 ──────────────────────────────────────────────
        // 例: "ILLIT (아일릿) 'It's Me' Official MV"
        //   → ["It's Me", "ILLIT It's Me", "ILLIT (아일릿) 'It's Me' Official MV"]
        function normalizeTitle(raw) {
          return raw
            // 1) 異体字クォート・ダッシュを正規化
            .replace(/[‘’`´]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/[‐‑‒–—―]/g, '-')
            .replace(/\s*[|｜]\s*/g, ' - ')  // 縦棒をダッシュ区切りに統一
            .replace(/[・･]/g, ' ')
            .replace(/　/g, ' ')
            // 2) 韓国語のみ削除（日本語・漢字は残す）
            .replace(/[가-힣ᄀ-ᇿ㄰-㆏]/g, "")
            // 3) 空括弧を削除
            .replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '')
            // 4) 不要語削除（長いフレーズから順に）
            .replace(/\b(official\s+music\s+video|music\s+video|official\s+video|official\s+mv|official\s+m\/v|official\s+audio|official\s+lyric\s+video|official\s+performance\s+video)\b/gi, '')
            .replace(/\b(lyric\s+video|lyrics\s+video|lyric\s+ver\.?|performance\s+video|dance\s+video|dance\s+ver\.?|dance\s+practice|dance\s+challenge|dance\s+film)\b/gi, '')
            .replace(/\b(visualizer|audio\s+only|full\s+ver\.?|short\s+ver\.?|inst\.?|instrumental|karaoke|acapella|a\s+cappella)\b/gi, '')
            .replace(/\b(official|m\/v|mv|m\.v\.|video|audio|lyric|lyrics|teaser|highlight|preview|trailer|comeback|debut)\b/gi, '')
            .replace(/\b(feat\.?|ft\.?|prod\.?|produced\s+by|dir\.?|directed\s+by|choreography\s+by|choreo\.?\s+by)\b/gi, '')
            .replace(/\b(hd|4k|fhd|1080p|720p|remastered|remaster|ver\.?|version|edit|remix|mix|extended|radio\s+edit)\b/gi, '')
            .replace(/\b(ep\.?|album|single|ost|bgm)\b/gi, '')
            // 5) 末尾の記号・区切り文字を整理
            .replace(/[\s\-:_]+$/, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        }

        function buildQueries(raw) {
          const queries = new Set();
          const norm = normalizeTitle(raw);

          // A) クォート内テキストを抽出（最優先：曲タイトルそのもの）
          //    縮約形アポストロフィ（It's, Don't 等）はクォートと区別して内部に許容する
          const extractQuoted = (str) => {
            const out = [];
            // “…” ・ ‘…’ の対応ペア
            for (const m of str.matchAll(/‘([^‘’]{2,})’/g)) out.push(m[1].trim());
            for (const m of str.matchAll(/“([^“”]{2,})”/g)) out.push(m[1].trim());
            // ASCII ' : 内部の ' は \w'\w （縮約）のみ許容
            for (const m of str.matchAll(/'((?:[^']|(?<=\w)'(?=\w)){2,})'/g))  out.push(m[1].trim());
            // ASCII "
            for (const m of str.matchAll(/"([^"]{2,})"/g)) out.push(m[1].trim());
            return out.filter(s => s.length > 1);
          };
          extractQuoted(raw).forEach(s => queries.add(s.replace(/[‘’]/g, "'")));
          extractQuoted(norm).forEach(s => queries.add(s));

          // B) ダッシュ・縦棒・コロン区切りで分割 → 後半が曲タイトル、前半がアーティスト
          const dashSplit = norm.split(/\s*[-:]\s*/);
          let artistPart = '';
          let songPart   = '';
          if (dashSplit.length >= 2) {
            artistPart = dashSplit[0].replace(/(.*?)/g, '').replace(/[.*?]/g, '').trim();
            songPart   = dashSplit.slice(1).join(' ').replace(/(.*?)/g, '').replace(/[.*?]/g, '').trim();
            if (songPart.length > 1)               queries.add(songPart);
            if (artistPart && songPart.length > 1) queries.add(artistPart + ' ' + songPart);
          }

          // C) 括弧内テキスト（英数字中心のもの）を曲タイトル候補として追加
          for (const m of norm.matchAll(/(([^)]{2,}))/g)) {
            const inner = m[1].trim();
            const nonAscii = (inner.match(/[^-]/g) || []).length;
            if (nonAscii < inner.length * 0.4) queries.add(inner);
          }

          // D) 正規化済み全体（括弧除去）
          const cleanFull = norm.replace(/(.*?)/g, '').replace(/[.*?]/g, '').replace(/s{2,}/g, ' ').trim();
          if (cleanFull.length > 1) queries.add(cleanFull);

          // E) ダッシュ区切りがない場合：先頭語をアーティスト名と仮定して残りを候補に
          if (dashSplit.length < 2) {
            const words = cleanFull.split(/s+/);
            if (words.length >= 3) {
              queries.add(words.slice(1).join(' '));
              queries.add(words.slice(2).join(' '));
            }
          }

          // F) 最終手段：正規化済み文字列（括弧含む）
          if (norm.length > 1) queries.add(norm);

          return [...queries].filter(q => q && q.length >= 2 && q.length <= 120);
        }
        // IMDB Suggestion API
        // https://v3.sg.media-imdb.com/suggestion/<first-letter>/<query>.json
        async function imdbSuggest(query) {
          return new Promise((resolve) => {
            const url = imdbSuggestionUrl(query);
            https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }, (res) => {
              let data = '';
              res.on('data', c => data += c);
              res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(null); }
              });
            }).on('error', () => resolve(null));
          });
        }

        const queries = buildQueries(title);
        console.log(`[IMDB] "${title}" → クエリ候補: ${JSON.stringify(queries)}`);

        let found = null;
        for (const q of queries) {
          const json = await imdbSuggest(q);
          if (!json?.d) continue;
          const mv = json.d.find(item => item.qid === 'musicVideo')
                  ?? json.d.find(item => item.q  === 'music video')
                  ?? json.d.find(item => (item.l || '').toLowerCase().includes(title.toLowerCase().slice(0, 10)));
          if (mv) {
            found = { tt: mv.id, title: mv.l, year: mv.y ?? '', image: mv.i?.imageUrl ?? '' };
            console.log(`[IMDB] ヒット: ${JSON.stringify(found)} (query="${q}")`);
            break;
          }
        }

        if (!found) {
          console.log(`[IMDB] "${title}" → 見つかりませんでした`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ notFound: true }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(found));
      } catch (e) {
        console.error('[IMDB Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /imdb-crew : tt ID → キャスト・クルー情報を api.imdbapi.dev から取得 ────
  // リクエスト body: { tt: string }
  // レスポンス:     { title, year, rating, votes, poster, genres, runtime, plot,
  //                  directors, cast, writers, crew }
  if (req.method === 'POST' && req.url === '/imdb-crew') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { tt } = JSON.parse(body);
        if (!tt) throw new Error('tt が指定されていません');

        // api.imdbapi.dev への汎用GETヘルパー
        function imdbApiGet(apiPath) {
          return new Promise((resolve, reject) => {
            const options = {
              hostname: 'api.imdbapi.dev',
              path: apiPath,
              method: 'GET',
              headers: { 'Accept': 'application/json' },
            };
            https.request(options, (r) => {
              let data = '';
              r.on('data', c => data += c);
              r.on('end', () => {
                if (r.statusCode !== 200) {
                  reject(new Error(`imdbapi.dev ${apiPath} → ${r.statusCode}`));
                  return;
                }
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
              });
            }).on('error', reject).end();
          });
        }

        // タイトル情報とクレジットを並列取得（creditsは失敗してもOK）
        console.log(`[IMDB-Crew] ${tt} 取得開始`);
        let titleData, creditsData;
        try {
          [titleData, creditsData] = await Promise.all([
            imdbApiGet(`/titles/${tt}`),
            imdbApiGet(`/titles/${tt}/credits?pageSize=50`).catch(e => {
              console.warn(`[IMDB-Crew] credits取得失敗（タイトル情報のみ返します）: ${e.message}`);
              return null;
            }),
          ]);
        } catch (e) {
          throw new Error(`タイトル情報取得失敗: ${e.message}`);
        }

        // ── タイトル情報を整形 ──────────────────────────────────────
        const result = {
          title:   titleData.primaryTitle ?? titleData.originalTitle ?? '',
          year:    titleData.startYear ?? '',
          rating:  titleData.rating?.aggregateRating ?? null,
          votes:   titleData.rating?.voteCount ?? null,
          poster:  titleData.primaryImage?.url ?? '',
          genres:  titleData.genres ?? [],
          runtime: titleData.runtimeSeconds ? Math.round(titleData.runtimeSeconds / 60) : null,
          plot:    titleData.plot ?? '',
          directors: [],
          cast:      [],
          writers:   [],
          crew:      [],
        };

        // ── クレジットをカテゴリ別に分類 ────────────────────────────
        const credits = creditsData?.credits ?? [];
        for (const c of credits) {
          const name  = c.name?.displayName ?? c.name?.primaryName ?? '';
          const image = c.name?.primaryImage?.url ?? '';
          const cat   = c.category ?? '';
          const job   = c.job ?? '';

          const person = { name, image };

          if (cat === 'director') {
            result.directors.push(person);
          } else if (cat === 'actor' || cat === 'actress' || cat === 'self') {
            result.cast.push({
              name, image,
              characters: c.characters ?? [],
              category: cat,
            });
          } else if (cat === 'writer') {
            result.writers.push(person);
          } else {
            result.crew.push({ name, image, job, category: cat });
          }
        }

        // 次ページが存在する場合は cast / crew をさらに取得（最大100件まで）
        let nextToken = creditsData?.nextPageToken;
        let page = 1;
        while (nextToken && page < 2) {
          const more = await imdbApiGet(`/titles/${tt}/credits?pageSize=50&pageToken=${encodeURIComponent(nextToken)}`);
          for (const c of (more.credits ?? [])) {
            const name  = c.name?.displayName ?? c.name?.primaryName ?? '';
            const image = c.name?.primaryImage?.url ?? '';
            const cat   = c.category ?? '';
            const job   = c.job ?? '';
            if (cat === 'director')                      result.directors.push({ name, image });
            else if (cat === 'actor' || cat === 'actress' || cat === 'self')
              result.cast.push({ name, image, characters: c.characters ?? [], category: cat });
            else if (cat === 'writer')                   result.writers.push({ name, image });
            else                                         result.crew.push({ name, image, job, category: cat });
          }
          nextToken = more.nextPageToken;
          page++;
        }

        console.log(`[IMDB-Crew] ${tt} 完了 — 監督${result.directors.length} キャスト${result.cast.length} クルー${result.crew.length}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error('[IMDB-Crew Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /translate : DeepL API でテキストを日本語に翻訳 ──────────────────────────
  if (req.method === 'POST' && req.url === '/translate') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { text } = JSON.parse(body);
        if (!text) { res.writeHead(400); res.end(JSON.stringify({ error: 'text required' })); return; }
        if (!DEEPL_API_KEY) throw new Error('DEEPL_API_KEY が設定されていません');

        // Free plan は api-free.deepl.com、有料は api.deepl.com
        const isFree = DEEPL_API_KEY.endsWith(':fx');
        const hostname = isFree ? 'api-free.deepl.com' : 'api.deepl.com';
        const postData = new URLSearchParams({ text, target_lang: 'JA' }).toString();

        const translated = await new Promise((resolve, reject) => {
          const options = {
            hostname,
            path: '/v2/translate',
            method: 'POST',
            headers: {
              'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded',
              'Content-Length': Buffer.byteLength(postData),
            },
          };
          const r = https.request(options, (resp) => {
            let data = '';
            resp.on('data', c => data += c);
            resp.on('end', () => {
              try {
                const json = JSON.parse(data);
                if (resp.statusCode !== 200) reject(new Error(json.message || `DeepL ${resp.statusCode}`));
                else resolve(json.translations?.[0]?.text ?? '');
              } catch (e) { reject(e); }
            });
          });
          r.on('error', reject);
          r.write(postData);
          r.end();
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ translated }));
      } catch (e) {
        console.error('[DeepL]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /imdb-name-search : 人名 → nameId を取得 ───────────────────────────────
  // リクエスト body: { name: string }
  // レスポンス:     { nameId, name, image } | { notFound: true } | { error }
  if (req.method === 'POST' && req.url === '/imdb-name-search') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { name } = JSON.parse(body);
        if (!name) throw new Error('name が指定されていません');

        const url = imdbSuggestionUrl(name);

        const result = await new Promise((resolve) => {
          https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
              try { resolve(JSON.parse(data)); }
              catch { resolve(null); }
            });
          }).on('error', () => resolve(null));
        });

        if (!result?.d) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ notFound: true }));
          return;
        }

        const nameItems = result.d.filter(item => item.id?.startsWith('nm'));
        const found = nameItems.find(item => /\bDirector\b/i.test(item.s || ''))
                   ?? nameItems.find(item => item.qid === 'name')
                   ?? nameItems[0];
        if (!found) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ notFound: true }));
          return;
        }

        console.log(`[IMDB-Name] "${name}" → ${found.id} (${found.l})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ nameId: found.id, name: found.l, image: found.i?.imageUrl ?? '' }));
      } catch (e) {
        console.error('[IMDB-Name Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /imdb-filmography : nameId → フィルモグラフィーを取得 ─────────────────
  // リクエスト body: { nameId: string }
  // レスポンス:     { credits: [...] } | { error }
  if (req.method === 'POST' && req.url === '/imdb-filmography') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { nameId } = JSON.parse(body);
        if (!nameId) throw new Error('nameId が指定されていません');

        console.log(`[IMDB-Filmography] ${nameId} 取得開始`);
        const startTime = Date.now();

        function imdbFilmographyPage(pageToken = '') {
          return new Promise((resolve, reject) => {
            const params = new URLSearchParams({ pageSize: '50' });
            if (pageToken) params.set('pageToken', pageToken);
            const apiPath = `/names/${nameId}/filmography?${params.toString()}`;
            const options = {
              hostname: 'api.imdbapi.dev',
              path: apiPath,
              method: 'GET',
              headers: { 'Accept': 'application/json' },
            };
            https.request(options, (r) => {
              let raw = '';
              r.on('data', c => raw += c);
              r.on('end', () => {
                if (r.statusCode !== 200) {
                  reject(new Error(`imdbapi.dev ${apiPath} → ${r.statusCode}`));
                  return;
                }
                try {
                  const data = JSON.parse(raw);
                  if (data?.code && data?.message) {
                    reject(new Error(`imdbapi.dev ${apiPath} → ${data.message}`));
                    return;
                  }
                  resolve(data);
                }
                catch (e) { reject(e); }
              });
            }).on('error', reject).end();
          });
        }

        const allCredits = [];
        let nextPageToken = '';
        let totalCount = 0;
        let page = 0;
        do {
          const data = await imdbFilmographyPage(nextPageToken);
          console.log(`[IMDB-Filmography] page ${page + 1} 取得完了 (${Date.now() - startTime}ms)`);
          const credits = Array.isArray(data?.credits) ? data.credits : [];
          allCredits.push(...credits);
          totalCount = data?.totalCount ?? totalCount;
          nextPageToken = data?.nextPageToken ?? '';
          page++;
        } while (nextPageToken && page < 2);

        const result = {
          credits: allCredits,
          totalCount: totalCount || allCredits.length,
          nextPageToken: nextPageToken || undefined,
        };

        console.log(`[IMDB-Filmography] 全体時間: ${Date.now() - startTime}ms`);
        console.log(`[IMDB-Filmography] ${nameId} 完了 — ${allCredits.length}/${result.totalCount}件`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error('[IMDB-Filmography Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /notion-add-creator : 作品にクリエイターを追加 ───────────────────────
  // body: { workId, creatorPageId }
  if (req.method === 'POST' && req.url === '/notion-add-creator') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { workId, creatorPageId } = JSON.parse(body);
        if (!workId || !creatorPageId) throw new Error('workId, creatorPageId が必要です');

        console.log(`[Notion] クリエイター追加開始: work=${workId} creator=${creatorPageId}`);

        // 1. 現在のページ情報を取得してリレーションプロパティを特定
        const pageRes = await notionRequest('GET', `/v1/pages/${workId}`);
        if (pageRes.status !== 200) throw new Error(`ページ取得失敗: ${pageRes.status}`);

        const props = pageRes.body.properties;
        let relPropName = await getCreatorRelPropName();
        if (!relPropName) throw new Error('クリエイターリレーションプロパティが見つかりませんでした');

        const relProp = props[relPropName];
        let currentIds = [];
        if (relProp?.type === 'relation') {
          currentIds = relProp.relation.map(r => r.id);
        }

        // すでに追加されているかチェック
        if (currentIds.includes(creatorPageId)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: '既に追加されています' }));
          return;
        }

        // 2. PATCH で更新
        const updateBody = {
          properties: {
            [relPropName]: {
              relation: [...currentIds.map(id => ({ id })), { id: creatorPageId }]
            }
          }
        };

        const patchRes = await notionRequest('PATCH', `/v1/pages/${workId}`, updateBody);
        if (patchRes.status !== 200) throw new Error(`更新失敗: ${patchRes.status}`);

        console.log(`[Notion] 追加成功: ${workId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('[Notion Add Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /notion-create-creator : クリエイターDBに新規クリエイターを作成 ──────────
  // body: { name, imageUrl? }
  // レスポンス: { success, creatorPageId, alreadyExists? }
  if (req.method === 'POST' && req.url === '/notion-create-creator') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { name, imageUrl } = JSON.parse(body);
        if (!name) throw new Error('name が必要です');

        console.log(`[Notion] クリエイター新規作成: name="${name}"`);

        // 1. クリエイターDBのスキーマを取得してtitleプロパティ名を特定
        const dbRes = await notionRequest('GET', `/v1/databases/${DB_CREATORS}`);
        if (dbRes.status !== 200) throw new Error(`DB取得失敗: ${dbRes.status}`);

        let titlePropName = 'Name';
        for (const [propName, prop] of Object.entries(dbRes.body.properties)) {
          if (prop.type === 'title') { titlePropName = propName; break; }
        }

        // 2. 同名クリエイターが存在するか確認
        const searchRes = await notionRequest('POST', `/v1/databases/${DB_CREATORS}/query`, {
          filter: { property: titlePropName, title: { equals: name } },
          page_size: 1,
        });
        if (searchRes.status === 200 && searchRes.body.results?.length > 0) {
          const existing = searchRes.body.results[0];
          console.log(`[Notion] 既存クリエイター発見: ${existing.id}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, creatorPageId: existing.id, alreadyExists: true }));
          return;
        }

        // 3. 新規ページ作成
        const createBody = {
          parent: { database_id: DB_CREATORS },
          properties: {
            [titlePropName]: { title: [{ text: { content: name } }] },
          },
        };
        if (imageUrl) {
          createBody.cover = { type: 'external', external: { url: imageUrl } };
        }

        const createRes = await notionRequest('POST', '/v1/pages', createBody);
        if (createRes.status !== 200) throw new Error(`作成失敗: ${createRes.status} ${JSON.stringify(createRes.body)}`);

        const newPageId = createRes.body.id;
        console.log(`[Notion] クリエイター作成成功: ${newPageId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, creatorPageId: newPageId }));
      } catch (e) {
        console.error('[Notion Create Creator Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /notion-set-creator-cover : クリエイターページのカバー画像を設定 ───────
  // body: { creatorPageId, imageUrl }
  if (req.method === 'POST' && req.url === '/notion-set-creator-cover') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { creatorPageId, imageUrl } = JSON.parse(body);
        if (!creatorPageId || !imageUrl) throw new Error('creatorPageId, imageUrl が必要です');

        console.log(`[Notion] カバー画像設定: creator=${creatorPageId} url=${imageUrl}`);

        const patchRes = await notionRequest('PATCH', `/v1/pages/${creatorPageId}`, {
          cover: { type: 'external', external: { url: imageUrl } }
        });
        if (patchRes.status !== 200) throw new Error(`カバー画像設定失敗: ${patchRes.status}`);

        console.log(`[Notion] カバー画像設定成功: ${creatorPageId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('[Notion Cover Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /notion-role-options : Role プロパティの選択肢一覧を返す ───────────────
  // レスポンス: { options: [{ id, name, color }] }
  if (req.method === 'GET' && req.url === '/notion-role-options') {
    try {
      const dbRes = await notionRequest('GET', `/v1/databases/${DB_CREATORS}`);
      if (dbRes.status !== 200) throw new Error(`DB取得失敗: ${dbRes.status}`);
      const props = dbRes.body.properties;
      const rolePropName = Object.keys(props).find(k => k === 'Role' || k === '役職') || 'Role';
      const roleProp = props[rolePropName];
      let options = [];
      if (roleProp?.type === 'multi_select') {
        options = roleProp.multi_select.options || [];
      } else if (roleProp?.type === 'select') {
        options = roleProp.select.options || [];
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ options: options.map(o => ({ id: o.id, name: o.name, color: o.color })) }));
    } catch (e) {
      console.error('[RoleOptions Error]', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── /notion-update-creator-meta : 役職・SNS を更新 ────────────────────────
  // body: { creatorPageId, role?, sns?: string[] }
  if (req.method === 'POST' && req.url === '/notion-update-creator-meta') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { creatorPageId, role, sns } = JSON.parse(body);
        if (!creatorPageId) throw new Error('creatorPageId が必要です');

        // クリエイターDBのプロパティ名を取得
        const dbRes = await notionRequest('GET', `/v1/databases/${DB_CREATORS}`);
        if (dbRes.status !== 200) throw new Error(`DB取得失敗: ${dbRes.status}`);
        const props = dbRes.body.properties;

        // Role プロパティ名を検出
        const rolePropName = Object.keys(props).find(k => k === 'Role' || k === '役職') || 'Role';
        // SNS プロパティ名を検出
        const snsPropName  = Object.keys(props).find(k => k.toLowerCase() === 'sns') || 'SNS';

        const patchProps = {};

        if (role !== undefined) {
          const roleProp = props[rolePropName];
          if (roleProp?.type === 'select') {
            patchProps[rolePropName] = { select: role ? { name: role } : null };
          } else if (roleProp?.type === 'multi_select') {
            // カンマ区切り文字列を複数の multi_select 項目に変換
            const roleItems = role
              ? role.split(',').map(r => r.trim()).filter(Boolean).map(r => ({ name: r }))
              : [];
            patchProps[rolePropName] = { multi_select: roleItems };
          } else {
            // rich_text fallback
            patchProps[rolePropName] = { rich_text: role ? [{ text: { content: role } }] : [] };
          }
          console.log(`[Notion] 役職更新: ${creatorPageId} → "${role}"`);
        }

        if (sns !== undefined) {
          // SNS は最初の URL のみ保存（Notion URL 型）
          const firstUrl = (sns && sns.length > 0) ? sns[0] : null;
          const snsProp  = props[snsPropName];
          if (snsProp?.type === 'url') {
            patchProps[snsPropName] = { url: firstUrl || null };
          } else {
            // rich_text fallback
            patchProps[snsPropName] = { rich_text: firstUrl ? [{ text: { content: firstUrl } }] : [] };
          }
          console.log(`[Notion] SNS更新: ${creatorPageId} → ${firstUrl || '(削除)'}`);
        }

        if (Object.keys(patchProps).length === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, noop: true }));
          return;
        }

        const patchRes = await notionRequest('PATCH', `/v1/pages/${creatorPageId}`, { properties: patchProps });
        if (patchRes.status !== 200) throw new Error(`更新失敗: ${patchRes.status} ${JSON.stringify(patchRes.body)}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('[UpdateCreatorMeta Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /notion-rename-creator : クリエイターの名前を変更 ──────────────────────
  // body: { creatorPageId, newName }
  // レスポンス: { success }
  if (req.method === 'POST' && req.url === '/notion-rename-creator') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { creatorPageId, newName } = JSON.parse(body);
        if (!creatorPageId || !newName) throw new Error('creatorPageId, newName が必要です');

        console.log(`[Notion] クリエイター名変更: id=${creatorPageId} newName="${newName}"`);

        // 1. クリエイターDBのtitleプロパティ名を取得
        const dbRes = await notionRequest('GET', `/v1/databases/${DB_CREATORS}`);
        if (dbRes.status !== 200) throw new Error(`DB取得失敗: ${dbRes.status}`);

        let titlePropName = 'Name';
        for (const [propName, prop] of Object.entries(dbRes.body.properties)) {
          if (prop.type === 'title') { titlePropName = propName; break; }
        }

        // 2. ページのtitleを更新
        const patchRes = await notionRequest('PATCH', `/v1/pages/${creatorPageId}`, {
          properties: {
            [titlePropName]: { title: [{ text: { content: newName } }] }
          }
        });
        if (patchRes.status !== 200) throw new Error(`名前更新失敗: ${patchRes.status} ${JSON.stringify(patchRes.body)}`);

        console.log(`[Notion] クリエイター名変更成功: ${creatorPageId} → "${newName}"`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('[Notion Rename Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /notion-remove-creator : 作品からクリエイターを削除 ──────────────────
  // body: { workId, creatorPageId }
  if (req.method === 'POST' && req.url === '/notion-remove-creator') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { workId, creatorPageId } = JSON.parse(body);
        if (!workId || !creatorPageId) throw new Error('workId, creatorPageId が必要です');

        console.log(`[Notion] クリエイター削除開始: work=${workId} creator=${creatorPageId}`);

        // 1. 現在のページ情報を取得
        const pageRes = await notionRequest('GET', `/v1/pages/${workId}`);
        if (pageRes.status !== 200) throw new Error(`ページ取得失敗: ${pageRes.status}`);

        const props = pageRes.body.properties;
        let relPropName = await getCreatorRelPropName();
        if (!relPropName) throw new Error('クリエイターリレーションプロパティが見つかりませんでした');

        const relProp = props[relPropName];
        let currentIds = [];
        if (relProp?.type === 'relation') {
          currentIds = relProp.relation.map(r => r.id);
        }

        // 対象を除外したIDリスト
        const newIds = currentIds.filter(id => id.replace(/-/g, '') !== creatorPageId.replace(/-/g, ''));

        // 2. PATCH で更新
        const updateBody = {
          properties: {
            [relPropName]: {
              relation: newIds.map(id => ({ id }))
            }
          }
        };

        const patchRes = await notionRequest('PATCH', `/v1/pages/${workId}`, updateBody);
        if (patchRes.status !== 200) throw new Error(`更新失敗: ${patchRes.status}`);

        console.log(`[Notion] 削除成功: ${workId} から ${creatorPageId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('[Notion Remove Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /notion-data : Notion から全データを取得して返す ───────────────────────
  if (req.method === 'POST' && req.url === '/notion-data') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      const { database } = JSON.parse(body || '{}'); // リクエストボディから database パラメータを取得
      try {
        if (!NOTION_TOKEN) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'Notion API is not configured. Please set NOTION_TOKEN environment variable.',
            code: 'NOTION_TOKEN_MISSING'
          }));
          return;
        }
        const { rows, creators, artists, count } = await buildData(database); // database パラメータを渡す
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results: rows, creators, artists, count }));
      } catch (e) {
        console.error('[Error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── /favicon.ico : ファビコンを配信 ──────────────────────────────────────
  if (req.method === 'GET' && req.url === '/favicon.ico') {
    const FAVICON_FILE = path.join(__dirname, 'favicon.ico');
    try {
      if (fs.existsSync(FAVICON_FILE)) {
        const favicon = fs.readFileSync(FAVICON_FILE);
        res.writeHead(200, { 
          'Content-Type': 'image/x-icon',
          'Cache-Control': 'public, max-age=31536000'
        });
        res.end(favicon);
      } else {
        res.writeHead(404); res.end();
      }
    } catch (e) {
      console.error('[Favicon error]', e.message);
      res.writeHead(500); res.end();
    }
    return;
  }

  // ─── /logo.png : ロゴを配信 ──────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/logo.png') {
    const LOGO_FILE = path.join(__dirname, 'logo.png');
    try {
      if (fs.existsSync(LOGO_FILE)) {
        const logo = fs.readFileSync(LOGO_FILE);
        res.writeHead(200, { 
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000'
        });
        res.end(logo);
      } else {
        res.writeHead(404); res.end();
      }
    } catch (e) {
      console.error('[Logo error]', e.message);
      res.writeHead(500); res.end();
    }
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    try {
      // Check if HTML file exists
      if (!fs.existsSync(HTML_FILE)) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Error</title></head>
          <body>
            <h1>Server Error</h1>
            <p>HTML file not found at: ${HTML_FILE}</p>
            <p>Please ensure creator-network.html exists in the application directory.</p>
          </body>
          </html>
        `);
        return;
      }
      
      const html = fs.readFileSync(HTML_FILE, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      console.error('[Static file error]', e.message);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Error reading HTML file: ${e.message}`);
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

// ─── エラーハンドリング ────────────────────────────────────────────────────────
server.on('error', (err) => {
  console.error('[Server Error]', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});

// ─── 予期しないエラーをキャッチ ────────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception]', error.message);
  // Heroku では例外をキャッチしてもプロセスは死ぬため、直ちにexit
  if (isProduction) {
    console.error('Fatal error - exiting');
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ✅  Creator Network サーバー起動中');
  if (isProduction) {
    console.log(`  🌐  Heroku app running on port ${PORT}`);
  } else {
    console.log(`  🌐  http://localhost:${PORT} をブラウザで開いてください`);
  }
  console.log('');
  console.log('  必要な環境変数:');
  console.log('    NOTION_TOKEN — Notion 統合トークン（必須）');
  console.log('    DEEPL_API_KEY — DeepL APIキー（オプション）');
  console.log('    YOUTUBE_API_KEY — YouTube APIキー（オプション）');
  console.log('    ※ YouTube動画検索は youtubei.js (npm install youtubei.js) を使用します（APIキー不要）');
  console.log('');
    console.log('  アーティストアイコンは Spotify API (RapidAPI) からアーティスト名で取得します');
  console.log('  クリエイターアイコンは Notion SNS欄の Instagram URL から自動取得します');
  console.log('    RAPIDAPI_KEY — RapidAPI キー（instagram120.p.rapidapi.com）');
  if (RAPIDAPI_KEY) {
    console.log('  ✅ Instagram アバター取得が有効です（RapidAPI経由）');
  } else {
    console.log('  ⚠️  RAPIDAPI_KEY 未設定 — Instagram アバター取得は無効');
  }
  console.log('');
  
  if (NOTION_TOKEN) {
    console.log('  ✅ NOTION_TOKEN が設定されています');
  } else {
    console.log('  ⚠️  NOTION_TOKEN が設定されていません — /notion-* エンドポイントは使用不可');
  }
  
  console.log('');
  if (!isProduction) {
    console.log('  起動例:');
    console.log('    NOTION_TOKEN=xxx node server.js');
  }
  console.log('');
  if (!isProduction) {
    console.log('  Ctrl+C で停止');
  }
  console.log('');
});