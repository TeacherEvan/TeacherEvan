/**
 * Minimal GIF inspector — dependency-free so the asset pipeline and the test
 * suite can verify the encoded banner without pulling in an image library.
 */
const fs = require('fs');

/**
 * @param {string} file path to a GIF
 * @returns {{width:number,height:number,frames:number,loops:boolean,bytes:number}}
 */
function inspectGif(file) {
  const buf = fs.readFileSync(file);
  const sig = buf.toString('ascii', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error(`Not a GIF: ${sig}`);
  const width  = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  let frames = 0, loops = false;
  for (let i = 13; i < buf.length - 14; i++) {
    // Graphic Control Extension: 0x21 0xF9, block size 0x04, and terminator 0x00 at offset +7
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9 && buf[i + 2] === 0x04 && buf[i + 7] === 0x00) {
      frames++;
    }
    // NETSCAPE2.0 or ANIMEXTS1.0 Application Extension
    if (buf[i] === 0x21 && buf[i + 1] === 0xff && buf[i + 2] === 0x0b) {
      const appId = buf.toString('ascii', i + 3, i + 14);
      if (appId === 'NETSCAPE2.0' || appId === 'ANIMEXTS1.0') loops = true;
    }
  }
  return { width, height, frames, loops, bytes: buf.length };
}

module.exports = { inspectGif };
