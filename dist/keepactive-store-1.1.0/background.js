/* background.js
 * Manifest V3 service worker for KeepActive.
 *
 * Responsibilities:
 *   - keep the display awake while KeepActive is effectively ON
 *   - own the schedule, Smart Pause and session clock state machine
 *   - drive the Teams Web content script through state broadcasts
 *   - optionally connect to the bundled native helper (full build only)
 *
 * The service worker can be stopped at any time, so every decision is based
 * on persisted state. No behaviour depends on in-memory timers surviving.
 */

importScripts('lib/random.js', 'lib/storage.js', 'lib/logger.js');

(() => {
  'use strict';

  const SARandom = self.SARandom;
  const SAStorage = self.SAStorage;
  const SALogger = self.SALogger;

  const WELCOME_SHOWN_KEY = 'welcomeShown';
  const NATIVE_HOST = 'keepactive_helper';

  const ALARM = {
    SCHEDULE: 'schedule-change',
    MAX_SESSION: 'max-session',
    TICK: 'ka-tick',
    RESUME_IDLE: 'resume-idle',
    HELPER_TICK: 'helper-tick',
    HELPER_RECONNECT: 'helper-reconnect'
  };

  const ICONS_RED = {
    '16': 'icons/icon-red-16.png',
    '32': 'icons/icon-red-32.png',
    '48': 'icons/icon-red-48.png',
    '128': 'icons/icon-red-128.png'
  };
  const ICONS_GREEN = {
    '16': 'icons/icon-green-16.png',
    '32': 'icons/icon-green-32.png',
    '48': 'icons/icon-green-48.png',
    '128': 'icons/icon-green-128.png'
  };
  const ICONS_GREEN_DIM = {
    '16': 'icons/icon-green-dim-16.png',
    '32': 'icons/icon-green-dim-32.png',
    '48': 'icons/icon-green-dim-48.png',
    '128': 'icons/icon-green-dim-128.png'
  };

  const VALID_MODES = new Set(['keepAwake', 'teamsWeb', 'nativeHelper']);

  let stateCache = null;
  let initPromise = null;
  let idleListenerRegistered = false;
  let commandListenerRegistered = false;
  let keepAwakeState = null;
  let lastIconKey = null;

  let nativePort = null;
  let nativeConnecting = false;
  let nativeLastError = null;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function hasNativePermission() {
    try {
      const manifest = chrome.runtime.getManifest();
      const declared = [].concat(
        Array.isArray(manifest.permissions) ? manifest.permissions : [],
        Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions : []
      );
      return declared.includes('nativeMessaging');
    } catch (_) {
      return false;
    }
  }

  async function log(level, message, data) {
    try {
      if (SALogger && typeof SALogger[level] === 'function') {
        SALogger[level]('keepactive-bg', message, data);
      }
    } catch (_) {
      /* logging must never break the extension */
    }
  }

  async function getState() {
    const raw = await SAStorage.getState();
    raw.effective = SAStorage.computeEffective(raw);
    raw.nativeAvailable = hasNativePermission();
    stateCache = raw;
    return raw;
  }

  function broadcastStateChange(state) {
    const payload = state || stateCache;
    if (!payload) return;
    try {
      const result = chrome.runtime.sendMessage({ type: 'STATE_CHANGED', state: payload });
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {
      /* no receiving context is normal */
    }
  }

  function queryIdle(seconds) {
    return new Promise(resolve => {
      try {
        chrome.idle.queryState(Math.max(15, Number(seconds) || 15), value => {
          resolve(value || 'active');
        });
      } catch (_) {
        resolve('active');
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Session clock                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Accumulate effective ON time exactly once per effective period.
   * An effective period starts when master power, schedule and pause state
   * all agree, and ends on the first transition away from that state.
   */
  async function reconcileSession() {
    const current = await SAStorage.getState();
    const now = Date.now();
    const effective = SAStorage.computeEffective(current, new Date(now));

    let next = null;

    if (effective) {
      if (!current.sessionStartedAt) {
        next = { ...current, sessionStartedAt: now, lastActiveAt: current.lastActiveAt || now };
      }
      if (!current.enabledAt) {
        next = next || { ...current };
        next.enabledAt = current.sessionStartedAt || now;
      }
    } else {
      if (current.sessionStartedAt) {
        next = {
          ...current,
          totalActiveMs: (current.totalActiveMs || 0) + Math.max(0, now - current.sessionStartedAt),
          sessionStartedAt: null
        };
      }
      if (!current.enabled) {
        const needsReset = current.enabledAt !== null ||
          current.pauseReason !== null ||
          current.smartPauseOverride ||
          current.idleSince !== null ||
          current.sessionStartedAt !== null;
        if (needsReset) {
          next = next || { ...current };
          next.enabledAt = null;
          next.pauseReason = null;
          next.smartPauseOverride = false;
          next.idleSince = null;
        }
      }
    }

    if (!next) return { changed: false, state: current };

    await SAStorage.setState(next);
    return { changed: true, state: await getState() };
  }

  /* ------------------------------------------------------------------ */
  /* Keep-awake and toolbar                                              */
  /* ------------------------------------------------------------------ */

  async function applyKeepAwake(on) {
    const target = !!on;
    if (keepAwakeState === target) return;

    try {
      if (target) {
        await chrome.power.requestKeepAwake('display');
      } else {
        await chrome.power.releaseKeepAwake();
      }
      keepAwakeState = target;
      await log('info', 'power', target ? 'Keep-awake ACTIVE (display)' : 'Keep-awake released');
    } catch (error) {
      await log('error', 'power', 'Failed to toggle keep-awake', { error: String(error) });
    }
  }

  async function updateToolbarIcon(state) {
    if (!chrome.action || typeof chrome.action.setIcon !== 'function') return;

    const key = state.effective ? 'green' : (state.enabled ? 'dim' : 'red');
    if (key === lastIconKey) return;

    const path = key === 'green' ? ICONS_GREEN : (key === 'dim' ? ICONS_GREEN_DIM : ICONS_RED);
    try {
      await chrome.action.setIcon({ path });
      lastIconKey = key;
    } catch (_) {
      /* tab may be closing; next state change retries */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Native helper                                                       */
  /* ------------------------------------------------------------------ */

  async function setNativeStatus(connected, error) {
    const current = await SAStorage.getState();
    const nextConnected = !!connected;
    const nextError = error ? String(error) : null;
    if (current.nativeHelperConnected === nextConnected && (current.lastError || null) === nextError) {
      return;
    }
    await SAStorage.setState({
      ...current,
      nativeHelperConnected: nextConnected,
      lastError: nextError
    });
    await getState();
    broadcastStateChange(stateCache);
  }

  function postNative(message) {
    if (!nativePort) return false;
    try {
      nativePort.postMessage(message);
      return true;
    } catch (error) {
      nativeLastError = String(error);
      return false;
    }
  }

  function postNativeConfig() {
    if (!nativePort || !stateCache) return;
    postNative({
      type: 'CONFIG',
      minSec: stateCache.intervals.helperMinSec,
      maxSec: stateCache.intervals.helperMaxSec,
      pressShift: true,
      minIdleSec: Math.max(15, stateCache.smartPause.idleDetectionSeconds || 15)
    });
  }

  async function scheduleNativeReconnect() {
    const state = await getState();
    if (!state.modes.nativeHelper || !hasNativePermission()) return;
    const existing = await chrome.alarms.get(ALARM.HELPER_RECONNECT);
    if (!existing) {
      await chrome.alarms.create(ALARM.HELPER_RECONNECT, { delayInMinutes: 2 });
    }
  }

  function disconnectNative(clearStatus = true) {
    if (nativePort) {
      try { nativePort.postMessage({ type: 'STOP' }); } catch (_) {}
      try { nativePort.disconnect(); } catch (_) {}
      nativePort = null;
    }
    nativeConnecting = false;
    nativeLastError = null;
    void chrome.alarms.clear(ALARM.HELPER_TICK);
    void chrome.alarms.clear(ALARM.HELPER_RECONNECT);
    if (clearStatus) void setNativeStatus(false, null);
  }

  function connectNative() {
    if (!hasNativePermission()) {
      void setNativeStatus(false, 'Native messaging is not included in this build.');
      return;
    }
    if (nativePort || nativeConnecting) return;

    nativeConnecting = true;
    let port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (error) {
      nativeConnecting = false;
      nativeLastError = String(error);
      void setNativeStatus(false, nativeLastError);
      void scheduleNativeReconnect();
      return;
    }

    nativePort = port;
    nativeConnecting = false;

    port.onMessage.addListener(message => {
      void handleNativeMessage(message);
    });

    port.onDisconnect.addListener(() => {
      const runtimeError = chrome.runtime.lastError && chrome.runtime.lastError.message;
      const message = runtimeError || nativeLastError || 'Native helper disconnected. Install or repair the helper, then reconnect.';
      nativePort = null;
      nativeConnecting = false;
      nativeLastError = null;
      void setNativeStatus(false, message);
      void scheduleNativeReconnect();
    });

    postNative({ type: 'PING' });
    postNativeConfig();
    void log('info', 'native', 'Native helper connection opened');
  }

  async function handleNativeMessage(message) {
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'READY' || message.type === 'PONG') {
      nativeLastError = null;
      await setNativeStatus(true, null);
      const state = await getState();
      await scheduleHelperTick(state);
      await log('info', 'native', 'Native helper ready', {
        platform: message.platform || undefined,
        version: message.version || undefined
      });
      return;
    }

    if (message.type === 'RESULT') {
      if (!message.ok) {
        nativeLastError = message.reason || 'Native helper skipped the action.';
      } else {
        nativeLastError = null;
      }
      await setNativeStatus(!!nativePort, nativeLastError);
      await log(message.ok ? 'debug' : 'warn', 'native', message.ok ? 'Native micro-activity executed' : 'Native helper skipped action', {
        reason: message.reason || undefined
      });
      return;
    }

    if (message.type === 'ERROR') {
      nativeLastError = message.message || 'Native helper reported an error.';
      await setNativeStatus(!!nativePort, nativeLastError);
      await log('warn', 'native', 'Native helper error', { error: nativeLastError });
    }
  }

  async function scheduleHelperTick(state) {
    await chrome.alarms.clear(ALARM.HELPER_TICK);
    if (!state) state = await getState();
    if (!state.enabled || !state.effective || !state.modes.nativeHelper || !state.nativeHelperConnected) {
      return;
    }

    const minSec = state.intervals.helperMinSec;
    const maxSec = state.intervals.helperMaxSec;
    const delayMs = SARandom ? SARandom.delayMs(minSec, maxSec) : Math.round(((minSec + maxSec) / 2) * 1000);
    const delayMinutes = Math.max(0.75, delayMs / 60000);
    await chrome.alarms.create(ALARM.HELPER_TICK, { delayInMinutes: delayMinutes });
  }

  async function syncNativeHelper(state) {
    if (!state) state = await getState();

    if (!hasNativePermission() || !state.modes.nativeHelper) {
      if (nativePort) {
        disconnectNative();
      } else {
        void chrome.alarms.clear(ALARM.HELPER_TICK);
        void chrome.alarms.clear(ALARM.HELPER_RECONNECT);
      }
      return;
    }

    if (!nativePort && !nativeConnecting) connectNative();
    await scheduleHelperTick(state);
  }

  async function onHelperTick() {
    const state = await getState();
    if (!state.enabled || !state.effective || !state.modes.nativeHelper) {
      await scheduleHelperTick(state);
      return;
    }
    if (!nativePort) {
      connectNative();
      await scheduleNativeReconnect();
      return;
    }
    if (!postNative({ type: 'TRIGGER', source: 'schedule' })) {
      await scheduleNativeReconnect();
    }
    await scheduleHelperTick(state);
  }

  /* ------------------------------------------------------------------ */
  /* Core state transitions                                              */
  /* ------------------------------------------------------------------ */

  async function applyEffectiveState(options = {}) {
    await reconcileSession();
    const state = await getState();

    await applyKeepAwake(state.effective && state.modes.keepAwake);
    await updateToolbarIcon(state);
    await syncNativeHelper(state);

    if (options.broadcast !== false) broadcastStateChange(state);
    return state;
  }

  async function setPauseReason(reason, options = {}) {
    const current = await SAStorage.getState();
    if (reason === current.pauseReason && !options.force) {
      return applyEffectiveState();
    }

    const now = Date.now();
    const next = { ...current, pauseReason: reason };

    if (reason === 'activity') {
      next.lastActiveAt = now;
      next.idleSince = null;
      next.smartPauseOverride = false;
    } else if (reason === 'manual-hold') {
      next.idleSince = null;
      next.smartPauseOverride = false;
    } else if (!reason) {
      next.idleSince = null;
      if (current.pauseReason === 'activity' && options.userInitiated) {
        // The user explicitly asked to keep simulating. Do not immediately
        // re-pause on the next 'active' idle event.
        next.smartPauseOverride = true;
      } else if (current.pauseReason === 'manual-hold') {
        next.smartPauseOverride = false;
      }
    }

    await SAStorage.setState(next);
    await applyEffectiveState();
  }

  async function clearPauseReason(options = {}) {
    return setPauseReason(null, options);
  }

  async function toggleEnabled(on) {
    if (typeof on !== 'boolean') throw new Error('TOGGLE requires a boolean enabled value.');

    await reconcileSession();
    const current = await SAStorage.getState();
    const now = Date.now();

    const next = { ...current, enabled: on };
    next.pauseReason = null;
    next.smartPauseOverride = false;
    next.idleSince = null;

    if (on) {
      next.enabledAt = now;
      next.sessionStartedAt = null;
      next.lastActiveAt = now;
    } else {
      next.enabledAt = null;
      next.sessionStartedAt = null;
    }

    await SAStorage.setState(next);
    await chrome.alarms.clear(ALARM.RESUME_IDLE);

    await applyEffectiveState();
    if (on) await applyInitialIdleState();
    await scheduleAlarms();
    await log('info', 'toggle', on ? 'ENABLED' : 'DISABLED');
  }

  async function toggleMode(mode, on) {
    if (!VALID_MODES.has(mode)) throw new Error('Unknown mode: ' + mode);
    if (typeof on !== 'boolean') throw new Error('TOGGLE_MODE requires a boolean enabled value.');
    if (mode === 'nativeHelper' && on && !hasNativePermission()) {
      throw new Error('The native helper is not included in this build.');
    }

    const current = await SAStorage.getState();
    await SAStorage.setState({
      ...current,
      modes: { ...current.modes, [mode]: on }
    });

    if (mode === 'nativeHelper') {
      if (on) {
        await getState();
        connectNative();
      } else {
        disconnectNative();
      }
    }

    await applyEffectiveState();
    await scheduleAlarms();
    await log('info', 'mode', `Mode ${mode} = ${on}`);
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  function pickSettings(changes) {
    const picked = {};
    if (!changes || typeof changes !== 'object') return picked;

    const number = value => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    if (changes.intervals && typeof changes.intervals === 'object') {
      picked.intervals = {};
      for (const key of ['webMinSec', 'webMaxSec', 'helperMinSec', 'helperMaxSec']) {
        if (changes.intervals[key] !== undefined) {
          const n = number(changes.intervals[key]);
          if (n !== null) picked.intervals[key] = n;
        }
      }
    }

    if (changes.smartPause && typeof changes.smartPause === 'object') {
      picked.smartPause = {};
      if (typeof changes.smartPause.enabled === 'boolean') {
        picked.smartPause.enabled = changes.smartPause.enabled;
      }
      for (const key of ['resumeAfterIdleMin', 'idleDetectionSeconds']) {
        if (changes.smartPause[key] !== undefined) {
          const n = number(changes.smartPause[key]);
          if (n !== null) picked.smartPause[key] = n;
        }
      }
    }

    if (changes.schedule && typeof changes.schedule === 'object') {
      picked.schedule = {};
      if (typeof changes.schedule.enabled === 'boolean') {
        picked.schedule.enabled = changes.schedule.enabled;
      }
      if (typeof changes.schedule.start === 'string') picked.schedule.start = changes.schedule.start;
      if (typeof changes.schedule.end === 'string') picked.schedule.end = changes.schedule.end;
      if (changes.schedule.days && typeof changes.schedule.days === 'object') {
        picked.schedule.days = {};
        for (const day of SAStorage.DAYS) {
          if (changes.schedule.days[day] !== undefined) {
            picked.schedule.days[day] = !!changes.schedule.days[day];
          }
        }
      }
    }

    if (changes.safety && typeof changes.safety === 'object') {
      const n = number(changes.safety.maxSessionHours);
      if (n !== null) picked.safety = { maxSessionHours: n };
    }

    if (typeof changes.debugOverlay === 'boolean') picked.debugOverlay = changes.debugOverlay;
    return picked;
  }

  async function updateSettings(changes) {
    const picked = pickSettings(changes);
    const current = await SAStorage.getState();
    const next = JSON.parse(JSON.stringify(current));

    if (picked.intervals) Object.assign(next.intervals, picked.intervals);
    if (picked.smartPause) Object.assign(next.smartPause, picked.smartPause);
    if (picked.safety) Object.assign(next.safety, picked.safety);
    if (picked.schedule) {
      if (typeof picked.schedule.enabled === 'boolean') next.schedule.enabled = picked.schedule.enabled;
      if (picked.schedule.start) next.schedule.start = picked.schedule.start;
      if (picked.schedule.end) next.schedule.end = picked.schedule.end;
      if (picked.schedule.days) Object.assign(next.schedule.days, picked.schedule.days);
    }
    if (typeof picked.debugOverlay === 'boolean') next.debugOverlay = picked.debugOverlay;

    if (next.smartPause.enabled === false && next.pauseReason === 'activity') {
      next.pauseReason = null;
      next.idleSince = null;
      next.smartPauseOverride = false;
    }

    await SAStorage.setState(next);
    const fresh = await getState();

    try {
      chrome.idle.setDetectionInterval(Math.max(15, fresh.smartPause.idleDetectionSeconds || 15));
    } catch (_) {}

    await applyEffectiveState();
    await scheduleAlarms();
    postNativeConfig();
    broadcastStateChange(await getState());
  }

  /* ------------------------------------------------------------------ */
  /* Smart Pause                                                         */
  /* ------------------------------------------------------------------ */

  async function ensureResumeAlarm(when) {
    const desired = Math.max(Date.now() + 5000, Number(when) || Date.now() + 60000);
    const existing = await chrome.alarms.get(ALARM.RESUME_IDLE);
    if (existing && Math.abs(existing.scheduledTime - desired) < 30000) return;
    await chrome.alarms.create(ALARM.RESUME_IDLE, { when: desired });
  }

  async function handleIdleState(idleState) {
    const state = await getState();
    if (!state.enabled || !state.smartPause.enabled) return;

    if (idleState === 'active') {
      await chrome.alarms.clear(ALARM.RESUME_IDLE);
      if (state.pauseReason === 'manual-hold') return;

      if (state.smartPauseOverride) {
        // User explicitly resumed while Smart Pause is on. Honour it until
        // they step away (idle/locked), which clears the override.
        await SAStorage.setState({ ...state, lastActiveAt: Date.now(), idleSince: null });
        return;
      }

      if (state.pauseReason !== 'activity') {
        await setPauseReason('activity');
        await log('info', 'smart-pause', 'Paused due to detected user activity');
      } else {
        await SAStorage.setState({ ...state, lastActiveAt: Date.now() });
      }
      return;
    }

    if (idleState === 'idle' || idleState === 'locked') {
      const idleSince = state.idleSince || Date.now();
      await SAStorage.setState({ ...state, idleSince, smartPauseOverride: false });
      const fresh = await getState();

      if (fresh.pauseReason === 'activity') {
        const waitMin = Math.max(1, fresh.smartPause.resumeAfterIdleMin || 2);
        await ensureResumeAlarm(idleSince + waitMin * 60000);
        await log('info', 'smart-pause', `Away detected; resuming in ${waitMin} min`);
      }
    }
  }

  async function applyInitialIdleState() {
    const state = await getState();
    if (!state.enabled || !state.smartPause.enabled) return;
    const idleState = await queryIdle(state.smartPause.idleDetectionSeconds);
    await handleIdleState(idleState);
  }

  function setupIdleDetection(detectionSeconds) {
    try {
      chrome.idle.setDetectionInterval(Math.max(15, Number(detectionSeconds) || 15));
    } catch (_) {}

    if (idleListenerRegistered) return;
    idleListenerRegistered = true;

    chrome.idle.onStateChanged.addListener(idleState => {
      void (async () => {
        try {
          await ensureInit();
          await handleIdleState(idleState);
        } catch (error) {
          await log('error', 'smart-pause', 'Idle transition failed', { error: String(error) });
        }
      })();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Alarms                                                              */
  /* ------------------------------------------------------------------ */

  async function ensureTickAlarm() {
    const existing = await chrome.alarms.get(ALARM.TICK);
    if (!existing) {
      await chrome.alarms.create(ALARM.TICK, { periodInMinutes: 1 });
    }
  }

  async function scheduleAlarms() {
    const state = await getState();

    await chrome.alarms.clear(ALARM.SCHEDULE);
    await chrome.alarms.clear(ALARM.MAX_SESSION);

    if (state.schedule.enabled) {
      const next = SAStorage.getNextScheduleChange(new Date(), state.schedule);
      if (next && next > Date.now()) {
        await chrome.alarms.create(ALARM.SCHEDULE, { when: next });
      }
    }

    if (state.enabled) {
      if (!state.enabledAt) {
        await SAStorage.setState({ ...state, enabledAt: Date.now() });
      }
      const fresh = await getState();
      if (fresh.safety.maxSessionHours > 0 && fresh.enabledAt) {
        const maxMs = fresh.safety.maxSessionHours * 60 * 60 * 1000;
        const remaining = maxMs - (Date.now() - fresh.enabledAt);
        if (remaining <= 0) {
          await toggleEnabled(false);
          await log('info', 'session', 'Max session hours reached, auto-disabled');
          return;
        }
        await chrome.alarms.create(ALARM.MAX_SESSION, { when: Date.now() + remaining });
      }
    }

    await ensureTickAlarm();
    await scheduleHelperTick(state);
  }

  async function onAlarm(alarm) {
    await ensureInit();

    switch (alarm.name) {
      case ALARM.SCHEDULE:
        await applyEffectiveState();
        await scheduleAlarms();
        await log('info', 'schedule', 'Schedule transition applied', {
          effective: !!stateCache && stateCache.effective
        });
        break;

      case ALARM.MAX_SESSION: {
        const state = await getState();
        const maxMs = state.safety.maxSessionHours * 60 * 60 * 1000;
        if (state.enabled && state.enabledAt && maxMs > 0 && Date.now() - state.enabledAt >= maxMs) {
          await toggleEnabled(false);
          await log('info', 'session', 'Max session hours reached, auto-disabled');
        } else {
          await scheduleAlarms();
        }
        break;
      }

      case ALARM.RESUME_IDLE: {
        const state = await getState();
        if (state.pauseReason !== 'activity' || !state.enabled || !state.smartPause.enabled) break;
        const idleState = await queryIdle(state.smartPause.idleDetectionSeconds);
        if (idleState === 'active') break;
        await clearPauseReason();
        await scheduleAlarms();
        await log('info', 'smart-pause', 'Resumed after required idle period');
        break;
      }

      case ALARM.TICK: {
        const beforeEffective = stateCache ? stateCache.effective : null;
        const beforeSession = stateCache ? stateCache.sessionStartedAt : null;
        const result = await reconcileSession();
        if (result.changed || (stateCache && stateCache.effective !== beforeEffective) ||
            (stateCache && stateCache.sessionStartedAt !== beforeSession)) {
          await applyEffectiveState();
        }
        break;
      }

      case ALARM.HELPER_TICK:
        await onHelperTick();
        break;

      case ALARM.HELPER_RECONNECT: {
        const state = await getState();
        if (state.modes.nativeHelper && hasNativePermission()) {
          connectNative();
        }
        break;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Commands and messages                                               */
  /* ------------------------------------------------------------------ */

  function setupCommandHandler() {
    if (commandListenerRegistered) return;
    commandListenerRegistered = true;

    chrome.commands.onCommand.addListener(command => {
      void (async () => {
        if (command !== 'toggle-keepactive') return;
        await ensureInit();
        const state = await getState();
        await toggleEnabled(!state.enabled);
      })();
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;
    if (sender && sender.id && sender.id !== chrome.runtime.id) return false;

    void (async () => {
      await ensureInit();

      switch (message.type) {
        case 'GET_STATE':
          return getState();

        case 'TOGGLE':
          await toggleEnabled(message.enabled);
          return { ok: true, state: await getState() };

        case 'TOGGLE_MODE':
          await toggleMode(message.mode, message.enabled);
          return { ok: true, state: await getState() };

        case 'SET_PAUSE_REASON':
          if (message.reason !== 'manual-hold' && message.reason !== 'activity') {
            throw new Error('Invalid pause reason.');
          }
          await setPauseReason(message.reason, { force: true });
          return { ok: true, state: await getState() };

        case 'CLEAR_PAUSE_REASON':
          await clearPauseReason({ userInitiated: message.userInitiated !== false });
          return { ok: true, state: await getState() };

        case 'UPDATE_SETTINGS':
          await updateSettings(message.changes);
          return { ok: true, state: await getState() };

        case 'NATIVE_TEST': {
          if (!hasNativePermission()) throw new Error('The native helper is not included in this build.');
          if (!nativePort) connectNative();
          return { ok: true, connected: !!nativePort, state: await getState() };
        }

        case 'NATIVE_RECONNECT': {
          if (!hasNativePermission()) throw new Error('The native helper is not included in this build.');
          disconnectNative(false);
          connectNative();
          return { ok: true, connected: !!nativePort, state: await getState() };
        }

        case 'RESET_ALL': {
          disconnectNative(false);
          keepAwakeState = null;
          await applyKeepAwake(false);
          lastIconKey = null;

          await chrome.alarms.clearAll();
          const defaults = SAStorage.defaultState();
          await chrome.storage.local.set({
            [SAStorage.KEY]: defaults,
            [WELCOME_SHOWN_KEY]: true
          });
          if (SALogger && typeof SALogger.clear === 'function') await SALogger.clear();

          stateCache = await getState();
          await applyEffectiveState();
          await scheduleAlarms();
          broadcastStateChange(stateCache);
          return { ok: true, state: stateCache };
        }

        default:
          return { ok: false, error: 'Unknown message type' };
      }
    })().then(sendResponse).catch(error => {
      sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
    });

    return true;
  });

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  async function getWelcomeShown() {
    try {
      const result = await chrome.storage.local.get(WELCOME_SHOWN_KEY);
      return !!result[WELCOME_SHOWN_KEY];
    } catch (_) {
      return false;
    }
  }

  async function setWelcomeShown(value) {
    try {
      await chrome.storage.local.set({ [WELCOME_SHOWN_KEY]: value });
    } catch (_) {}
  }

  async function doInit() {
    stateCache = await getState();
    setupIdleDetection(stateCache.smartPause.idleDetectionSeconds);
    setupCommandHandler();

    await reconcileSession();
    await applyEffectiveState({ broadcast: false });
    await scheduleAlarms();
    await applyInitialIdleState();

    const fresh = await getState();
    broadcastStateChange(fresh);
    await log('info', 'background', 'KeepActive service worker initialized', {
      effective: fresh.effective
    });
  }

  function ensureInit() {
    if (!initPromise) {
      initPromise = doInit().catch(error => {
        initPromise = null;
        throw error;
      });
    }
    return initPromise;
  }

  chrome.alarms.onAlarm.addListener(alarm => {
    void onAlarm(alarm).catch(error => {
      void log('error', 'alarm', 'Alarm handler failed', { name: alarm.name, error: String(error) });
    });
  });

  chrome.runtime.onStartup.addListener(() => {
    void ensureInit();
  });

  chrome.runtime.onInstalled.addListener(details => {
    void (async () => {
      await ensureInit();
      if (details.reason === 'install') {
        const shown = await getWelcomeShown();
        if (!shown) {
          await setWelcomeShown(true);
          await chrome.tabs.create({ url: 'welcome.html' });
        }
      }
    })();
  });

  void ensureInit();
})();
