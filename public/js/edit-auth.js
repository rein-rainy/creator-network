'use strict';

/* ═══════════════════════════════════════════
   EDIT MODE（編集はパスワードを入れた人だけ。それ以外はゲストとして閲覧のみ）
   パスワードは Shift+E で開く入力欄から任意で入力する（画面上にボタンは置かない）。通ればトークンを保存し、次回からは入力不要。
   編集用の UI は .edit-only を付けるか canEdit() で出し分ける（body.can-edit のときだけ表示）。
═══════════════════════════════════════════ */
const EDIT_TOKEN_KEY = 'creator_network_edit_token';
let _editOpen = false; // サーバーがパスワードなしで編集を許可している（ローカル開発）

function _loadEditToken() {
  try { return localStorage.getItem(EDIT_TOKEN_KEY) || ''; } catch { return ''; }
}
function _saveEditToken(token) {
  try { token ? localStorage.setItem(EDIT_TOKEN_KEY, token) : localStorage.removeItem(EDIT_TOKEN_KEY); } catch {}
}

const canEdit = () => document.body.classList.contains('can-edit');

/** Notion を書き換える fetch に付けるヘッダー */
function editHeaders() {
  const token = _loadEditToken();
  return token
    ? { 'Content-Type': 'application/json', 'X-Edit-Token': token }
    : { 'Content-Type': 'application/json' };
}

function _setEditMode(on) {
  const changed = canEdit() !== on;
  document.body.classList.toggle('can-edit', on);
  // 編集用のポップオーバーやパネルが開いたまま残らないように
  if (!on) {
    ['role-picker-popover', 'sns-picker-popover', 'add-creator-dropdown'].forEach(id => document.getElementById(id)?.classList.remove('open'));
  }
  // 開いている人物パネルを描き直す（名前のダブルクリック編集の有無を切り替える）
  const sel = changed && typeof AN !== 'undefined' && AN.find(n => n.id === selId);
  if (sel && sel.type !== 'work' && document.getElementById('info-panel').classList.contains('visible')) showPanel(sel);
}

// パスワード欄は type="text" にして伏せ字は CSS で出す。type="password" がページにあると、ブラウザがログインフォームと見なして
// 「パスワードを保存しますか？」を出したり、検索ボックスにパスワードの候補を出したりするため。
// 伏せ字の CSS に対応していないブラウザだけ type="password" に戻す（見えてしまうよりはよい）
if (!CSS.supports('-webkit-text-security', 'disc')) document.getElementById('edit-password').type = 'password';

function _closeEditLogin() {
  document.getElementById('edit-password').value = ''; // 入力値を残さない
  document.getElementById('edit-login-popover').classList.remove('open');
  document.removeEventListener('mousedown', _closeEditLoginOnOutside);
}
function _closeEditLoginOnOutside(e) {
  const pop = document.getElementById('edit-login-popover');
  if (!pop.contains(e.target)) _closeEditLogin();
}

function _openEditLogin() {
  const pop = document.getElementById('edit-login-popover');
  const input = document.getElementById('edit-password');
  document.getElementById('edit-login-error').textContent = '';
  input.value = '';
  pop.classList.add('open');
  // 押すボタンがないので、トップバーの下の中央に出す
  pop.style.top = 'calc(var(--topbar-h) + 12px)';
  pop.style.left = Math.max(8, (window.innerWidth - pop.offsetWidth) / 2) + 'px';
  input.focus();
  setTimeout(() => document.addEventListener('mousedown', _closeEditLoginOnOutside), 0);
}

async function _submitEditLogin() {
  const input = document.getElementById('edit-password');
  const submit = document.getElementById('edit-login-submit');
  const errorEl = document.getElementById('edit-login-error');
  if (!input.value) return;
  submit.disabled = true;
  errorEl.textContent = '';
  try {
    const res = await fetch('/auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: input.value }),
    });
    const data = await res.json();
    if (!data.token) throw new Error(data.error || 'ログインできませんでした');
    _saveEditToken(data.token);
    _setEditMode(true);
    _closeEditLogin();
    showToast('編集モードになりました');
  } catch (e) {
    errorEl.textContent = e.message;
    input.select();
  } finally {
    submit.disabled = false;
  }
}

async function _checkEditMode() {
  try {
    const res = await fetch('/auth-check', { method: 'POST', headers: editHeaders(), body: '{}' });
    const data = await res.json();
    _editOpen = !!data.open;
    if (!data.editor) _saveEditToken(''); // パスワードが変わったなどで使えなくなったトークンは捨てる
    _setEditMode(!!data.editor);
  } catch {
    // サーバーに届かないときは保存済みトークンの有無で仮に決める（書き込み時にサーバーが改めて確認する）
    _setEditMode(!!_loadEditToken());
  }
}

// Shift+E：ゲストならパスワード入力を開く（もう一度で閉じる）、編集モードならゲストに戻る
// ブラウザのショートカットと重ならないよう ⌘/Ctrl/Alt は使わない。文字入力中は反応しない
document.addEventListener('keydown', e => {
  if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.code !== 'KeyE') return;
  const t = e.target;
  if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
  e.preventDefault();
  if (_editOpen) { showToast('この環境はパスワードなしで編集できます'); return; }
  if (canEdit()) {
    _saveEditToken('');
    _setEditMode(false);
    showToast('ゲストモードに戻りました');
    return;
  }
  const pop = document.getElementById('edit-login-popover');
  pop.classList.contains('open') ? _closeEditLogin() : _openEditLogin();
});
document.getElementById('edit-login-submit').addEventListener('click', _submitEditLogin);
document.getElementById('edit-login-close').addEventListener('click', _closeEditLogin);
document.getElementById('edit-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') _submitEditLogin();
  if (e.key === 'Escape') _closeEditLogin();
});

// 保存済みトークンがあれば確認を待たずに編集モードで表示する（ちらつき防止）
_setEditMode(!!_loadEditToken());
_checkEditMode();
