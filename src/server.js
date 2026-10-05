/**
 * Creator Network local server
 * Start: node server.js
 * URL: http://localhost:3000
 */
require('dotenv').config();

const http = require('http');
const config = require('./server/config');
const { servePublicFile, serveIndex } = require('./server/static');
const { notFound } = require('./server/http');
const { handleAvatarRoutes } = require('./server/routes/avatars');
const { handleImdbRoutes } = require('./server/routes/imdb');
const { handleMiscRoutes } = require('./server/routes/misc');
const { handleNotionRoutes } = require('./server/routes/notion');

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
  if (serveIndex(req, res, config.PUBLIC_DIR)) return;

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
  console.log('    RAPIDAPI_KEY — RapidAPI キー（instagram-best-experience.p.rapidapi.com / spotify23.p.rapidapi.com）');
  console.log('');
  console.log(config.NOTION_TOKEN
    ? '  NOTION_TOKEN が設定されています'
    : '  NOTION_TOKEN が設定されていません — /notion-* エンドポイントは使用不可');
  console.log(config.RAPIDAPI_KEY
    ? '  RapidAPI avatar endpoints are enabled'
    : '  RAPIDAPI_KEY 未設定 — avatar endpoints are limited');
  console.log('');
});
