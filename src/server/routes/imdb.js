const { readJson, sendJson } = require('../http');
const { proxyImage } = require('../services/imageProxy');
const { searchTitle, fetchCrew, searchName, fetchFilmography } = require('../services/imdb');

async function handleImdbRoutes(req, res) {
  if (req.method === 'GET' && req.url.startsWith('/imdb-img/')) {
    const encoded = req.url.slice('/imdb-img/'.length).split('?')[0];
    if (!encoded) {
      res.writeHead(400);
      res.end('imageUrl required');
      return true;
    }
    try {
      const imageUrl = Buffer.from(encoded, 'base64').toString('utf-8');
      new URL(imageUrl);
      proxyImage(imageUrl, res, 'imdb-img');
    } catch {
      res.writeHead(400);
      res.end('invalid imageUrl');
    }
    return true;
  }

  if (req.method === 'POST' && req.url === '/imdb-search') {
    try {
      const { title } = await readJson(req);
      if (!title) throw new Error('title が指定されていません');
      return sendJson(res, 200, await searchTitle(title));
    } catch (error) {
      console.error('[IMDB Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'POST' && req.url === '/imdb-crew') {
    try {
      const { tt } = await readJson(req);
      if (!tt) throw new Error('tt が指定されていません');
      return sendJson(res, 200, await fetchCrew(tt));
    } catch (error) {
      console.error('[IMDB-Crew Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'POST' && req.url === '/imdb-name-search') {
    try {
      const { name } = await readJson(req);
      if (!name) throw new Error('name が指定されていません');
      return sendJson(res, 200, await searchName(name));
    } catch (error) {
      console.error('[IMDB-Name Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'POST' && req.url === '/imdb-filmography') {
    try {
      const { nameId } = await readJson(req);
      if (!nameId) throw new Error('nameId が指定されていません');
      return sendJson(res, 200, await fetchFilmography(nameId));
    } catch (error) {
      console.error('[IMDB-Filmography Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  return false;
}

module.exports = { handleImdbRoutes };
