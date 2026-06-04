const { createCache } = require('../util/cache');
const { fetchJson } = require('../util/fetchJson');
const { toRomaji } = require('../util/romaji');

// Searches change rarely and are pure functions of the query, so cache aggressively.
const suggestCache = createCache({ ttlMs: 30 * 60 * 1000, max: 1000 });
const apiCache = createCache({ ttlMs: 30 * 60 * 1000, max: 500 });

function imdbSuggestionUrl(query) {
  const encoded = encodeURIComponent(query).replace(/%20/g, '_');
  const first = (encoded[0] || 'x').toLowerCase();
  const bucket = /^[a-z0-9]$/.test(first) ? first : 'x';
  return `https://v3.sg.media-imdb.com/suggestion/${bucket}/${encoded}.json`;
}

function imdbSuggest(query) {
  return suggestCache.wrap(query, () =>
    fetchJson(imdbSuggestionUrl(query), { label: `IMDB-suggest "${query}"` })
      .catch(() => null) // suggestion is best-effort; never fail the whole search
  );
}

function imdbApiGet(apiPath) {
  return apiCache.wrap(apiPath, () =>
    fetchJson(`https://api.imdbapi.dev${apiPath}`, { label: `imdbapi.dev ${apiPath}`, timeoutMs: 10000 })
  );
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

/** Lowercased word tokens, stripped of punctuation, for similarity comparison. */
function tokenize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// This app maps songs to music videos, so non-music types (movie, tvSeries,
// short…) are essentially never the right answer and only cause common-word
// collisions ("Lemon", "Pretender"). We accept only these music-ish types.
const MUSIC_TYPES = new Set(['musicVideo', 'tvMusic', 'video']);

function isMusicType(item) {
  return MUSIC_TYPES.has(item.qid) || item.q === 'music video';
}

/**
 * IMDb names music videos as "Artist: Song", so the part after the last colon
 * is the song. We match against *that* rather than the whole title: an
 * artist-only query like "yoasobi" would otherwise score 100% against every
 * one of that artist's videos and pick the wrong (most popular) song.
 */
function candidateSongTokens(candidateTitle) {
  const idx = candidateTitle.lastIndexOf(':');
  const song = idx >= 0 ? candidateTitle.slice(idx + 1) : candidateTitle;
  return tokenize(song);
}

/**
 * Score a music-video candidate against the full set of query tokens. The key
 * signal is "song coverage": how much of the candidate's *song* (post-colon)
 * the queries actually mention. Type and popularity are only tie-breakers.
 * Returns coverage so the caller can gate on it — a confident NOT FOUND beats
 * returning the artist's wrong popular video.
 */
function scoreCandidate(item, queryTokenSet) {
  if (!item.id?.startsWith('tt') || !isMusicType(item)) return { score: -1, coverage: 0 };
  const songTokens = candidateSongTokens(item.l);
  if (!songTokens.length) return { score: -1, coverage: 0 };
  const covered = songTokens.filter(token => queryTokenSet.has(token)).length;
  const coverage = covered / songTokens.length;
  let score = coverage * 100;
  if (item.qid === 'musicVideo' || item.q === 'music video') score += 15;
  // Popularity tiebreaker only (tiny), to order otherwise-equal candidates.
  if (typeof item.rank === 'number') score += Math.max(0, 5 - item.rank / 4000);
  return { score, coverage };
}

/**
 * Add romaji transliterations of any Japanese-containing queries. IMDb indexes
 * Japanese titles by their romaji reading (e.g. "夜に駆ける" -> "Yoru ni Kakeru"),
 * so these often hit when the original-script query cannot. No-op when kuromoji
 * is unavailable.
 */
async function withRomajiQueries(queries) {
  const out = [...queries];
  const seen = new Set(queries.map(q => q.toLowerCase()));
  for (const query of queries) {
    if (!/[぀-ヿ一-龯]/.test(query)) continue;
    const romaji = await toRomaji(query);
    if (romaji && romaji.length >= 2 && !seen.has(romaji.toLowerCase())) {
      seen.add(romaji.toLowerCase());
      out.push(romaji);
    }
  }
  return out;
}

async function searchTitle(title) {
  const queries = await withRomajiQueries(buildQueries(title));
  console.log(`[IMDB] "${title}" -> queries: ${JSON.stringify(queries)}`);

  const queryTokens = new Set(queries.flatMap(tokenize));
  const results = await Promise.all(queries.map(query => imdbSuggest(query)));

  let best = null;
  for (const json of results) {
    for (const item of json?.d ?? []) {
      const { score, coverage } = scoreCandidate(item, queryTokens);
      if (score > (best?.score ?? -Infinity)) best = { item, score, coverage };
    }
  }

  // Accept only when the queries actually name the candidate's song — a
  // confident NOT FOUND beats returning the artist's wrong popular video.
  if (best && best.coverage >= 0.6) {
    const { item } = best;
    console.log(`[IMDB] "${title}" -> ${item.id} "${item.l}" (score ${best.score.toFixed(1)}, coverage ${best.coverage.toFixed(2)})`);
    return { tt: item.id, title: item.l, year: item.y ?? '', image: item.i?.imageUrl ?? '' };
  }

  console.log(`[IMDB] "${title}" -> notFound (best "${best?.item?.l ?? 'n/a'}" coverage ${best?.coverage?.toFixed(2) ?? 'n/a'})`);
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
