const path = require('path');

const PORT = process.env.PORT || 3000;
const IS_HEROKU = !!process.env.DYNO;
const isProduction = process.env.NODE_ENV === 'production' || IS_HEROKU;

module.exports = {
  PORT,
  IS_HEROKU,
  isProduction,
  NOTION_TOKEN: process.env.NOTION_TOKEN,
  DEEPL_API_KEY: process.env.DEEPL_API_KEY,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  RAPIDAPI_KEY: process.env.RAPIDAPI_KEY,
  DB_WORKS: '18860905b37f80358899e51e4e514f92',
  DB_CREATORS: '18860905b37f8093954fdb1bb9602c18',
  DB_ARTISTS: '2d260905b37f80fbae0de6cb61a03091',
  PUBLIC_DIR: path.join(__dirname, '..', '..', 'public'),
};
