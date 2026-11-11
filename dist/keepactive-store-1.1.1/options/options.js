/* options.js
 * Options page logic for KeepActive.
 * Works in Chrome and degrades to a static preview when opened directly.
 */

(() => {
  'use strict';

  const SAStorage = typeof self !== 'undefined' ? self.SAStorage : null;
  const SALogger = typeof self !== 'undefined' ? self.SALogger : null;

  const elements = {
    webMin: document.getElementById('webMin'),
    webMax: document.getElementById('webMax'),
    helperMin: document.getElementById('helperMin'),
    helperMax: document.getElementById('helperMax'),
    nativeHelperCard: document.getElementById('nativeHelperCard'),
    nativeHelperEnabled: document.getElementById('nativeHelperEnabled'),
    nativeStatus: document.getElementById('nativeStatus'),
    testNative: document.getElementById('testNative'),
    schedEnabled: document.getElementById('schedEnabled'),
    schedStart: document.getElementById('schedStart'),
    schedEnd: document.getElementById('schedEnd'),
    smartPauseEnabled: document.getElementById('smartPauseEnabled'),
    resumeAfter: document.getElementById('resumeAfter'),
    idleThreshold: document.getElementById('idleThreshold'),
    maxSession: document.getElementById('maxSession'),
    debugOverlay: document.getElementById('debugOverlay'),
    neutralClicks: document.getElementById('neutralClicks'),
    siteTeamsMicrosoft: document.getElementById('siteTeamsMicrosoft'),
    siteTeamsCloud: document.getElementById('siteTeamsCloud'),
    logView: document.getElementById('logView'),
    refreshLogs: document.getElementById('refreshLogs'),
    exportLogs: document.getElementById('exportLogs'),
    clearLogs: document.getElementById('clearLogs'),
    resetAll: document.getElementById('resetAll'),
    setupGuideBtn: document.getElementById('setupGuideBtn'),
    dayToggles: document.querySelectorAll('.day-toggles input[type="checkbox"]')
  };

  let localState = {
    modes: { keepAwake: true, teamsWeb: true, nativeHelper: false },
    nativeHelperConnected: false,
    intervals: { webMinSec: 60, webMaxSec: 150, helperMinSec: 45, helperMaxSec: 120 },
    schedule: {
      enabled: false,
      start: '09:30',
      end: '18:30',
      days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false }
    },
    smartPause: { enabled: true, resumeAfterIdleMin: 2, idleDetectionSeconds: 15 },
    safety: { maxSessionHours: 0 },
    webActivity: {
      neutralClicks: true,
      sites: { 'teams.microsoft.com': true, 'teams.cloud.microsoft': true }
    },
    debugOverlay: false
  };

  let unsubscribeState = null;
  let unsubscribeLogs = null;

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

  async function sendMessage(message) {
    if (!hasChromeRuntime()) return { ok: true, state: localState };
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
      applyState(localState);
      return;
    }
    const response = await sendMessage({ type: 'GET_STATE' });
    if (response && typeof response === 'object') {
      localState = response;
      applyState(response);
    }
  }

  function updateNativeStatus() {
    if (!elements.nativeStatus) return;
    const enabled = !!localState.modes?.nativeHelper;
    const connected = !!localState.nativeHelperConnected;

    if (!enabled) {
      elements.nativeStatus.textContent = 'Helper disabled';
      elements.nativeStatus.style.color = 'var(--text-muted)';
    } else if (connected) {
      elements.nativeStatus.textContent = 'Connected';
      elements.nativeStatus.style.color = 'var(--emerald-dark)';
    } else {
      elements.nativeStatus.textContent = 'Enabled — not connected. Run the installer, then reload KeepActive.';
      elements.nativeStatus.style.color = '#b45309';
    }
  }

  function applyState(state) {
    if (!state) return;
    localState = state;

    if (elements.webMin) elements.webMin.value = state.intervals?.webMinSec ?? 60;
    if (elements.webMax) elements.webMax.value = state.intervals?.webMaxSec ?? 150;
    if (elements.helperMin) elements.helperMin.value = state.intervals?.helperMinSec ?? 45;
    if (elements.helperMax) elements.helperMax.value = state.intervals?.helperMaxSec ?? 120;

    if (elements.schedEnabled) elements.schedEnabled.checked = !!state.schedule?.enabled;
    if (elements.schedStart) elements.schedStart.value = state.schedule?.start ?? '09:30';
    if (elements.schedEnd) elements.schedEnd.value = state.schedule?.end ?? '18:30';
    toggleScheduleFields(!!state.schedule?.enabled);

    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
      const cb = document.querySelector(`.day-toggles input[value="${day}"]`);
      if (cb) cb.checked = !!state.schedule?.days?.[day];
    }

    if (elements.smartPauseEnabled) elements.smartPauseEnabled.checked = !!state.smartPause?.enabled;
    if (elements.resumeAfter) elements.resumeAfter.value = state.smartPause?.resumeAfterIdleMin ?? 2;
    if (elements.idleThreshold) elements.idleThreshold.value = state.smartPause?.idleDetectionSeconds ?? 15;

    if (elements.maxSession) elements.maxSession.value = state.safety?.maxSessionHours ?? 0;
    if (elements.debugOverlay) elements.debugOverlay.checked = !!state.debugOverlay;
    const web = state.webActivity || {};
    if (elements.neutralClicks) elements.neutralClicks.checked = web.neutralClicks !== false;
    if (elements.siteTeamsMicrosoft) elements.siteTeamsMicrosoft.checked = web.sites?.['teams.microsoft.com'] !== false;
    if (elements.siteTeamsCloud) elements.siteTeamsCloud.checked = web.sites?.['teams.cloud.microsoft'] !== false;

    const supported = nativeSupported();
    if (elements.nativeHelperCard) elements.nativeHelperCard.hidden = !supported;
    if (elements.nativeHelperEnabled) {
      elements.nativeHelperEnabled.checked = !!state.modes?.nativeHelper;
      elements.nativeHelperEnabled.disabled = !supported;
    }
    updateNativeStatus();
  }

  function toggleScheduleFields(enabled) {
    if (elements.schedStart) elements.schedStart.disabled = !enabled;
    if (elements.schedEnd) elements.schedEnd.disabled = !enabled;
    if (elements.dayToggles) elements.dayToggles.forEach(cb => { cb.disabled = !enabled; });
  }

  function gatherChanges() {
    const days = {};
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
      const cb = document.querySelector(`.day-toggles input[value="${day}"]`);
      if (cb) days[day] = cb.checked;
    }

    return {
      intervals: {
        webMinSec: parseInt(elements.webMin?.value || '60', 10),
        webMaxSec: parseInt(elements.webMax?.value || '150', 10),
        helperMinSec: parseInt(elements.helperMin?.value || '45', 10),
        helperMaxSec: parseInt(elements.helperMax?.value || '120', 10)
      },
      schedule: {
        enabled: !!elements.schedEnabled?.checked,
        start: elements.schedStart?.value || '09:30',
        end: elements.schedEnd?.value || '18:30',
        days
      },
      smartPause: {
        enabled: !!elements.smartPauseEnabled?.checked,
        resumeAfterIdleMin: parseInt(elements.resumeAfter?.value || '2', 10),
        idleDetectionSeconds: parseInt(elements.idleThreshold?.value || '15', 10)
      },
      safety: {
        maxSessionHours: parseInt(elements.maxSession?.value || '0', 10)
      },
      webActivity: {
        neutralClicks: !!elements.neutralClicks?.checked,
        sites: {
          'teams.microsoft.com': !!elements.siteTeamsMicrosoft?.checked,
          'teams.cloud.microsoft': !!elements.siteTeamsCloud?.checked
        }
      },
      debugOverlay: !!elements.debugOverlay?.checked
    };
  }

  async function saveSettings() {
    const changes = gatherChanges();
    const response = await sendMessage({ type: 'UPDATE_SETTINGS', changes });
    if (response && response.state) applyState(response.state);
    showToast('Preferences updated');
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = [
      'position: fixed',
      'bottom: 24px',
      'right: 24px',
      'z-index: 10000',
      'background: #10b981',
      'color: white',
      'padding: 10px 18px',
      'font-size: 13px',
      'font-weight: 700',
      'font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
      'border-radius: 8px',
      'box-shadow: 0 8px 24px rgba(0,0,0,0.25)',
      'animation: slideIn 0.25s ease'
    ].join(';');
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.2s ease forwards';
      setTimeout(() => toast.remove(), 200);
    }, 2000);
  }

  async function loadLogs() {
    if (!elements.logView) return;
    try {
      if (SALogger && typeof SALogger.exportText === 'function') {
        const text = await SALogger.exportText();
        elements.logView.textContent = text || '[System ready: 0 diagnostic events recorded]';
      } else {
        elements.logView.textContent = `[Diagnostics Console ready]\n[Timestamp: ${new Date().toISOString()}] No anomalous events logged.`;
      }
      elements.logView.scrollTop = elements.logView.scrollHeight;
    } catch (error) {
      elements.logView.textContent = 'Diagnostic trace: ' + error;
    }
  }

  function setupListeners() {
    const saveInputs = [
      elements.webMin, elements.webMax,
      elements.helperMin, elements.helperMax,
      elements.schedStart, elements.schedEnd,
      elements.resumeAfter, elements.idleThreshold,
      elements.maxSession
    ];

    saveInputs.forEach(input => {
      if (input) input.addEventListener('change', saveSettings);
    });

    const toggleInputs = [
      elements.schedEnabled,
      elements.smartPauseEnabled,
      elements.debugOverlay,
      elements.neutralClicks,
      elements.siteTeamsMicrosoft,
      elements.siteTeamsCloud
    ];

    toggleInputs.forEach(cb => {
      if (!cb) return;
      cb.addEventListener('change', () => {
        if (cb === elements.schedEnabled) toggleScheduleFields(cb.checked);
        void saveSettings();
      });
    });

    if (elements.dayToggles) {
      elements.dayToggles.forEach(cb => cb.addEventListener('change', saveSettings));
    }

    if (elements.nativeHelperEnabled) {
      elements.nativeHelperEnabled.addEventListener('change', async () => {
        localState.modes = localState.modes || {};
        localState.modes.nativeHelper = elements.nativeHelperEnabled.checked;
        updateNativeStatus();
        const response = await sendMessage({
          type: 'TOGGLE_MODE',
          mode: 'nativeHelper',
          enabled: elements.nativeHelperEnabled.checked
        });
        if (response && response.state) applyState(response.state);
        else if (response && response.error) showToast(response.error);
      });
    }

    if (elements.testNative) {
      elements.testNative.addEventListener('click', async () => {
        const response = await sendMessage({ type: 'NATIVE_TEST' });
        if (response && response.state) applyState(response.state);
        showToast(response && response.ok
          ? (response.connected ? 'Helper connection requested' : 'Helper is not connected')
          : (response && response.error) || 'Helper test failed');
      });
    }

    if (elements.refreshLogs) {
      elements.refreshLogs.addEventListener('click', () => {
        void loadLogs();
        showToast('Logs refreshed');
      });
    }

    if (elements.exportLogs) {
      elements.exportLogs.addEventListener('click', async () => {
        let text = '';
        if (SALogger && typeof SALogger.exportText === 'function') {
          text = await SALogger.exportText();
        } else {
          text = elements.logView ? elements.logView.textContent : '';
        }
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `keepactive-logs-${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Logs exported');
      });
    }

    if (elements.clearLogs) {
      elements.clearLogs.addEventListener('click', async () => {
        if (confirm('Clear all diagnostic logs?')) {
          if (SALogger && typeof SALogger.clear === 'function') await SALogger.clear();
          await loadLogs();
          showToast('Logs cleared');
        }
      });
    }

    if (elements.resetAll) {
      elements.resetAll.addEventListener('click', async () => {
        if (confirm('Reset ALL settings and logs? This restores factory defaults and releases the wake lock.')) {
          const response = await sendMessage({ type: 'RESET_ALL' });
          if (response && response.state) applyState(response.state);
          showToast('All configurations reset to defaults');
          setTimeout(() => location.reload(), 300);
        }
      });
    }

    if (elements.setupGuideBtn) {
      elements.setupGuideBtn.addEventListener('click', () => {
        if (hasChromeRuntime() && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: 'welcome.html' });
        } else {
          window.open('../welcome.html', '_blank');
        }
      });
    }

    if (SAStorage && typeof SAStorage.onChanged === 'function') {
      unsubscribeState = SAStorage.onChanged(newState => {
        if (newState) applyState(SAStorage.normalize(newState));
      });
    }

    if (SALogger) {
      const subscribe = SALogger.onChange || SALogger.onChanged;
      if (typeof subscribe === 'function') {
        unsubscribeLogs = subscribe.call(SALogger, () => { void loadLogs(); });
      }
    }
  }

  loadState().then(setupListeners).then(loadLogs);

  window.addEventListener('unload', () => {
    if (unsubscribeState) unsubscribeState();
    if (unsubscribeLogs) unsubscribeLogs();
  });

  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes slideOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-12px); } }
  `;
  document.head.appendChild(style);
})();
