/* ═══════════════════════════════════════════
   IMDB INTEGRATION
═══════════════════════════════════════════ */
const _imdbCache       = new Map(); // tt → data
const _imdbTtCache     = new Map(); // workTitle → tt | 'NOT_FOUND'

/* ── 名前類似度ユーティリティ ─────────────────────────────
   normalize: 大文字小文字・記号・空白を統一
   nameSimilarity: 0.0〜1.0 のスコアを返す
     - 完全一致        → 1.0
     - 一方が他方を含む → 0.85〜0.95
     - トークン部分一致 → 共通トークン数で按分
   IMDB_NAME_THRESHOLD: この値以上なら「同一人物とみなす」
─────────────────────────────────────────────────────── */
const IMDB_NAME_THRESHOLD = 0.72;

function _normName(s) {
  return (s || '').toLowerCase()
    .replace(/[·•．・\-_''.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// スペースを完全除去した形（"chogiseok" と "cho gi seok" を同一視するため）
function _compact(s) { return s.replace(/\s/g, ''); }

function nameSimilarity(a, b) {
  const na = _normName(a), nb = _normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;

  // スペース除去後の完全一致（例: "chogiseok" vs "cho gi seok"）
  if (_compact(na) === _compact(nb)) return 0.97;

  // 通常の包含チェック（スペースあり）
  if (na.includes(nb) || nb.includes(na)) {
    const longer = Math.max(na.length, nb.length);
    const shorter = Math.min(na.length, nb.length);
    return 0.75 + 0.2 * (shorter / longer);
  }

  // スペース除去後の包含チェック（例: "chogiseok" vs "cho gi seok extra"）
  const ca = _compact(na), cb = _compact(nb);
  if (ca.includes(cb) || cb.includes(ca)) {
    const longer = Math.max(ca.length, cb.length);
    const shorter = Math.min(ca.length, cb.length);
    return 0.70 + 0.2 * (shorter / longer);
  }

  // トークン単位の Jaccard 類似度
  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  let inter = 0;
  ta.forEach(t => { if (tb.has(t)) inter++; });
  const union = ta.size + tb.size - inter;
  return union > 0 ? inter / union : 0;
}

/** IMDbの名前 imdbName が、グラフ上のクリエイターノード群のいずれかと
 *  閾値以上一致するか判定し、一致したノードIDを返す（なければ null）*/
function findMatchedCreatorNode(imdbName, workNodeId) {
  let best = null, bestScore = 0;
  AN.forEach(n => {
    if (n.type !== 'director' && n.type !== 'artist') return;
    // このノードが workNode とリンクされているか確認
    const linked = AL.some(l => {
      const s = lid(l.source), t = lid(l.target);
      return (s === n.id && t === workNodeId) || (t === n.id && s === workNodeId);
    });
    if (!linked) return;
    const score = nameSimilarity(imdbName, n.label || '');
    if (score > bestScore) { bestScore = score; best = n.id; }
  });
  return bestScore >= IMDB_NAME_THRESHOLD ? best : null;
}
const _translateCache  = new Map(); // 原文 → 訳文

async function translatePlot(text) {
  if (!text) return text;
  if (_translateCache.has(text)) return _translateCache.get(text);
  try {
    const r = await fetch('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const d = await r.json();
    if (d.translated) { _translateCache.set(text, d.translated); return d.translated; }
  } catch (e) { console.warn('[DeepL]', e); }
  return text; // 失敗時は原文を返す
}

function categoryLabel(cat) {
  const map = {
    director: '監督', writer: '脚本', producer: 'プロデューサー',
    composer: '音楽', cinematographer: '撮影', editor: '編集',
    production_designer: 'プロダクションデザイン',
    casting_director: 'キャスティング',
    costume_designer: '衣装',
    self: '本人出演', archive_footage: 'アーカイブ映像',
    archive_sound: 'アーカイブ音声',
  };
  return map[cat] || cat;
}

function imdbProxyImg(url) {
  if (!url) return null;
  return `/imdb-img/${btoa(url)}`;
}

function personImgHtml(imgUrl, phIcon, imgClass, phClass) {
  if (imgUrl) {
    return `<img class="${esc(imgClass)}" src="${esc(imdbProxyImg(imgUrl))}" alt="" loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <div class="${esc(phClass)}" style="display:none">${phIcon}</div>`;
  }
  return `<div class="${esc(phClass)}">${phIcon}</div>`;
}

/** 作品パネルの「IMDb 情報」セクションの枠（中身は renderImdbData が埋める） */
function imdbSectionHtml(panelId) {
  return `<div id="imdb-section-${esc(panelId)}" class="panel-section imdb-section">
    <div class="section-label"><span>IMDb 情報</span></div>
    <div id="imdb-found-${esc(panelId)}"></div>
    <div id="imdb-body-${esc(panelId)}"><div class="loading-row"><div class="spinner"></div>読み込み中…</div></div>
  </div>`;
}

function renderImdbData(panelId, data, workNode = null) {
  const body    = document.getElementById(`imdb-body-${panelId}`);
  const foundEl = document.getElementById(`imdb-found-${panelId}`);
  if (!body) return;

  if (data.notFound) {
    body.innerHTML = `<div class="empty-note">IMDbに情報が見つかりませんでした</div>`;
    return;
  }

  // ── ヘッダー: タイトル・年・評価 ──────────────────────────────────
  if (foundEl) {
    let chips = '';
    if (data.rating) chips += `<span class="imdb-chip rating">${STAR_ICON}${data.rating}</span>`;
    if (data.votes)  chips += `<span class="imdb-chip">${Number(data.votes).toLocaleString('ja-JP')}票</span>`;
    if (data.year)   chips += `<span class="imdb-chip">${data.year}</span>`;
    foundEl.innerHTML = `
      <div class="imdb-found">
        <span class="imdb-found-title">${esc(data.title || '')}</span>
        ${chips}
      </div>`;
  }

  const directors = data.directors || [];
  const cast      = data.cast      || [];
  const crew      = data.crew      || [];
  const writers   = data.writers   || [];

  // クルー重複排除（writersがcrewに含まれる場合）
  const crewNames = new Set(crew.map(p => p.name));
  const allCrew   = [
    ...directors.map(p => ({ ...p, category: 'director' })),
    ...writers.map(p => ({ ...p, category: 'writer' })).filter(p => !crewNames.has(p.name)),
    ...crew,
  ];

  let html = '';

  // ── 基本情報: ジャンル・上映時間・あらすじ ───────────────────────────
  const infoChips = [];
  if (data.runtime) infoChips.push(`<span class="imdb-chip">${data.runtime}分</span>`);
  (data.genres || []).forEach(g => infoChips.push(`<span class="imdb-chip">${esc(g)}</span>`));
  if (infoChips.length || data.plot) {
    html += `<div class="imdb-meta-row">`;
    if (infoChips.length) html += `<div class="imdb-info-grid">${infoChips.join('')}</div>`;
    if (data.plot) html += `<div class="imdb-plot">${esc(data.plot)}</div>`;
    html += `</div>`;
  }

  // work-person-btn と同じカードUI（横スクロール）、クリックでフィルモグラフィー表示
  // workNode が渡された場合は＋ボタンを表示して参加クリエイターに追加できる
  // rawImgUrl: IMDb 側の元画像URL（カバー設定用）
  const imdbPersonCard = (name, role, imgSrc, kind, rawImgUrl = '', _workNode = workNode, nameId = '') => {
    const avatarClass = kind === 'art' ? ' art' : '';
    const initial  = esc([...name][0] || '?');
    const showRole = role && role.trim() && role.trim().toLowerCase() !== name.trim().toLowerCase();
    const img = imgSrc ? `<img src="${esc(imgSrc)}" alt="" onerror="this.remove()">` : '';

    // 完全一致 OR 名前類似度が閾値以上のノードとリンクされていれば追加済みとみなす
    const alreadyAdded = _workNode
      ? !!findMatchedCreatorNode(name, _workNode.id)
      : false;

    const plusBtn = _workNode ? `
      <button class="card-corner-btn imdb-add-creator-btn${alreadyAdded ? ' is-added' : ''}"
        data-name="${esc(name)}" data-raw-img="${esc(rawImgUrl)}"
        title="${esc(name)}${alreadyAdded ? 'は参加クリエイターに追加済み' : 'を参加クリエイターに追加'}">
        ${icon(alreadyAdded ? 'check' : 'plus', 10)}
      </button>` : '';

    return `
      <div class="person-card-wrap imdb-person-wrap">
        <button class="person-card imdb-search-card" data-name="${esc(name)}" data-name-id="${esc(nameId)}">
          <span class="avatar avatar-md${avatarClass}">${initial}${img}</span>
          <span class="person-card-text">
            <span class="person-card-name">${esc(name)}</span>
            ${showRole ? `<span class="person-card-role">${esc(role)}</span>` : ''}
          </span>
        </button>
        ${plusBtn}
      </div>`;
  };


  // role の優先度順（数値が小さいほど先）
  const ROLE_ORDER = ['director','writer','producer','composer','cinematographer','editor','production_designer','casting_director','costume_designer'];
  function roleRank(cat) {
    const i = ROLE_ORDER.indexOf(cat);
    return i === -1 ? ROLE_ORDER.length : i;
  }

  // ── クリエイター（監督・スタッフ）ロールごとにセクション分け ────────────
  if (allCrew.length) {
    // ロールごとにグループ化（優先度順を保持）
    const roleGroups = new Map();
    [...allCrew]
      .sort((a, b) => roleRank(a.category) - roleRank(b.category))
      .forEach(p => {
        const key = p.category || '';
        if (!roleGroups.has(key)) roleGroups.set(key, []);
        roleGroups.get(key).push(p);
      });

    // 各グループ内: アイコンあり & creatorMetaに登録=0, アイコンあり=1, creatorMetaに登録=2, 残り=3 → 名前順
    roleGroups.forEach(persons => {
      persons.sort((a, b) => {
        function crewScore(p) {
          const hasImg = !!(p.image);
          const inMeta = creatorMetaMap.has(p.name || '');
          if (hasImg && inMeta) return 0;
          if (hasImg)           return 1;
          if (inMeta)           return 2;
          return 3;
        }
        const sa = crewScore(a), sb = crewScore(b);
        if (sa !== sb) return sa - sb;
        return (a.name || '').localeCompare(b.name || '', 'ja');
      });
    });

    html += `<div class="imdb-sub-title">クリエイター (${allCrew.length}人)</div>`;
    html += `<div class="person-list">`;
    roleGroups.forEach((persons, cat) => {
      persons.forEach(p => {
        const name   = p.name || '';
        const role   = p.job  ? p.job : categoryLabel(p.category);
        const imgSrc = p.image ? imdbProxyImg(p.image) : '';
        html += imdbPersonCard(name, role, imgSrc, 'dir', p.image || '', workNode, p.id || '');
      });
    });
    html += `</div>`;
  }

  // ── 出演者 ───────────────────────────────────────────────────────────
  if (cast.length) {
    const castLimit = 30;
    // アイコンあり & 名前=characters[0]=0, アイコンあり=1, 名前=characters[0]=2, 残りはcharacters毎に名前順
    const sortedCast = [...cast].sort((a, b) => {
      function castScore(p) {
        const hasImg      = !!(p.image);
        const nameMatchCh = !!(p.characters && p.characters.length && p.name && p.name === p.characters[0]);
        if (hasImg && nameMatchCh) return 0;
        if (hasImg)                return 1;
        if (nameMatchCh)           return 2;
        return 3;
      }
      const sa = castScore(a), sb = castScore(b);
      if (sa !== sb) return sa - sb;
      // スコア3同士はcharacters[0]毎にまとめてから名前順
      if (sa === 3) {
        const ca = (a.characters && a.characters[0]) || '', cb = (b.characters && b.characters[0]) || '';
        if (ca !== cb) return ca.localeCompare(cb, 'ja');
      }
      return (a.name || '').localeCompare(b.name || '', 'ja');
    });
    html += `<div class="imdb-sub-title">出演 (${cast.length}人)</div>`;
    html += `<div class="person-list">`;
    sortedCast.slice(0, castLimit).forEach(p => {
      const name   = p.name || '';
      const role   = (p.characters && p.characters.length) ? p.characters[0] : categoryLabel(p.category) || '';
      const imgSrc = p.image ? imdbProxyImg(p.image) : '';
      html += imdbPersonCard(name, role, imgSrc, 'art', '', null, p.id || '');
    });
    html += `</div>`;
    if (cast.length > castLimit) {
      html += `<div class="empty-note">他 ${cast.length - castLimit} 人</div>`;
    }
  }

  if (!html) html = `<div class="empty-note">データなし</div>`;
  body.innerHTML = html;

  // カードクリック → フィルモグラフィー表示（IMDb nameId を検索）
  body.querySelectorAll('.imdb-search-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      const imgSrc = btn.querySelector('img')?.src || '';
      // クルー由来の IMDb nameId が分かっているので名前検索を経由しない（同名人物の誤一致を防ぐ）
      if (name) openFilmographyModal(name, imgSrc, { nameId: btn.dataset.nameId || '' });
    });
  });

  // ＋ボタン → 参加クリエイターに追加（Notionクリエイター新規作成＋リレーション＋カバー画像）
  if (workNode) {
    body.querySelectorAll('.imdb-add-creator-btn').forEach(btn => {
      if (btn.classList.contains('is-added')) return;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const personName = btn.dataset.name;
        const rawImgUrl  = btn.dataset.rawImg || '';

        // 1. ボタンを即座に ✓ に変える
        btn.innerHTML = icon('check', 10);
        btn.classList.add('is-added');

        addImdbPersonToWork(workNode, personName, rawImgUrl);
      });
    });
  }
}

