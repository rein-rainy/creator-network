/* ═══════════════════════════════════════════
   ADD WORK — URL から作品を追加する（編集モードのみ）
   PC では Save to Notion 拡張で入れているものを、スマホからも入れられるように。
   1. URL を貼ると、サーバー（/url-preview）がタイトル・サムネイル・チャンネル・説明文を返す
   2. タイトルとチャンネル名から登録済みのアーティストを、説明文のクレジットから登録済みのクリエイターを探して最初から入れておく
   3. カテゴリ・クリエイター・アーティストを直して Notion に追加（フォームは最新作品の保存と共通：mountWorkSaveForm）
   ?add=<URL> で開くと、その URL を入れた状態で開く（Android の共有メニューからも）
═══════════════════════════════════════════ */
const ADD_WORK_DEFAULT_TAGS = ['MV'];
let _addWorkPending = null;   // 編集モードに入ったら開く URL（共有から開いたがまだログインしていないとき）

/** 名前が文章の中に出てくるか。英数字の名前は単語の区切りで見る（「Ado」が「Adore」に当たらないように） */
function _nameInText(name, text, compactText) {
  const n = (name || '').normalize('NFKC').toLowerCase().trim();
  if (!n) return false;
  if (/^[\x00-\x7f]+$/.test(n)) {
    if (n.replace(/[^a-z0-9]/g, '').length < 3) return false;
    const re = new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}($|[^a-z0-9])`);
    return re.test(text);
  }
  const c = _recentCompact(n);
  return c.length >= 2 && compactText.includes(c);
}

/** タイトルとチャンネル名から、登録済みのアーティストを探す */
function _guessArtists(preview) {
  const text = `${preview.title} ${preview.channel?.name || ''}`.normalize('NFKC').toLowerCase();
  const compactText = _recentCompact(text);
  const channel = _recentCompact(preview.channel?.name || '');
  return ALL_ARTISTS.filter(a => {
    const key = _recentCompact(a.Name);
    if (!key || !a.notionPageId) return false;
    // 公式チャンネル（「YOASOBI Official」など）は名前で始まる
    if (channel && key.length >= 2 && channel.startsWith(key)) return true;
    return _nameInText(a.Name, text, compactText);
  });
}

/** 説明文（クレジット）とタイトルから、登録済みのクリエイターを探す。別名も見る */
function _guessCreators(preview) {
  const text = `${preview.title}\n${preview.description || ''}`.normalize('NFKC').toLowerCase();
  const compactText = _recentCompact(text);
  return ALL_CREATORS.filter(c => c.notionPageId
    && [c.Name, ...(getCreatorMeta(c.Name).aliases || [])].some(name => _nameInText(name, text, compactText)));
}

function _creatorPerson(c) {
  const node = AN.find(n => n.type === 'director' && n.notionPageId && n.notionPageId === c.notionPageId);
  return { name: c.Name, notionPageId: c.notionPageId, avatar: node?.avatar || c.Avatar || '', role: c.Role || '' };
}

/** グラフにすでにある作品（同じ YouTube の動画か、同じ URL） */
function _findExistingWork(url) {
  const vid = ytid(url);
  return AN.find(n => n.type === 'work' && n.url && (vid ? ytid(n.url) === vid : n.url === url)) || null;
}

/** 文章の中の最初の URL（共有メニューからはタイトルと URL がまとめて来ることがある） */
function _firstUrl(text) {
  return (String(text || '').match(/https?:\/\/[^\s<>"']+/) || [''])[0];
}

function openAddWorkPanel(initialUrl = '') {
  if (!canEdit()) {
    _addWorkPending = initialUrl || '';
    showToast('作品を追加するには編集モードに入ってください');
    if (typeof _openEditLogin === 'function') _openEditLogin();
    return;
  }
  stopYtIframe();
  selId = null; hovId = null; applyHL(null, null);

  document.getElementById('pt').textContent = 'NEW WORK';
  const pnEl = document.getElementById('pn');
  pnEl.textContent = '作品を追加';
  pnEl.ondblclick = null; pnEl.title = ''; pnEl.style.cursor = '';
  document.getElementById('ph-avatar').style.display = 'none';
  ['pc-search', 'pc-notion'].forEach(id => { document.getElementById(id).style.display = 'none'; });

  const canPaste = !!navigator.clipboard?.readText;
  const pc2 = document.getElementById('pc2');
  pc2.innerHTML = `
    <div class="aw-thumb" id="aw-thumb" hidden></div>
    <div class="panel-section aw-url-section">
      <div class="aw-url-row">
        <input type="url" class="cmeta-input" id="aw-url" placeholder="YouTube などの URL" inputmode="url"
               autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
        ${canPaste ? '<button type="button" class="btn btn-secondary btn-md" id="aw-paste">貼り付け</button>' : ''}
      </div>
      <div class="aw-status" id="aw-status">URL を貼ると、タイトルとカバー画像を読み込みます</div>
    </div>
    <div class="panel-section" id="aw-form" hidden>
      <div class="prop-list">
        <div class="prop-row"><div class="prop-label">タイトル</div><div class="prop-value"><input type="text" class="cmeta-input" id="aw-title" autocomplete="off"></div></div>
        <div class="prop-row prop-row-sm"><div class="prop-label">カテゴリ</div><div class="prop-value" id="aw-tags"></div></div>
        <div class="prop-row"><div class="prop-label">クリエイター</div><div class="prop-value" id="aw-creators"></div></div>
        <div class="prop-row"><div class="prop-label">アーティスト</div><div class="prop-value" id="aw-artists"></div></div>
      </div>
      <div class="aw-note" id="aw-note"></div>
      <button class="btn btn-primary btn-block prop-submit" id="aw-save">Notion に追加</button>
    </div>`;

  const panel = document.getElementById('info-panel');
  const overlay = document.getElementById('info-overlay');
  panel.classList.remove('mode-side', 'above-gallery', 'above-filmography');
  overlay.classList.remove('above-gallery', 'above-filmography');
  panel.classList.add('mode-modal', 'visible');
  overlay.classList.add('visible');
  pc2.scrollTop = 0;

  const urlInput = document.getElementById('aw-url');
  const statusEl = document.getElementById('aw-status');
  const thumbEl = document.getElementById('aw-thumb');
  const formEl = document.getElementById('aw-form');
  const titleInput = document.getElementById('aw-title');
  const noteEl = document.getElementById('aw-note');
  const saveBtn = document.getElementById('aw-save');

  let preview = null;   // 読み込めた URL の情報
  let form = null;      // { selected, creators, artists }
  let reqSeq = 0;
  let lastUrl = '';

  const setStatus = (html, kind = '') => {
    statusEl.className = 'aw-status' + (kind ? ` ${kind}` : '');
    statusEl.innerHTML = html;
  };

  async function load(raw) {
    const url = _firstUrl(raw) || raw.trim();
    if (!url || url === lastUrl) return;
    lastUrl = url;
    if (!/^https?:\/\//i.test(url)) { setStatus('http から始まる URL を入れてください', 'err'); return; }
    const seq = ++reqSeq;
    preview = null;
    formEl.hidden = true;
    thumbEl.hidden = true;
    setStatus('<span class="spinner"></span>読み込み中…');
    try {
      const r = await fetch('/url-preview', { method: 'POST', headers: editHeaders(), body: JSON.stringify({ url }) });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
      if (seq !== reqSeq || !pc2.contains(urlInput)) return;
      preview = data;
      showPreview();
    } catch (e) {
      if (seq !== reqSeq || !pc2.contains(urlInput)) return;
      lastUrl = '';
      setStatus(`読み込めませんでした：${esc(e.message)}`, 'err');
    }
  }

  function showPreview() {
    const existing = _findExistingWork(preview.url);
    const meta = [preview.provider, preview.channel?.name].filter(Boolean).map(esc).join(' · ');
    if (existing) {
      setStatus(`${meta ? `${meta}<br>` : ''}この作品は登録済みです <button type="button" class="btn btn-secondary btn-xs" id="aw-open-existing">開く</button>`, 'warn');
      document.getElementById('aw-open-existing').addEventListener('click', () => {
        selId = existing.id; applyHL(selId, 'click'); showPanel(existing);
      });
    } else {
      setStatus(meta);
    }

    if (preview.thumbnail) {
      thumbEl.innerHTML = `<img class="player-thumb" alt="" src="${esc(preview.thumbnail)}" onerror="this.parentElement.hidden = true">`;
      thumbEl.hidden = false;
    }

    titleInput.value = preview.title;
    const creators = _guessCreators(preview).map(_creatorPerson);
    const artists = _guessArtists(preview).map(_artistPerson);
    const isVideo = preview.provider === 'YouTube' || preview.provider === 'Vimeo';
    const { selected } = mountWorkSaveForm({
      tagsEl: document.getElementById('aw-tags'),
      creatorsEl: document.getElementById('aw-creators'),
      artistsEl: document.getElementById('aw-artists'),
      tags: isVideo ? ADD_WORK_DEFAULT_TAGS : [], creators, artists,
    });
    form = { selected, creators, artists };
    const found = [];
    if (creators.length) found.push(preview.description ? '説明文から見つけたクリエイター' : 'タイトルから見つけたクリエイター');
    if (artists.length) found.push('タイトルとチャンネルから見つけたアーティスト');
    noteEl.textContent = found.length ? `${found.join('と、')}を入れています。違っていたら × で外してください。` : '';
    formEl.hidden = false;
    saveBtn.disabled = !!existing;
    saveBtn.textContent = existing ? '登録済みです' : 'Notion に追加';
  }

  urlInput.addEventListener('paste', () => setTimeout(() => load(urlInput.value), 0));
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); load(urlInput.value); } });
  let typingTimer = null;
  urlInput.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => load(urlInput.value), 600);
  });
  document.getElementById('aw-paste')?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const url = _firstUrl(text) || text.trim();
      if (!url) { setStatus('クリップボードに URL がありません', 'err'); return; }
      urlInput.value = url;
      load(url);
    } catch {
      setStatus('貼り付けできませんでした。入力欄を長押しして貼り付けてください', 'err');
      urlInput.focus();
    }
  });

  saveBtn.addEventListener('click', async () => {
    if (!preview || !form) return;
    const title = titleInput.value.trim();
    if (!title) { titleInput.focus(); showToast('タイトルを入れてください', 'err'); return; }
    saveBtn.disabled = true;
    saveBtn.textContent = '追加中…';
    try {
      const categories = [...form.selected];
      const res = await _recentPost('/notion-create-work', {
        title, url: preview.url, coverUrl: preview.thumbnail || '', categories,
        creatorPageIds: form.creators.map(p => p.notionPageId).filter(Boolean),
        artistPageIds: form.artists.map(a => a.notionPageId).filter(Boolean),
      });
      const { workNode } = addSavedWorkToGraph(res.workPageId, {
        title, url: preview.url, categories, creators: form.creators, artists: form.artists,
      });
      showToast(res.alreadyExists ? 'Notion に同じ URL の作品がありました' : 'Notion に追加しました');
      // グラフに描き足して、追加した作品を開く
      closeInfoPanel();
      refresh();
      selId = workNode.id;
      applyHL(selId, 'click');
      showPanel(workNode);
    } catch (e) {
      console.error('[AddWork]', e);
      showToast(`✗ 追加できませんでした: ${e.message}`, 'err', 6000);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Notion に追加';
    }
  });

  if (initialUrl) { urlInput.value = initialUrl; load(initialUrl); }
  else if (!MOBILE_MQ.matches) urlInput.focus();   // スマホは自分で押すまでキーボードを出さない
}

document.getElementById('add-work-btn').addEventListener('click', () => openAddWorkPanel());

// 編集モードに入ったら、待っていた URL で開く
new MutationObserver(() => {
  if (_addWorkPending !== null && canEdit()) {
    const url = _addWorkPending;
    _addWorkPending = null;
    openAddWorkPanel(url);
  }
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

/* ?add=<URL>（共有メニュー・ショートカットから）。データを読み込んでから開く */
(function openFromQuery() {
  const params = new URLSearchParams(location.search);
  const shared = params.get('add') || params.get('url') || _firstUrl(params.get('text')) || '';
  if (!shared) return;
  history.replaceState(null, '', location.pathname);   // 再読み込みで二重に開かないように
  const started = Date.now();
  const tryOpen = () => {
    if (AN.length || Date.now() - started > 15000) openAddWorkPanel(shared);
    else setTimeout(tryOpen, 300);
  };
  window.addEventListener('load', tryOpen);
})();
