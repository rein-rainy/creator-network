const https = require('https');
const config = require('../config');

async function translateToJapanese(text) {
  if (!text) throw new Error('text required');
  if (!config.DEEPL_API_KEY) throw new Error('DEEPL_API_KEY が設定されていません');

  const isFree = config.DEEPL_API_KEY.endsWith(':fx');
  const hostname = isFree ? 'api-free.deepl.com' : 'api.deepl.com';
  const postData = new URLSearchParams({ text, target_lang: 'JA' }).toString();

  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path: '/v2/translate',
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${config.DEEPL_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200) reject(new Error(json.message || `DeepL ${res.statusCode}`));
          else resolve(json.translations?.[0]?.text ?? '');
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

module.exports = { translateToJapanese };
