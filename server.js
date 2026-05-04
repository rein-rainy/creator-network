/**
 * Creator Network — ローカルサーバー
 * 起動: node server.js
 * アクセス: http://localhost:3000
 */

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const https = require('https');

const PORT              = process.env.PORT || 3000;
const NOTION_TOKEN      = process.env.NOTION_TOKEN;
const DB_WORKS       = '18860905b37f80358899e51e4e514f92'; // メイン（作品）
const DB_CREATORS    = '2d260905b37f80fbae0de6cb61a03091'; // クリエイター
const DB_ARTISTS     = '18860905b37f8093954fdb1bb9602c18'; // アーティスト

// 起動時にトークンの存在を確認
if (!NOTION_TOKEN) {
  console.error('[Error] 環境変数 NOTION_TOKEN が設定されていません。');
  process.exit(1);
}
const HTML_FILE      = path.join(__dirname, 'creator-network.html');

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
        'Content-Length': Buffer.byteLength(postData),
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

      // Cover画像をアバターとして使用（external / file 両対応）
      let avatar = '';
      const cover = page.cover;
      if (cover?.type === 'external') avatar = cover.external?.url ?? '';
      else if (cover?.type === 'file') avatar = cover.file?.url ?? '';

      persons.push({ Name: name, Role: role, SNS: sns, Avatar: avatar });
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

// ─── メイン処理 ───────────────────────────────────────────────────────────────
async function buildData() {
  console.log('[Notion] 3つのDBを並列取得中...');
  const [works, creatorResult, artistResult] = await Promise.all([
    fetchWorks(),
    fetchPersonDB(DB_CREATORS, 'Creator'),
    fetchPersonDB(DB_ARTISTS,  'Artist'),
  ]);
  const creatorMap = creatorResult.map;
  const artistMap  = artistResult.map;
  const creators   = creatorResult.persons;
  const artists    = artistResult.persons;

  // キー一覧（列順保持）
  const keySet = new Set();
  works.forEach(p => Object.keys(p.properties).forEach(k => keySet.add(k)));
  const keys = [...keySet];

  // 行データに変換
  const rows = works.map(page => {
    const row = {};
    keys.forEach(k => {
      row[k] = extractValue(page.properties[k], creatorMap, artistMap);
    });
    return row;
  });

  console.log(`[Notion] 完了 — 作品 ${rows.length} 件 / Creator ${creators.length} 件 / Artist ${artists.length} 件`);
  return { rows, creators, artists, count: rows.length };
}


// ─── Deezer API でアーティスト名からアバター画像URLを取得 ────────────────────
//
// フロー:
//   https://api.deezer.com/search/artist?q=<name>&limit=1 にリクエストを送り、
//   最初のヒットの picture_medium を imageUrl として返す

// アーティスト名 → { imageUrl, artistName } を返す
function searchArtistImage(artistName) {
  return new Promise((resolve) => {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=1`;
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const artist = json.data?.[0];
          if (!artist) {
            console.warn(`[Deezer] "${artistName}" が見つかりませんでした`);
            return resolve(null);
          }
          if ((artist.nb_fan ?? 0) <= 10000) {
            console.warn(`[Deezer] "${artistName}" nb_fan=${artist.nb_fan} (1万以下) → スキップ`);
            return resolve(null);
          }
          const imageUrl = artist.picture_medium || artist.picture;
          console.log(`[Deezer] "${artistName}" nb_fan=${artist.nb_fan} → ${imageUrl}`);
          resolve({ imageUrl, artistName: artist.name });
        } catch (e) {
          console.warn(`[Deezer] "${artistName}" レスポンス解析失敗: ${e.message}`);
          resolve(null);
        }
      });
    }).on('error', (e) => {
      console.warn(`[Deezer] "${artistName}" リクエストエラー: ${e.message}`);
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

  // ─── /avatar : アーティスト名 → Deezer画像URL を返す ────────────────────────
  // リクエスト body: { artistName: string }
  // レスポンス:     { imageUrl, artistName }
  if (req.method === 'POST' && req.url === '/avatar') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { artistName } = JSON.parse(body);
        if (!artistName) throw new Error('artistName が指定されていません');

        const result = await searchArtistImage(artistName);
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

    if (req.method === 'POST' && req.url === '/notion-data') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { rows, creators, artists, count } = await buildData();
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

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    try {
      const html = fs.readFileSync(HTML_FILE, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`ファイルが見つかりません: ${HTML_FILE}\n${e.message}`);
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ✅  Creator Network サーバー起動中');
  console.log(`  🌐  http://localhost:${PORT} をブラウザで開いてください`);
  console.log('');
  console.log('  必要な環境変数:');
  console.log('    NOTION_TOKEN — Notion 統合トークン');
  console.log('');
  console.log('  アーティストアイコンは Deezer API からアーティスト名で取得します（APIキー不要）');
  console.log('');
  console.log('  起動例:');
  console.log('    NOTION_TOKEN=xxx node server.js');
  console.log('');
  console.log('  Ctrl+C で停止');
  console.log('');
});
