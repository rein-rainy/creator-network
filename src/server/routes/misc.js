const { jsonRoute, HttpError } = require('../http');
const { searchYoutubeVideos } = require('../services/youtube');
const { translateToJapanese } = require('../services/translate');

async function handleMiscRoutes(req, res) {
  if (await jsonRoute(req, res, { method: 'POST', path: '/youtube-video-search', label: 'YouTube.js Error' }, async ({ titles = [] }) => {
    return searchYoutubeVideos(titles);
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/translate', label: 'DeepL' }, async ({ text }) => {
    if (!text) throw new HttpError(400, 'text required', { error: 'text required' });
    return { translated: await translateToJapanese(text) };
  })) return true;

  return false;
}

module.exports = { handleMiscRoutes };
