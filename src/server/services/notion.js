const https = require('https');
const config = require('../config');

function notionRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.notion.com',
      path: apiPath,
      method,
      headers: {
        'Authorization': `Bearer ${config.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData || ''),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8'); // 日本語が切れ目をまたいでも文字化けしないように
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

/** Name of the title-type property, or `fallback` if none found. */
function findTitleProp(props, fallback = 'Name') {
  for (const [name, prop] of Object.entries(props)) {
    if (prop.type === 'title') return name;
  }
  return fallback;
}

/** Name of the Role property (English or Japanese), defaulting to 'Role'. */
function findRoleProp(props) {
  return Object.keys(props).find(key => key === 'Role' || key === '役職') || 'Role';
}

/** Name of the SNS property (case-insensitive), defaulting to 'SNS'. */
function findSnsProp(props) {
  return Object.keys(props).find(key => key.toLowerCase() === 'sns') || 'SNS';
}

async function fetchPersonDB(dbId, label) {
  const map = {};
  const persons = [];
  let cursor;
  let hasMore = true;
  let total = 0;

  while (hasMore) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const response = await notionRequest('POST', `/v1/databases/${dbId}/query`, body);
    if (response.status !== 200) throw new Error(`${label} DB取得失敗: ${response.status}`);

    for (const page of response.body.results) {
      const props = page.properties;
      let name = '';
      for (const prop of Object.values(props)) {
        if (prop.type === 'title' && prop.title?.length) {
          name = prop.title.map(t => t.plain_text).join('');
          break;
        }
      }
      if (!name) name = page.id;
      map[page.id] = name;

      const roleProp = props['Role'] ?? props['役職'];
      let role = '';
      if (roleProp?.type === 'select') role = roleProp.select?.name ?? '';
      else if (roleProp?.type === 'rich_text') role = roleProp.rich_text.map(t => t.plain_text).join('');
      else if (roleProp?.type === 'multi_select') role = roleProp.multi_select.map(s => s.name).join(', ');

      const snsProp = props['SNS'] ?? props['sns'];
      let sns = '';
      if (snsProp?.type === 'url') sns = snsProp.url ?? '';
      else if (snsProp?.type === 'rich_text') sns = snsProp.rich_text.map(t => t.plain_text).join('');

      // ページのカバー画像をアイコンとして使う（Notion にアップロードした画像の URL は1時間で失効するため毎回取り直す）
      // AvatarType: 'file' = このアプリが Notion にアップロードした画像 / 'external' = 外部 URL（IMDb など）
      const avatar = page.cover?.external?.url ?? page.cover?.file?.url ?? '';
      const avatarType = avatar ? page.cover.type : '';

      persons.push({ Name: name, Role: role, SNS: sns, Avatar: avatar, AvatarType: avatarType, notionPageId: page.id });
    }

    hasMore = response.body.has_more;
    cursor = response.body.next_cursor;
    total += response.body.results.length;
  }

  console.log(`  [${label}] ${total} 件`);
  return { map, persons };
}

async function fetchWorks() {
  const results = [];
  let cursor;
  let hasMore = true;

  while (hasMore) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const response = await notionRequest('POST', `/v1/databases/${config.DB_WORKS}/query`, body);
    if (response.status !== 200) throw new Error(`作品DB取得失敗: ${response.status}`);

    results.push(...response.body.results);
    hasMore = response.body.has_more;
    cursor = response.body.next_cursor;
  }

  console.log(`  [作品] ${results.length} 件`);
  return results;
}

function extractValue(prop, creatorMap, artistMap) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title': return prop.title.map(t => t.plain_text).join('');
    case 'rich_text': return prop.rich_text.map(t => t.plain_text).join('');
    case 'number': return prop.number ?? '';
    case 'select': return prop.select?.name ?? '';
    case 'multi_select': return prop.multi_select.map(s => s.name).join(', ');
    case 'date': return prop.date?.start ?? '';
    case 'checkbox': return prop.checkbox ? 'TRUE' : 'FALSE';
    case 'url': return prop.url ?? '';
    case 'email': return prop.email ?? '';
    case 'phone_number': return prop.phone_number ?? '';
    case 'formula': return prop.formula?.string ?? String(prop.formula?.number ?? '');
    case 'people': return prop.people.map(p => p.name ?? '').join(', ');
    case 'files': return prop.files.map(f => f.name).join(', ');
    case 'status': return prop.status?.name ?? '';
    case 'relation':
      return prop.relation.map(r => creatorMap[r.id] ?? artistMap[r.id] ?? r.id).join(', ');
    case 'rollup': {
      const rollup = prop.rollup;
      if (rollup?.type === 'array') return rollup.array.map(i => extractValue(i, creatorMap, artistMap)).join(', ');
      if (rollup?.type === 'number') return String(rollup.number ?? '');
      return '';
    }
    default:
      return '';
  }
}

async function getCreatorRelPropName() {
  console.log('[Notion] リレーションプロパティ名を自動検出中...');
  const response = await notionRequest('GET', `/v1/databases/${config.DB_WORKS}`);
  if (response.status !== 200) return null;

  const creatorDbIdNorm = config.DB_CREATORS.replace(/-/g, '').toLowerCase();
  for (const [name, prop] of Object.entries(response.body.properties)) {
    if (prop.type === 'relation' && prop.relation?.database_id) {
      const relDbId = prop.relation.database_id.replace(/-/g, '').toLowerCase();
      if (relDbId === creatorDbIdNorm) {
        console.log(`[Notion] 検出完了: "${name}"`);
        return name;
      }
    }
  }
  return null;
}

async function buildData(targetDb = 'all') {
  let works = [];
  let creatorResult = { map: {}, persons: [] };
  let artistResult = { map: {}, persons: [] };

  if (targetDb === 'creators') {
    console.log('[Notion] Creator DBのみ取得中...');
    creatorResult = await fetchPersonDB(config.DB_CREATORS, 'Creator');
  } else {
    console.log('[Notion] 3つのDBを並列取得中...');
    [works, creatorResult, artistResult] = await Promise.all([
      fetchWorks(),
      fetchPersonDB(config.DB_CREATORS, 'Creator'),
      fetchPersonDB(config.DB_ARTISTS, 'Artist'),
    ]);
  }

  const creatorMap = creatorResult.map;
  const artistMap = artistResult.map;
  const creators = creatorResult.persons;
  const artists = artistResult.persons;
  const keySet = new Set();
  works.forEach(page => Object.keys(page.properties).forEach(key => keySet.add(key)));
  const keys = [...keySet];

  let creatorRelProp = 'Director / Creator';
  if (targetDb !== 'creators') {
    if (works.length > 0) {
      for (const [name, prop] of Object.entries(works[0].properties)) {
        if (prop.type === 'relation' && prop.relation.some(r => creatorMap[r.id])) {
          creatorRelProp = name;
          break;
        }
      }
    }
    if (creatorRelProp === 'Director / Creator') {
      creatorRelProp = await getCreatorRelPropName() || 'Director / Creator';
    }
  }

  const rows = works.map(page => {
    const row = {};
    keys.forEach(key => {
      row[key] = extractValue(page.properties[key], creatorMap, artistMap);
    });
    row._notionPageId = page.id;
    // 名前に「,」を含む人物（Tyler, The Creator など）を「, 」連結の文字列から復元できないので、リレーションは配列でも渡す
    row._relNames = {};
    keys.forEach(key => {
      const prop = page.properties[key];
      if (prop?.type === 'relation') row._relNames[key] = prop.relation.map(r => creatorMap[r.id] ?? artistMap[r.id] ?? r.id);
    });

    const relProp = page.properties[creatorRelProp];
    row._creatorRelIds = (relProp?.type === 'relation') ? relProp.relation.map(r => r.id) : [];
    row._creatorRelPropName = creatorRelProp;
    return row;
  });

  const titlePropName = works.length > 0 ? findTitleProp(works[0].properties, null) : null;
  if (titlePropName) {
    rows.sort((a, b) => (a[titlePropName] || '').localeCompare(b[titlePropName] || '', 'ja'));
    console.log(`[Notion] 作品を名前順にソート (key: "${titlePropName}")`);
  }

  console.log(`[Notion] 完了 — 作品 ${rows.length} 件 / Creator ${creators.length} 件 / Artist ${artists.length} 件`);
  return { rows, creators, artists, count: rows.length, tagColors: await getTagColors() };
}

/* 変更確認用の目印。3つの DB それぞれで最後に編集されたページの id と編集時刻をつなげたもの。
   作品の追加・編集があればこれが変わるので、ブラウザは変わったときだけ buildData を取り直す。
   ※ Notion の last_edited_time は分単位で、削除（アーカイブ）されたページは検索に出てこない。
     同じページを同じ分のうちに続けて編集した場合や削除は、ブラウザ側の定期的な取り直しで拾う。 */
async function getChangeSignature() {
  const parts = await Promise.all([config.DB_WORKS, config.DB_CREATORS, config.DB_ARTISTS].map(async dbId => {
    const response = await notionRequest('POST', `/v1/databases/${dbId}/query`, {
      page_size: 1,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    });
    if (response.status !== 200) throw new Error(`変更確認失敗: ${response.status}`);
    const page = response.body.results[0];
    return page ? `${page.id}@${page.last_edited_time}` : '';
  }));
  return parts.join('|');
}

async function addCreatorToWork(workId, creatorPageId) {
  console.log(`[Notion] クリエイター追加開始: work=${workId} creator=${creatorPageId}`);
  const pageRes = await notionRequest('GET', `/v1/pages/${workId}`);
  if (pageRes.status !== 200) throw new Error(`ページ取得失敗: ${pageRes.status}`);

  const relPropName = await getCreatorRelPropName();
  if (!relPropName) throw new Error('クリエイターリレーションプロパティが見つかりませんでした');

  const relProp = pageRes.body.properties[relPropName];
  const currentIds = relProp?.type === 'relation' ? relProp.relation.map(r => r.id) : [];
  if (currentIds.includes(creatorPageId)) {
    return { success: true, message: '既に追加されています' };
  }

  const patchRes = await notionRequest('PATCH', `/v1/pages/${workId}`, {
    properties: {
      [relPropName]: {
        relation: [...currentIds.map(id => ({ id })), { id: creatorPageId }],
      },
    },
  });
  if (patchRes.status !== 200) throw new Error(`更新失敗: ${patchRes.status}`);
  return { success: true };
}

/** 人物 DB（クリエイター / アーティスト）にページを作る。同名がいればそれを返す */
async function createPerson(dbId, name, imageUrl) {
  const dbRes = await notionRequest('GET', `/v1/databases/${dbId}`);
  if (dbRes.status !== 200) throw new Error(`DB取得失敗: ${dbRes.status}`);

  const titlePropName = findTitleProp(dbRes.body.properties);

  const searchRes = await notionRequest('POST', `/v1/databases/${dbId}/query`, {
    filter: { property: titlePropName, title: { equals: name } },
    page_size: 1,
  });
  if (searchRes.status === 200 && searchRes.body.results?.length > 0) {
    const existing = searchRes.body.results[0];
    return { success: true, pageId: existing.id, alreadyExists: true };
  }

  const createBody = {
    parent: { database_id: dbId },
    properties: {
      [titlePropName]: { title: [{ text: { content: name } }] },
    },
  };
  if (imageUrl) createBody.cover = { type: 'external', external: { url: imageUrl } };

  const createRes = await notionRequest('POST', '/v1/pages', createBody);
  if (createRes.status !== 200) throw new Error(`作成失敗: ${createRes.status} ${JSON.stringify(createRes.body)}`);
  return { success: true, pageId: createRes.body.id };
}

async function createCreator(name, imageUrl) {
  console.log(`[Notion] クリエイター新規作成: name="${name}"`);
  const { pageId, ...rest } = await createPerson(config.DB_CREATORS, name, imageUrl);
  return { ...rest, creatorPageId: pageId };
}

async function createArtist(name) {
  console.log(`[Notion] アーティスト新規作成: name="${name}"`);
  const { pageId, ...rest } = await createPerson(config.DB_ARTISTS, name);
  return { ...rest, artistPageId: pageId };
}

async function setCreatorCover(creatorPageId, imageUrl) {
  const patchRes = await notionRequest('PATCH', `/v1/pages/${creatorPageId}`, {
    cover: { type: 'external', external: { url: imageUrl } },
  });
  if (patchRes.status !== 200) throw new Error(`カバー画像設定失敗: ${patchRes.status}`);
  return { success: true };
}

const IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/** 画像データを Notion にアップロードしてクリエイターページのカバーに設定する */
async function uploadCreatorCover(creatorPageId, buffer, contentType) {
  const ext = IMAGE_EXTENSIONS[contentType];
  if (!ext) throw new Error(`未対応の画像形式: ${contentType}`);
  const filename = `avatar.${ext}`;

  const createRes = await notionRequest('POST', '/v1/file_uploads', { filename, content_type: contentType });
  if (createRes.status !== 200) throw new Error(`アップロード作成失敗: ${createRes.status} ${JSON.stringify(createRes.body)}`);
  const uploadId = createRes.body.id;

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }), filename);
  const sendRes = await fetch(`https://api.notion.com/v1/file_uploads/${uploadId}/send`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' },
    body: form,
  });
  if (!sendRes.ok) throw new Error(`アップロード送信失敗: ${sendRes.status} ${await sendRes.text()}`);

  const patchRes = await notionRequest('PATCH', `/v1/pages/${creatorPageId}`, {
    cover: { type: 'file_upload', file_upload: { id: uploadId } },
  });
  if (patchRes.status !== 200) throw new Error(`カバー画像設定失敗: ${patchRes.status} ${JSON.stringify(patchRes.body)}`);
  return { success: true, coverUrl: patchRes.body.cover?.file?.url ?? '' };
}

