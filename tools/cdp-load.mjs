/* tools/cdp-load.js
 * Load an unpacked extension in a CDP-controlled Chrome and print its ID.
 * Usage: node tools/cdp-load.js <unpacked-path> [port]
 */

'use strict';

const path = process.argv[2];
const port = process.argv[3] || '9333';
if (!path) {
  console.error('Usage: node tools/cdp-load.js <unpacked-path> [port]');
  process.exit(1);
}

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise(resolve => pending.set(id, resolve));
}

const result = await send('Extensions.loadUnpacked', { path });
console.log(JSON.stringify(result, null, 2));
ws.close();
