/* tools/cdp-smoke.mjs
 * End-to-end smoke test for the packaged KeepActive builds.
 *
 * Prerequisites:
 *   - Chrome running with --remote-debugging-port=9333
 *     and --enable-unsafe-extension-debugging
 *   - A disposable Chrome profile
 *
 * Usage:
 *   node tools/cdp-smoke.mjs store <unpacked-store-path> [port]
 *   node tools/cdp-smoke.mjs full <unpacked-full-path> [port]
 *   node tools/cdp-smoke.mjs native <unpacked-full-path> <extension-id> [port]
 */

'use strict';

const mode = process.argv[2];
const unpackedPath = process.argv[3];
const port = mode === 'native' ? (process.argv[5] || '9333') : (process.argv[4] || '9333');
const expectedExtensionId = mode === 'native' ? process.argv[4] : null;

if (!mode || !unpackedPath) {
  console.error('Usage: node tools/cdp-smoke.mjs <store|full|native> <unpacked-path> [extension-id] [port]');
  process.exit(1);
}

const BASE = `http://127.0.0.1:${port}`;
let failures = 0;
const errors = [];

function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

class CdpClient {
  constructor(webSocketUrl, label) {
    this.label = label;
    this.ws = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${this.label}: ${message.error.message}`));
        else resolve(message);
      } else if (message.method) {
        this.events.push(message);
        if (message.method === 'Runtime.exceptionThrown') {
          const text = message.params?.exceptionDetails?.exception?.description ||
            message.params?.exceptionDetails?.text || 'unknown exception';
          errors.push(`${this.label}: ${text}`);
        }
        if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
          const args = (message.params.args || []).map(arg => arg.value || arg.description || '').join(' ');
          errors.push(`${this.label}: console.error ${args}`);
        }
      }
    };
  }

  async open({ enableRuntime = true } = {}) {
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    if (enableRuntime) await this.send('Runtime.enable');
    return this;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${this.label}: timeout on ${method}`));
        }
      }, 20000);
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (response.result?.exceptionDetails) {
      const detail = response.result.exceptionDetails;
      throw new Error(detail.exception?.description || detail.text || 'evaluation failed');
    }
    return response.result?.result?.value;
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function targetList() {
  return fetchJson(`${BASE}/json/list`);
}