/** 作品DBのプロパティ名を型・リレーション先から特定する */
async function getWorkPropNames() {
  const dbRes = await notionRequest('GET', `/v1/databases/${config.DB_WORKS}`);
  if (dbRes.status !== 200) throw new Error(`作品DB取得失敗: ${dbRes.status}`);
  const props = Object.entries(dbRes.body.properties);
  const normId = id => (id || '').replace(/-/g, '').toLowerCase();
  const relationTo = dbId => props.find(([, p]) => p.type === 'relation' && normId(p.relation?.database_id) === normId(dbId))?.[0];
  return {
    props: dbRes.body.properties,
    title: props.find(([, p]) => p.type === 'title')?.[0],
    url: props.find(([, p]) => p.type === 'url')?.[0],
    category: props.find(([name, p]) => name === 'Category' && p.type === 'multi_select')?.[0]
      ?? props.find(([, p]) => p.type === 'multi_select')?.[0],
    creators: relationTo(config.DB_CREATORS),
    artists: relationTo(config.DB_ARTISTS),
  };
}

async function getWorkCategoryOptions() {
  const names = await getWorkPropNames();
  const options = names.category ? names.props[names.category].multi_select.options || [] : [];
  return { options: options.map(option => ({ name: option.name, color: option.color })) };
}

