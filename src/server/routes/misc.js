const { readJson, sendJson } = require('../http');
const { searchYoutubeVideos } = require('../services/youtube');
const { translateToJapanese } = require('../services/translate');

async function handleMiscRoutes(req, res) {
  if (req.method === 'POST' && req.url === '/youtube-video-search') {
    try {
      const { titles = [] } = await readJson(req);
      return sendJson(res, 200, await searchYoutubeVideos(titles));
    } catch (error) {
      console.error('[YouTube.js Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'POST' && req.url === '/translate') {
    try {
      const { text } = await readJson(req);
      if (!text) return sendJson(res, 400, { error: 'text required' });
      return sendJson(res, 200, { translated: await translateToJapanese(text) });
    } catch (error) {
      console.error('[DeepL]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  return false;
}

module.exports = { handleMiscRoutes };
