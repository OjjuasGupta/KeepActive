/* content/teams.js
 * Content script injected strictly into top-level Teams Web tabs.
 *
 * Teams Web keeps presence active in response to normal DOM input events.
 * This script emits a very small, randomized stream of pointer movement and
 * occasional Shift key pulses. It never clicks, never types text and never
 * touches page controls. Everything is gated by the persisted effective state
 * (master switch + schedule + Smart Pause + Teams engine toggle).
 */

(() => {
  'use strict';

  if (window.top !== window.self) return;

  const SARandom = self.SARandom;
  const SALogger = self.SALogger;
  const SAStorage = self.SAStorage;

  let activityTimer = null;
  let isRunning = false;
  let debugOverlay = null;
  let showDebug = false;
  let lastSignature = '';

  function log(level, message, data) {
    try {
      if (SALogger && typeof SALogger[level] === 'function') {
        SALogger[level]('keepactive-content', message, data);
      }
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
    const mouseEvent = new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x + (window.screenX || 0),
      screenY: y + (window.screenY || 0)
    });
    document.dispatchEvent(mouseEvent);

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
      document.dispatchEvent(pointerEvent);
    }

    addDebugBadge(`pointer @(${x},${y})`);
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
  }

  async function runActivityCycle() {
    if (!isRunning) return;

    const first = safeViewportPoint();
    emitPointerMove(first.x, first.y);

    if (SARandom && SARandom.chance(0.35)) {
      const driftX = first.x + SARandom.nonZeroInt(1, 4);
      const driftY = first.y + SARandom.nonZeroInt(1, 4);
      emitPointerMove(driftX, driftY);
    }

    if (SARandom && SARandom.chance(0.25)) {
      emitShiftPulse();
    }
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
      debugOverlay: !!state?.debugOverlay
    });
  }

  function applyState(state) {
    if (!state) return;

    const effective = !!(SAStorage &&
      typeof SAStorage.computeEffective === 'function' &&
      SAStorage.computeEffective(state) &&
      state.modes?.teamsWeb);

    const signature = signatureFor(state);
    const changed = signature !== lastSignature;
    lastSignature = signature;
    isRunning = effective;
    showDebug = !!state.debugOverlay;

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
