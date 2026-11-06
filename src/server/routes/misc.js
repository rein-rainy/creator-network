const { jsonRoute, HttpError } = require('../http');
const { searchYoutubeVideos } = require('../services/youtube');
const { translateToJapanese } = require('../services/translate');
const { getUrlPreview } = require('../services/urlPreview');

async function handleMiscRoutes(req, res) {
  if (await jsonRoute(req, res, { method: 'POST', path: '/youtube-video-search', label: 'YouTube.js Error' }, async ({ titles = [] }) => {
    return searchYoutubeVideos(titles);
  })) return true;

  // URL からタイトル・サムネイルなどを取る（作品の追加フォームの補完）。サーバーから任意の URL を読みに行くので編集モードだけ
  if (await jsonRoute(req, res, { method: 'POST', path: '/url-preview', label: 'URL Preview Error', editor: true }, async ({ url }) => {
    try {
      return await getUrlPreview(url);
    } catch (error) {
      throw new HttpError(422, error.message, { error: error.message });
    }
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/translate', label: 'DeepL' }, async ({ text }) => {
    if (!text) throw new HttpError(400, 'text required', { error: 'text required' });
    return { translated: await translateToJapanese(text) };
  })) return true;

  return false;
}

module.exports = { handleMiscRoutes };
