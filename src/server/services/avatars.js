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

  return new Promise((resolve) => {
    const postData = JSON.stringify({ username });
    const options = {
      hostname: 'instagram120.p.rapidapi.com',
      path: '/api/instagram/profile',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-rapidapi-host': 'instagram120.p.rapidapi.com',
        'x-rapidapi-key': config.RAPIDAPI_KEY,
      },
    };

    const req = https.request(options, (igRes) => {
      let data = '';
      igRes.on('data', chunk => data += chunk);
      igRes.on('end', () => {
        try {
          if (igRes.statusCode !== 200) {
            igAvatarCache.set(username, { profilePicUrl: null, status: igRes.statusCode, expireAt: Date.now() + IG_CACHE_TTL_MS });
            return resolve(null);
          }

          const json = JSON.parse(data);
          const user = json?.result;
          if (!user) {
            igAvatarCache.set(username, { profilePicUrl: null, status: 404, expireAt: Date.now() + IG_CACHE_TTL_MS });
            return resolve(null);
          }

          const profilePicUrl = user.profile_pic_url_hd || user.profile_pic_url || null;
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
    req.write(postData);
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
