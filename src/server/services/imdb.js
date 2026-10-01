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

// IMDb's own web frontend talks to this GraphQL endpoint; it needs no API key
// but only accepts POST. Its responses carry a "non-commercial use only" notice.
const IMDB_GRAPHQL_URL = 'https://caching.graphql.imdb.com/';

function imdbGraphql(query, variables) {
  return apiCache.wrap(JSON.stringify([query, variables]), async () => {
    const json = await fetchJson(IMDB_GRAPHQL_URL, {
      body: { query, variables },
      headers: { 'x-imdb-client-name': 'imdb-web-next' },
      label: 'IMDb-GraphQL',
      timeoutMs: 10000,
    });
    if (json.errors?.length && !json.data) throw new Error(json.errors[0].message);
    return json.data;
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

const TITLE_QUERY = `query Title($id: ID!) {
  title(id: $id) {
    titleText { text } originalTitleText { text }
    releaseYear { year }
    ratingsSummary { aggregateRating voteCount }
    primaryImage { url }
    genres { genres { text } }
    runtime { seconds }
    plot { plotText { plainText } }
    credits(first: 100) {
      edges { node {
        category { id }
        name { id nameText { text } primaryImage { url } }
        ... on Cast { characters { name } }
        ... on Crew { jobs { text } }
      } }
    }
  }
}`;

async function fetchCrew(tt) {
  console.log(`[IMDB-Crew] ${tt} 取得開始`);
  let title;
  try {
    title = (await imdbGraphql(TITLE_QUERY, { id: tt }))?.title;
  } catch (error) {
    throw new Error(`タイトル情報取得失敗: ${error.message}`);
  }
  if (!title) throw new Error(`タイトル情報取得失敗: ${tt} が見つかりません`);

  const result = {
    title: title.titleText?.text ?? title.originalTitleText?.text ?? '',
    year: title.releaseYear?.year ?? '',
    rating: title.ratingsSummary?.aggregateRating ?? null,
    votes: title.ratingsSummary?.voteCount ?? null,
    poster: title.primaryImage?.url ?? '',
    genres: (title.genres?.genres ?? []).map(genre => genre.text),
    runtime: title.runtime?.seconds ? Math.round(title.runtime.seconds / 60) : null,
    plot: title.plot?.plotText?.plainText ?? '',
    directors: [],
    cast: [],
    writers: [],
    crew: [],
  };

  for (const { node: credit } of title.credits?.edges ?? []) {
    const id = credit.name?.id ?? '';
    const name = credit.name?.nameText?.text ?? '';
    const image = credit.name?.primaryImage?.url ?? '';
    const cat = credit.category?.id ?? '';
    const job = (credit.jobs ?? []).map(j => j.text).join(', ');
    if (cat === 'director') result.directors.push({ id, name, image });
    else if (cat === 'actor' || cat === 'actress' || cat === 'self') {
      result.cast.push({ id, name, image, characters: (credit.characters ?? []).map(c => c.name), category: cat });
    } else if (cat === 'writer') result.writers.push({ id, name, image });
    else result.crew.push({ id, name, image, job, category: cat });
  }

  console.log(`[IMDB-Crew] ${tt} 完了 — 監督${result.directors.length} キャスト${result.cast.length} クルー${result.crew.length}`);
  return result;
}

/** Lowercase, drop punctuation and all whitespace: "Cho Gi-seok" -> "chogiseok". */
function compactName(str) {
  return (str || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
}

// Resolving tt + crew for each linked work costs two requests; a handful is plenty.
const MAX_HINT_WORKS = 5;

/**
 * Find the person among the credits of works they are known to be on. This is
 * the reliable path: a bare name search can't tell "Samson" the MV director
 * from "Samson" the actor, but the MV's own credits can.
 */
async function findNameInWorks(name, workTitles) {
  const target = compactName(name);
  if (!target) return null;
  for (const workTitle of workTitles.slice(0, MAX_HINT_WORKS)) {
    try {
      const hit = await searchTitle(workTitle);
      if (hit.notFound) continue;
      const crew = await fetchCrew(hit.tt);
      const people = [...crew.directors, ...crew.writers, ...crew.crew, ...crew.cast];
      const person = people.find(p => p.id && compactName(p.name) === target)
        ?? people.find(p => {
          const candidate = compactName(p.name);
          return p.id && candidate.length >= 3 && (candidate.includes(target) || target.includes(candidate));
        });
      if (person) {
        console.log(`[IMDB-Name] "${name}" -> ${person.id} (credits of ${hit.tt})`);
        return { nameId: person.id, name: person.name, image: person.image };
      }
    } catch (error) {
      console.warn(`[IMDB-Name] "${workTitle}" の照合に失敗: ${error.message}`);
    }
  }
  return null;
}

async function searchName(name, workTitles = []) {
  const fromWorks = await findNameInWorks(name, workTitles);
  if (fromWorks) return fromWorks;

  const result = await imdbSuggest(name);
  if (!result?.d) return { notFound: true };

  // Fallback without work context: prefer an exact name match, then directors.
  const target = compactName(name);
  const nameItems = result.d.filter(item => item.id?.startsWith('nm'));
  const exact = nameItems.filter(item => compactName(item.l) === target);
  const pool = exact.length ? exact : nameItems;
  const found = pool.find(item => /\bDirector\b/i.test(item.s || ''))
    ?? pool[0];

  if (!found) return { notFound: true };
  return { nameId: found.id, name: found.l, image: found.i?.imageUrl ?? '' };
}

const FILMOGRAPHY_QUERY = `query Filmography($id: ID!, $after: ID) {
  name(id: $id) {
    credits(first: 250, after: $after) {
      total
      pageInfo { hasNextPage endCursor }
      edges { node {
        category { id }
        title {
          id titleText { text } originalTitleText { text }
          titleType { id } releaseYear { year }
          ratingsSummary { aggregateRating } primaryImage { url }
        }
        ... on Cast { characters { name } }
        ... on Crew { jobs { text } }
      } }
    }
  }
}`;

/** Reshape a GraphQL credit into the {title:{primaryTitle,type,…}, category} form the client renders. */
function toFilmographyCredit(node) {
  const title = node.title ?? {};
  return {
    category: node.category?.id ?? '',
    jobs: (node.jobs ?? []).map(j => j.text),
    characters: (node.characters ?? []).map(c => c.name),
    title: {
      id: title.id,
      primaryTitle: title.titleText?.text ?? title.originalTitleText?.text ?? '',
      type: title.titleType?.id ?? 'unknown',
      startYear: title.releaseYear?.year ?? null,
      rating: title.ratingsSummary?.aggregateRating ? { aggregateRating: title.ratingsSummary.aggregateRating } : null,
      primaryImage: title.primaryImage?.url ? { url: title.primaryImage.url } : null,
    },
  };
}

async function fetchFilmography(nameId) {
  console.log(`[IMDB-Filmography] ${nameId} 取得開始`);
  const startTime = Date.now();
  const allCredits = [];
  let after = null;
  let totalCount = 0;
  let page = 0;

  do {
    const credits = (await imdbGraphql(FILMOGRAPHY_QUERY, { id: nameId, after }))?.name?.credits;
    console.log(`[IMDB-Filmography] page ${page + 1} 取得完了 (${Date.now() - startTime}ms)`);
    allCredits.push(...(credits?.edges ?? []).map(edge => toFilmographyCredit(edge.node)));
    totalCount = credits?.total ?? totalCount;
    after = credits?.pageInfo?.hasNextPage ? credits.pageInfo.endCursor : null;
    page++;
  } while (after && page < 2);

  return {
    credits: allCredits,
    totalCount: totalCount || allCredits.length,
    nextPageToken: after || undefined,
  };
}

// IMDb lists a person's credits newest first. One page of 250 covers even
// the most prolific MV directors (Dave Meyers has ~220).
const DIRECTOR_MUSIC_VIDEOS_QUERY = `query DirectorMusicVideos($id: ID!) {
  name(id: $id) {
    primaryImage { url }
    credits(first: 250, filter: { categories: ["director"], titleType: ["musicVideo"] }) {
      edges { node { title {
        id titleText { text } originalTitleText { text }
        releaseYear { year }
        releaseDate { day month year }
        ratingsSummary { aggregateRating voteCount }
      } } }
    }
  }
}`;

async function fetchDirectorMusicVideos(nameId) {
  const data = await imdbGraphql(DIRECTOR_MUSIC_VIDEOS_QUERY, { id: nameId });
  const credits = (data?.name?.credits?.edges ?? []).map(({ node }) => {
    const title = node.title ?? {};
    const date = title.releaseDate ?? {};
    return {
      tt: title.id,
      title: title.titleText?.text ?? title.originalTitleText?.text ?? '',
      year: date.year ?? title.releaseYear?.year ?? null,
      month: date.month ?? null,
      day: date.day ?? null,
      rating: title.ratingsSummary?.aggregateRating ?? null,
      votes: title.ratingsSummary?.voteCount ?? 0,
    };
  });
  return { image: data?.name?.primaryImage?.url ?? '', credits };
}

module.exports = {
  imdbSuggestionUrl,
  searchTitle,
  fetchCrew,
  searchName,
  fetchFilmography,
  fetchDirectorMusicVideos,
};
