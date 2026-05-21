const { readJson, sendJson } = require('../http');
const { searchArtistImage, extractIgUsername, fetchIgProfilePic } = require('../services/avatars');
const { proxyImage } = require('../services/imageProxy');

async function handleAvatarRoutes(req, res) {
  if (req.method === 'POST' && req.url === '/avatar') {
    try {
      const { artistName } = await readJson(req);
      if (!artistName) throw new Error('artistName が指定されていません');
      const result = await searchArtistImage(artistName);
      if (!result?.imageUrl) return sendJson(res, 404, { error: `"${artistName}" の画像が見つかりませんでした` });
      return sendJson(res, 200, result);
    } catch (error) {
      console.error('[Avatar Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'POST' && req.url === '/avatar-batch') {
    try {
      const { artists = [] } = await readJson(req);
      if (!artists.length) throw new Error('artists が空です');

      const results = {};
      const CONCURRENCY = 5;
      const DELAY_MS = 100;
      for (let i = 0; i < artists.length; i += CONCURRENCY) {
        const chunk = artists.slice(i, i + CONCURRENCY);
        const settled = await Promise.all(
          chunk.map(({ artistName }) =>
            searchArtistImage(artistName)
              .then(result => ({ artistName, result }))
              .catch(() => ({ artistName, result: null }))
          )
        );
        settled.forEach(({ artistName, result }) => { results[artistName] = result; });
        if (i + CONCURRENCY < artists.length) await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
      return sendJson(res, 200, { results });
    } catch (error) {
      console.error('[Batch Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/avatar-img/')) {
    const encoded = req.url.slice('/avatar-img/'.length).split('?')[0];
    if (!encoded) {
      res.writeHead(400);
      res.end('imageUrl required');
      return true;
    }
    try {
      const imageUrl = Buffer.from(encoded, 'base64').toString('utf-8');
      new URL(imageUrl);
      proxyImage(imageUrl, res, 'avatar-img');
    } catch {
      res.writeHead(400);
      res.end('invalid imageUrl');
    }
    return true;
  }

  if (req.method === 'POST' && req.url === '/ig-avatar') {
    try {
      const { instagramUrl, username: rawUsername } = await readJson(req);
      const username = rawUsername || extractIgUsername(instagramUrl);
      if (!username) throw new Error('有効な Instagram URL または username が必要です');

      const profilePicUrl = await fetchIgProfilePic(username);
      if (!profilePicUrl) return sendJson(res, 404, { error: `"${username}" のプロフィール画像が見つかりませんでした` });

      const proxyUrl = `/avatar-img/${Buffer.from(profilePicUrl).toString('base64')}`;
      return sendJson(res, 200, { proxyUrl, profilePicUrl, username });
    } catch (error) {
      console.error('[IG Avatar Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'POST' && req.url === '/ig-avatar-batch') {
    try {
      const { items = [] } = await readJson(req);
      if (!items.length) throw new Error('items が空です');

      const results = {};
      const CONCURRENCY = 3;
      const DELAY_MS = 300;
      for (let i = 0; i < items.length; i += CONCURRENCY) {
        const chunk = items.slice(i, i + CONCURRENCY);
        const settled = await Promise.all(chunk.map(async ({ notionPageId, instagramUrl }) => {
          const username = extractIgUsername(instagramUrl);
          if (!username) return { notionPageId, result: null };
          const profilePicUrl = await fetchIgProfilePic(username).catch(() => null);
          if (!profilePicUrl) return { notionPageId, result: null };
          const proxyUrl = `/avatar-img/${Buffer.from(profilePicUrl).toString('base64')}`;
          return { notionPageId, result: { proxyUrl, profilePicUrl, username } };
        }));
        settled.forEach(({ notionPageId, result }) => { results[notionPageId] = result; });
        if (i + CONCURRENCY < items.length) await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
      return sendJson(res, 200, { results });
    } catch (error) {
      console.error('[IG Batch Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  return false;
}

module.exports = { handleAvatarRoutes };
