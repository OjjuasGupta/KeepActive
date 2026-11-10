// One-shot: generate a stable RSA keypair for the extension so its ID never
// changes between installs. Writes tools/extension-key.* and prints the ID.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });
const b64 = der.toString('base64');

fs.writeFileSync(path.join(dir, 'extension-key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
fs.writeFileSync(path.join(dir, 'extension-key.pub.der'), der);
fs.writeFileSync(path.join(dir, 'extension-key.b64.txt'), b64);

// Chrome extension id = first 16 bytes of SHA256(DER public key), each nibble
// mapped to a..p, i.e. a=0, b=1, ... p=15.
const hash = crypto.createHash('sha256').update(der).digest().subarray(0, 16);
let id = '';
for (const byte of hash) {
  id += String.fromCharCode(97 + (byte >> 4));
  id += String.fromCharCode(97 + (byte & 15));
}
fs.writeFileSync(path.join(dir, 'extension-id.txt'), id);

console.log('EXTENSION_ID=' + id);
console.log('PUBLIC_KEY_B64=' + b64);