/** タグ名 → Notion の色名（作品カテゴリと役職）。画面のタグを Notion と同じ色で塗るのに使う */
async function getTagColors() {
  const [categories, roles] = await Promise.all([
    getWorkCategoryOptions().catch(() => ({ options: [] })),
    getRoleOptions().catch(() => ({ options: [] })),
  ]);
  const toMap = ({ options }) => Object.fromEntries(options.map(o => [o.name, o.color]));
  return { categories: toMap(categories), roles: toMap(roles) };
}

/** 作品ページを作成する。同じ URL の作品があれば作らずにそれを返す */
async function createWork({ title, url, coverUrl, categories = [], creatorPageIds = [], artistPageIds = [] }) {
  const names = await getWorkPropNames();
  if (!names.title) throw new Error('作品DBにタイトルプロパティがありません');

  if (url && names.url) {
    const existing = await notionRequest('POST', `/v1/databases/${config.DB_WORKS}/query`, {
      filter: { property: names.url, url: { equals: url } },
      page_size: 1,
    });
    if (existing.status === 200 && existing.body.results?.length) {
      return { success: true, workPageId: existing.body.results[0].id, alreadyExists: true };
    }
  }

  const properties = { [names.title]: { title: [{ text: { content: title } }] } };
  if (url && names.url) properties[names.url] = { url };
  if (categories.length && names.category) properties[names.category] = { multi_select: categories.map(name => ({ name })) };
  if (creatorPageIds.length && names.creators) properties[names.creators] = { relation: creatorPageIds.map(id => ({ id })) };
  if (artistPageIds.length && names.artists) properties[names.artists] = { relation: artistPageIds.map(id => ({ id })) };

  const body = { parent: { database_id: config.DB_WORKS }, properties };
  if (coverUrl) body.cover = { type: 'external', external: { url: coverUrl } };

  const createRes = await notionRequest('POST', '/v1/pages', body);
  if (createRes.status !== 200) throw new Error(`作品作成失敗: ${createRes.status} ${JSON.stringify(createRes.body)}`);
  return { success: true, workPageId: createRes.body.id };
}

