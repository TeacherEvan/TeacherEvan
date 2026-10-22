/**
 * PickaBoo Banner Capture — Playwright headless renderer (single source of truth)
 *
 * Renders scripts/banner.html deterministically frame-by-frame, compiles the
 * result into assets/pickaboo-loop.gif and verifies the encoded artifact.
 *
 *   node scripts/capture_banner.js
 */
const { chromium } = require('playwright');
const { execSync }  = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { inspectGif } = require('./lib/gif');

const ROOT        = path.resolve(__dirname, '..');
const FPS        = 25;
const DURATION   = 6.0;
const FRAMES     = Math.round(FPS * DURATION);   // 150
const VIEW_W     = 900;
const VIEW_H     = 300;
const OUT_W      = 800;                          // encoded width (Camo-friendly)
const FRAMES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pb_capture_'));
const OUTPUT     = path.join(ROOT, 'assets', 'pickaboo-loop.gif');
const PALETTE    = path.join(FRAMES_DIR, 'palette.png');

/** GIF verification lives in scripts/lib/gif.js so tests share the same parser. */

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page    = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H } });

  const bannerPath = path.join(__dirname, 'banner.html');
  await page.goto(`file://${bannerPath}`);
  await page.waitForTimeout(600); // let fonts settle

  console.log(`Capturing ${FRAMES} frames at ${FPS}fps…`);
  for (let i = 0; i < FRAMES; i++) {
    const t = i / FPS;
    // Deterministic render function — no RAF, pure Canvas draw
    await page.evaluate((time) => window.__renderFrame(time), t);
    const framePath = path.join(FRAMES_DIR, `frame_${String(i).padStart(4, '0')}.png`);
    await page.screenshot({ path: framePath, clip: { x: 0, y: 0, width: VIEW_W, height: VIEW_H } });
    if (i % 25 === 0) process.stdout.write(`  frame ${i}/${FRAMES}\n`);
  }

  await browser.close();
  console.log('All frames captured. Encoding GIF…');

  // Two-pass ffmpeg GIF: 20fps, scaled width, optimized palette
  execSync(
    `ffmpeg -y -framerate ${FPS} -i ${FRAMES_DIR}/frame_%04d.png ` +
    `-vf "fps=20,scale=${OUT_W}:-1:flags=lanczos,split[s0][s1];` +
    `[s0]palettegen=max_colors=128:reserve_transparent=0:stats_mode=diff[p];` +
    `[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" ` +
    `"${OUTPUT}"`,
    { stdio: 'inherit' }
  );

  // Verify the artifact we just produced
  const info = inspectGif(OUTPUT);
  const sizeKB = Math.round(fs.statSync(OUTPUT).size / 1024);
  if (!info.loops) throw new Error('Encoded GIF is not marked as looping');
  if (info.frames < 60) throw new Error(`Encoded GIF has too few frames (${info.frames})`);
  if (info.width !== OUT_W) throw new Error(`Unexpected GIF width ${info.width} (expected ${OUT_W})`);

  console.log(`✓ Done — ${path.relative(ROOT, OUTPUT)}  (${sizeKB} KB, ${info.width}×${info.height}, ${info.frames} frames, looping)`);
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
})().catch(err => {
  console.error('✗ Banner capture failed:', err.message);
  process.exit(1);
});
