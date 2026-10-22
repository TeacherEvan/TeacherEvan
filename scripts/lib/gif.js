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
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9) frames++;      // Graphic Control Extension
    if (buf[i] === 0x21 && buf[i + 1] === 0xff) loops = true;  // Application Extension (NETSCAPE loop)
  }
  return { width, height, frames, loops, bytes: buf.length };
}

module.exports = { inspectGif };
