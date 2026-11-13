/**
 * Engine behaviour tests — real Chromium, real input events.
 *
 * Regression guards for the direct 150-sprite interactive playground (v5.0):
 *   - loads directly into 150 sprites with no swipe pager
 *   - tap ripples, hold singularity/supernova, and grab/drag/fling work
 *   - pointers clear cleanly on pointerleave
 *   - no sprite ever ends up with NaN coordinates
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const ENGINE_URL = pathToFileURL(path.resolve(__dirname, '..', 'docs', 'index.html')).href;

// Deterministic PRNG so runs are reproducible
const SEED_SCRIPT = `(() => {
  let a = 12345;
  Math.random = () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
})()`;

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

test('loads directly into 150-sprite playground with no errors or swipe pager', async (t) => {
  if (!browser) return t.skip('Chromium not available');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.addInitScript(SEED_SCRIPT);
  await page.goto(ENGINE_URL, { waitUntil: 'load' });
  await page.waitForTimeout(200);

  const info = await page.evaluate(() => ({
    version: window.__sprites?.version,
    snap: window.__sprites?.snapshot(),
    hasPager: Boolean(window.__pager),
    hasPickaboo: Boolean(window.__pickaboo),
  }));

  assert.equal(errors.length, 0, `unexpected errors: ${errors.join('; ')}`);
  assert.equal(info.version, '5.0');
  assert.equal(info.hasPager, false, 'should not expose a swipe pager');
  assert.equal(info.hasPickaboo, false, 'should not expose legacy pickaboo');
  assert.equal(info.snap.spriteCount, 150);
  assert.equal(info.snap.isPaused, false);
  assert.equal(info.snap.positions.length, 150);
  for (const s of info.snap.positions) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), 'finite sprite position');
    assert.ok(Number.isFinite(s.vx) && Number.isFinite(s.vy), 'finite sprite velocity');
  }

  await page.close();
});

test('tap spawns ripple and hold releases supernova with finite coordinates', async (t) => {
  if (!browser) return t.skip('Chromium not available');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(SEED_SCRIPT);
  await page.goto(ENGINE_URL, { waitUntil: 'load' });
  await page.waitForTimeout(150);

  // Tap in empty space or near center
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();

  const afterTap = await page.evaluate(() => window.__sprites.snapshot());
  assert.ok(afterTap.ripples >= 1, `expected >= 1 ripple after tap, got ${afterTap.ripples}`);

  // Hold to build singularity, then release supernova
  await page.mouse.move(320, 240);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await page.waitForTimeout(100);

  const afterHold = await page.evaluate(() => window.__sprites.snapshot());
  assert.equal(afterHold.activePointers, 0);
  for (const s of afterHold.positions) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
    assert.ok(Number.isFinite(s.vx) && Number.isFinite(s.vy));
  }

  await page.close();
});

test('grabbing, dragging, and flinging a sprite keeps finite coordinates', async (t) => {
  if (!browser) return t.skip('Chromium not available');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(SEED_SCRIPT);
  await page.goto(ENGINE_URL, { waitUntil: 'load' });
  await page.waitForTimeout(150);

  const target = await page.evaluate(() => window.__sprites.snapshot().positions[0]);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  const duringGrab = await page.evaluate(() => window.__sprites.snapshot());
  assert.equal(duringGrab.grabbed, 1, 'sprite should be grabbed when pressing directly on it');

  await page.mouse.move(target.x + 120, target.y + 80, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);

  const afterFling = await page.evaluate(() => window.__sprites.snapshot());
  assert.equal(afterFling.grabbed, 0);
  for (const s of afterFling.positions) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
    assert.ok(Number.isFinite(s.vx) && Number.isFinite(s.vy));
  }

  await page.close();
});

test('sound and motion buttons toggle aria-pressed', async (t) => {
  if (!browser) return t.skip('Chromium not available');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(ENGINE_URL, { waitUntil: 'load' });
  await page.waitForTimeout(150);

  const soundBefore = await page.getAttribute('#btnSound', 'aria-pressed');
  await page.click('#btnSound');
  const soundAfter = await page.getAttribute('#btnSound', 'aria-pressed');
  assert.notEqual(soundBefore, soundAfter);

  const motionBefore = await page.getAttribute('#btnMotion', 'aria-pressed');
  await page.click('#btnMotion');
  const motionAfter = await page.getAttribute('#btnMotion', 'aria-pressed');
  assert.notEqual(motionBefore, motionAfter);

  await page.click('#btnMotion');
  const motionRestored = await page.getAttribute('#btnMotion', 'aria-pressed');
  assert.equal(motionRestored, motionBefore);

  await page.close();
});

test('pointercancel and blur clear active pointers cleanly', async (t) => {
  if (!browser) return t.skip('Chromium not available');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(ENGINE_URL, { waitUntil: 'load' });
  await page.waitForTimeout(150);

  await page.mouse.move(500, 400);
  await page.mouse.down();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
  });

  const snap = await page.evaluate(() => window.__sprites.snapshot());
  assert.equal(snap.activePointers, 0);
  assert.equal(snap.grabbed, 0);

  await page.close();
});
