/* lib/logger.js
 * Append-only ring buffer of diagnostic events, stored in chrome.storage.local.
 * Used by the service worker, content script and options page.
 *
 * Writes are batched so a chatty content script does not hammer storage
 * (chrome.storage.local has a write-rate quota).
 */

(function (root) {
  'use strict';

  const LOG_KEY = 'kalogs';
  const MAX_ENTRIES = 500;
  const FLUSH_MS = 4000;

  /** @type {Array<Object>} */
  let pending = [];
  let flushTimer = null;
  let flushing = false;

  function nowISO() {
    return new Date().toISOString();
  }

  function compact(data) {
    if (data === undefined || data === null) return undefined;
    if (typeof data !== 'object') return data;
    try {
      const s = JSON.stringify(data);
      if (s.length <= 300) return data;
      return { _truncated: s.slice(0, 280) + '…' };
    } catch (_) {
      return undefined;
    }
  }

  function makeEntry(level, category, message, data) {
    return {
      t: nowISO(),
      ms: Date.now(),
      lvl: level,
      cat: category,
      msg: String(message || ''),
      data: compact(data)
    };
  }

  async function readAll() {
    try {
      const res = await chrome.storage.local.get(LOG_KEY);
      const arr = res && res[LOG_KEY];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  async function appendMany(entries) {
    if (!entries.length) return;
    const existing = await readAll();
    const merged = existing.concat(entries);
    const trimmed = merged.length > MAX_ENTRIES
      ? merged.slice(merged.length - MAX_ENTRIES)
      : merged;
    try {
      await chrome.storage.local.set({ [LOG_KEY]: trimmed });
    } catch (_) {
      /* quota or invalidated context; drop silently — logging must never break the app */
    }
  }

  async function flush() {
    if (flushing || !pending.length) return;
    flushing = true;
    const batch = pending;
    pending = [];
    try {
      await appendMany(batch);
    } finally {
      flushing = false;
    }
    if (pending.length) scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, FLUSH_MS);
  }

  function entry(level, category, message, data) {
    pending.push(makeEntry(level, category, message, data));
    // Hard cap on memory if storage writes are stalled.
    if (pending.length > 200) pending = pending.slice(-200);
    scheduleFlush();
  }

  const api = {
    LOG_KEY,
    MAX_ENTRIES,

    debug: (cat, msg, data) => entry('debug', cat, msg, data),
    info: (cat, msg, data) => entry('info', cat, msg, data),
    warn: (cat, msg, data) => entry('warn', cat, msg, data),
    error: (cat, msg, data) => entry('error', cat, msg, data),

    /** Force pending entries to storage right now. */
    flush,

    /** All stored entries, oldest first. Flushes pending writes first. */
    async all() {
      await flush();
      return readAll();
    },

    /** Most recent `n` entries, newest first. */
    async recent(n = 100) {
      const all = await api.all();
      return all.slice(-n).reverse();
    },

    async clear() {
      pending = [];
      try {
        await chrome.storage.local.remove(LOG_KEY);
      } catch (_) {}
    },

    /** Plain-text export for the options page. */
    async exportText() {
      const all = await api.all();
      const lines = all.map((e) => {
        const d = e.data === undefined ? '' : ' ' + JSON.stringify(e.data);
        return `${e.t}  [${e.lvl.toUpperCase()}]  (${e.cat})  ${e.msg}${d}`;
      });
      return lines.join('\r\n');
    },

    /** Subscribe to new entries (options page live view). */
    onChange(cb) {
      const handler = (changes, area) => {
        if (area === 'local' && changes[LOG_KEY]) cb();
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    }
  };

  root.SALogger = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
