const config = require('../config');
const { readJson, sendJson } = require('../http');
const notion = require('../services/notion');

async function handleNotionRoutes(req, res) {
  if (req.method === 'POST' && req.url === '/notion-data') {
    try {
      const { database } = await readJson(req);
      if (!config.NOTION_TOKEN) {
        return sendJson(res, 503, {
          error: 'Notion API is not configured. Please set NOTION_TOKEN environment variable.',
          code: 'NOTION_TOKEN_MISSING',
        });
      }
      const { rows, creators, artists, count } = await notion.buildData(database);
      return sendJson(res, 200, { results: rows, creators, artists, count });
    } catch (error) {
      console.error('[Notion Data Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'POST' && req.url === '/notion-add-creator') {
    try {
      const { workId, creatorPageId } = await readJson(req);
      if (!workId || !creatorPageId) throw new Error('workId, creatorPageId が必要です');
      return sendJson(res, 200, await notion.addCreatorToWork(workId, creatorPageId));
    } catch (error) {
      console.error('[Notion Add Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'POST' && req.url === '/notion-create-creator') {
    try {
      const { name, imageUrl } = await readJson(req);
      if (!name) throw new Error('name が必要です');
      return sendJson(res, 200, await notion.createCreator(name, imageUrl));
    } catch (error) {
      console.error('[Notion Create Creator Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'POST' && req.url === '/notion-set-creator-cover') {
    try {
      const { creatorPageId, imageUrl } = await readJson(req);
      if (!creatorPageId || !imageUrl) throw new Error('creatorPageId, imageUrl が必要です');
      return sendJson(res, 200, await notion.setCreatorCover(creatorPageId, imageUrl));
    } catch (error) {
      console.error('[Notion Cover Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && req.url === '/notion-role-options') {
    try {
      return sendJson(res, 200, await notion.getRoleOptions());
    } catch (error) {
      console.error('[RoleOptions Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'POST' && req.url === '/notion-update-creator-meta') {
    try {
      const { creatorPageId, role, sns } = await readJson(req);
      if (!creatorPageId) throw new Error('creatorPageId が必要です');
      return sendJson(res, 200, await notion.updateCreatorMeta(creatorPageId, role, sns));
    } catch (error) {
      console.error('[UpdateCreatorMeta Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'POST' && req.url === '/notion-rename-creator') {
    try {
      const { creatorPageId, newName } = await readJson(req);
      if (!creatorPageId || !newName) throw new Error('creatorPageId, newName が必要です');
      return sendJson(res, 200, await notion.renameCreator(creatorPageId, newName));
    } catch (error) {
      console.error('[Notion Rename Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'POST' && req.url === '/notion-remove-creator') {
    try {
      const { workId, creatorPageId } = await readJson(req);
      if (!workId || !creatorPageId) throw new Error('workId, creatorPageId が必要です');
      return sendJson(res, 200, await notion.removeCreatorFromWork(workId, creatorPageId));
    } catch (error) {
      console.error('[Notion Remove Error]', error.message);
      return sendJson(res, 500, { error: error.message });
    }
  }

  return false;
}

module.exports = { handleNotionRoutes };
