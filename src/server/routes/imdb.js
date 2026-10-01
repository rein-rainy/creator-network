const { jsonRoute } = require('../http');
const { handleImageProxyRoute } = require('../services/imageProxy');
const { searchTitle, fetchCrew, searchName, fetchFilmography, fetchRecentDirectorCredits } = require('../services/imdb');

async function handleImdbRoutes(req, res) {
  if (handleImageProxyRoute(req, res, '/imdb-img/', 'imdb-img')) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/imdb-search', label: 'IMDB Error' }, async ({ title }) => {
    if (!title) throw new Error('title が指定されていません');
    return searchTitle(title);
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/imdb-crew', label: 'IMDB-Crew Error' }, async ({ tt }) => {
    if (!tt) throw new Error('tt が指定されていません');
    return fetchCrew(tt);
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/imdb-name-search', label: 'IMDB-Name Error' }, async ({ name, workTitles }) => {
    if (!name) throw new Error('name が指定されていません');
    return searchName(name, Array.isArray(workTitles) ? workTitles : []);
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/imdb-filmography', label: 'IMDB-Filmography Error' }, async ({ nameId }) => {
    if (!nameId) throw new Error('nameId が指定されていません');
    return fetchFilmography(nameId);
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/imdb-recent-credits', label: 'IMDB-Recent Error' }, async ({ nameId }) => {
    if (!nameId) throw new Error('nameId が指定されていません');
    return fetchRecentDirectorCredits(nameId);
  })) return true;

  return false;
}

module.exports = { handleImdbRoutes };
