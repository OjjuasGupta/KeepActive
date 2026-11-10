/* content/teams.js
 * Content script injected strictly into top-level Teams Web tabs.
 *
 * Teams Web keeps presence active in response to normal DOM input events.
 * This script emits a very small, randomized stream of pointer movement,
 * occasional Shift key pulses, focus/visibilitychange pings and (optionally)
 * a click on the page background. It never clicks controls, never types text
 * and never reads page content. Everything is gated by the persisted
 * effective state (master switch + schedule + Smart Pause + Teams engine
 * toggle + allowed sites). Each cycle is written to the local diagnostic log.
 */

(() => {
  'use strict';

  if (window.top !== window.self) return;

  const SARandom = self.SARandom;
  const SAStorage = self.SAStorage;

  let activityTimer = null;
  let isRunning = false;
  let debugOverlay = null;
  let showDebug = false;
  let lastSignature = '';
  let neutralClicks = true;
  let smartPauseOn = false;
  let lastUserActivitySent = 0;

  function log(level, message, data) {
    // The service worker is the single writer of the log key; writing from
    // here too would race its read-merge-write and drop entries.
    try {
      const result = chrome.runtime.sendMessage({ type: 'LOG', level, message, data });
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {}
  }

  function removeDebugBadge() {
    if (debugOverlay) {
      debugOverlay.remove();
      debugOverlay = null;
    }
  }

  function addDebugBadge(text) {
    if (!showDebug) {
      removeDebugBadge();
      return;
    }
    if (!debugOverlay) {
      debugOverlay = document.createElement('div');
      debugOverlay.id = 'ka-debug-badge';
      debugOverlay.style.cssText = [
        'position: fixed',
        'bottom: 12px',
        'right: 12px',
        'z-index: 2147483647',
        'background: rgba(7, 8, 10, 0.9)',
        'color: #34d399',
        'font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        'padding: 6px 10px',
        'border-radius: 6px',
        'pointer-events: none',
        'border: 1px solid rgba(16, 185, 129, 0.3)',
        'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5)',
        'max-width: 320px',
        'white-space: pre-wrap'
      ].join(';');
      document.documentElement.appendChild(debugOverlay);
    }
    const timestamp = new Date().toISOString().slice(11, 23);
    const lines = debugOverlay.textContent.split('\n').filter(Boolean);
    lines.unshift(`[${timestamp}] ${text}`);
    debugOverlay.textContent = lines.slice(0, 5).join('\n');
  }

  function safeViewportPoint() {
    const width = Math.max(200, window.innerWidth || 1024);
    const height = Math.max(200, window.innerHeight || 768);
    const x = Math.round((SARandom ? SARandom.float(0.1, 0.9) : 0.5) * width);
    const y = Math.round((SARandom ? SARandom.float(0.1, 0.9) : 0.5) * height);
    return { x, y };
  }

  function emitPointerMove(x, y) {
    // Target the element under the point so delegated listeners see a real-looking path.
    const target = document.elementFromPoint(x, y) || document.body || document.documentElement;
    const mouseEvent = new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x + (window.screenX || 0),
      screenY: y + (window.screenY || 0)
    });
    target.dispatchEvent(mouseEvent);

    if (typeof PointerEvent === 'function') {
      const pointerEvent = new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
      });
      target.dispatchEvent(pointerEvent);
    }

    addDebugBadge(`pointer @(${x},${y})`);
    return `mousemove@${x},${y}`;
  }

  function isEditing() {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  }

  /**
   * Click sequence aimed at <body> itself, never at a control. Because the
   * event target is body, component click handlers (send, delete, links,
   * buttons) never match it.
   */
  function emitNeutralClick(x, y) {
    const body = document.body;
    if (!body || isEditing()) return null;
    const init = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0
    };
    if (typeof PointerEvent === 'function') {
      body.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 }));
    }
    body.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }));
    if (typeof PointerEvent === 'function') {
      body.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    }
    body.dispatchEvent(new MouseEvent('mouseup', init));
    body.dispatchEvent(new MouseEvent('click', init));
    addDebugBadge('neutral background click');
    return 'click@body';
  }

  function emitFocusPing() {
    // Re-fires the signals Teams listens to; does not change visibilityState.
    window.dispatchEvent(new FocusEvent('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    addDebugBadge('focus + visibilitychange');
    return 'focus+visibilitychange';
  }

  function emitShiftPulse() {
    const down = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Shift',
      code: 'ShiftLeft',
      keyCode: 16,
      which: 16,
      shiftKey: true
    });
    document.dispatchEvent(down);
    setTimeout(() => {
      const up = new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        key: 'Shift',
        code: 'ShiftLeft',
        keyCode: 16,
        which: 16,
        shiftKey: false
      });
      document.dispatchEvent(up);
    }, SARandom ? SARandom.int(30, 90) : 50);
    addDebugBadge('harmless Shift pulse');
    return 'shift';
  }

  async function runActivityCycle() {
    if (!isRunning) return;

    const fired = [];
    const first = safeViewportPoint();
    fired.push(emitPointerMove(first.x, first.y));

    if (SARandom && SARandom.chance(0.35)) {
      const driftX = first.x + SARandom.nonZeroInt(1, 4);
      const driftY = first.y + SARandom.nonZeroInt(1, 4);
      fired.push(emitPointerMove(driftX, driftY));
    }

    if (neutralClicks && SARandom && SARandom.chance(0.2)) {
      const click = emitNeutralClick(first.x, first.y);
      if (click) fired.push(click);
    }

    if (SARandom && SARandom.chance(0.25)) {
      fired.push(emitShiftPulse());
    }

    if (!document.hidden && SARandom && SARandom.chance(0.3)) {
      fired.push(emitFocusPing());
    }

    log('info', 'Teams Web events dispatched', {
      events: fired,
      host: location.hostname,
      visible: !document.hidden
    });
  }

  function clearActivityTimer() {
    if (activityTimer) {
      clearTimeout(activityTimer);
      activityTimer = null;
    }
  }

  function scheduleNext(state) {
    clearActivityTimer();
    if (!isRunning || !state) return;

    const minSec = state.intervals?.webMinSec ?? 60;
    const maxSec = state.intervals?.webMaxSec ?? 150;
    const delayMs = SARandom ? SARandom.delayMs(minSec, maxSec) : 60000;

    activityTimer = setTimeout(() => {
      activityTimer = null;
      if (!isRunning) return;
      void runActivityCycle().finally(() => {
        fetchAndApplyState();
      });
    }, delayMs);
  }

  function signatureFor(state) {
    return JSON.stringify({
      enabled: !!state?.enabled,
      pauseReason: state?.pauseReason || null,
      schedule: state?.schedule || null,
      teamsWeb: !!state?.modes?.teamsWeb,
      intervals: state?.intervals || null,
      webActivity: state?.webActivity || null,
      debugOverlay: !!state?.debugOverlay
    });
  }

  function siteAllowed(state) {
    const sites = state?.webActivity?.sites;
    return !sites || sites[location.hostname] !== false;
  }

  function applyState(state) {
    if (!state) return;

    const effective = !!(SAStorage &&
      typeof SAStorage.computeEffective === 'function' &&
      SAStorage.computeEffective(state) &&
      state.modes?.teamsWeb &&
      siteAllowed(state));

    const signature = signatureFor(state);
    const changed = signature !== lastSignature;
    lastSignature = signature;
    isRunning = effective;
    showDebug = !!state.debugOverlay;
    neutralClicks = state.webActivity?.neutralClicks !== false;
    smartPauseOn = !!(state.enabled && state.smartPause?.enabled);

    if (!isRunning) {
      clearActivityTimer();
      removeDebugBadge();
      return;
    }

    if (changed || !activityTimer) {
      scheduleNext(state);
    }
  }

  function fetchAndApplyState() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, response => {
        if (chrome.runtime.lastError || !response) {
          isRunning = false;
          clearActivityTimer();
          removeDebugBadge();
          return;
        }
        applyState(response);
      });
    } catch (_) {
      isRunning = false;
      clearActivityTimer();
    }
  }

  // Background broadcasts are the fast path; storage changes cover service
  // worker restarts and missed messages without polling.
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(message => {
      if (message && message.type === 'STATE_CHANGED' && message.state) {
        applyState(message.state);
      }
    });
  }

  if (SAStorage && typeof SAStorage.onChanged === 'function') {
    SAStorage.onChanged(raw => {
      if (raw) applyState(SAStorage.normalize(raw));
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) fetchAndApplyState();
  });

  // Smart Pause: deliberate real input in this tab pauses simulation at once,
  // without waiting for the chrome.idle threshold. Trusted mousemove is
  // ignored so the native helper's small cursor nudges do not count.
  function onRealInput(event) {
    if (!event.isTrusted || !smartPauseOn) return;
    const now = Date.now();
    if (now - lastUserActivitySent < 10000) return;
    lastUserActivitySent = now;
    try {
      const result = chrome.runtime.sendMessage({ type: 'USER_ACTIVITY' });
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {}
  }
  for (const type of ['keydown', 'mousedown', 'wheel', 'touchstart']) {
    window.addEventListener(type, onRealInput, { capture: true, passive: true });
  }

  window.addEventListener('pageshow', fetchAndApplyState);

  function init() {
    log('info', 'Teams Web script loaded in top frame');
    fetchAndApplyState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
