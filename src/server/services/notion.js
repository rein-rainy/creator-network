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

      persons.push({ Name: name, Role: role, SNS: sns, Avatar: '', notionPageId: page.id });
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

    const relProp = page.properties[creatorRelProp];
    row._creatorRelIds = (relProp?.type === 'relation') ? relProp.relation.map(r => r.id) : [];
    row._creatorRelPropName = creatorRelProp;
    return row;
  });

  let titlePropName = null;
  if (works.length > 0) {
    for (const [name, prop] of Object.entries(works[0].properties)) {
      if (prop.type === 'title') {
        titlePropName = name;
        break;
      }
    }
  }
  if (titlePropName) {
    rows.sort((a, b) => (a[titlePropName] || '').localeCompare(b[titlePropName] || '', 'ja'));
    console.log(`[Notion] 作品を名前順にソート (key: "${titlePropName}")`);
  }

  console.log(`[Notion] 完了 — 作品 ${rows.length} 件 / Creator ${creators.length} 件 / Artist ${artists.length} 件`);
  return { rows, creators, artists, count: rows.length };
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

async function createCreator(name, imageUrl) {
  console.log(`[Notion] クリエイター新規作成: name="${name}"`);
  const dbRes = await notionRequest('GET', `/v1/databases/${config.DB_CREATORS}`);
  if (dbRes.status !== 200) throw new Error(`DB取得失敗: ${dbRes.status}`);

  let titlePropName = 'Name';
  for (const [propName, prop] of Object.entries(dbRes.body.properties)) {
    if (prop.type === 'title') {
      titlePropName = propName;
      break;
    }
  }

  const searchRes = await notionRequest('POST', `/v1/databases/${config.DB_CREATORS}/query`, {
    filter: { property: titlePropName, title: { equals: name } },
    page_size: 1,
  });
  if (searchRes.status === 200 && searchRes.body.results?.length > 0) {
    const existing = searchRes.body.results[0];
    return { success: true, creatorPageId: existing.id, alreadyExists: true };
  }

  const createBody = {
    parent: { database_id: config.DB_CREATORS },
    properties: {
      [titlePropName]: { title: [{ text: { content: name } }] },
    },
  };
  if (imageUrl) createBody.cover = { type: 'external', external: { url: imageUrl } };

  const createRes = await notionRequest('POST', '/v1/pages', createBody);
  if (createRes.status !== 200) throw new Error(`作成失敗: ${createRes.status} ${JSON.stringify(createRes.body)}`);
  return { success: true, creatorPageId: createRes.body.id };
}

async function setCreatorCover(creatorPageId, imageUrl) {
  const patchRes = await notionRequest('PATCH', `/v1/pages/${creatorPageId}`, {
    cover: { type: 'external', external: { url: imageUrl } },
  });
  if (patchRes.status !== 200) throw new Error(`カバー画像設定失敗: ${patchRes.status}`);
  return { success: true };
}

async function getRoleOptions() {
  const dbRes = await notionRequest('GET', `/v1/databases/${config.DB_CREATORS}`);
  if (dbRes.status !== 200) throw new Error(`DB取得失敗: ${dbRes.status}`);
  const props = dbRes.body.properties;
  const rolePropName = Object.keys(props).find(key => key === 'Role' || key === '役職') || 'Role';
  const roleProp = props[rolePropName];
  let options = [];
  if (roleProp?.type === 'multi_select') options = roleProp.multi_select.options || [];
  else if (roleProp?.type === 'select') options = roleProp.select.options || [];
  return { options: options.map(option => ({ id: option.id, name: option.name, color: option.color })) };
}

async function updateCreatorMeta(creatorPageId, role, sns) {
  const dbRes = await notionRequest('GET', `/v1/databases/${config.DB_CREATORS}`);
  if (dbRes.status !== 200) throw new Error(`DB取得失敗: ${dbRes.status}`);
  const props = dbRes.body.properties;
  const rolePropName = Object.keys(props).find(key => key === 'Role' || key === '役職') || 'Role';
  const snsPropName = Object.keys(props).find(key => key.toLowerCase() === 'sns') || 'SNS';
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

  let titlePropName = 'Name';
  for (const [propName, prop] of Object.entries(dbRes.body.properties)) {
    if (prop.type === 'title') {
      titlePropName = propName;
      break;
    }
  }

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
  addCreatorToWork,
  createCreator,
  setCreatorCover,
  getRoleOptions,
  updateCreatorMeta,
  renameCreator,
  removeCreatorFromWork,
};
