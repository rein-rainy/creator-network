/**
 * Run `fn` over `items` in chunks of `concurrency`, pausing `delayMs`
 * between chunks. Returns results in the same order as `items`.
 * `fn` is called as `fn(item, index)`.
 */
async function processInChunks(items, fn, { concurrency = 5, delayMs = 100 } = {}) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map((item, idx) => fn(item, i + idx)));
    results.push(...chunkResults);
    if (i + concurrency < items.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return results;
}

module.exports = { processInChunks };
