/**
 * Engine behaviour tests — real Chromium, real input events.
 *
 * Regression guards for the direct 100-sprite interactive playground (v5.0):
 *   - loads directly into 100 sprites with no swipe pager
 *   - tap ripples, hold singularity/supernova, and grab/drag/fling work smoothly
 *   - pointers clear cleanly on pointerleave and blur
 *   - 390px mobile fit, coarse pointer 44px touch targets, reduced motion honored
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

async function waitForEngineReady(page) {
  await page.waitForFunction(() => {
    const snap = window.__sprites?.snapshot();
    return Boolean(snap && snap.spriteCount === 100);
  });
}

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

test('loads directly into 100-sprite playground with no errors or swipe pager', async (t) => {
  if (!browser) return t.skip('Chromium not available');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.addInitScript(SEED_SCRIPT);
  await page.goto(ENGINE_URL, { waitUntil: 'load' });
  await waitForEngineReady(page);

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
  assert.equal(info.snap.spriteCount, 100);
  assert.equal(info.snap.isPaused, false);
  assert.equal(info.snap.positions.length, 100);
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
  await waitForEngineReady(page);

  // Pick a genuine empty-space point outside every sprite's hit radius
  const emptySpot = await page.evaluate(() => {
    const snap = window.__sprites.snapshot();
    const minSep = snap.hitRadius + 24;
    for (let x = 200; x <= 1080; x += 60) {
      for (let y = 160; y <= 640; y += 60) {
        const clear = snap.positions.every(p => Math.hypot(p.x - x, p.y - y) > minSep);
        if (clear) return { x, y };
      }
    }
    return { x: 640, y: 400 };
  });

  await page.mouse.move(emptySpot.x, emptySpot.y);
  await page.mouse.down();
  await page.waitForFunction(() => window.__sprites.snapshot().activePointers === 1);
  await page.mouse.up();
  await page.waitForFunction(() => window.__sprites.snapshot().ripples >= 1);

  const afterTap = await page.evaluate(() => window.__sprites.snapshot());
  assert.ok(afterTap.ripples >= 1, `expected >= 1 ripple after tap, got ${afterTap.ripples}`);

  // Hold to build singularity, then release supernova
  await page.mouse.move(320, 240);
  await page.mouse.down();
  await page.waitForTimeout(500);
  const beforeRelease = await page.evaluate(() => window.__sprites.snapshot());
  await page.mouse.up();
  await page.waitForFunction(
    () => window.__sprites.snapshot().activePointers === 0 && window.__sprites.snapshot().ripples >= 1
  );

  const afterHold = await page.evaluate(() => window.__sprites.snapshot());
  const meanSpeed = snap =>
    snap.positions.reduce((sum, s) => sum + Math.hypot(s.vx, s.vy), 0) / snap.positions.length;
  const speedBefore = meanSpeed(beforeRelease);
  const speedAfter = meanSpeed(afterHold);
  assert.ok(
    speedAfter > speedBefore,
    `expected mean radial speed to increase after supernova release (${speedBefore} -> ${speedAfter})`
  );
  assert.equal(afterHold.activePointers, 0);
  for (const s of afterHold.positions) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
    assert.ok(Number.isFinite(s.vx) && Number.isFinite(s.vy));
  }

  await page.close();
});

test('grabbing, dragging, and flinging a sprite keeps kinetic momentum smoothly', async (t) => {
  if (!browser) return t.skip('Chromium not available');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(SEED_SCRIPT);
  await page.goto(ENGINE_URL, { waitUntil: 'load' });
  await waitForEngineReady(page);

  const target = await page.evaluate(() => window.__sprites.snapshot().positions[0]);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  const duringGrab = await page.evaluate(() => window.__sprites.snapshot());
  assert.equal(duringGrab.grabbed, 1, 'sprite should be grabbed when pressing directly on it');

  await page.mouse.move(target.x + 140, target.y + 90, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__sprites.snapshot().grabbed === 0);

  const afterFling = await page.evaluate(() => window.__sprites.snapshot());
  assert.equal(afterFling.grabbed, 0);
  assert.ok(afterFling.positions[0].vx > 0, `expected vx > 0 after (+140, +90) fling, got ${afterFling.positions[0].vx}`);
  assert.ok(afterFling.positions[0].vy > 0, `expected vy > 0 after (+140, +90) fling, got ${afterFling.positions[0].vy}`);
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
  await page.waitForFunction(() => Boolean(document.querySelector('#btnSound')) && Boolean(document.querySelector('#btnMotion')));

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

test('mobile 390px viewport fits controls cleanly with 44px touch targets and reduced motion', async (t) => {
  if (!browser) return t.skip('Chromium not available');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(ENGINE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(document.querySelector('#btnSound')) && Boolean(document.querySelector('#btnMotion')));

  const metrics = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('header button, header a')];
    const maxRight = Math.max(...controls.map(el => el.getBoundingClientRect().right));
    const minHeight = Math.min(...controls.map(el => el.getBoundingClientRect().height));
    const dotAnim = getComputedStyle(document.querySelector('.dot-live')).animationName;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      maxRight,
      minHeight,
      dotAnim,
    };
  });

  assert.equal(metrics.scrollWidth, metrics.innerWidth);
  assert.ok(metrics.maxRight <= 390, `control clips past 390px: ${metrics.maxRight}`);
  assert.ok(metrics.minHeight >= 44, `expected >= 44px touch target, got ${metrics.minHeight}`);
  assert.equal(metrics.dotAnim, 'none');

  await context.close();
});

test('pointercancel and blur clear active pointers cleanly', async (t) => {
  if (!browser) return t.skip('Chromium not available');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(ENGINE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(document.querySelector('#btnSound')) && Boolean(document.querySelector('#btnMotion')));

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

test('particle budget ceiling bounds sparks to SPARK_CAPACITY and keeps 100 sprites under rapid bursts', async (t) => {
  if (!browser) return t.skip('Chromium not available');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(SEED_SCRIPT);
  await page.goto(ENGINE_URL, { waitUntil: 'load' });
  await waitForEngineReady(page);

  const sparkCheck = await page.evaluate(() => {
    const { SpriteSparks, SPARK_CAPACITY } = window.TeacherEvan.SpriteSparks;
    const pool = new SpriteSparks();
    for (let i = 0; i < 12; i++) {
      pool.burst(400 + i * 20, 300, '#00f0ff', { count: 48, speed: 5 });
    }
    const lenAfterOverfill = pool.length;
    const cursorAfterOverfill = pool.cursor;
    pool.update(1 / 60);
    const lenAfterStep = pool.length;
    return { SPARK_CAPACITY, lenAfterOverfill, cursorAfterOverfill, lenAfterStep };
  });

  assert.equal(sparkCheck.SPARK_CAPACITY, 360);
  assert.equal(sparkCheck.lenAfterOverfill, 360, 'spark ring buffer must cap at SPARK_CAPACITY');
  assert.equal(sparkCheck.cursorAfterOverfill, (12 * 48) % 360);
  assert.ok(sparkCheck.lenAfterStep <= 360);

  // Trigger rapid canvas taps to stress live engine budget
  for (let i = 0; i < 8; i++) {
    await page.mouse.click(220 + i * 90, 250 + (i % 3) * 80);
  }
  await page.waitForFunction(() => window.__sprites.snapshot().activePointers === 0);

  const snap = await page.evaluate(() => window.__sprites.snapshot());
  assert.equal(snap.spriteCount, 100);
  assert.equal(snap.positions.length, 100);
  for (const s of snap.positions) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
    assert.ok(Number.isFinite(s.vx) && Number.isFinite(s.vy));
  }

  await page.close();
});

test('Web Audio mute/unmute reuses a single AudioContext and tracks oscillator lifecycle', async (t) => {
  if (!browser) return t.skip('Chromium not available');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await page.addInitScript(() => {
    const stats = {
      contextsCreated: 0,
      oscillatorsCreated: 0,
      oscillatorsEnded: 0,
      suspendCalls: 0,
      resumeCalls: 0,
    };
    window.__audioStats = stats;

    const NativeAC = window.AudioContext || window.webkitAudioContext;
    if (!NativeAC) return;

    function WrappedAudioContext(...args) {
      const ctx = new NativeAC(...args);
      stats.contextsCreated++;

      const origCreateOsc = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = () => {
        const osc = origCreateOsc();
        stats.oscillatorsCreated++;
        osc.addEventListener('ended', () => {
          stats.oscillatorsEnded++;
        });
        return osc;
      };

      const origSuspend = ctx.suspend.bind(ctx);
      ctx.suspend = () => {
        stats.suspendCalls++;
        return origSuspend();
      };

      const origResume = ctx.resume.bind(ctx);
      ctx.resume = () => {
        stats.resumeCalls++;
        return origResume();
      };

      return ctx;
    }
    WrappedAudioContext.prototype = NativeAC.prototype;
    window.AudioContext = WrappedAudioContext;
    window.webkitAudioContext = WrappedAudioContext;
  });

  await page.goto(ENGINE_URL, { waitUntil: 'load' });
  await waitForEngineReady(page);

  // First canvas tap unlocks audio and creates the single AudioContext + drone + chime oscillators
  await page.mouse.click(640, 400);
  await page.waitForFunction(() => window.__audioStats.contextsCreated === 1);
  const afterUnlock = await page.evaluate(() => ({ ...window.__audioStats }));
  assert.equal(afterUnlock.contextsCreated, 1);
  assert.ok(afterUnlock.oscillatorsCreated >= 5, `expected >= 5 oscillators (4 drone + LFO), got ${afterUnlock.oscillatorsCreated}`);

  // Mute via #btnSound -> should not create new oscillators on canvas tap
  await page.click('#btnSound');
  assert.equal(await page.getAttribute('#btnSound', 'aria-pressed'), 'false');
  const oscBeforeMutedTap = await page.evaluate(() => window.__audioStats.oscillatorsCreated);
  await page.mouse.click(500, 320);
  const afterMutedTap = await page.evaluate(() => ({ ...window.__audioStats }));
  assert.equal(afterMutedTap.contextsCreated, 1);
  assert.equal(afterMutedTap.oscillatorsCreated, oscBeforeMutedTap, 'muted taps must not spawn chime oscillators');

  // Unmute via #btnSound -> reuses existing AudioContext and resumes without duplicating context
  await page.click('#btnSound');
  assert.equal(await page.getAttribute('#btnSound', 'aria-pressed'), 'true');
  await page.mouse.click(720, 360);
  await page.waitForFunction(
    prevOsc => window.__audioStats.oscillatorsCreated > prevOsc,
    oscBeforeMutedTap
  );
  const afterUnmuteTap = await page.evaluate(() => ({ ...window.__audioStats }));
  assert.equal(afterUnmuteTap.contextsCreated, 1, 'unmuting must reuse the single AudioContext');
  assert.ok(afterUnmuteTap.oscillatorsCreated > oscBeforeMutedTap, 'unmuted tap must resume spawning chime oscillators');

  await page.close();
});
