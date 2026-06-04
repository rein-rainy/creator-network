function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  res.writeHead(404);
  res.end('Not found');
}

/**
 * Error carrying an HTTP status (and optional custom JSON payload).
 * Throw from a route handler to respond with a non-500 status.
 */
class HttpError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

/**
 * Match a JSON endpoint and run `fn` with the parsed request body.
 * Handles body parsing, success response, and unified error handling.
 * Returns true if the request matched (and a response was sent).
 */
async function jsonRoute(req, res, { method, path, label }, fn) {
  if (req.method !== method || req.url !== path) return false;
  try {
    const body = await readJson(req);
    sendJson(res, 200, await fn(body));
  } catch (error) {
    // HttpError is an intentional, expected response (404/503 etc.) — not a fault to log.
    if (!(error instanceof HttpError)) console.error(`[${label}]`, error.message);
    sendJson(res, error.status || 500, error.payload || { error: error.message });
  }
  return true;
}

module.exports = { readJson, sendJson, notFound, HttpError, jsonRoute };