async function createTarget(url) {
  const response = await fetch(`${BASE}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`createTarget failed: ${response.status}`);
  const created = await response.json();
  for (let i = 0; i < 40; i++) {
    const targets = await targetList();
    const target = targets.find(item => item.id === created.id);
    if (target && target.webSocketDebuggerUrl) return target;
    await sleep(250);
  }
  throw new Error(`target did not appear: ${created.id}`);
}

async function openExtensionPage(extensionId, pagePath) {
  const target = await createTarget(`chrome-extension://${extensionId}/${pagePath}`);
  const client = await new CdpClient(target.webSocketDebuggerUrl, pagePath).open();
  await client.send('Page.enable');
  for (let i = 0; i < 40; i++) {
    const ready = await client.evaluate('document.readyState');
    if (ready === 'complete') break;
    await sleep(250);
  }
  return client;
}

function messageExpression(message) {
  return `new Promise((resolve, reject) => chrome.runtime.sendMessage(${JSON.stringify(message)}, response => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve(response);
  }))`;
}

async function getState(client) {
  return client.evaluate(messageExpression({ type: 'GET_STATE' }));
}

async function sendMessage(client, message) {
  return client.evaluate(messageExpression(message));
}

async function waitFor(predicate, timeoutMs = 8000, intervalMs = 250) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

async function attachServiceWorker(extensionId) {
  const targets = await targetList();
  const worker = targets.find(item =>
    item.type === 'service_worker' &&
    item.url.includes(extensionId) &&
    item.url.endsWith('/background.js')
  );
  if (!worker) return null;
  return new CdpClient(worker.webSocketDebuggerUrl, 'service-worker').open();
}

async function loadExtension() {
  const version = await fetchJson(`${BASE}/json/version`);
  const browser = await new CdpClient(version.webSocketDebuggerUrl, 'browser').open({ enableRuntime: false });
  const response = await browser.send('Extensions.loadUnpacked', { path: unpackedPath });
  browser.close();
  const id = response.result?.id;
  if (!id) throw new Error('Extensions.loadUnpacked did not return an extension id');
  return id;
}

async function testStore(extensionId) {
  console.log(`\nStore build: ${extensionId}`);
  const popup = await openExtensionPage(extensionId, 'popup/popup.html');
  const worker = await attachServiceWorker(extensionId);

  const manifest = await popup.evaluate('chrome.runtime.getManifest()');
  check('manifest version is 1.1.1', manifest.version === '1.1.1', manifest.version);
  check('store manifest has no nativeMessaging', !manifest.permissions.includes('nativeMessaging'));
  check('store popup hides native helper card', await popup.evaluate('document.getElementById("nativeCard").hidden'));
  check('popup shows version 1.1.1', (await popup.evaluate('document.querySelector(".version-pill").textContent')).includes('1.1.1'));

  // Start from a known state even if a previous run was interrupted.
  await sendMessage(popup, { type: 'RESET_ALL' });
  let state = await getState(popup);
  check('initial state is disabled', state.enabled === false, JSON.stringify(state));

  // The shipped schedule is 09:30-18:30 and Smart Pause reacts to real
  // workstation activity. Force manual mode with Smart Pause off so the
  // session-clock and pause-button assertions are deterministic.
  await sendMessage(popup, { type: 'UPDATE_SETTINGS', changes: {
    schedule: { enabled: false },
    smartPause: { enabled: false }
  } });

  await popup.evaluate('document.getElementById("masterToggle").click()');
  state = await waitFor(async () => {
    const next = await getState(popup);
    return next.enabled ? next : null;
  });
  check('master toggle enables extension', !!state, 'state never became enabled');
  check('enabledAt is recorded', !!state?.enabledAt);

  if (state?.pauseReason === 'activity') {
    check('Smart Pause paused an active workstation', true);
    const resumed = await sendMessage(popup, { type: 'CLEAR_PAUSE_REASON', userInitiated: true });
    check('manual resume clears activity pause', resumed?.state?.pauseReason === null, JSON.stringify(resumed));
    check('manual resume sets smartPauseOverride', resumed?.state?.smartPauseOverride === true, JSON.stringify(resumed?.state));
  } else {
    check('Smart Pause state is valid', state?.pauseReason === null || state?.pauseReason === 'activity');
  }

  state = await getState(popup);
  check('session clock is running', !!state?.sessionStartedAt, JSON.stringify(state));

  const uptimeAfter = await waitFor(async () => {
    const text = await popup.evaluate('document.getElementById("uptime").textContent');
    return text && text !== '00:00:00' ? text : null;
  }, 6000);
  check('popup uptime advances', !!uptimeAfter, uptimeAfter || 'uptime stayed at 00:00:00');

  await popup.evaluate('document.getElementById("pauseBtn").click()');
  state = await waitFor(async () => {
    const next = await getState(popup);
    return next.pauseReason === 'manual-hold' && next.sessionStartedAt === null ? next : null;
  });
  check('pause button sets manual hold', !!state, 'manual-hold was not set');
  check('manual pause stops the session clock', state?.sessionStartedAt === null, JSON.stringify(state));
  check('manual pause accumulates active time', (state?.totalActiveMs || 0) > 0, JSON.stringify(state));

  const pauseLabel = await waitFor(async () => {
    const label = await popup.evaluate('document.querySelector("#pauseBtn span").textContent');
    return label === 'Resume Simulation' ? label : null;
  }, 4000);
  check('pause button label reflects manual hold', !!pauseLabel, 'label did not change to Resume Simulation');

  await popup.evaluate('document.getElementById("pauseBtn").click()');
  state = await waitFor(async () => {
    const next = await getState(popup);
    return next.pauseReason === null ? next : null;
  });
  check('pause button resumes manual hold', !!state, 'manual-hold was not cleared');

  await sendMessage(popup, {
    type: 'UPDATE_SETTINGS',
    changes: {
      schedule: {
        enabled: true,
        start: '00:00',
        end: '00:01',
        days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true }
      }
    }
  });
  state = await getState(popup);
  check('off-schedule state is not effective', state.effective === false, JSON.stringify(state));
  check('off-schedule closes the session clock', state.sessionStartedAt === null, JSON.stringify(state));

  await sendMessage(popup, {
    type: 'UPDATE_SETTINGS',
    changes: {
      schedule: {
        enabled: false,
        days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false }
      }
    }
  });
  state = await getState(popup);
  check('schedule disable restores effective state', state.effective === true, JSON.stringify(state));

  await popup.evaluate('document.getElementById("masterToggle").click()');
  state = await waitFor(async () => {
    const next = await getState(popup);
    return next.enabled === false ? next : null;
  });
  check('master toggle disables extension', !!state);
  check('disable preserves accumulated active time', (state?.totalActiveMs || 0) > 0, JSON.stringify(state));
  check('disable clears session clock', state?.sessionStartedAt === null, JSON.stringify(state));

  const entries = await waitFor(async () => {
    const logs = await popup.evaluate('chrome.storage.local.get("kalogs")');
    const stored = logs.kalogs || [];
    return stored.length > 0 ? stored : null;
  }, 8000);
  check('diagnostic log has entries', !!entries, String(entries ? entries.length : 0));

  await sendMessage(popup, { type: 'RESET_ALL' });
  state = await getState(popup);
  check('reset restores defaults', state.enabled === false && state.totalActiveMs === 0, JSON.stringify(state));
  check('no unexpected page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  if (worker) {
    const workerVersion = await worker.evaluate('chrome.runtime.getManifest().version');
    check('service worker is alive and reports version', workerVersion === '1.1.1', workerVersion);
    worker.close();
  }

  popup.close();
}

