const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
};

function servePublicFile(req, res, publicDir) {
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  const relativePath = pathname.replace(/^\/+/, '');
  if (!relativePath) return false;

  const filePath = path.join(publicDir, relativePath);
  if (!filePath.startsWith(publicDir + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;

  const contentType = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': contentType.startsWith('text/html') ? 'no-cache' : 'public, max-age=86400',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(filePath).pipe(res);
  return true;
}

/**
 * Serve `public/index.html` for `GET`/`HEAD` of `/` or `/index.html`.
 * Returns true if the request matched (and a response was sent).
 */
function serveIndex(req, res, publicDir) {
  const isIndexRequest = (req.method === 'GET' || req.method === 'HEAD')
    && (req.url === '/' || req.url === '/index.html');
  if (!isIndexRequest) return false;

  const htmlFile = path.join(publicDir, 'index.html');
  try {
    if (!fs.existsSync(htmlFile)) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body>
          <h1>Server Error</h1>
          <p>HTML file not found at: ${htmlFile}</p>
          <p>Please ensure public/index.html exists in the application directory.</p>
        </body>
        </html>
      `);
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    res.end(fs.readFileSync(htmlFile, 'utf-8'));
    return true;
  } catch (error) {
    console.error('[Static file error]', error.message);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Error reading HTML file: ${error.message}`);
    return true;
  }
}

module.exports = { servePublicFile, serveIndex };
