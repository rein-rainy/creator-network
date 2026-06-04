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
    const { rows, creators, artists, count } = await notion.buildData(database);
    return { results: rows, creators, artists, count };
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/notion-add-creator', label: 'Notion Add Error' }, async ({ workId, creatorPageId }) => {
    if (!workId || !creatorPageId) throw new Error('workId, creatorPageId が必要です');
    return notion.addCreatorToWork(workId, creatorPageId);
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/notion-create-creator', label: 'Notion Create Creator Error' }, async ({ name, imageUrl }) => {
    if (!name) throw new Error('name が必要です');
    return notion.createCreator(name, imageUrl);
  })) return true;

  if (await jsonRoute(req, res, { method: 'POST', path: '/notion-set-creator-cover', label: 'Notion Cover Error' }, async ({ creatorPageId, imageUrl }) => {
    if (!creatorPageId || !imageUrl) throw new Error('creatorPageId, imageUrl が必要です');
    return notion.setCreatorCover(creatorPageId, imageUrl);
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
