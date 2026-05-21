const youtubeVideoCache = new Map();

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

      return {
        url: `https://www.youtube.com/watch?v=${video.id}`,
        thumbnail,
        title: video.title?.text ?? title,
      };
    } catch (error) {
      console.warn(`[YouTube.js] "${title}" 検索失敗 (${Date.now() - t0}ms): ${error.message || String(error)}`);
      return null;
    }
  }

  const CONCURRENCY = 5;
  const DELAY_MS = 100;
  for (let i = 0; i < uncached.length; i += CONCURRENCY) {
    const chunk = uncached.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(title => ytJsSearch(title)));
    chunkResults.forEach((result, index) => {
      const title = chunk[index];
      youtubeVideoCache.set(title, result);
      results[title] = result;
    });
    if (i + CONCURRENCY < uncached.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  const successCount = Object.values(results).filter(Boolean).length;
  console.log(`[YouTube.js] 全体完了: ${Date.now() - startTime}ms (成功=${successCount}/${uniqueTitles.length})`);
  return { results };
}

module.exports = { searchYoutubeVideos };
