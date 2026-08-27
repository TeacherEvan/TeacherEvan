/**
 * PickaBoo Banner Capture — Playwright headless renderer
 * Records scripts/banner.html at 25fps, exports frames, compiles GIF via ffmpeg
 */
const { chromium } = require('playwright');
const { execSync }  = require('child_process');
const path = require('path');
const fs   = require('fs');

const FPS      = 25;
const DURATION = 6.0;
const FRAMES   = Math.round(FPS * DURATION);  // 150
const FRAMES_DIR = '/tmp/pb_capture';
const OUTPUT     = 'assets/pickaboo-loop.gif';
const PALETTE    = '/tmp/pb_capture_palette.png';

fs.mkdirSync(FRAMES_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page    = await browser.newPage();
  await page.setViewportSize({ width: 900, height: 300 });

  const bannerPath = path.resolve(__dirname, 'banner.html');
  await page.goto(`file://${bannerPath}`);

  // Wait for fonts to load
  await page.waitForTimeout(600);

  console.log(`Capturing ${FRAMES} frames at ${FPS}fps…`);
  for (let i = 0; i < FRAMES; i++) {
    const t = i / FPS;
    // Call deterministic render function — no RAF, pure Canvas draw
    await page.evaluate((t) => window.__renderFrame(t), t);
    const framePath = path.join(FRAMES_DIR, `frame_${String(i).padStart(4,'0')}.png`);
    await page.screenshot({ path: framePath, clip: { x:0, y:0, width:900, height:300 } });
    if (i % 25 === 0) process.stdout.write(`  frame ${i}/${FRAMES}\n`);
  }

  await browser.close();
  console.log('All frames captured. Encoding GIF…');

  // Two-pass ffmpeg GIF with high-quality dithering
  execSync(`ffmpeg -y -framerate ${FPS} -i ${FRAMES_DIR}/frame_%04d.png \
    -vf "palettegen=max_colors=256:reserve_transparent=0:stats_mode=diff" \
    ${PALETTE}`, { stdio:'inherit' });

  execSync(`ffmpeg -y -framerate ${FPS} -i ${FRAMES_DIR}/frame_%04d.png \
    -i ${PALETTE} \
    -lavfi "paletteuse=dither=sierra2_4a:diff_mode=rectangle" \
    ${OUTPUT}`, { stdio:'inherit' });

  const sizeKB = Math.round(fs.statSync(OUTPUT).size / 1024);
  console.log(`✓ Done — ${OUTPUT}  (${sizeKB} KB)`);
})();
