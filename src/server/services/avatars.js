const https = require('https');
const config = require('../config');

const IG_CACHE_TTL_MS = 60 * 60 * 1000;
const SPOTIFY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const igAvatarCache = new Map();
const spotifyAvatarCache = new Map();

function extractIgUsername(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('instagram.com')) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[0] || null;
  } catch {
    return null;
  }
}

async function fetchIgProfilePic(username) {
  if (!username) return null;

  const cached = igAvatarCache.get(username);
  if (cached && Date.now() < cached.expireAt) {
    if (cached.profilePicUrl === null) return null;
    return cached.profilePicUrl;
  }

  if (!config.RAPIDAPI_KEY) {
    console.warn('[IG] RAPIDAPI_KEY が未設定のためスキップ');
    return null;
  }

  // RapidAPI「Instagram best experience」（GET /profile?username=）。
  // 以前使っていた Instagram120 は RapidAPI から取り下げられた（404 "API doesn't exists"）。
  const IG_API_HOST = 'instagram-best-experience.p.rapidapi.com';
  return new Promise((resolve) => {
    const options = {
      hostname: IG_API_HOST,
      path: `/profile?username=${encodeURIComponent(username)}`,
      method: 'GET',
      headers: {
        'x-rapidapi-host': IG_API_HOST,
        'x-rapidapi-key': config.RAPIDAPI_KEY,
      },
    };

    const req = https.request(options, (igRes) => {
      let data = '';
      igRes.setEncoding('utf8'); // 日本語が切れ目をまたいでも文字化けしないように
      igRes.on('data', chunk => data += chunk);
      igRes.on('end', () => {
        try {
          if (igRes.statusCode !== 200) {
            // API の取り下げ・購読切れ・無料枠の使い切りなどに気づけるよう、理由を残す
            console.warn(`[IG] "${username}": HTTP ${igRes.statusCode} ${data.slice(0, 200)}`);
            igAvatarCache.set(username, { profilePicUrl: null, status: igRes.statusCode, expireAt: Date.now() + IG_CACHE_TTL_MS });
            return resolve(null);
          }

          const user = JSON.parse(data);
          const profilePicUrl = user?.hd_profile_pic_url_info?.url || user?.profile_pic_url || null;
          if (!profilePicUrl) {
            console.warn(`[IG] "${username}": プロフィール画像が見つからない ${data.slice(0, 200)}`);
            igAvatarCache.set(username, { profilePicUrl: null, status: 404, expireAt: Date.now() + IG_CACHE_TTL_MS });
            return resolve(null);
          }

          igAvatarCache.set(username, { profilePicUrl, expireAt: Date.now() + IG_CACHE_TTL_MS });
          resolve(profilePicUrl);
        } catch (error) {
          console.warn(`[IG] "${username}": レスポンス解析失敗: ${error.message}`);
          resolve(null);
        }
      });
    });
    req.on('error', (error) => {
      console.warn(`[IG] "${username}": リクエストエラー: ${error.message}`);
      resolve(null);
    });
    req.end();
  });
}

async function searchArtistImage(artistName) {
  const cached = spotifyAvatarCache.get(artistName);
  if (cached && Date.now() < cached.expireAt) {
    return { imageUrl: cached.imageUrl, artistName: cached.artistName };
  }

  return new Promise((resolve) => {
    const options = {
      hostname: 'spotify23.p.rapidapi.com',
      path: `/search/?q=${encodeURIComponent(artistName)}&type=artists&offset=0&limit=1`,
      method: 'GET',
      headers: {
        'x-rapidapi-host': 'spotify23.p.rapidapi.com',
        'x-rapidapi-key': config.RAPIDAPI_KEY,
      },
    };

    https.get(options, (res) => {
      let data = '';
      res.setEncoding('utf8'); // 日本語が切れ目をまたいでも文字化けしないように
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const artistData = json.artists?.items?.[0]?.data;
          if (!artistData) return resolve(null);

          const imageUrl = artistData.visuals?.avatarImage?.sources?.[0]?.url;
          const nameInApi = artistData.profile?.name || artistName;
          if (!imageUrl) return resolve(null);

          spotifyAvatarCache.set(artistName, {
            imageUrl,
            artistName: nameInApi,
            expireAt: Date.now() + SPOTIFY_CACHE_TTL_MS,
          });
          resolve({ imageUrl, artistName: nameInApi });
        } catch (error) {
          console.warn(`[Spotify] "${artistName}" レスポンス解析失敗: ${error.message}`);
          resolve(null);
        }
      });
    }).on('error', (error) => {
      console.warn(`[Spotify] "${artistName}" リクエストエラー: ${error.message}`);
      resolve(null);
    });
  });
}

module.exports = { extractIgUsername, fetchIgProfilePic, searchArtistImage };
