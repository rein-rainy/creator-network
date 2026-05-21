const https = require('https');

function proxyImage(imageUrl, res, endpoint = 'unknown') {
  try {
    const parsed = new URL(imageUrl);
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET' },
      (upstream) => {
        if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
          console.log(`[Img Proxy:${endpoint}] Redirecting from ${imageUrl} to ${upstream.headers.location}`);
          proxyImage(upstream.headers.location, res, endpoint);
          return;
        }

        res.writeHead(upstream.statusCode === 200 ? 200 : upstream.statusCode, {
          'Content-Type': upstream.headers['content-type'] || 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
        });
        upstream.pipe(res);
        upstream.on('error', (error) => {
          console.error(`[Img Proxy:${endpoint}] Upstream stream error for ${imageUrl}:`, error.message);
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Proxy stream error');
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Upstream request timed out'));
    });
    req.setTimeout(10000);
    req.on('error', (error) => {
      console.error(`[Img Proxy:${endpoint}] Request error for ${imageUrl}:`, error.message);
      res.writeHead(502);
      res.end();
    }).end();
  } catch (error) {
    console.error('[Img] URL parse error:', error.message);
    res.writeHead(400);
    res.end();
  }
}

module.exports = { proxyImage };
