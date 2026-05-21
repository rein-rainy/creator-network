/* ═══════════════════════════════════════════
   ARTIST AVATAR (Spotify via RapidAPI)
   フロー:
     1. アーティスト名 → サーバー /avatar へ POST
        → サーバーのキャッシュまたは Spotify API で検索
        → { imageUrl, artistName } を返す
     2. /avatar-img/<base64(imageUrl)> でプロキシ取得
     3. cache[artistName] = proxyUrl で保存
     4. node.avatar にセット → DOM反映
═══════════════════════════════════════════ */

// ── キャッシュ構造 ──────────────────────────────────────────────────────────
// localStorage に保存するオブジェクト:
//   { artistName → proxyUrl }
// キー名を更新することで古い Deezer キャッシュを無効化
const AVATAR_CACHE_KEY = 'creator_avatar_spotify_v1';

function loadAvatarCache() {
  try {
    return JSON.parse(localStorage.getItem(AVATAR_CACHE_KEY) || '{}');
  } catch { return {}; }
}

function saveAvatarCache(cache) {
  try { localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

// ── Instagram アバターキャッシュ ────────────────────────────────────────────
// localStorage に保存するオブジェクト:
//   { notionPageId → proxyUrl }
// ※ キーは notionPageId（名前ではなく ID）で管理。Instagram URL が変更されても
//   Notion側のページIDは不変のため、古いキャッシュが残るリスクが少ない。

const IG_AVATAR_CACHE_KEY = 'creator_avatar_instagram_v1';

function loadIgAvatarCache() {
  try {
    return JSON.parse(localStorage.getItem(IG_AVATAR_CACHE_KEY) || '{}');
  } catch { return {}; }
}

function saveIgAvatarCache(cache) {
  try { localStorage.setItem(IG_AVATAR_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

// Instagram SNSリンクを sns 配列から抽出
function extractInstagramUrl(snsArray) {
  if (!Array.isArray(snsArray)) return null;
  const igEntry = snsArray.find(s => s && s.label === 'Instagram' && s.url);
  return igEntry ? igEntry.url : null;
}

// DOM のアバター欄を画像にフェードインで差し替える
function applyAvatarToDOM(node) {
  const cardEl = document.querySelector(`.pnode-card[data-id="${node.id}"]`);
  if (!cardEl) return;
  const avatarDiv = cardEl.querySelector('.pnode-avatar');
  if (!avatarDiv) return;
  const initial = [...node.label][0] || '?';
  const isDir = node.type === 'director';
  const nodeBg = isDir ? 'var(--node-dir)' : 'var(--node-art)';

  const img = document.createElement('img');
  img.className = 'avatar-img';  // opacity:0 からスタート
  img.src = node.avatar;
  img.alt = '';
  img.style.cssText = 'width:100%;height:100%;object-fit:cover';

  img.onload = () => {
    // イニシャル span を除去してから画像をフェードイン
    avatarDiv.querySelectorAll('.pnode-initial').forEach(el => el.remove());
    avatarDiv.appendChild(img);
    requestAnimationFrame(() => img.classList.add('loaded'));
  };
  img.onerror = () => {
    // 失敗時: 青背景＋イニシャルをそのまま維持
    console.warn(`[Avatar] ${node.label}: 画像ロード失敗`, node.avatar);
    avatarDiv.style.background = nodeBg;
    if (!avatarDiv.querySelector('.pnode-initial')) {
      const span = document.createElement('span');
      span.className = 'pnode-initial';
      span.textContent = initial;
      avatarDiv.appendChild(span);
    }
  };
  // DOM に入れずに先読みスタート（onload/onerror が発火したら上記で処理）
  img.src = node.avatar;

  // パネルが同じノードを表示中なら ph-avatar も更新
  if (selId === node.id) {
    const phAvatar = document.getElementById('ph-avatar');
    if (phAvatar && phAvatar.style.display !== 'none') {
      phAvatar.innerHTML = '';
      const pImg = document.createElement('img');
      pImg.src = node.avatar; pImg.alt = '';
      pImg.style.cssText = 'width:100%;height:100%;object-fit:cover';
      pImg.onerror = () => {
        phAvatar.style.background = nodeBg;
        phAvatar.innerHTML = `<span class="pnode-initial">${initial}</span>`;
      };
      phAvatar.appendChild(pImg);
    }
  }
}


// ── Intersection Observer ベースの遅延アバター取得 ─────────────────────────
// 画面内に入ったノードカードを検出し、未取得のアーティストのみ順次フェッチする

let _avatarObserver = null;          // 現在の IntersectionObserver
const _avatarFetching = new Set();   // 処理中のノードID（重複防止）
const _avatarFetchQueue = [];        // 可視になった順の待機キュー
let _avatarQueueTimer = null;        // キュー処理タイマー

// アバター取得前はイニシャル表示をそのまま維持（青背景はノード生成時に設定済み）
function applyAvatarLoading(_node) { /* no-op */ }

// キューに溜まったノードを一定間隔でバッチ処理
async function _processAvatarQueue() {
  _avatarQueueTimer = null;
  if (!_avatarFetchQueue.length) return;

  const cache = loadAvatarCache();

  // キューを取り出す（最大20件ずつ）
  const batch = _avatarFetchQueue.splice(0, 20);
  const toFetch = [];

  for (const node of batch) {
    if (_avatarFetching.has(node.id)) continue;
    if (node.avatar) continue;  // 既に取得済み

    // キャッシュヒット → 即反映
    if (cache[node.label]) {
      node.avatar = cache[node.label];
      console.log(`[Avatar] ${node.label}: キャッシュヒット`);
      applyAvatarToDOM(node);
    } else {
      toFetch.push(node);
      _avatarFetching.add(node.id);
    }
  }

  if (!toFetch.length) {
    // まだキューが残っている場合は次を処理
    if (_avatarFetchQueue.length) _scheduleAvatarQueue();
    return;
  }

  console.log(`[Avatar] ${toFetch.length}件を取得中...`, toFetch.map(n => n.label));

  const artists = toFetch.map(node => ({
    artistName: node.label,
    workTitles: (node.works || []).map(wid => AN.find(n => n.id === wid)?.label).filter(Boolean),
  }));

  let results = {};
  try {
    const res = await fetch('/avatar-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artists }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    results = data.results || {};
  } catch (e) {
    console.error('[Avatar] バッチ取得失敗:', e);
    toFetch.forEach(n => _avatarFetching.delete(n.id));
    if (_avatarFetchQueue.length) _scheduleAvatarQueue();
    return;
  }

  for (const node of toFetch) {
    _avatarFetching.delete(node.id);
    const result = results[node.label];
    if (!result || !result.imageUrl) {
      console.warn(`[Avatar] ${node.label}: 取得失敗 → 青背景のまま`);
      continue;
    }
    const proxyUrl = `/avatar-img/${btoa(result.imageUrl)}`;
    node.avatar = proxyUrl;
    cache[node.label] = proxyUrl;
    console.log(`[Avatar] ${node.label}: 完了`);
    applyAvatarToDOM(node);
  }
  saveAvatarCache(cache);

  // キューに残りがあれば続きを処理
  if (_avatarFetchQueue.length) _scheduleAvatarQueue();
}

function _scheduleAvatarQueue() {
  if (_avatarQueueTimer) return;
  _avatarQueueTimer = setTimeout(_processAvatarQueue, 80);
}

// SVG の foreignObject は画面スクロールでも位置が変わるため
// canvas の transform 変化後に再チェックする仕組みも持つ
function setupAvatarObserver() {
  // 既存のオブザーバーを破棄
  if (_avatarObserver) { _avatarObserver.disconnect(); _avatarObserver = null; }
  _avatarFetchQueue.length = 0;

  const cache = loadAvatarCache();

  // artist ノードのカード要素を全取得して監視開始
  const targets = AN.filter(n => n.type === 'artist' && !n.avatar);
  if (!targets.length) { console.log('[Avatar] 取得対象なし'); return; }
  console.log(`[Avatar] ${targets.length}件を監視開始`);

  // パルスを即時適用（ロード待ち状態を視覚化）
  for (const node of targets) {
    if (cache[node.label]) {
      // キャッシュあり → パルス不要、即反映
      node.avatar = cache[node.label];
      applyAvatarToDOM(node);
    } else {
      applyAvatarLoading(node);
    }
  }

  const uncached = targets.filter(n => !n.avatar);
  if (!uncached.length) { console.log('[Avatar] 全キャッシュヒット'); return; }

  _avatarObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const id = entry.target.dataset.id;
      const node = AN.find(n => n.id === id);
      if (!node || node.avatar || _avatarFetching.has(id)) continue;
      // 既にキューに入っていなければ追加
      if (!_avatarFetchQueue.find(n => n.id === id)) {
        _avatarFetchQueue.push(node);
        _scheduleAvatarQueue();
      }
      // 監視解除（一度キューに入れたら不要）
      _avatarObserver.unobserve(entry.target);
    }
  }, {
    root: null,           // ビューポート基準
    rootMargin: '60px',   // 60px 手前から先読み
    threshold: 0,
  });

  // 現在 DOM にあるカードを監視登録
  for (const node of uncached) {
    const cardEl = document.querySelector(`.pnode-card[data-id="${node.id}"]`);
    if (cardEl) _avatarObserver.observe(cardEl);
  }
}

// draw() が呼ばれるたびに新しい DOM を再監視するためのエントリポイント
function fetchArtistAvatars() {
  // rAF 後に DOM が確定してから監視を開始
  requestAnimationFrame(() => setupAvatarObserver());
}

// ── Director/Creator の Instagram アバター取得 ─────────────────────────────
// 画面内に表示されている全ノードを一括取得（クールダウンなし）。
// キャッシュ済みはスキップ（永久保存）。
//
// フロー:
//   1. director ノードのうち Instagram URL あり を対象に登録
//   2. キャッシュヒット → 即反映（スキップ）
//   3. 画面内（IntersectionObserver で可視）のノードを全収集
//   4. 未取得ノードをまとめて並列フェッチ → node.avatar にセット → DOM反映

const _igFetching   = new Set();     // 処理中 nodeId（重複防止）

// 1件 /ig-avatar を叩いて結果を返す（クールダウンなし）
async function _fetchOneIgAvatar(node) {
  if (_igFetching.has(node.id) || node.avatar) return;
  _igFetching.add(node.id);
  const igUrl = extractInstagramUrl(node.sns);
  const key   = node.notionPageId || node.id;

  console.log(`[IG Avatar] ${node.label}: 取得開始`);
  try {
    const res = await fetch('/ig-avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instagramUrl: igUrl }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // proxyUrl から画像をフェッチして Base64 データURIに変換してキャッシュ
    // （インスタの画像URLは数日で失効するため、画像データ自体を保存する）
    let avatarData = data.proxyUrl; // フォールバック用に URL も保持
    try {
      const imgRes = await fetch(data.proxyUrl, { signal: AbortSignal.timeout(10000) });
      if (imgRes.ok) {
        const blob = await imgRes.blob();
        avatarData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('FileReader失敗'));
          reader.readAsDataURL(blob);
        });
      }
    } catch (imgErr) {
      console.warn(`[IG Avatar] ${node.label}: 画像Base64変換失敗（URLをフォールバック使用）`, imgErr.message);
    }

    node.avatar = avatarData;
    const cache = loadIgAvatarCache();
    cache[key] = avatarData;   // 永久キャッシュ（Base64データURIで保存）
    saveIgAvatarCache(cache);
    console.log(`[IG Avatar] ${node.label}: 完了 (${data.username})`);
    applyAvatarToDOM(node);
  } catch (e) {
    console.warn(`[IG Avatar] ${node.label}: 取得失敗 — ${e.message}`);
  } finally {
    _igFetching.delete(node.id);
  }
}

// draw() 後に呼ぶエントリポイント
function fetchDirectorIgAvatars() {
  requestAnimationFrame(() => _setupIgObserver());
}

function _setupIgObserver() {
  const cache = loadIgAvatarCache();

  // Instagram URL を持つ director ノードが対象
  const targets = AN.filter(n => n.type === 'director' && extractInstagramUrl(n.sns));
  if (!targets.length) { console.log('[IG Avatar] 取得対象なし'); return; }
  console.log(`[IG Avatar] ${targets.length}件を確認`);

  // キャッシュヒット → 即反映（スキップ）
  // data: URI のみ有効。URL文字列は失効している可能性があるため破棄して再取得
  for (const node of targets) {
    const key = node.notionPageId || node.id;
    if (cache[key]) {
      if (cache[key].startsWith('data:')) {
        node.avatar = cache[key];
        console.log(`[IG Avatar] ${node.label}: キャッシュヒット（スキップ）`);
        applyAvatarToDOM(node);
      } else {
        // 旧形式（URL）は削除して再取得
        console.log(`[IG Avatar] ${node.label}: 旧URLキャッシュを破棄して再取得`);
        delete cache[key];
      }
    }
  }
  saveIgAvatarCache(cache); // 旧形式を削除した場合に備えて保存

  const uncached = targets.filter(n => !n.avatar);
  if (!uncached.length) { console.log('[IG Avatar] 全キャッシュヒット'); return; }
  console.log(`[IG Avatar] 未キャッシュ ${uncached.length}件を一括取得`);

  // 画面内に見えているノードを収集し、全件を並列フェッチ（クールダウンなし）
  const visibleNodes = [];
  const hiddenNodes  = [];

  for (const node of uncached) {
    const cardEl = document.querySelector(`.pnode-card[data-id="${node.id}"]`);
    if (!cardEl) continue;
    const rect = cardEl.getBoundingClientRect();
    const inView = rect.top < window.innerHeight + 60 && rect.bottom > -60
                && rect.left < window.innerWidth  + 60 && rect.right  > -60;
    if (inView) visibleNodes.push(node);
    else        hiddenNodes.push(node);
  }

  // 画面内ノードを並列で一括取得
  if (visibleNodes.length) {
    console.log(`[IG Avatar] 画面内 ${visibleNodes.length}件を並列取得`);
    Promise.all(visibleNodes.map(node => _fetchOneIgAvatar(node)));
  }

  // 画面外ノードは IntersectionObserver で可視化したタイミングで並列取得
  if (hiddenNodes.length) {
    const obs = new IntersectionObserver((entries) => {
      const toFetch = [];
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id   = entry.target.dataset.id;
        const node = AN.find(n => n.id === id);
        if (!node || node.avatar || _igFetching.has(id)) continue;
        toFetch.push(node);
        obs.unobserve(entry.target);
      }
      if (toFetch.length) {
        console.log(`[IG Avatar] 新たに画面内 ${toFetch.length}件を並列取得`);
        Promise.all(toFetch.map(node => _fetchOneIgAvatar(node)));
      }
    }, { root: null, rootMargin: '60px', threshold: 0 });

    for (const node of hiddenNodes) {
      const cardEl = document.querySelector(`.pnode-card[data-id="${node.id}"]`);
      if (cardEl) obs.observe(cardEl);
    }
  }
}
