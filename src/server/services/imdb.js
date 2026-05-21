const https = require('https');

function imdbSuggestionUrl(query) {
  const encoded = encodeURIComponent(query).replace(/%20/g, '_');
  const first = (encoded[0] || 'x').toLowerCase();
  const bucket = /^[a-z0-9]$/.test(first) ? first : 'x';
  return `https://v3.sg.media-imdb.com/suggestion/${bucket}/${encoded}.json`;
}

function imdbSuggest(query) {
  return new Promise((resolve) => {
    const url = imdbSuggestionUrl(query);
    https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function imdbApiGet(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.imdbapi.dev',
      path: apiPath,
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    };
    https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`imdbapi.dev ${apiPath} -> ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (error) { reject(error); }
      });
    }).on('error', reject).end();
  });
}

function normalizeTitle(raw) {
  return raw
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s*[|｜]\s*/g, ' - ')
    .replace(/[・･]/g, ' ')
    .replace(/　/g, ' ')
    .replace(/[가-힣ᄀ-ᇿ㄰-㆏]/g, '')
    .replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '')
    .replace(/\b(official\s+music\s+video|music\s+video|official\s+video|official\s+mv|official\s+m\/v|official\s+audio|official\s+lyric\s+video|official\s+performance\s+video)\b/gi, '')
    .replace(/\b(lyric\s+video|lyrics\s+video|lyric\s+ver\.?|performance\s+video|dance\s+video|dance\s+ver\.?|dance\s+practice|dance\s+challenge|dance\s+film)\b/gi, '')
    .replace(/\b(visualizer|audio\s+only|full\s+ver\.?|short\s+ver\.?|inst\.?|instrumental|karaoke|acapella|a\s+cappella)\b/gi, '')
    .replace(/\b(official|m\/v|mv|m\.v\.|video|audio|lyric|lyrics|teaser|highlight|preview|trailer|comeback|debut)\b/gi, '')
    .replace(/\b(feat\.?|ft\.?|prod\.?|produced\s+by|dir\.?|directed\s+by|choreography\s+by|choreo\.?\s+by)\b/gi, '')
    .replace(/\b(hd|4k|fhd|1080p|720p|remastered|remaster|ver\.?|version|edit|remix|mix|extended|radio\s+edit)\b/gi, '')
    .replace(/\b(ep\.?|album|single|ost|bgm)\b/gi, '')
    .replace(/[\s\-:_]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildQueries(raw) {
  const queries = new Set();
  const norm = normalizeTitle(raw);
  const extractQuoted = (str) => {
    const out = [];
    for (const match of str.matchAll(/‘([^‘’]{2,})’/g)) out.push(match[1].trim());
    for (const match of str.matchAll(/“([^“”]{2,})”/g)) out.push(match[1].trim());
    for (const match of str.matchAll(/'((?:[^']|(?<=\w)'(?=\w)){2,})'/g)) out.push(match[1].trim());
    for (const match of str.matchAll(/"([^"]{2,})"/g)) out.push(match[1].trim());
    return out.filter(value => value.length > 1);
  };

  extractQuoted(raw).forEach(value => queries.add(value.replace(/[‘’]/g, "'")));
  extractQuoted(norm).forEach(value => queries.add(value));

  const dashSplit = norm.split(/\s*[-:]\s*/);
  if (dashSplit.length >= 2) {
    const artistPart = dashSplit[0].replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();
    const songPart = dashSplit.slice(1).join(' ').replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();
    if (songPart.length > 1) queries.add(songPart);
    if (artistPart && songPart.length > 1) queries.add(`${artistPart} ${songPart}`);
  }

  for (const match of norm.matchAll(/\(([^)]{2,})\)/g)) {
    const inner = match[1].trim();
    const nonAscii = (inner.match(/[^\x00-\x7F]/g) || []).length;
    if (nonAscii < inner.length * 0.4) queries.add(inner);
  }

  const cleanFull = norm.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').replace(/\s{2,}/g, ' ').trim();
  if (cleanFull.length > 1) queries.add(cleanFull);

  if (dashSplit.length < 2) {
    const words = cleanFull.split(/\s+/);
    if (words.length >= 3) {
      queries.add(words.slice(1).join(' '));
      queries.add(words.slice(2).join(' '));
    }
  }

  if (norm.length > 1) queries.add(norm);
  return [...queries].filter(query => query && query.length >= 2 && query.length <= 120);
}

async function searchTitle(title) {
  const queries = buildQueries(title);
  console.log(`[IMDB] "${title}" -> queries: ${JSON.stringify(queries)}`);

  for (const query of queries) {
    const json = await imdbSuggest(query);
    if (!json?.d) continue;
    const match = json.d.find(item => item.qid === 'musicVideo')
      ?? json.d.find(item => item.q === 'music video')
      ?? json.d.find(item => (item.l || '').toLowerCase().includes(title.toLowerCase().slice(0, 10)));
    if (match) {
      return { tt: match.id, title: match.l, year: match.y ?? '', image: match.i?.imageUrl ?? '' };
    }
  }

  return { notFound: true };
}

async function fetchCrew(tt) {
  console.log(`[IMDB-Crew] ${tt} 取得開始`);
  let titleData;
  let creditsData;
  try {
    [titleData, creditsData] = await Promise.all([
      imdbApiGet(`/titles/${tt}`),
      imdbApiGet(`/titles/${tt}/credits?pageSize=50`).catch(error => {
        console.warn(`[IMDB-Crew] credits取得失敗（タイトル情報のみ返します）: ${error.message}`);
        return null;
      }),
    ]);
  } catch (error) {
    throw new Error(`タイトル情報取得失敗: ${error.message}`);
  }

  const result = {
    title: titleData.primaryTitle ?? titleData.originalTitle ?? '',
    year: titleData.startYear ?? '',
    rating: titleData.rating?.aggregateRating ?? null,
    votes: titleData.rating?.voteCount ?? null,
    poster: titleData.primaryImage?.url ?? '',
    genres: titleData.genres ?? [],
    runtime: titleData.runtimeSeconds ? Math.round(titleData.runtimeSeconds / 60) : null,
    plot: titleData.plot ?? '',
    directors: [],
    cast: [],
    writers: [],
    crew: [],
  };

  function addCredit(credit) {
    const name = credit.name?.displayName ?? credit.name?.primaryName ?? '';
    const image = credit.name?.primaryImage?.url ?? '';
    const cat = credit.category ?? '';
    const job = credit.job ?? '';
    if (cat === 'director') result.directors.push({ name, image });
    else if (cat === 'actor' || cat === 'actress' || cat === 'self') {
      result.cast.push({ name, image, characters: credit.characters ?? [], category: cat });
    } else if (cat === 'writer') result.writers.push({ name, image });
    else result.crew.push({ name, image, job, category: cat });
  }

  for (const credit of creditsData?.credits ?? []) addCredit(credit);

  let nextToken = creditsData?.nextPageToken;
  let page = 1;
  while (nextToken && page < 2) {
    const more = await imdbApiGet(`/titles/${tt}/credits?pageSize=50&pageToken=${encodeURIComponent(nextToken)}`);
    for (const credit of more.credits ?? []) addCredit(credit);
    nextToken = more.nextPageToken;
    page++;
  }

  console.log(`[IMDB-Crew] ${tt} 完了 — 監督${result.directors.length} キャスト${result.cast.length} クルー${result.crew.length}`);
  return result;
}

async function searchName(name) {
  const result = await imdbSuggest(name);
  if (!result?.d) return { notFound: true };

  const nameItems = result.d.filter(item => item.id?.startsWith('nm'));
  const found = nameItems.find(item => /\bDirector\b/i.test(item.s || ''))
    ?? nameItems.find(item => item.qid === 'name')
    ?? nameItems[0];

  if (!found) return { notFound: true };
  return { nameId: found.id, name: found.l, image: found.i?.imageUrl ?? '' };
}

async function fetchFilmography(nameId) {
  console.log(`[IMDB-Filmography] ${nameId} 取得開始`);
  const startTime = Date.now();
  const allCredits = [];
  let nextPageToken = '';
  let totalCount = 0;
  let page = 0;

  do {
    const params = new URLSearchParams({ pageSize: '50' });
    if (nextPageToken) params.set('pageToken', nextPageToken);
    const data = await imdbApiGet(`/names/${nameId}/filmography?${params.toString()}`);
    console.log(`[IMDB-Filmography] page ${page + 1} 取得完了 (${Date.now() - startTime}ms)`);
    const credits = Array.isArray(data?.credits) ? data.credits : [];
    allCredits.push(...credits);
    totalCount = data?.totalCount ?? totalCount;
    nextPageToken = data?.nextPageToken ?? '';
    page++;
  } while (nextPageToken && page < 2);

  return {
    credits: allCredits,
    totalCount: totalCount || allCredits.length,
    nextPageToken: nextPageToken || undefined,
  };
}

module.exports = {
  imdbSuggestionUrl,
  searchTitle,
  fetchCrew,
  searchName,
  fetchFilmography,
};
