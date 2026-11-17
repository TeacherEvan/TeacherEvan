/**
 * Minimal GIF inspector — dependency-free so the asset pipeline and the test
 * suite can verify the encoded banner without pulling in an image library.
 */
const fs = require('fs');

function skipSubBlocks(buf, pos) {
  while (pos < buf.length) {
    const len = buf[pos++];
    if (len === 0) return pos;
    pos += len;
  }
  throw new Error('Truncated GIF sub-block');
}

/**
 * @param {string} file path to a GIF
 * @returns {{width:number,height:number,frames:number,loops:boolean,bytes:number,delays:number[]}}
 */
function inspectGif(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 14) throw new Error(`Truncated GIF (${buf.length} bytes)`);
  const sig = buf.toString('ascii', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error(`Not a GIF: ${sig}`);
  if (buf[buf.length - 1] !== 0x3b) throw new Error('Missing GIF trailer (0x3B)');

  const width  = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const lsdPacked = buf[10];
  let i = 13 + ((lsdPacked & 0x80) ? 3 * (1 << ((lsdPacked & 0x07) + 1)) : 0);

  let frames = 0;
  let loops = false;
  const delays = [];
  while (i < buf.length) {
    const block = buf[i++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      if (i >= buf.length) throw new Error('Truncated GIF extension');
      const label = buf[i++];
      if (label === 0xf9) {
        if (i + 5 >= buf.length) throw new Error('Truncated GIF GCE block');
        const blockSize = buf[i];
        if (blockSize !== 0x04) {
          throw new Error(`Invalid GIF GCE block size: expected 0x04, got 0x${blockSize.toString(16)}`);
        }
        const delayCs = buf.readUInt16LE(i + 2);
        if (buf[i + 5] !== 0x00) {
          throw new Error(`Missing GIF GCE terminator (0x00), got 0x${buf[i + 5].toString(16)}`);
        }
        delays.push(delayCs);
        i += 6;
      } else {
        if (label === 0xff && i < buf.length) {
          const blockSize = buf[i];
          if (blockSize === 0x0b && i + 12 <= buf.length) {
            const appId = buf.toString('ascii', i + 1, i + 12);
            if (appId === 'NETSCAPE2.0' || appId === 'ANIMEXTS1.0') loops = true;
          }
        }
        i = skipSubBlocks(buf, i);
      }
    } else if (block === 0x2c) {
      if (i + 9 > buf.length) throw new Error('Truncated GIF image descriptor');
      frames++;
      const imgPacked = buf[i + 8];
      i += 9;
      if (imgPacked & 0x80) {
        i += 3 * (1 << ((imgPacked & 0x07) + 1));
      }
      if (i >= buf.length) throw new Error('Truncated GIF image data');
      i += 1; // LZW minimum code size
      i = skipSubBlocks(buf, i);
    } else {
      throw new Error(`Unexpected GIF block 0x${block.toString(16)} at offset ${i - 1}`);
    }
  }
  return { width, height, frames, loops, bytes: buf.length, delays };
}

module.exports = { inspectGif };