async function testFull(extensionId) {
  console.log(`\nFull build: ${extensionId}`);
  const popup = await openExtensionPage(extensionId, 'popup/popup.html');

  const manifest = await popup.evaluate('chrome.runtime.getManifest()');
  check('full manifest declares nativeMessaging', manifest.permissions.includes('nativeMessaging'));
  check('full popup shows native helper card', !(await popup.evaluate('document.getElementById("nativeCard").hidden')));
  check('native helper is disabled by default', (await getState(popup)).modes.nativeHelper === false);

  const options = await openExtensionPage(extensionId, 'options/options.html');
  check('options page shows native helper card', !(await options.evaluate('document.getElementById("nativeHelperCard").hidden')));
  check('options helper status starts disabled', (await options.evaluate('document.getElementById("nativeStatus").textContent')).includes('disabled'));
  options.close();

  popup.close();
}

async function testNative(extensionId) {
  console.log(`\nNative helper test: ${extensionId}`);
  const popup = await openExtensionPage(extensionId, 'popup/popup.html');

  const enable = await sendMessage(popup, { type: 'TOGGLE_MODE', mode: 'nativeHelper', enabled: true });
  check('native helper mode can be enabled', enable?.ok === true, JSON.stringify(enable));

  const connected = await waitFor(async () => {
    const state = await getState(popup);
    return state.nativeHelperConnected ? state : null;
  }, 12000);
  check('native helper connects', !!connected, 'nativeHelperConnected stayed false');

  if (connected) {
    const test = await sendMessage(popup, { type: 'NATIVE_TEST' });
    check('NATIVE_TEST responds', test?.ok === true, JSON.stringify(test));
    check('NATIVE_TEST reports connected', test?.connected === true, JSON.stringify(test));
  }

  const disable = await sendMessage(popup, { type: 'TOGGLE_MODE', mode: 'nativeHelper', enabled: false });
  check('native helper mode can be disabled', disable?.ok === true, JSON.stringify(disable));
  const disconnected = await waitFor(async () => {
    const state = await getState(popup);
    return state.nativeHelperConnected === false ? state : null;
  }, 5000);
  check('native helper disconnects', !!disconnected);

  check('no unexpected page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  popup.close();
}

const extensionId = await loadExtension();
if (mode === 'native' && expectedExtensionId && expectedExtensionId !== extensionId) {
  console.error(`Extension ID mismatch: loaded ${extensionId}, expected ${expectedExtensionId}`);
  process.exit(1);
}

if (mode === 'store') await testStore(extensionId);
else if (mode === 'full') await testFull(extensionId);
else if (mode === 'native') await testNative(extensionId);
else {
  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}

if (failures) {
  console.error(`\n${failures} smoke test(s) failed.`);
  process.exit(1);
}
console.log('\nAll smoke tests passed.');
