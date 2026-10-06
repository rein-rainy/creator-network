const { processInChunks } = require('../util/concurrency');

const youtubeVideoCache = new Map();

/** 共同投稿（「A and B」）の動画は、投稿者のリンクが共同チャンネル一覧のダイアログになっている。そこから各チャンネルを取り出す */
function collaboratorChannels(author) {
  const items = author?.endpoint?.payload?.panelLoadingStrategy?.inlineContent?.dialogViewModel
    ?.customContent?.listViewModel?.listItems ?? [];
  return items.map(({ listItemViewModel: item }) => ({
    id: item?.rendererContext?.commandContext?.onTap?.innertubeCommand?.browseEndpoint?.browseId ?? '',
    name: item?.title?.content ?? '',
    icon: item?.leadingAccessory?.avatarViewModel?.image?.sources?.[0]?.url ?? '',
  })).filter(c => c.name);
}

async function searchYoutubeVideos(titles = []) {
  const uniqueTitles = [...new Set(titles.map(title => String(title || '').trim()).filter(Boolean))].slice(0, 100);
  const startTime = Date.now();
  const uncached = uniqueTitles.filter(title => !youtubeVideoCache.has(title));
  const results = {};

  uniqueTitles.forEach(title => {
    if (youtubeVideoCache.has(title)) results[title] = youtubeVideoCache.get(title);
  });

  console.log(`[YouTube.js] 全体開始 titles=${uniqueTitles.length} (キャッシュ済み=${uniqueTitles.length - uncached.length} 未取得=${uncached.length})`);

  if (!global._ytInitPromise) {
    global._ytInitPromise = (async () => {
      try {
        const { Innertube } = await import('youtubei.js');
        const client = await Innertube.create({
          generate_session_locally: true,
          retrieve_player: false,
        });
        console.log('[YouTube.js] Innertube クライアント初期化完了');
        return client;
      } catch (error) {
        console.error('[YouTube.js] クライアント初期化失敗:', error.message);
        return null;
      }
    })();
  }

  const yt = await global._ytInitPromise;
  if (!yt) global._ytInitPromise = null;
  if (!yt) return { results, warning: 'YouTube API unavailable' };

  async function ytJsSearch(title) {
    const t0 = Date.now();
    try {
      const searchResults = await yt.search(title, { type: 'video' });
      console.log(`[YouTube.js] "${title}" 実行時間: ${Date.now() - t0}ms`);
      const video = searchResults.videos?.[0] ?? null;
      if (!video || !video.id) return null;

      const thumbnail = video.best_thumbnail?.url
        ?? video.thumbnails?.[0]?.url
        ?? `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`;

      // 投稿したチャンネル（名前とアイコン）。検索結果に含まれているので追加の問い合わせは不要
      // 共同投稿なら name は「A and B」で、members に各チャンネルが入る
      const author = video.author;
      const channel = author?.name
        ? {
            id: author.id && author.id !== 'N/A' ? author.id : '',
            name: author.name,
            icon: author.best_thumbnail?.url ?? author.thumbnails?.[0]?.url ?? '',
            members: collaboratorChannels(author),
          }
        : null;

      return {
        url: `https://www.youtube.com/watch?v=${video.id}`,
        thumbnail,
        title: video.title?.text ?? title,
        channel,
      };
    } catch (error) {
      console.warn(`[YouTube.js] "${title}" 検索失敗 (${Date.now() - t0}ms): ${error.message || String(error)}`);
      return null;
    }
  }

  await processInChunks(uncached, async (title) => {
    const result = await ytJsSearch(title);
    youtubeVideoCache.set(title, result);
    results[title] = result;
  }, { concurrency: 5, delayMs: 100 });

  const successCount = Object.values(results).filter(Boolean).length;
  console.log(`[YouTube.js] 全体完了: ${Date.now() - startTime}ms (成功=${successCount}/${uniqueTitles.length})`);
  return { results };
}

module.exports = { searchYoutubeVideos };
