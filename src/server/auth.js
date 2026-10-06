const crypto = require('crypto');
const config = require('./config');

// 編集用パスワード（EDIT_PASSWORD）を知っている人だけが Notion を書き換えられる。それ以外はゲスト（閲覧のみ）。
// トークンはパスワードから決まる値なので、サーバーを再起動しても有効なまま。パスワードを変えると全員ログアウトになる。
// EDIT_PASSWORD 未設定のときは、ローカルでは誰でも編集でき、本番では誰も編集できない。
const TOKEN_HEADER = 'x-edit-token';

const editToken = () => config.EDIT_PASSWORD
  ? crypto.createHmac('sha256', config.EDIT_PASSWORD).update('creator-network-edit').digest('hex')
  : null;

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function isOpenEditing() {
  return !config.EDIT_PASSWORD && !config.isProduction;
}

function isEditor(req) {
  if (isOpenEditing()) return true;
  const token = editToken();
  return !!token && safeEqual(req.headers[TOKEN_HEADER], token);
}

/** パスワードが合っていればトークンを返す。総当たりを遅らせるため、外れたときは少し待ってから返す */
async function login(password) {
  if (config.EDIT_PASSWORD && safeEqual(password, config.EDIT_PASSWORD)) return editToken();
  await new Promise(resolve => setTimeout(resolve, 800));
  return null;
}

module.exports = { TOKEN_HEADER, isEditor, isOpenEditing, login };
