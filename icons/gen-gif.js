const fs = require('fs');

// Generate a proper animated GIF using manual LZW encoding
// 32x32 pulsing green circle

// GIF Constants
const WIDTH = 32;
const HEIGHT = 32;
const FRAMES = 4;
const DELAY = 10; // 10 = 100ms (10 * 10ms)

// Colors
const TRANSPARENT = 0;
const GREEN = 1;
const WHITE = 2;

// Build color table (3 entries * 3 bytes = 9 bytes)
const gct = Buffer.from([
  0x00, 0x00, 0x00,  // 0: black (transparent)
  0x22, 0xC5, 0x5E,  // 1: green
  0xFF, 0xFF, 0xFF,  // 2: white
]);

// LZW Encoder
function lzwEncode(pixels, width, height, minCodeSize) {
  const MAX_CODES = 4096;
  let dictSize = 256;
  let clearCode = 1 << minCodeSize;
  let eoiCode = clearCode + 1;
  let nextCode = eoiCode + 1;
  
  // Initialize dictionary with single pixel values
  const dict = new Map();
  for (let i = 0; i < 256; i++) {
    dict.set(String.fromCharCode(i), i);
  }
  
  let data = [];
  let current = '';
  
  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i];
    const char = String.fromCharCode(pixel);
    
    if (dict.has(current + char)) {
      current += char;
    } else {
      data.push(dict.get(current));
      if (nextCode < MAX_CODES) {
        dict.set(current + char, nextCode++);
      }
      current = char;
    }
  }
  
  if (current) {
    data.push(dict.get(current));
  }
  
  // Convert codes to bytes
  let bitBuffer = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1;
  const output = [];
  
  function writeCode(code) {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      output.push(bitBuffer & 0xFF);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  }
  
  writeCode(clearCode);
  
  for (const code of data) {
    writeCode(code);
    if (nextCode === (1 << codeSize) && codeSize < 12) {
      codeSize++;
    }
  }
  
  writeCode(eoiCode);
  
  // Flush remaining bits
  while (bitCount > 0) {
    output.push(bitBuffer & 0xFF);
    bitBuffer >>= 8;
    bitCount -= 8;
  }
  
  // Pack into sub-blocks (max 255 bytes each)
  const blocks = [];
  for (let i = 0; i < output.length; i += 255) {
    const chunk = output.slice(i, Math.min(i + 255, output.length));
    blocks.push(Buffer.from([chunk.length, ...chunk]));
  }
  blocks.push(Buffer.from([0x00])); // Terminator
  
  return Buffer.concat(blocks);
}

// Create frame pixels for a given radius
function createFramePixels(radius) {
  const pixels = new Uint8Array(WIDTH * HEIGHT);
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < radius) {
        pixels[y * WIDTH + x] = GREEN;
      } else if (dist < radius + 1) {
        pixels[y * WIDTH + x] = WHITE;
      } else {
        pixels[y * WIDTH + x] = TRANSPARENT;
      }
    }
  }
  return pixels;
}

// Build GIF
const frames = [];
const radii = [8, 11, 13, 11]; // pulse effect

for (const r of radii) {
  const pixels = createFramePixels(r);
  const lzwData = lzwEncode(pixels, WIDTH, HEIGHT, 2); // 2 bits for 4 colors
  
  // Graphic Control Extension
  const gce = Buffer.from([
    0x21, 0xF9, 0x04,  // Extension introducer, GCE label, block size
    0x01,              // Disposal method=0, user input=0, transparent color flag=1
    DELAY & 0xFF, (DELAY >> 8) & 0xFF,  // Delay time (little endian)
    TRANSPARENT,       // Transparent color index
    0x00               // Block terminator
  ]);
  
  // Image Descriptor
  const imgDesc = Buffer.from([
    0x2C,              // Image separator
    0x00, 0x00,        // Left position
    0x00, 0x00,        // Top position
    WIDTH & 0xFF, (WIDTH >> 8) & 0xFF,   // Width
    HEIGHT & 0xFF, (HEIGHT >> 8) & 0xFF, // Height
    0x00               // No local color table, no interlace
  ]);
  
  frames.push(Buffer.concat([gce, imgDesc, Buffer.from([0x02]), lzwData])); // 0x02 = min code size
}

// Assemble GIF
const header = Buffer.from('GIF89a');
const lsd = Buffer.from([
  WIDTH & 0xFF, (WIDTH >> 8) & 0xFF,   // Canvas width
  HEIGHT & 0xFF, (HEIGHT >> 8) & 0xFF, // Canvas height
  0x80 | 0x00 | 0x01,  // GCT flag=1, color resolution=0, sort=0, size=1 (2^(1+1)=4 colors)
  0x00,                // Background color index
  0x00                 // Pixel aspect ratio
]);

// Netscape Loop Extension (for animation loop)
const netscape = Buffer.from([
  0x21, 0xFF, 0x0B,    // Extension, Application, block size
  0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30, // "NETSCAPE2.0"
  0x03, 0x01, 0x00, 0x00, // Sub-block: loop count = 0 (infinite)
  0x00                 // Terminator
]);

const trailer = Buffer.from([0x3B]); // GIF trailer

const gif = Buffer.concat([header, lsd, gct, netscape, ...frames, trailer]);
fs.writeFileSync('F:\\Claude\\stayactive\\icons\\icon32.gif', gif);
console.log('Created animated icon32.gif (' + gif.length + ' bytes)');

// Also create static GIFs for other sizes (just first frame)
for (const size of [16, 48, 128]) {
  const scale = size / 32;
  const w = size;
  const h = size;
  
  const pixels = new Uint8Array(w * h);
  const cx = w / 2;
  const cy = h / 2;
  const r = 8 * scale;
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < r) {
        pixels[y * w + x] = GREEN;
      } else if (dist < r + 1) {
        pixels[y * w + x] = WHITE;
      } else {
        pixels[y * w + x] = TRANSPARENT;
      }
    }
  }
  
  const lzwData = lzwEncode(pixels, w, h, 2);
  
  const gce = Buffer.from([0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, TRANSPARENT, 0x00]);
  const imgDesc = Buffer.from([
    0x2C, 0x00, 0x00, 0x00, 0x00,
    w & 0xFF, (w >> 8) & 0xFF, h & 0xFF, (h >> 8) & 0xFF,
    0x00
  ]);
  
  const lsd = Buffer.from([
    w & 0xFF, (w >> 8) & 0xFF, h & 0xFF, (h >> 8) & 0xFF,
    0x80 | 0x01, 0x00, 0x00
  ]);
  
  const gif = Buffer.concat([
    Buffer.from('GIF89a'),
    lsd,
    gct,
    gce,
    imgDesc,
    Buffer.from([0x02]),
    lzwData,
    Buffer.from([0x00]),
    Buffer.from([0x3B])
  ]);
  
  fs.writeFileSync(`F:\\Claude\\stayactive\\icons\\icon${size}.gif`, gif);
  console.log(`Created icon${size}.gif (${gif.length} bytes)`);
}