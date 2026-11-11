/* lib/rating.js
 * Decides when the popup may ask for a Chrome Web Store rating.
 * Local-only: the record lives in chrome.storage.local and nothing is sent anywhere.
 */

(() => {
  'use strict';

  const KEY = 'ka_rating';
  const DAY = 24 * 60 * 60 * 1000;
  const MIN_AGE_MS = 7 * DAY;
  const MIN_ACTIVE_MS = 2 * 60 * 60 * 1000;
  const SNOOZE_MS = 30 * DAY;

  function normalize(record, now) {
    const r = record && typeof record === 'object' ? record : {};
    return {
      firstSeenAt: Number.isFinite(r.firstSeenAt) ? r.firstSeenAt : now,
      snoozedUntil: Number.isFinite(r.snoozedUntil) ? r.snoozedUntil : 0,
      snoozes: Number.isFinite(r.snoozes) ? r.snoozes : 0,
      done: r.done === true
    };
  }

  // Only store installs ('normal'): unpacked, sideloaded and policy installs have no listing to rate.
  function shouldAsk(record, now, installType, totalActiveMs) {
    if (installType !== 'normal' || !record || record.done) return false;
    if (now - record.firstSeenAt < MIN_AGE_MS) return false;
    if ((totalActiveMs || 0) < MIN_ACTIVE_MS) return false;
    return now >= record.snoozedUntil;
  }

  // "Later" snoozes once; a second "Later" stops asking for good.
  function later(record, now) {
    const snoozes = record.snoozes + 1;
    return { ...record, snoozes, snoozedUntil: now + SNOOZE_MS, done: snoozes >= 2 };
  }

  function finish(record) {
    return { ...record, done: true };
  }

  function reviewUrl(extensionId) {
    return `https://chromewebstore.google.com/detail/${extensionId}/reviews`;
  }

  self.SARating = { KEY, MIN_AGE_MS, MIN_ACTIVE_MS, SNOOZE_MS, normalize, shouldAsk, later, finish, reviewUrl };
})();
