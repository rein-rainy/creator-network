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
const DEEPL_API_KEY     = process.env.DEEPL_API_KEY;
const YOUTUBE_API_KEY   = process.env.YOUTUBE_API_KEY;
const DB_WORKS       = '18860905b37f80358899e51e4e514f92'; // メイン（作品）
const DB_CREATORS    = '2d260905b37f80fbae0de6cb61a03091'; // クリエイター
const DB_ARTISTS     = '18860905b37f8093954fdb1bb9602c18'; // アーティスト

// 起動時にトークンの存在を確認
if (!NOTION_TOKEN) {
  console.error('[Error] 環境変数 NOTION_TOKEN が設定されていません。');
  process.exit(1);
}
const HTML_FILE      = path.join(__dirname, 'creator-network.html');

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
    row['_notionPageId'] = page.id; // Notionページへのリンク用
    return row;
  });

  console.log(`[Notion] 完了 — 作品 ${rows.length} 件 / Creator ${creators.length} 件 / Artist ${artists.length} 件`);
  return { rows, creators, artists, count: rows.length };
}


// ─── Deezer API でアーティスト名からアバター画像URLを取得 ────────────────────
//
// フロー:
//   1. https://api.deezer.com/search/artist?q=<name>&limit=1 でアーティスト検索
//   2. 以下のいずれかを満たせば画像を返す:
//        a. nb_fan > 1000
//        b. genre_id が K-Pop(129) または J-Pop(52)
//        c. tracklist の曲タイトルと workTitles のいずれかが部分一致
//   3. どれも満たさなければ null を返す

const ALLOWED_GENRE_IDS = new Set([52, 129]); // J-Pop=52, K-Pop=129

// tracklist URL から曲タイトル一覧を取得
function fetchTracklist(tracklistUrl) {
  return new Promise((resolve) => {
    https.get(tracklistUrl, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const titles = (json.data || []).map(t => (t.title || '').toLowerCase());
          resolve(titles);
        } catch {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

// アーティスト名 → { imageUrl, artistName } を返す
// workTitles: アーティストが参加する作品タイトルの配列（tracklist照合用）
async function searchArtistImage(artistName, workTitles = []) {
  return new Promise((resolve) => {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=1`;
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', async () => {
        try {
          const json = JSON.parse(data);
          const artist = json.data?.[0];
          if (!artist) {
            console.warn(`[Deezer] "${artistName}" が見つかりませんでした`);
            return resolve(null);
          }

          const nbFan    = artist.nb_fan ?? 0;
          const genreId  = artist.genre_id ?? -1;
          console.log(`[Deezer] "${artistName}" nb_fan=${nbFan} genre_id=${genreId}`);

          // 条件a: nb_fan > 1000
          if (nbFan > 1000) {
            const imageUrl = artist.picture_medium || artist.picture;
            console.log(`[Deezer] "${artistName}" nb_fan条件OK → ${imageUrl}`);
            return resolve({ imageUrl, artistName: artist.name });
          }

          // 条件b: genre_id が K-Pop / J-Pop
          if (ALLOWED_GENRE_IDS.has(genreId)) {
            const imageUrl = artist.picture_medium || artist.picture;
            console.log(`[Deezer] "${artistName}" genre_id=${genreId}(K/J-Pop)条件OK → ${imageUrl}`);
            return resolve({ imageUrl, artistName: artist.name });
          }

          // 条件c: tracklist と workTitles の部分一致
          if (artist.tracklist && workTitles.length > 0) {
            const trackTitles = await fetchTracklist(artist.tracklist);
            const normWork = workTitles.map(t => t.toLowerCase());
            const matched = trackTitles.some(track =>
              normWork.some(work => track.includes(work) || work.includes(track))
            );
            if (matched) {
              const imageUrl = artist.picture_medium || artist.picture;
              console.log(`[Deezer] "${artistName}" tracklist一致条件OK → ${imageUrl}`);
              return resolve({ imageUrl, artistName: artist.name });
            }
          }

          console.warn(`[Deezer] "${artistName}" 全条件不一致 → スキップ`);
          resolve(null);
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

  // ─── /youtube-video-search : タイトル → YouTube動画直リンクとサムネイル ───────
  // リクエスト body: { titles: string[] }
  // レスポンス:     { results: { [title]: { videoId, url, thumbnail, title } | null } }
  if (req.method === 'POST' && req.url === '/youtube-video-search') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        if (!YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY が設定されていません');
        const { titles = [] } = JSON.parse(body);
        const uniqueTitles = [...new Set(titles.map(t => String(t || '').trim()).filter(Boolean))].slice(0, 50);

        function youtubeSearch(title) {
          if (youtubeVideoCache.has(title)) return Promise.resolve(youtubeVideoCache.get(title));
          return new Promise((resolve, reject) => {
            const params = new URLSearchParams({
              part: 'snippet',
              type: 'video',
              maxResults: '1',
              q: title,
              key: YOUTUBE_API_KEY,
            });
            const apiPath = `/youtube/v3/search?${params.toString()}`;
            https.request({
              hostname: 'www.googleapis.com',
              path: apiPath,
              method: 'GET',
              headers: { 'Accept': 'application/json' },
            }, (r) => {
              let raw = '';
              r.on('data', c => raw += c);
              r.on('end', () => {
                try {
                  const data = JSON.parse(raw);
                  if (r.statusCode !== 200) {
                    reject(new Error(data?.error?.message || `YouTube Data API → ${r.statusCode}`));
                    return;
                  }
                  const item = data.items?.[0];
                  const videoId = item?.id?.videoId || '';
                  const result = videoId ? {
                    videoId,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    thumbnail: item.snippet?.thumbnails?.medium?.url
                            || item.snippet?.thumbnails?.default?.url
                            || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
                    title: item.snippet?.title || title,
                  } : null;
                  youtubeVideoCache.set(title, result);
                  resolve(result);
                } catch (e) {
                  reject(e);
                }
              });
            }).on('error', reject).end();
          });
        }

        const results = {};
        for (const title of uniqueTitles) {
          try { results[title] = await youtubeSearch(title); }
          catch (e) {
            console.warn(`[YouTube] "${title}" 検索失敗: ${e.message}`);
            results[title] = null;
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch (e) {
        console.error('[YouTube Error]', e.message);
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
            const nonAscii = (inner.match(/[^ -]/g) || []).length;
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
          const credits = Array.isArray(data?.credits) ? data.credits : [];
          allCredits.push(...credits);
          totalCount = data?.totalCount ?? totalCount;
          nextPageToken = data?.nextPageToken ?? '';
          page++;
        } while (nextPageToken && page < 20);

        const result = {
          credits: allCredits,
          totalCount: totalCount || allCredits.length,
          nextPageToken: nextPageToken || undefined,
        };

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

  // ─── /notion-data : Notion から全データを取得して返す ───────────────────────
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
  console.log('    YOUTUBE_API_KEY — YouTube Data API v3 キー（フィルモグラフィー動画リンク用）');
  console.log('');
  console.log('  アーティストアイコンは Deezer API からアーティスト名で取得します（APIキー不要）');
  console.log('');
  console.log('  起動例:');
  console.log('    NOTION_TOKEN=xxx node server.js');
  console.log('');
  console.log('  Ctrl+C で停止');
  console.log('');
});
