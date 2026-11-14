/**
 * Banner renderer tests — real Chromium against scripts/banner.html.
 *
 * Guards:
 *   - analytical derivative heading continuity across canvas wrap boundaries (x=900, y=300)
 *   - seamless loop parity between t = 0 (frame 0) and t = DURATION (frame 150)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const BANNER_URL = pathToFileURL(path.resolve(__dirname, '..', 'scripts', 'banner.html')).href;

let browser = null;

test.before(async () => {
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
  } catch (err) {
    if (process.env.CI) {
      assert.fail(`Chromium is not installed in CI: ${err.message}`);
    }
    browser = null;
  }
});

test.after(async () => {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
});

test('wrap-boundary angle continuity (|Δθ| < 0.2 rad across x=900, y=300 transitions)', async (t) => {
  if (!browser) return t.skip('Chromium not available');
  const page = await browser.newPage({ viewport: { width: 900, height: 300 } });
  await page.goto(BANNER_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__renderFrame === 'function' && typeof posAt === 'function');

  const result = await page.evaluate(() => {
    const dt = 0.01;
    const steps = Math.round(DURATION / dt);
    let wrapCount = 0;
    let maxWrapDeltaTheta = 0;
    let worstWrap = null;

    for (let i = 0; i < SPRITES.length; i++) {
      const s = SPRITES[i];
      let prev = { ...posAt(s, 0) };
      for (let k = 1; k <= steps; k++) {
        const currRaw = posAt(s, k * dt);
        const curr = { x: currRaw.x, y: currRaw.y, angle: currRaw.angle };
        const wrappedX = Math.abs(curr.x - prev.x) > W / 2;
        const wrappedY = Math.abs(curr.y - prev.y) > H / 2;
        if (wrappedX || wrappedY) {
          wrapCount++;
          const dTheta = Math.abs(Math.atan2(
            Math.sin(curr.angle - prev.angle),
            Math.cos(curr.angle - prev.angle)
          ));
          if (dTheta > maxWrapDeltaTheta) {
            maxWrapDeltaTheta = dTheta;
            worstWrap = { sprite: i, t: k * dt, dTheta, prevX: prev.x, currX: curr.x, prevY: prev.y, currY: curr.y };
          }
        }
        prev = curr;
      }
    }
    return { wrapCount, maxWrapDeltaTheta, worstWrap };
  });

  assert.ok(result.wrapCount > 0, 'expected at least one canvas boundary wrap across 100 sprites');
  assert.ok(
    result.maxWrapDeltaTheta < 0.2,
    `expected |Δθ| < 0.2 rad on wrap, got ${result.maxWrapDeltaTheta} at ${JSON.stringify(result.worstWrap)}`
  );

  await page.close();
});

test('seamless loop parity between t = 0 and t = DURATION (frame 0 vs frame 150)', async (t) => {
  if (!browser) return t.skip('Chromium not available');
  const page = await browser.newPage({ viewport: { width: 900, height: 300 } });
  await page.goto(BANNER_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__renderFrame === 'function' && typeof posAt === 'function');

  const parity = await page.evaluate(() => {
    const c = document.getElementById('c');
    const context = c.getContext('2d');

    window.__renderFrame(0);
    const frame0 = context.getImageData(0, 0, W, H).data;
    const sprites0 = SPRITES.map(s => {
      const p = posAt(s, 0);
      return { x: p.x, y: p.y, angle: p.angle };
    });

    window.__renderFrame(DURATION);
    const frame150 = context.getImageData(0, 0, W, H).data;
    const sprites150 = SPRITES.map(s => {
      const p = posAt(s, DURATION);
      return { x: p.x, y: p.y, angle: p.angle };
    });

    let maxPosDiff = 0;
    let maxAngleDiff = 0;
    for (let i = 0; i < SPRITES.length; i++) {
      const dx = Math.abs(sprites0[i].x - sprites150[i].x);
      const dy = Math.abs(sprites0[i].y - sprites150[i].y);
      const wrapDx = Math.min(dx, W - dx);
      const wrapDy = Math.min(dy, H - dy);
      maxPosDiff = Math.max(maxPosDiff, wrapDx, wrapDy);
      const dTheta = Math.abs(Math.atan2(
        Math.sin(sprites0[i].angle - sprites150[i].angle),
        Math.cos(sprites0[i].angle - sprites150[i].angle)
      ));
      maxAngleDiff = Math.max(maxAngleDiff, dTheta);
    }

    let maxChannelDiff = 0;
    let totalAbsDiff = 0;
    for (let i = 0; i < frame0.length; i += 4) {
      const dr = Math.abs(frame0[i] - frame150[i]);
      const dg = Math.abs(frame0[i + 1] - frame150[i + 1]);
      const db = Math.abs(frame0[i + 2] - frame150[i + 2]);
      const da = Math.abs(frame0[i + 3] - frame150[i + 3]);
      totalAbsDiff += dr + dg + db + da;
      const m = Math.max(dr, dg, db, da);
      if (m > maxChannelDiff) maxChannelDiff = m;
    }
    const meanChannelDiff = totalAbsDiff / frame0.length;

    return { maxPosDiff, maxAngleDiff, maxChannelDiff, meanChannelDiff };
  });

  assert.ok(parity.maxPosDiff < 1e-9, `expected position parity < 1e-9, got ${parity.maxPosDiff}`);
  assert.ok(parity.maxAngleDiff < 1e-9, `expected angle parity < 1e-9, got ${parity.maxAngleDiff}`);
  assert.ok(parity.maxChannelDiff <= 4, `expected pixel channel diff <= 4, got ${parity.maxChannelDiff}`);
  assert.ok(
    parity.meanChannelDiff < 0.05,
    `expected mean channel diff < 0.05, got ${parity.meanChannelDiff}`
  );

  await page.close();
});
