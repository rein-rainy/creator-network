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

module.exports = { servePublicFile };