/** Notion クリエイターDBに同名（表記ゆれ程度）の人物がいれば返す */
function findExistingCreatorByName(name) {
  const key = _compact(_normName(name));
  if (!key) return null;
  return ALL_CREATORS.find(c => _compact(_normName(c.Name)) === key) || null;
}

/** IMDb の人物を作品の参加クリエイターに追加する。
 *  既存クリエイターがいればそれを紐づけ、いなければ Notion に新規作成してから紐づける */
function addImdbPersonToWork(workNode, personName, rawImgUrl = '') {
  const existing = findExistingCreatorByName(personName);
  if (existing) { addCreatorToWork(workNode, existing); return; }

  // 1. ローカルグラフに即座に反映
  if (!workNode._creatorRelIds) workNode._creatorRelIds = [];
  const creatorNodeId = `d_${personName}`;
  let targetNode = AN.find(n => n.id === creatorNodeId);
  if (!targetNode) {
    targetNode = {
      id: creatorNodeId, type: 'director', label: personName,
      role: '', sns: [], avatar: rawImgUrl || '',
      notionPageId: '', works: [workNode.id],
    };
    AN.push(targetNode);
  } else {
    if (!targetNode.works.includes(workNode.id)) targetNode.works.push(workNode.id);
  }
  if (!AL.find(l => lid(l.source) === creatorNodeId && lid(l.target) === workNode.id)) {
    AL.push({ source: creatorNodeId, target: workNode.id, ltype: 'dir' });
  }

  // 2. UIを即座に再描画（位置維持）
  showPanel(workNode);
  const { nodes: vNodes, links: vLinks } = filteredData();
  redraw(vNodes, vLinks);
  selId = workNode.id;
  applyHL(selId, 'click');

  // 3. バックグラウンドで Notion に反映（fire-and-forget）
  fetch('/notion-create-creator', {
    method: 'POST',
    headers: editHeaders(),
    body: JSON.stringify({ name: personName, imageUrl: rawImgUrl || undefined }),
  })
  .then(r => r.json())
  .then(createData => {
    if (!createData.success) throw new Error(createData.error || '作成失敗');
    const creatorPageId = createData.creatorPageId;
    // notionPageId を後から補完
    if (targetNode && !targetNode.notionPageId) targetNode.notionPageId = creatorPageId;
    // 以降の追加で同じ人物を重複作成しないよう一覧にも反映
    ALL_CREATORS.push({ Name: personName, Role: '', SNS: '', Avatar: rawImgUrl || '', notionPageId: creatorPageId });
    const normalizedNewId = creatorPageId.replace(/-/g, '');
    if (!workNode._creatorRelIds.some(id => id.replace(/-/g,'') === normalizedNewId)) {
      workNode._creatorRelIds.push(creatorPageId);
    }
    return fetch('/notion-add-creator', {
      method: 'POST',
      headers: editHeaders(),
      body: JSON.stringify({ workId: workNode.notionPageId, creatorPageId }),
    });
  })
  .then(r => r.json())
  .catch(err => console.error('[IMDB AddCreator]', err));
}

