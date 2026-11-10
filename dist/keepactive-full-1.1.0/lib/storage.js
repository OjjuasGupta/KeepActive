/* lib/storage.js
 * Single source of truth for state shape, defaults, validation, and scheduling logic.
 * Imported by background.js, popup, options, and content script.
 */

(function (root) {
  'use strict';

  const KEY = 'ka';
  const VERSION = 2;

  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  function defaultState() {
    return {
      v: VERSION,

      // Master switch. Everything else is gated on this.
      enabled: false,

      // Why it is currently paused, if it is. null = not paused.
      pauseReason: null, // null | 'activity' | 'manual-hold'

      // Timestamp the master switch was turned on (wall clock), and the start
      // of the current effective ON period. sessionStartedAt is null while the
      // extension is paused or outside schedule.
      enabledAt: null,
      sessionStartedAt: null,

      // Total accumulated effective ON time in ms across sessions (survives restarts).
      totalActiveMs: 0,

      // Last observed transition into the active state, and the time the user
      // was first observed idle. Used to make Smart Pause resumable across
      // service-worker restarts.
      lastActiveAt: null,
      idleSince: null,

      // When the user explicitly resumes while Smart Pause is enabled, keep
      // their choice instead of immediately pausing on the next active event.
      smartPauseOverride: false,

      // Optional native helper status. Always present so popup/options can
      // render a stable state even when the store build has no helper.
      nativeHelperConnected: false,

      modes: {
        keepAwake: true,      // chrome.power
        teamsWeb: true,       // content script in Teams Web
        nativeHelper: false   // optional native messaging helper
      },

      // Activity tuning (seconds).
      intervals: {
        webMinSec: 60,
        webMaxSec: 150,
        helperMinSec: 45,
        helperMaxSec: 120
      },

      // Smart pause: pause when the human is genuinely at the keyboard.
      smartPause: {
        enabled: true,
        resumeAfterIdleMin: 2,     // wait N minutes of continuous idle before resuming
        idleDetectionSeconds: 15   // chrome.idle threshold
      },

      // Working-hours schedule (local time, 24h clock "HH:MM").
      schedule: {
        enabled: false,
        days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
        start: '09:30',
        end: '18:30'
      },

      // Safety limits.
      safety: {
        maxSessionHours: 0 // 0 = unlimited; otherwise auto-off after N hours
      },

      // Diagnostics
      debugOverlay: false, // draw small status badge in Teams tab
      lastError: null
    };
  }

  function clamp(n, lo, hi, fallback) {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(hi, Math.max(lo, v));
  }

  function validHHMM(s) {
    return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  }

  /** Deep-merge persisted state over defaults, coercing every field. */
  function normalize(raw) {
    const d = defaultState();
    if (!raw || typeof raw !== 'object') return d;

    const s = d;
    s.enabled = !!raw.enabled;
    s.pauseReason = typeof raw.pauseReason === 'string' ? raw.pauseReason : null;
    s.enabledAt = Number.isFinite(raw.enabledAt) ? raw.enabledAt : null;
    s.sessionStartedAt = Number.isFinite(raw.sessionStartedAt) ? raw.sessionStartedAt : null;
    s.totalActiveMs = clamp(raw.totalActiveMs, 0, Number.MAX_SAFE_INTEGER, 0);
    s.lastActiveAt = Number.isFinite(raw.lastActiveAt) ? raw.lastActiveAt : null;
    s.idleSince = Number.isFinite(raw.idleSince) ? raw.idleSince : null;
    s.smartPauseOverride = !!raw.smartPauseOverride;
    s.nativeHelperConnected = !!raw.nativeHelperConnected;

    if (raw.modes && typeof raw.modes === 'object') {
      s.modes.keepAwake = raw.modes.keepAwake !== false;
      s.modes.teamsWeb = raw.modes.teamsWeb !== false;
      s.modes.nativeHelper = !!raw.modes.nativeHelper;
    }

    if (raw.intervals && typeof raw.intervals === 'object') {
      s.intervals.webMinSec = clamp(raw.intervals.webMinSec, 10, 3600, 60);
      s.intervals.webMaxSec = clamp(raw.intervals.webMaxSec, 11, 3600, 150);
      s.intervals.helperMinSec = clamp(raw.intervals.helperMinSec, 10, 3600, 45);
      s.intervals.helperMaxSec = clamp(raw.intervals.helperMaxSec, 11, 3600, 120);
    }
    // Keep max >= min + 1
    if (s.intervals.webMaxSec <= s.intervals.webMinSec) {
      s.intervals.webMaxSec = s.intervals.webMinSec + 1;
    }
    if (s.intervals.helperMaxSec <= s.intervals.helperMinSec) {
      s.intervals.helperMaxSec = s.intervals.helperMinSec + 1;
    }

    if (raw.smartPause && typeof raw.smartPause === 'object') {
      s.smartPause.enabled = raw.smartPause.enabled !== false;
      s.smartPause.resumeAfterIdleMin = clamp(raw.smartPause.resumeAfterIdleMin, 1, 120, 2);
      s.smartPause.idleDetectionSeconds = clamp(raw.smartPause.idleDetectionSeconds, 15, 3600, 15);
    }

    if (raw.schedule && typeof raw.schedule === 'object') {
      s.schedule.enabled = !!raw.schedule.enabled;
      if (raw.schedule.days && typeof raw.schedule.days === 'object') {
        for (const day of DAYS) {
          s.schedule.days[day] = !!raw.schedule.days[day];
        }
      }
      s.schedule.start = validHHMM(raw.schedule.start) ? raw.schedule.start : '09:30';
      s.schedule.end = validHHMM(raw.schedule.end) ? raw.schedule.end : '18:30';
    }

    if (raw.safety && typeof raw.safety === 'object') {
      s.safety.maxSessionHours = clamp(raw.safety.maxSessionHours, 0, 72, 0);
    }

    s.debugOverlay = !!raw.debugOverlay;
    s.lastError = typeof raw.lastError === 'string' ? raw.lastError : null;
    return s;
  }

  function isWithinSchedule(state, date = new Date()) {
    const sched = state?.schedule;
    if (!sched || !sched.enabled) return true;

    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const today = dayNames[date.getDay()];
    const yesterday = dayNames[(date.getDay() + 6) % 7];

    const [startH, startM] = (sched.start || '09:30').split(':').map(Number);
    const [endH, endM] = (sched.end || '18:30').split(':').map(Number);

    const start = startH * 60 + startM;
    const end = endH * 60 + endM;
    const current = date.getHours() * 60 + date.getMinutes();

    if (start <= end) {
      return !!sched.days?.[today] && current >= start && current < end;
    }

    // Overnight shift, e.g. 22:00 to 06:00. The shift belongs to the day it
    // started, so the early-morning portion checks yesterday's workday.
    if (current >= start && sched.days?.[today]) return true;
    if (current < end && sched.days?.[yesterday]) return true;
    return false;
  }

  function computeEffective(state, date = new Date()) {
    if (!state || !state.enabled) return false;
    if (state.pauseReason) return false;
    if (!isWithinSchedule(state, date)) return false;
    return true;
  }

  /**
   * Calculate the next timestamp (epoch ms) when schedule changes
   * (ON -> OFF or OFF -> ON). Handles normal, overnight, and multi-day gaps.
   */
  function getNextScheduleChange(now, sched) {
    if (!sched || !sched.enabled) return null;

    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const [startH, startM] = (sched.start || '09:30').split(':').map(Number);
    const [endH, endM] = (sched.end || '18:30').split(':').map(Number);
    const start = startH * 60 + startM;
    const end = endH * 60 + endM;
    const overnight = start > end;

    let best = null;

    // Include yesterday so an overnight shift that started yesterday can
    // produce its end transition today.
    for (let offset = -1; offset <= 8; offset++) {
      const dayDate = new Date(now);
      dayDate.setDate(now.getDate() + offset);
      dayDate.setHours(0, 0, 0, 0);

      const day = dayNames[dayDate.getDay()];
      if (!sched.days?.[day]) continue;

      const startTs = dayDate.getTime() + start * 60000;
      const endTs = dayDate.getTime() + end * 60000 + (overnight ? 86400000 : 0);

      for (const ts of [startTs, endTs]) {
        if (ts > now.getTime() && (best === null || ts < best)) {
          best = ts;
        }
      }
    }

    return best;
  }

  async function getState() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return defaultState();
    }
    const res = await chrome.storage.local.get(KEY);
    return normalize(res ? res[KEY] : null);
  }

  async function setState(next) {
    const normalized = normalize(next);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [KEY]: normalized });
    }
    return normalized;
  }

  /** Read-modify-write with a mutex so concurrent updates cannot clobber. */
  let chain = Promise.resolve();
  function update(mutator) {
    const run = async () => {
      const cur = await getState();
      const draft = JSON.parse(JSON.stringify(cur));
      const result = (await mutator(draft)) || draft;
      return setState(result);
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  function onChanged(cb) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) {
      return () => {};
    }
    const handler = (changes, area) => {
      if (area === 'local' && changes[KEY]) cb(changes[KEY].newValue);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }

  const api = {
    KEY,
    DAYS,
    defaultState,
    normalize,
    isWithinSchedule,
    computeEffective,
    getNextScheduleChange,
    getState,
    setState,
    update,
    onChanged
  };

  root.SAStorage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
