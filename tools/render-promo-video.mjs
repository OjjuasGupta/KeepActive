// Renders store-assets/promo-video.html to store-assets/keepactive-promo-1080p.mp4 (1920x1080, 30fps, no audio).
// Usage: node tools/render-promo-video.mjs   (needs google-chrome and ffmpeg on PATH)
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = pathToFileURL(join(root, 'store-assets/promo-video.html')).href;
const out = join(root, 'store-assets/keepactive-promo-1080p.mp4');
const FPS = 30, port = 9300 + Math.floor(Math.random() * 500);

const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader', '--allow-file-access-from-files', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'promo-'))}`, 'about:blank'], { stdio: 'ignore' });
let tabs;
for (let i = 0; i < 40 && !tabs; i++) {
  await new Promise(r => setTimeout(r, 250));
  try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch {}
}
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression, awaitPromise = false) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })).result?.value;

await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: html });
await new Promise(r => setTimeout(r, 800));
await ev('window.ready', true);
const dur = await ev('window.DURATION');

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-r', String(FPS), '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const frames = Math.round(dur * FPS);
for (let f = 0; f < frames; f++) {
  await ev(`render(${(f / FPS).toFixed(4)})`);
  const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
  if (!ff.stdin.write(Buffer.from(s.data, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
  if (f % 150 === 0) console.log(`frame ${f}/${frames}`);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
ws.close(); chrome.kill();
console.log('wrote', out);
process.exit(0);