async function getRoleOptions() {
  const dbRes = await notionRequest('GET', `/v1/databases/${config.DB_CREATORS}`);
  if (dbRes.status !== 200) throw new Error(`DB取得失敗: ${dbRes.status}`);
  const props = dbRes.body.properties;
  const roleProp = props[findRoleProp(props)];
  let options = [];
  if (roleProp?.type === 'multi_select') options = roleProp.multi_select.options || [];
  else if (roleProp?.type === 'select') options = roleProp.select.options || [];
  return { options: options.map(option => ({ id: option.id, name: option.name, color: option.color })) };
}

async function updateCreatorMeta(creatorPageId, role, sns) {
  const dbRes = await notionRequest('GET', `/v1/databases/${config.DB_CREATORS}`);
  if (dbRes.status !== 200) throw new Error(`DB取得失敗: ${dbRes.status}`);
  const props = dbRes.body.properties;
  const rolePropName = findRoleProp(props);
  const snsPropName = findSnsProp(props);
  const patchProps = {};

  if (role !== undefined) {
    const roleProp = props[rolePropName];
    if (roleProp?.type === 'select') {
      patchProps[rolePropName] = { select: role ? { name: role } : null };
    } else if (roleProp?.type === 'multi_select') {
      patchProps[rolePropName] = {
        multi_select: role ? role.split(',').map(item => item.trim()).filter(Boolean).map(name => ({ name })) : [],
      };
    } else {
      patchProps[rolePropName] = { rich_text: role ? [{ text: { content: role } }] : [] };
    }
  }

  if (sns !== undefined) {
    const firstUrl = (sns && sns.length > 0) ? sns[0] : null;
    const snsProp = props[snsPropName];
    if (snsProp?.type === 'url') patchProps[snsPropName] = { url: firstUrl || null };
    else patchProps[snsPropName] = { rich_text: firstUrl ? [{ text: { content: firstUrl } }] : [] };
  }

  if (Object.keys(patchProps).length === 0) return { success: true, noop: true };
  const patchRes = await notionRequest('PATCH', `/v1/pages/${creatorPageId}`, { properties: patchProps });
  if (patchRes.status !== 200) throw new Error(`更新失敗: ${patchRes.status} ${JSON.stringify(patchRes.body)}`);
  return { success: true };
}