async function fetchImdbInfo(panelId, workTitle, workNode = null) {
  const body    = document.getElementById(`imdb-body-${panelId}`);
  const foundEl = document.getElementById(`imdb-found-${panelId}`);
  if (!body) return;

  try {
    // ── 1) tt 取得 ────────────────────────────────────────────────
    let tt = _imdbTtCache.get(workTitle);

    if (!tt) {
      const r1 = await fetch('/imdb-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: workTitle }),
      });
      if (!r1.ok) throw new Error(`検索失敗 (${r1.status})`);
      const d1 = await r1.json();

      if (d1.error) throw new Error(d1.error);

      if (d1.notFound) {
        _imdbTtCache.set(workTitle, 'NOT_FOUND');
        renderImdbData(panelId, { notFound: true }, workNode);
        return;
      }

      tt = d1.tt;
      _imdbTtCache.set(workTitle, tt);
      if (foundEl) foundEl.textContent = d1.title || '';
    }

    if (tt === 'NOT_FOUND') {
      renderImdbData(panelId, { notFound: true }, workNode);
      return;
    }

    // ── 2) キャッシュ確認 ─────────────────────────────────────────
    if (_imdbCache.has(tt)) {
      renderImdbData(panelId, _imdbCache.get(tt), workNode);
      return;
    }

    // ── 3) キャスト・クルー取得（サーバー経由で IMDb GraphQL を叩く）────
    const r2 = await fetch('/imdb-crew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tt }),
    });
    if (!r2.ok) throw new Error(`クルー取得失敗 (${r2.status})`);
    const d2 = await r2.json();
    if (d2.error) throw new Error(d2.error);

    // plot を日本語に翻訳してからキャッシュ・描画
    const plotJa = d2.plot ? await translatePlot(d2.plot) : d2.plot;
    const d2ja = { ...d2, tt, plot: plotJa };
    _imdbCache.set(tt, d2ja);
    renderImdbData(panelId, d2ja, workNode);

  } catch (e) {
    console.error('[IMDB]', e);
    if (body) {
      body.innerHTML = `<div class="error-box">取得エラー: ${esc(e.message)}</div>`;
    }
  }
}

