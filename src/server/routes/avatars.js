const { jsonRoute, HttpError } = require('../http');
const { searchArtistImage, extractIgUsername, fetchIgProfilePic } = require('../services/avatars');
const { handleImageProxyRoute } = require('../services/imageProxy');
const { processInChunks } = require('../util/concurrency');

const toProxyUrl = url => `/avatar-img/${Buffer.from(url).toString('base64')}`;

async function handleAvatarRoutes(req, res) {
  if (handleImageProxyRoute(req, res, '/avatar-img/', 'avatar-img')) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/avatar', label: 'Avatar Error' }, async ({ artistName }) => {
    if (!artistName) throw new Error('artistName が指定されていません');
    const result = await searchArtistImage(artistName);
    if (!result?.imageUrl) throw new HttpError(404, `"${artistName}" の画像が見つかりませんでした`, { error: `"${artistName}" の画像が見つかりませんでした` });
    return result;
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/avatar-batch', label: 'Batch Error' }, async ({ artists = [] }) => {
    if (!artists.length) throw new Error('artists が空です');
    const results = {};
    await processInChunks(
      artists,
      ({ artistName }) =>
        searchArtistImage(artistName)
          .then(result => { results[artistName] = result; })
          .catch(() => { results[artistName] = null; }),
      { concurrency: 5, delayMs: 100 }
    );
    return { results };
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/ig-avatar', label: 'IG Avatar Error' }, async ({ instagramUrl, username: rawUsername }) => {
    const username = rawUsername || extractIgUsername(instagramUrl);
    if (!username) throw new Error('有効な Instagram URL または username が必要です');

    const profilePicUrl = await fetchIgProfilePic(username);
    if (!profilePicUrl) throw new HttpError(404, 'not found', { error: `"${username}" のプロフィール画像が見つかりませんでした` });

    return { proxyUrl: toProxyUrl(profilePicUrl), profilePicUrl, username };
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/ig-avatar-batch', label: 'IG Batch Error' }, async ({ items = [] }) => {
    if (!items.length) throw new Error('items が空です');
    const results = {};
    await processInChunks(
      items,
      async ({ notionPageId, instagramUrl }) => {
        const username = extractIgUsername(instagramUrl);
        const profilePicUrl = username ? await fetchIgProfilePic(username).catch(() => null) : null;
        results[notionPageId] = profilePicUrl
          ? { proxyUrl: toProxyUrl(profilePicUrl), profilePicUrl, username }
          : null;
      },
      { concurrency: 3, delayMs: 300 }
    );
    return { results };
  })) return true;

  return false;
}

module.exports = { handleAvatarRoutes };