async function renameCreator(creatorPageId, newName) {
  const dbRes = await notionRequest('GET', `/v1/databases/${config.DB_CREATORS}`);
  if (dbRes.status !== 200) throw new Error(`DB取得失敗: ${dbRes.status}`);

  const titlePropName = findTitleProp(dbRes.body.properties);

  const patchRes = await notionRequest('PATCH', `/v1/pages/${creatorPageId}`, {
    properties: {
      [titlePropName]: { title: [{ text: { content: newName } }] },
    },
  });
  if (patchRes.status !== 200) throw new Error(`名前更新失敗: ${patchRes.status} ${JSON.stringify(patchRes.body)}`);
  return { success: true };
}

async function removeCreatorFromWork(workId, creatorPageId) {
  const pageRes = await notionRequest('GET', `/v1/pages/${workId}`);
  if (pageRes.status !== 200) throw new Error(`ページ取得失敗: ${pageRes.status}`);

  const relPropName = await getCreatorRelPropName();
  if (!relPropName) throw new Error('クリエイターリレーションプロパティが見つかりませんでした');

  const relProp = pageRes.body.properties[relPropName];
  const currentIds = relProp?.type === 'relation' ? relProp.relation.map(r => r.id) : [];
  const newIds = currentIds.filter(id => id.replace(/-/g, '') !== creatorPageId.replace(/-/g, ''));

  const patchRes = await notionRequest('PATCH', `/v1/pages/${workId}`, {
    properties: {
      [relPropName]: {
        relation: newIds.map(id => ({ id })),
      },
    },
  });
  if (patchRes.status !== 200) throw new Error(`更新失敗: ${patchRes.status}`);
  return { success: true };
}

module.exports = {
  notionRequest,
  buildData,
  getChangeSignature,
  addCreatorToWork,
  createCreator,
  createArtist,
  setCreatorCover,
  uploadCreatorCover,
  getWorkCategoryOptions,
  createWork,
  getRoleOptions,
  updateCreatorMeta,
  renameCreator,
  removeCreatorFromWork,
};