/* ═══════════════════════════════════════════
   FILMOGRAPHY MODAL
═══════════════════════════════════════════ */
const _fmgNameIdCache = new Map();  // name|作品タイトル… → nameId
const _fmgDataCache   = new Map();  // nameId → filmography data
const _fmgYoutubeCache = new Map(); // title → YouTube video data | null

// カテゴリ種別ラベル
function fmgTypeLabel(titleType) {
  const map = {
    musicVideo: 'Music Video', movie: '映画', tvSeries: 'TVシリーズ',
    tvMiniSeries: 'TVミニシリーズ', tvMovie: 'TV映画', short: '短編',
    video: 'ビデオ', tvSpecial: 'TVスペシャル', tvShort: 'TV短編',
    videoGame: 'ゲーム', podcastSeries: 'ポッドキャスト',
  };
  return map[titleType] || titleType || '不明';
}

// フィルモグラフィーのカテゴリタブ一覧（優先順）
const FMG_TAB_ORDER = ['musicVideo', 'movie', 'tvSeries', 'tvMiniSeries', 'tvMovie', 'short', 'video', 'tvSpecial'];

let _fmgCurrentTab  = null;
let _fmgCurrentName = null;
let _fmgCurrentPerson = null; // { name, nameId, image } — 作品パネルの初期クリエイターに使う
let _fmgGroups      = {};

