const config = require('../config');
const { jsonRoute, HttpError } = require('../http');
const notion = require('../services/notion');

async function handleNotionRoutes(req, res) {
  if (await jsonRoute(req, res, { method: 'POST', path: '/notion-data', label: 'Notion Data Error' }, async ({ database }) => {
    if (!config.NOTION_TOKEN) {
      throw new HttpError(503, 'Notion token missing', {
        error: 'Notion API is not configured. Please set NOTION_TOKEN environment variable.',
        code: 'NOTION_TOKEN_MISSING',
      });
    }
    // 目印は取得の前に取る（取得中に編集されても、次の変更確認で取り直される）
    const signature = await notion.getChangeSignature();
    const { rows, creators, artists, count, tagColors } = await notion.buildData(database);
    return { results: rows, creators, artists, count, tagColors, signature };
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/notion-changes', label: 'Notion Changes Error' }, async () => {
    if (!config.NOTION_TOKEN) throw new HttpError(503, 'Notion token missing', { error: 'Notion API is not configured.' });
    return { signature: await notion.getChangeSignature() };
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/notion-add-creator', label: 'Notion Add Error' }, async ({ workId, creatorPageId }) => {
    if (!workId || !creatorPageId) throw new Error('workId, creatorPageId が必要です');
    return notion.addCreatorToWork(workId, creatorPageId);
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/notion-create-creator', label: 'Notion Create Creator Error' }, async ({ name, imageUrl }) => {
    if (!name) throw new Error('name が必要です');
    return notion.createCreator(name, imageUrl);
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/notion-create-artist', label: 'Notion Create Artist Error' }, async ({ name }) => {
    if (!name) throw new Error('name が必要です');
    return notion.createArtist(name);
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/notion-set-creator-cover', label: 'Notion Cover Error' }, async ({ creatorPageId, imageUrl }) => {
    if (!creatorPageId || !imageUrl) throw new Error('creatorPageId, imageUrl が必要です');
    return notion.setCreatorCover(creatorPageId, imageUrl);
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/notion-upload-creator-cover', label: 'Notion Upload Cover Error' }, async ({ creatorPageId, dataUrl }) => {
    const match = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(dataUrl || '');
    if (!creatorPageId || !match) throw new Error('creatorPageId と画像の data URL が必要です');
    return notion.uploadCreatorCover(creatorPageId, Buffer.from(match[2], 'base64'), match[1]);
  })) return true;

  if (await jsonRoute(req, res, { method: 'GET', path: '/notion-work-categories', label: 'WorkCategories Error' }, async () => {
    return notion.getWorkCategoryOptions();
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/notion-create-work', label: 'Notion Create Work Error' }, async (work) => {
    if (!work.title) throw new Error('title が必要です');
    return notion.createWork(work);
  })) return true;

  if (await jsonRoute(req, res, { method: 'GET', path: '/notion-role-options', label: 'RoleOptions Error' }, async () => {
    return notion.getRoleOptions();
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/notion-update-creator-meta', label: 'UpdateCreatorMeta Error' }, async ({ creatorPageId, role, sns }) => {
    if (!creatorPageId) throw new Error('creatorPageId が必要です');
    return notion.updateCreatorMeta(creatorPageId, role, sns);
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/notion-rename-creator', label: 'Notion Rename Error' }, async ({ creatorPageId, newName }) => {
    if (!creatorPageId || !newName) throw new Error('creatorPageId, newName が必要です');
    return notion.renameCreator(creatorPageId, newName);
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/notion-remove-creator', label: 'Notion Remove Error' }, async ({ workId, creatorPageId }) => {
    if (!workId || !creatorPageId) throw new Error('workId, creatorPageId が必要です');
    return notion.removeCreatorFromWork(workId, creatorPageId);
  })) return true;

  return false;
}

module.exports = { handleNotionRoutes };
