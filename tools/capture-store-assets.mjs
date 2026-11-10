/* tools/capture-store-assets.mjs
 * Recaptures the Chrome Web Store screenshots from the packaged store build.
 *
 * Prerequisites: Chrome running with --remote-debugging-port and
 * --enable-unsafe-extension-debugging, with the store build loaded
 * (tools/cdp-load.mjs). Install Roboto or Segoe UI for consistent type, and
 * launch Chrome with LANG=en_GB.UTF-8 --lang=en-GB so time fields render 24h.
 *
 * Usage: node tools/capture-store-assets.mjs [port]
 * Writes store-assets/raw/*.png and the final 1280x800 / 440x280 images.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = `http://127.0.0.1:${process.argv[2] || '9333'}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const targets = await (await fetch(BASE + '/json/list')).json();
const workers = targets.filter(t => t.type === 'service_worker' && t.url.endsWith('/background.js'));
if (!workers.length) throw new Error('KeepActive service worker not found; load the store build first.');
const ver = await (await fetch(BASE + '/json/version')).json();

const ws = new WebSocket(ver.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise(r => (ws.onopen = r));
const send = (method, params = {}, sessionId) =>
  new Promise(r => { const i = nextId++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

async function open(url, width, height, scale = 1) {
  // Create the target at its final URL: extension pages reached by navigating
  // from about:blank do not get chrome.runtime.
  const { result: { targetId } } = await send('Target.createTarget', { url });
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
  await send('Emulation.setScrollbarsHidden', { hidden: true }, sessionId);
  // en-GB renders <input type="time"> in 24h, matching the "(24h)" labels.
  await send('Emulation.setLocaleOverride', { locale: 'en-GB' }, sessionId);
  await send('Page.enable', {}, sessionId);
  await sleep(1800);
  if (url.startsWith('chrome-extension://')) {
    // Right after install the page can load before extension bindings exist.
    for (let i = 0; i < 5; i++) {
      const res = await send('Runtime.evaluate', { expression: 'typeof chrome.runtime?.sendMessage', returnByValue: true }, sessionId);
      if (res.result?.result?.value === 'function') return { targetId, sessionId, ok: true };
      await send('Page.reload', {}, sessionId);
      await sleep(1000);
    }
    return { targetId, sessionId, ok: false };
  }
  return { targetId, sessionId, ok: true };
}

async function evaluate(sessionId, expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
}

async function shoot(page, out) {
  const shot = await send('Page.captureScreenshot', { format: 'png' }, page.sessionId);
  fs.writeFileSync(path.join(root, out), Buffer.from(shot.result.data, 'base64'));
  await send('Target.closeTarget', { targetId: page.targetId });
  console.log('saved', out);
}

// Several unpacked copies may be registered (stale profiles); use the first
// whose pages actually get extension bindings.
let extId = null;
let control = null;
for (const worker of workers) {
  const id = new URL(worker.url).host;
  const page = await open(`chrome-extension://${id}/options/options.html`, 1280, 800);
  if (page.ok) { extId = id; control = page; break; }
  await send('Target.closeTarget', { targetId: page.targetId });
}
if (!extId) throw new Error('No loaded KeepActive copy exposes chrome.runtime.');
console.log('using extension', extId);
const ext = p => `chrome-extension://${extId}/${p}`;

// Representative state: active, schedule 08:00-20:00 every day, ~48 min uptime.
await evaluate(control.sessionId, `(async () => {
  const send = m => chrome.runtime.sendMessage(m);
  await send({ type: 'RESET_ALL' });
  await send({ type: 'UPDATE_SETTINGS', changes: {
    schedule: { enabled: true, start: '08:00', end: '20:00',
      days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true } } } });
  await send({ type: 'TOGGLE', enabled: true });
  const { ka } = await chrome.storage.local.get('ka');
  ka.sessionStartedAt = Date.now() - (47 * 60 + 52) * 1000;
  ka.pauseReason = null;
  await chrome.storage.local.set({ ka });
})()`);
await sleep(800);
await send('Target.closeTarget', { targetId: control.targetId });
await shoot(await open(ext('options/options.html'), 1280, 800), 'store-assets/raw/options-1280x800.png');

// Size the popup viewport to its content, as Chrome does for real popups.
const probe = await open(ext('popup/popup.html'), 350, 100, 1);
const popupHeight = await evaluate(probe.sessionId, 'Math.ceil(document.documentElement.scrollHeight)');
await send('Target.closeTarget', { targetId: probe.targetId });
const popup = await open(ext('popup/popup.html'), 350, popupHeight, 2);
await shoot(popup, 'store-assets/raw/popup.png');

const welcome = await open(ext('welcome.html'), 1280, 800);
await shoot(welcome, 'store-assets/raw/welcome-1280x800.png');

// Compose final listing images from the raw captures.
const file = p => 'file://' + path.join(root, p);
await shoot(await open(file('store-assets/compose-popup.html'), 1280, 800), 'store-assets/keepactive-1-popup-1280x800.png');
fs.copyFileSync(path.join(root, 'store-assets/raw/options-1280x800.png'), path.join(root, 'store-assets/keepactive-2-control-deck-1280x800.png'));
fs.copyFileSync(path.join(root, 'store-assets/raw/welcome-1280x800.png'), path.join(root, 'store-assets/keepactive-3-setup-guide-1280x800.png'));
await shoot(await open(file('store-assets/compose-promo.html'), 440, 280), 'store-assets/keepactive-promo-440x280.png');

await evaluate((await open(ext('options/options.html'), 800, 600)).sessionId, `chrome.runtime.sendMessage({ type: 'RESET_ALL' })`);
process.exit(0);