function fmgTitleObject(item) {
  return item?.title && typeof item.title === 'object' ? item.title : {};
}

function fmgTitleType(item) {
  const title = fmgTitleObject(item);
  return item?.titleType ?? item?.type ?? title.titleType ?? title.type ?? item?.kind ?? 'unknown';
}

function fmgCreditTitle(item) {
  const title = fmgTitleObject(item);
  if (typeof item?.title === 'string') return item.title;
  return title.primaryTitle ?? title.originalTitle ?? item?.primaryTitle ?? item?.l ?? item?.titleId ?? item?.id ?? '不明';
}

function fmgTitleId(item) {
  const title = fmgTitleObject(item);
  return item?.tconst ?? item?.titleId ?? title.id ?? item?.id ?? '';
}

function fmgRawRoleValues(item) {
  const values = [];
  const push = (value) => {
    if (!value) return;
    if (typeof value === 'string') values.push(value);
    else if (typeof value === 'object') values.push(value.job ?? value.category ?? value.name ?? value.text ?? '');
  };
  push(item?.category);
  push(item?.job);
  (Array.isArray(item?.jobs) ? item.jobs : []).forEach(push);
  (Array.isArray(item?.roles) ? item.roles : []).forEach(push);
  if (!values.length) (Array.isArray(item?.characters) ? item.characters : []).forEach(push);
  return values.filter(Boolean);
}

function fmgRoleLabel(role) {
  const map = {
    director: '監督', writer: '脚本', producer: 'プロデューサー',
    composer: '音楽', cinematographer: '撮影', editor: '編集',
    production_designer: 'プロダクションデザイン',
    actor: '出演', actress: '出演', self: '本人出演',
  };
  return map[role] || role;
}

