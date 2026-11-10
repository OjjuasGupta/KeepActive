/* popup.js
 * Popup UI logic for KeepActive.
 * Works in Chrome and degrades to a static preview when opened directly.
 */

(() => {
  'use strict';

  const SAStorage = typeof self !== 'undefined' ? self.SAStorage : null;

  const masterToggle = document.getElementById('masterToggle');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const uptimeEl = document.getElementById('uptime');
  const nextScheduleEl = document.getElementById('nextSchedule');
  const modeKeepAwake = document.getElementById('modeKeepAwake');
  const modeTeamsWeb = document.getElementById('modeTeamsWeb');
  const nativeCard = document.getElementById('nativeCard');
  const modeNativeHelper = document.getElementById('modeNativeHelper');
  const nativeHelperStatus = document.getElementById('nativeHelperStatus');
  const nativeHint = document.getElementById('nativeHint');
  const pauseBtn = document.getElementById('pauseBtn');
  const optionsBtn = document.getElementById('optionsBtn');
  const setupGuideBtn = document.getElementById('setupGuideBtn');
  const disclaimerLink = document.getElementById('disclaimerLink');

  let state = {
    enabled: false,
    enabledAt: null,
    pauseReason: null,
    sessionStartedAt: null,
    totalActiveMs: 0,
    nativeHelperConnected: false,
    modes: { keepAwake: true, teamsWeb: true, nativeHelper: false },
    intervals: { webMinSec: 60, webMaxSec: 150, helperMinSec: 45, helperMaxSec: 120 },
    smartPause: { enabled: true, resumeAfterIdleMin: 2, idleDetectionSeconds: 15 },
    schedule: {
      enabled: false,
      start: '09:30',
      end: '18:30',
      days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false }
    }
  };
  let uptimeTimer = null;
  let pauseBusy = false;
  let stateEpoch = 0;

  function hasChromeRuntime() {
    return typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function';
  }

  function nativeSupported() {
    if (!hasChromeRuntime() || typeof chrome.runtime.getManifest !== 'function') return false;
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

  function isEffectiveEnabled(value) {
    if (SAStorage && typeof SAStorage.computeEffective === 'function') {
      return SAStorage.computeEffective(value);
    }
    if (!value || !value.enabled) return false;
    if (value.pauseReason) return false;
    return true;
  }

  function formatMs(ms) {
    if (!ms || ms < 0) return '00:00:00';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatNextChange(schedule) {
    if (!schedule || !schedule.enabled) return 'Manual Mode';
    if (!SAStorage || typeof SAStorage.getNextScheduleChange !== 'function') return 'Schedule active';

    const now = new Date();
    const nextChange = SAStorage.getNextScheduleChange(now, schedule);
    if (!nextChange) return 'Schedule active';

    const nextDate = new Date(nextChange);
    const timeStr = `${String(nextDate.getHours()).padStart(2, '0')}:${String(nextDate.getMinutes()).padStart(2, '0')}`;
    const isToday = nextDate.toDateString() === now.toDateString();
    const currentEffective = isEffectiveEnabled(state);
    const nextAction = currentEffective ? 'Auto-OFF' : 'Auto-ON';

    if (isToday) return `${nextAction} ${timeStr}`;
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${nextAction} ${dayNames[nextDate.getDay()]} ${timeStr}`;
  }

  function updateNativeUI() {
    const supported = nativeSupported();
    if (nativeCard) nativeCard.hidden = !supported;
    if (!supported) {
      if (nativeHint) nativeHint.hidden = true;
      return;
    }

    const enabled = !!state.modes?.nativeHelper;
    const connected = !!state.nativeHelperConnected;

    if (modeNativeHelper) {
      modeNativeHelper.checked = enabled;
      modeNativeHelper.disabled = !state.enabled;
    }

    if (nativeHelperStatus) {
      if (!enabled) {
        nativeHelperStatus.textContent = 'Optional desktop helper';
      } else if (connected) {
        nativeHelperStatus.textContent = 'Connected — OS-level micro-activity';
      } else {
        nativeHelperStatus.textContent = 'Enabled — helper not connected';
      }
    }

    if (nativeHint) {
      const show = enabled && !connected;
      nativeHint.hidden = !show;
      nativeHint.textContent = show
        ? 'Run native\\install.ps1 with this extension ID, reload the extension, then reconnect from the Control Deck.'
        : '';
    }
  }

  function updateUI(newState) {
    // Any applied state supersedes an in-flight GET_STATE response.
    stateEpoch += 1;
    if (newState) state = newState;
    const effective = isEffectiveEnabled(state);
    const supported = nativeSupported();

    if (masterToggle) {
      masterToggle.checked = !!state.enabled;
      masterToggle.disabled = false;
    }

    if (statusBadge && statusText) {
      if (state.enabled) {
        if (state.pauseReason === 'activity') {
          statusText.textContent = 'Status: Paused (You are active)';
          statusBadge.className = 'status-capsule paused';
        } else if (state.pauseReason === 'manual-hold') {
          statusText.textContent = 'Status: Paused (Manual)';
          statusBadge.className = 'status-capsule paused';
        } else if (!effective) {
          statusText.textContent = 'Status: Off-Schedule';
          statusBadge.className = 'status-capsule off';
        } else {
          statusText.textContent = 'Status: Active';
          statusBadge.className = 'status-capsule active';
        }
      } else {
        statusText.textContent = 'Status: Inactive';
        statusBadge.className = 'status-capsule off';
      }
    }

    if (modeKeepAwake) {
      modeKeepAwake.checked = !!state.modes?.keepAwake;
      modeKeepAwake.disabled = !state.enabled;
    }
    if (modeTeamsWeb) {
      modeTeamsWeb.checked = !!state.modes?.teamsWeb;
      modeTeamsWeb.disabled = !state.enabled;
    }

    updateNativeUI();

    const brandIcon = document.getElementById('brandIcon');
    if (brandIcon) {
      if (effective) {
        brandIcon.src = '../icons/icon-green-32.png';
        brandIcon.className = 'brand-icon state-active-blinking';
      } else {
        brandIcon.src = '../icons/icon-red-32.png';
        brandIcon.className = 'brand-icon state-inactive-red';
      }
    }

    if (pauseBtn) {
      pauseBtn.disabled = !state.enabled;
      const isPaused = !!state.pauseReason;
      const labelEl = pauseBtn.querySelector('span');
      if (labelEl) labelEl.textContent = isPaused ? 'Resume Simulation' : 'Pause Simulation';

      if (!state.enabled) {
        pauseBtn.className = 'glass-btn primary btn-disabled-cream';
      } else if (isPaused) {
        pauseBtn.className = 'glass-btn primary btn-resuming-cream';
      } else {
        pauseBtn.className = 'glass-btn primary btn-active-cream';
      }
    }

    if (nextScheduleEl) nextScheduleEl.textContent = formatNextChange(state.schedule);
    updateUptime();

    if (supported && !state.enabled) {
      // The mode rows are disabled while the master switch is off; keep the
      // native card visible so users can see the capability exists.
      if (nativeCard) nativeCard.hidden = false;
    }
  }

  function updateUptime() {
    if (!state || !uptimeEl) return;
    let ms = state.totalActiveMs || 0;
    if (state.enabled && state.sessionStartedAt && !state.pauseReason && isEffectiveEnabled(state)) {
      ms += Date.now() - state.sessionStartedAt;
    }
    uptimeEl.textContent = formatMs(ms);
  }

  function startUptimeTimer() {
    if (uptimeTimer) clearInterval(uptimeTimer);
    uptimeTimer = setInterval(updateUptime, 1000);
  }

  function sendMessage(message) {
    if (!hasChromeRuntime()) return Promise.resolve({ ok: true, state });
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function loadState() {
    if (!hasChromeRuntime()) {
      updateUI(state);
      return;
    }
    const epoch = stateEpoch;
    const response = await sendMessage({ type: 'GET_STATE' });
    if (epoch !== stateEpoch) return;
    if (response && typeof response === 'object') updateUI(response);
  }

  if (masterToggle) {
    masterToggle.addEventListener('change', async () => {
      state.enabled = masterToggle.checked;
      updateUI(state);
      const response = await sendMessage({ type: 'TOGGLE', enabled: masterToggle.checked });
      if (response && response.state) updateUI(response.state);
    });
  }

  if (modeKeepAwake) {
    modeKeepAwake.addEventListener('change', async () => {
      state.modes.keepAwake = modeKeepAwake.checked;
      const response = await sendMessage({ type: 'TOGGLE_MODE', mode: 'keepAwake', enabled: modeKeepAwake.checked });
      if (response && response.state) updateUI(response.state);
    });
  }

  if (modeTeamsWeb) {
    modeTeamsWeb.addEventListener('change', async () => {
      state.modes.teamsWeb = modeTeamsWeb.checked;
      const response = await sendMessage({ type: 'TOGGLE_MODE', mode: 'teamsWeb', enabled: modeTeamsWeb.checked });
      if (response && response.state) updateUI(response.state);
    });
  }

  if (modeNativeHelper) {
    modeNativeHelper.addEventListener('change', async () => {
      state.modes.nativeHelper = modeNativeHelper.checked;
      updateNativeUI();
      const response = await sendMessage({
        type: 'TOGGLE_MODE',
        mode: 'nativeHelper',
        enabled: modeNativeHelper.checked
      });
      if (response && response.state) updateUI(response.state);
    });
  }

  if (pauseBtn) {
    pauseBtn.addEventListener('click', async () => {
      if (pauseBusy) return;
      pauseBusy = true;
      pauseBtn.disabled = true;
      try {
        const response = state.pauseReason
          ? await sendMessage({ type: 'CLEAR_PAUSE_REASON', userInitiated: true })
          : await sendMessage({ type: 'SET_PAUSE_REASON', reason: 'manual-hold' });
        if (response && response.state) updateUI(response.state);
      } finally {
        pauseBusy = false;
        pauseBtn.disabled = !state.enabled;
      }
    });
  }

  if (optionsBtn) {
    optionsBtn.addEventListener('click', () => {
      if (hasChromeRuntime() && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open('../options/options.html', '_blank');
      }
      if (window.close) window.close();
    });
  }

  if (setupGuideBtn) {
    setupGuideBtn.addEventListener('click', () => {
      if (hasChromeRuntime() && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: 'welcome.html' });
      } else {
        window.open('../welcome.html', '_blank');
      }
      if (window.close) window.close();
    });
  }

  if (disclaimerLink) {
    disclaimerLink.addEventListener('click', event => {
      event.preventDefault();
      if (hasChromeRuntime() && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: 'privacy.html' });
      } else {
        window.open('../privacy.html', '_blank');
      }
    });
  }

  if (hasChromeRuntime() && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(message => {
      if (message && message.type === 'STATE_CHANGED' && message.state) {
        updateUI(message.state);
      }
    });
  }

  async function setupRatingPrompt() {
    const R = self.SARating;
    const card = document.getElementById('rateCard');
    if (!R || !card || !hasChromeRuntime() || !chrome.storage || !chrome.management) return;
    const now = Date.now();
    const stored = await chrome.storage.local.get(R.KEY);
    let record = R.normalize(stored[R.KEY], now);
    if (!stored[R.KEY]) await chrome.storage.local.set({ [R.KEY]: record });
    const me = await chrome.management.getSelf();
    if (!R.shouldAsk(record, now, me.installType, state.totalActiveMs)) return;

    const save = async next => {
      record = next;
      card.hidden = true;
      await chrome.storage.local.set({ [R.KEY]: record });
    };
    document.getElementById('rateYes').addEventListener('click', async () => {
      await save(R.finish(record));
      chrome.tabs.create({ url: R.reviewUrl(chrome.runtime.id) });
    });
    document.getElementById('rateLater').addEventListener('click', () => save(R.later(record, Date.now())));
    document.getElementById('rateNo').addEventListener('click', () => save(R.finish(record)));
    card.hidden = false;
  }

  loadState()
    .then(startUptimeTimer)
    .then(setupRatingPrompt)
    .catch(() => {});

  window.addEventListener('unload', () => {
    if (uptimeTimer) clearInterval(uptimeTimer);
  });
})();
