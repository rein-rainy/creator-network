const { jsonRoute, HttpError } = require('../http');
const auth = require('../auth');

async function handleAuthRoutes(req, res) {
  // 保存済みのトークンがまだ使えるか（パスワード変更で無効になる）
  if (await jsonRoute(req, res, { method: 'POST', path: '/auth-check', label: 'Auth Check Error' }, async () => {
    return { editor: auth.isEditor(req), open: auth.isOpenEditing() };
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/auth-login', label: 'Auth Login Error' }, async ({ password }) => {
    const token = await auth.login(password);
    if (!token) throw new HttpError(401, 'wrong password', { error: 'パスワードが違います' });
    return { token };
  })) return true;

  return false;
}

module.exports = { handleAuthRoutes };
