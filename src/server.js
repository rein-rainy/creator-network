/**
 * Creator Network local server
 * Start: node server.js
 * URL: http://localhost:3000
 */
require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./server/config');
const { servePublicFile } = require('./server/static');
const { notFound } = require('./server/http');
const { handleAvatarRoutes } = require('./server/routes/avatars');
const { handleImdbRoutes } = require('./server/routes/imdb');
const { handleMiscRoutes } = require('./server/routes/misc');
const { handleNotionRoutes } = require('./server/routes/notion');

const HTML_FILE = path.join(config.PUBLIC_DIR, 'index.html');

if (!config.NOTION_TOKEN) {
  console.warn('[Warning] 環境変数 NOTION_TOKEN が設定されていません。');
  console.warn('[Warning] /notion-* エンドポイントは動作しません。');
  if (!config.isProduction) {
    console.warn('[Info] ローカル開発の場合: NOTION_TOKEN=your_token node server.js');
  }
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function serveIndex(req, res) {
  if (!((req.method === 'GET' || req.method === 'HEAD') && (req.url === '/' || req.url === '/index.html'))) {
    return false;
  }

  try {
    if (!fs.existsSync(HTML_FILE)) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body>
          <h1>Server Error</h1>
          <p>HTML file not found at: ${HTML_FILE}</p>
          <p>Please ensure public/index.html exists in the application directory.</p>
        </body>
        </html>
      `);
      return true;
    }

    const html = fs.readFileSync(HTML_FILE, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    res.end(html);
    return true;
  } catch (error) {
    console.error('[Static file error]', error.message);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Error reading HTML file: ${error.message}`);
    return true;
  }
}

const routeHandlers = [
  handleAvatarRoutes,
  handleImdbRoutes,
  handleMiscRoutes,
  handleNotionRoutes,
];

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && servePublicFile(req, res, config.PUBLIC_DIR)) return;
  if (serveIndex(req, res)) return;

  for (const handler of routeHandlers) {
    if (await handler(req, res)) return;
  }

  notFound(res);
});

server.on('error', (error) => {
  console.error('[Server Error]', error.message);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${config.PORT} is already in use`);
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception]', error.message);
  if (config.isProduction) {
    console.error('Fatal error - exiting');
    process.exit(1);
  }
});

server.listen(config.PORT, () => {
  console.log('');
  console.log('  Creator Network サーバー起動中');
  if (config.isProduction) {
    console.log(`  Heroku app running on port ${config.PORT}`);
  } else {
    console.log(`  http://localhost:${config.PORT} をブラウザで開いてください`);
  }
  console.log('');
  console.log('  必要な環境変数:');
  console.log('    NOTION_TOKEN — Notion 統合トークン（必須）');
  console.log('    DEEPL_API_KEY — DeepL APIキー（オプション）');
  console.log('    YOUTUBE_API_KEY — YouTube APIキー（オプション）');
  console.log('    RAPIDAPI_KEY — RapidAPI キー（instagram120.p.rapidapi.com / spotify23.p.rapidapi.com）');
  console.log('');
  console.log(config.NOTION_TOKEN
    ? '  NOTION_TOKEN が設定されています'
    : '  NOTION_TOKEN が設定されていません — /notion-* エンドポイントは使用不可');
  console.log(config.RAPIDAPI_KEY
    ? '  RapidAPI avatar endpoints are enabled'
    : '  RAPIDAPI_KEY 未設定 — avatar endpoints are limited');
  console.log('');
});
