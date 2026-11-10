const fs = require('fs');

// Simple CRC32 implementation
function crc32(buf) {
    let crc = 0xFFFFFFFF;
    const table = [];
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
    }
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type);
    const crcBuf = Buffer.alloc(4);
    const combined = Buffer.concat([typeBuf, data]);
    crcBuf.writeUInt32BE(crc32(combined), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPNG(size) {
    const width = size;
    const height = size;
    
    // PNG signature
    const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    
    // IHDR chunk
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8;    // bit depth
    ihdrData[9] = 6;    // color type: RGBA
    ihdrData[10] = 0;   // compression
    ihdrData[11] = 0;   // filter
    ihdrData[12] = 0;   // interlace
    
    const ihdrChunk = createChunk('IHDR', ihdrData);
    
    // IDAT chunk - create a simple green circle icon
    const rawData = Buffer.alloc(height * (1 + width * 4));
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = width * 0.38;
    
    for (let y = 0; y < height; y++) {
        rawData[y * (1 + width * 4)] = 0; // filter type 0 (none)
        for (let x = 0; x < width; x++) {
            const offset = y * (1 + width * 4) + 1 + x * 4;
            const dx = x - centerX;
            const dy = y - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < radius) {
                // Green circle (KeepActive color)
                rawData[offset] = 0x22;     // R
                rawData[offset + 1] = 0xC5; // G
                rawData[offset + 2] = 0x5E; // B
                rawData[offset + 3] = 0xFF; // A
            } else if (dist < radius + 1.5) {
                // White border
                rawData[offset] = 0xFF;
                rawData[offset + 1] = 0xFF;
                rawData[offset + 2] = 0xFF;
                rawData[offset + 3] = 0xFF;
            } else {
                // Transparent background
                rawData[offset] = 0;
                rawData[offset + 1] = 0;
                rawData[offset + 2] = 0;
                rawData[offset + 3] = 0;
            }
        }
    }
    
    const zlib = require('zlib');
    const compressed = zlib.deflateSync(rawData);
    const idatChunk = createChunk('IDAT', compressed);
    
    // IEND chunk
    const iendChunk = createChunk('IEND', Buffer.alloc(0));
    
    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

for (const size of [16, 32, 48, 128]) {
    const png = createPNG(size);
    fs.writeFileSync(`F:\\Claude\\stayactive\\icons\\icon${size}.png`, png);
    console.log(`Created icon${size}.png (${png.length} bytes, ${size}x${size})`);
}