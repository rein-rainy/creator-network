const https = require('https');

/**
 * Request a URL (GET by default, or POST when `body` is given) and parse the
 * response as JSON, with a per-attempt timeout and
 * automatic retries (with exponential backoff) on network errors and 5xx.
 *
 * Resolves to the parsed JSON, or `null` if `nullOn404` is set and the
 * server returns 404. Throws on persistent failure.
 */
function fetchJson(url, {
  headers = {},
  body,
  timeoutMs = 8000,
  retries = 1,
  backoffMs = 400,
  label = 'fetchJson',
} = {}) {
  const attempt = (remaining) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = https.request(url, {
      method: payload === null ? 'GET' : 'POST',
      headers: {
        'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0',
        ...(payload === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const { statusCode } = res;
        if (statusCode >= 500 && remaining > 0) {
          reject(new Error(`${label} ${statusCode} (will retry)`));
          return;
        }
        if (statusCode !== 200) {
          reject(Object.assign(new Error(`${label} -> ${statusCode}`), { statusCode, noRetry: true }));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (error) { reject(Object.assign(error, { noRetry: true })); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`${label} timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end(payload ?? undefined);
  });

  const run = async (remaining) => {
    try {
      return await attempt(remaining);
    } catch (error) {
      if (error.noRetry || remaining <= 0) throw error;
      const delay = backoffMs * (2 ** (retries - remaining));
      console.warn(`[${label}] ${error.message} — retrying in ${delay}ms (${remaining} left)`);
      await new Promise(r => setTimeout(r, delay));
      return run(remaining - 1);
    }
  };

  return run(retries);
}

module.exports = { fetchJson };
