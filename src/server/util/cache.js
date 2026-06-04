/**
 * Minimal TTL + LRU in-memory cache.
 * Entries expire after `ttlMs`; when `max` is exceeded the oldest entry is evicted.
 */
function createCache({ ttlMs = 5 * 60 * 1000, max = 500 } = {}) {
  const store = new Map();

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      store.delete(key);
      return undefined;
    }
    // Refresh recency (LRU): re-insert at the end.
    store.delete(key);
    store.set(key, entry);
    return entry.value;
  }

  function set(key, value) {
    if (store.has(key)) store.delete(key);
    store.set(key, { value, expires: Date.now() + ttlMs });
    if (store.size > max) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
    }
  }

  /** Return cached value or compute, cache, and return it. Errors are not cached. */
  async function wrap(key, producer) {
    const cached = get(key);
    if (cached !== undefined) return cached;
    const value = await producer();
    set(key, value);
    return value;
  }

  return { get, set, wrap };
}

module.exports = { createCache };