function mergeFilmographyItems(items) {
  const merged = new Map();
  items.forEach(item => {
    const key = fmgTitleId(item) || `${fmgCreditTitle(item)}|${item.year ?? item.startYear ?? fmgTitleObject(item).startYear ?? ''}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...item, _fmgRoles: fmgRawRoleValues(item) });
      return;
    }

    existing._fmgRoles = [...(existing._fmgRoles || []), ...fmgRawRoleValues(item)];
    const existingTitle = fmgTitleObject(existing);
    const title = fmgTitleObject(item);
    if (!existingTitle.primaryImage?.url && title.primaryImage?.url) existing.title = item.title;
    if (!existing.primaryImage?.url && item.primaryImage?.url) existing.primaryImage = item.primaryImage;
    if (!existing.rating && item.rating) existing.rating = item.rating;
  });

  return [...merged.values()].map(item => ({
    ...item,
    _fmgRoles: [...new Set((item._fmgRoles || []).map(fmgRoleLabel))],
  }));
}

function normalizeFilmographyCredits(fmgData) {
  const source = fmgData?.filmography ?? fmgData?.credits ?? (Array.isArray(fmgData) ? fmgData : []);
  const credits = Array.isArray(source)
    ? source
    : source && typeof source === 'object'
      ? Object.values(source).flat()
      : [];

  return credits.filter(item => item && typeof item === 'object');
}

async function enrichFmgYoutubeLinks(body, rowSelector = '.fmg-item[data-yt-query]') {
  const rows = [...body.querySelectorAll(rowSelector)];

  const updateRow = (row) => {
    const query = row.dataset.ytQuery;
    const result = _fmgYoutubeCache.get(query);
    const thumbSlot = row.querySelector('.fmg-thumb, .fmg-ph');

    // 結果なし（取得失敗 or 見つからなかった）→ スケルトン解除だけ
    if (!result?.url) {
      if (thumbSlot?.classList.contains('fmg-ph')) thumbSlot.classList.add('done');
      return;
    }

    if (result.url) row.href = result.url;

    if (!result.thumbnail || !thumbSlot || thumbSlot.classList.contains('loaded')) {
      if (thumbSlot?.classList.contains('fmg-ph')) thumbSlot.classList.add('done');
      return;
    }

    const img = document.createElement('img');
    img.className = 'fmg-thumb';
    img.alt = '';
    img.loading = 'lazy';
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => {
      const ph = document.createElement('div');
      ph.className = 'fmg-ph done';
      img.replaceWith(ph);
    };
    img.src = result.thumbnail;
    thumbSlot.replaceWith(img);
  };

  // 1. すでにキャッシュにあるものは即座に反映
  rows.forEach(updateRow);

  // 2. キャッシュにないタイトルを抽出
  const queriesToFetch = [...new Set(rows.map(row => row.dataset.ytQuery).filter(Boolean))]
    .filter(query => !_fmgYoutubeCache.has(query));

  if (!queriesToFetch.length) return;

  // 3. BATCH_SIZE=5 で細かく分割し、全チャンクを同時並列で投げる
  //    → yt-dlpが1プロセスで処理する件数を減らすことで1バッチの完了が早くなり、
  //      取得できたものからすぐ表示できる。awaitしないので全バッチが同時に走る。
  const BATCH_SIZE = 5;
  for (let i = 0; i < queriesToFetch.length; i += BATCH_SIZE) {
    const chunk = queriesToFetch.slice(i, i + BATCH_SIZE);
    fetch('/youtube-video-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titles: chunk }),
    })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      // 取得できなかったクエリはnullとしてキャッシュしスケルトン解除
      chunk.forEach(query => {
        if (!_fmgYoutubeCache.has(query)) _fmgYoutubeCache.set(query, null);
      });
      if (data?.results) {
        Object.entries(data.results).forEach(([query, result]) => {
          _fmgYoutubeCache.set(query, result || null);
        });
      }
      // このチャンクに関連する行をまとめて更新
      chunk.forEach(query => {
        rows.filter(r => r.dataset.ytQuery === query).forEach(updateRow);
      });
    })
    .catch(err => {
      console.warn('[YouTube Batch Error]', err);
      chunk.forEach(query => {
        _fmgYoutubeCache.set(query, null);
        rows.filter(r => r.dataset.ytQuery === query).forEach(updateRow);
      });
    });
  }
}

/** グラフ上でこのノードとリンクしている作品タイトル（IMDb上の本人特定に使う） */
function linkedWorkTitles(nodeId) {
  const ids = new Set();
  AL.forEach(l => {
    const s = lid(l.source), t = lid(l.target);
    if (s === nodeId) ids.add(t);
    else if (t === nodeId) ids.add(s);
  });
  return AN.filter(n => ids.has(n.id) && n.type === 'work').map(n => n.label).filter(Boolean);
}

/**
 * opts.nameId     — 既知の IMDb nameId（あれば名前検索をスキップ）
 * opts.workTitles — この人物が関わった作品タイトル（同名人物の判別に使う）
 */
async function openFilmographyModal(personName, avatarSrc, opts = {}) {
  _fmgCurrentName = personName;
  _fmgCurrentPerson = { name: personName, nameId: opts.nameId || '', image: '' };

  // モーダルを開く
  const overlay = document.getElementById('filmography-overlay');
  overlay.classList.add('visible');

  // ヘッダー設定
  const initial = [...personName][0] || '?';
  const avatarEl = document.getElementById('fm2-avatar');
  const hasAvatar = avatarSrc && !avatarSrc.endsWith('/imdb-img/');
  avatarEl.innerHTML = esc(initial) + (hasAvatar ? `<img src="${esc(avatarSrc)}" alt="" onerror="this.remove()">` : '');
  document.getElementById('fm2-name').textContent = personName;
  document.getElementById('fm2-sub').textContent = 'IMDb フィルモグラフィーを読み込み中…';
  document.getElementById('fm2-google').onclick = () => {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(personName)}`, '_blank', 'noopener');
  };
  document.getElementById('fm2-tabs').innerHTML = '';
  document.getElementById('fm2-body').innerHTML = `
    <div class="fm2-loading">
      <div class="spinner"></div>フィルモグラフィー取得中…
    </div>`;

  try {
    // nameId 取得
    const workTitles = opts.workTitles || [];
    const cacheKey = `${personName}|${workTitles.join('|')}`;
    let nameId = opts.nameId || _fmgNameIdCache.get(cacheKey);
    if (!nameId) {
      const r1 = await fetch('/imdb-name-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: personName, workTitles }),
      });
      if (!r1.ok) throw new Error(`nameId取得失敗 (${r1.status})`);
      const d1 = await r1.json();
      if (d1.notFound || !d1.nameId) {
        document.getElementById('fm2-sub').textContent = 'IMDbに情報が見つかりませんでした';
        document.getElementById('fm2-body').innerHTML = `<div class="fm2-empty">IMDbに見つかりませんでした<br><br><a class="text-link" href="https://www.imdb.com/find?q=${encodeURIComponent(personName)}" target="_blank" rel="noopener noreferrer">IMDbで手動検索する →</a></div>`;
        return;
      }
      nameId = d1.nameId;
      _fmgNameIdCache.set(cacheKey, nameId);
      if (_fmgCurrentName === personName) _fmgCurrentPerson = { name: personName, nameId, image: d1.image || '' };
      // アバター画像を IMDB画像で更新
      if (d1.image) {
        avatarEl.innerHTML = `${esc(initial)}<img src="/imdb-img/${btoa(d1.image)}" alt="" onerror="this.remove()">`;
      }
    }

    // フィルモグラフィー取得
    let fmgData = _fmgDataCache.get(nameId);
    if (!fmgData) {
      const r2 = await fetch('/imdb-filmography', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nameId }),
      });
      if (!r2.ok) throw new Error(`フィルモグラフィー取得失敗 (${r2.status})`);
      fmgData = await r2.json();
      if (fmgData.error) throw new Error(fmgData.error);
      _fmgDataCache.set(nameId, fmgData);
    }

    // データを種別ごとにグループ化
    // サーバーが整形したフィルモグラフィーレスポンス形式に対応
    _fmgGroups = {};
    const creditArray = normalizeFilmographyCredits(fmgData);

    creditArray.forEach(item => {
      const type = fmgTitleType(item);
      if (!_fmgGroups[type]) _fmgGroups[type] = [];
      _fmgGroups[type].push(item);
    });

    // 各グループを年降順にソート
    Object.values(_fmgGroups).forEach(arr => {
      arr.sort((a, b) => {
        const titleA = fmgTitleObject(a);
        const titleB = fmgTitleObject(b);
        const ya = a.year ?? a.startYear ?? titleA.startYear ?? 0;
        const yb = b.year ?? b.startYear ?? titleB.startYear ?? 0;
        return yb - ya;
      });
    });

    const availableTypes = FMG_TAB_ORDER.filter(t => _fmgGroups[t]?.length)
      .concat(Object.keys(_fmgGroups).filter(t => !FMG_TAB_ORDER.includes(t) && _fmgGroups[t]?.length));

    if (!availableTypes.length) {
      document.getElementById('fm2-sub').textContent = '合計 0 件';
      document.getElementById('fm2-body').innerHTML = `<div class="fm2-empty">作品が見つかりませんでした</div>`;
      return;
    }

    // タブ生成
    const tabsEl = document.getElementById('fm2-tabs');
    tabsEl.innerHTML = '';
    availableTypes.forEach((type, i) => {
      const count = mergeFilmographyItems(_fmgGroups[type] || []).length;
      const btn = document.createElement('button');
      btn.className = 'fm2-tab' + (i === 0 ? ' active' : '');
      btn.textContent = `${fmgTypeLabel(type)} (${count})`;
      btn.dataset.type = type;
      btn.addEventListener('click', () => {
        tabsEl.querySelectorAll('.fm2-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _fmgCurrentTab = type;
        renderFmgList(type);
      });
      tabsEl.appendChild(btn);
    });

    _fmgCurrentTab = availableTypes[0];
    const totalWorks = availableTypes.reduce((sum, type) => sum + mergeFilmographyItems(_fmgGroups[type] || []).length, 0);
    document.getElementById('fm2-sub').textContent = `合計 ${totalWorks} 件`;
    renderFmgList(_fmgCurrentTab);

  } catch (e) {
    console.error('[Filmography]', e);
    document.getElementById('fm2-sub').textContent = 'エラーが発生しました';
    document.getElementById('fm2-body').innerHTML = `
      <div class="fm2-error">取得エラー: ${esc(e.message)}</div>
      <div class="fm2-fallback">
        <a class="text-link" href="https://www.imdb.com/find?q=${encodeURIComponent(personName)}" target="_blank" rel="noopener noreferrer">IMDbで手動検索する →</a>
      </div>`;
  }
}

function renderFmgList(type) {
  const body = document.getElementById('fm2-body');
  const items = mergeFilmographyItems(_fmgGroups[type] || []);
  if (!items.length) {
    body.innerHTML = `<div class="fm2-empty">この種別の作品はありません</div>`;
    return;
  }

  const html = items.map((item, i) => {
    const titleObj = fmgTitleObject(item);
    const title   = fmgCreditTitle(item);
    const year    = item.year ?? item.startYear ?? titleObj.startYear ?? '';
    const rating  = item.rating?.aggregateRating ?? titleObj.rating?.aggregateRating ?? null;
    const imgUrl  = titleObj.primaryImage?.url ?? item.primaryImage?.url ?? item.image ?? '';
    const searchQuery = `${title} ${fmgTypeLabel(type)}`;
    const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
    const titleType = fmgTitleType(item);

    const thumbHtml = '<div class="fmg-ph"></div>';

    const roleLabels = item._fmgRoles || [];
    const roleHtml = roleLabels.map(role => `<span class="fmg-role">${esc(role)}</span>`).join('');

    return `<a class="fmg-item" href="${esc(youtubeUrl)}" target="_blank" rel="noopener" data-yt-query="${esc(searchQuery)}" data-idx="${i}">
      ${thumbHtml}
      <div class="fmg-info">
        <div class="fmg-title">${esc(title)}</div>
        <div class="fmg-meta">
          ${year ? `<span class="fmg-year">${esc(String(year))}</span>` : ''}
          ${roleHtml}
          ${titleType && titleType !== type ? `<span class="fmg-type">${esc(fmgTypeLabel(titleType))}</span>` : ''}
          ${rating ? `<span class="fmg-rating">${STAR_ICON}${rating}</span>` : ''}
        </div>
      </div>
    </a>`;
  }).join('');

  body.innerHTML = html;
  enrichFmgYoutubeLinks(body);

  // 作品は最新作品と同じくページ内のパネルで開く（Cmd/Ctrl クリックなどは YouTube を新しいタブで）
  body.querySelectorAll('.fmg-item').forEach(row => row.addEventListener('click', e => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openRecentWorkPanel(_fmgWorkEntry(items[Number(row.dataset.idx)], type, row.dataset.ytQuery), { aboveFilmography: true });
  }));
}

/** フィルモグラフィーの1件を、最新作品パネル（openRecentWorkPanel）が扱う形にする */
function _fmgWorkEntry(item, type, ytQuery) {
  const titleObj = fmgTitleObject(item);
  const title = fmgCreditTitle(item);
  const entry = {
    title,
    tt: fmgTitleId(item),
    year: item.year ?? item.startYear ?? titleObj.startYear ?? null,
    rating: item.rating?.aggregateRating ?? titleObj.rating?.aggregateRating ?? null,
    ytQuery,
    defaultTags: fmgTitleType(item) === 'musicVideo' ? ['MV'] : [],
    directors: [],
  };
  entry.workNode = _findRegisteredWork(entry);
  entry.registered = !!entry.workNode;
  // フィルモグラフィーの本人が登録済みのクリエイターなら、保存時のクリエイターに最初から入れておく
  const p = _fmgCurrentPerson;
  const node = p && AN.find(n => n.type === 'director' && n.notionPageId && _compact(_normName(n.label)) === _compact(_normName(p.name)));
  if (node) entry.directors.push({ name: node.label, nameId: p.nameId, nodeId: node.id, imdbImage: p.image });
  return entry;
}

function closeFilmographyModal() {
  document.getElementById('filmography-overlay').classList.remove('visible');
  _fmgCurrentName = null;
  _fmgCurrentPerson = null;
  // フィルモグラフィーから保存した作品をグラフに描き足す
  if (_recentGraphDirty) {
    _recentGraphDirty = false;
    refresh();
  }
}

document.getElementById('fm2-close').addEventListener('click', closeFilmographyModal);
document.getElementById('filmography-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('filmography-overlay')) closeFilmographyModal();
});
