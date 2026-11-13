/**
 * Engine behaviour tests — real Chromium, real input events.
 *
 * These are the regression guards for the v4.1 physics rework:
 *   - the simulation must be frame-rate independent (fixed timestep)
 *   - the particle budget must hold
 *   - pointers must not become stale phantoms
 *   - no sprite may ever end up with NaN coordinates
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const ENGINE_URL = pathToFileURL(path.resolve(__dirname, '..', 'docs', 'index.html')).href;

// Deterministic PRNG so two runs at different refresh rates start identical
const SEED_SCRIPT = `(() => {
  let a = 12345;
  Math.random = () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
})()`;

const rafOverride = ms => `(() => {
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), ${ms});
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

async function openEngine(browser, { initScript } = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  if (initScript) await page.addInitScript(initScript);
  await page.goto(ENGINE_URL);
  await page.waitForTimeout(400);
  return { context, page, errors };
}

test('engine boots clean and exposes its state', async t => {
  if (!browser) {
    if (process.env.CI) assert.fail('Chromium is not installed in CI');
    t.skip('Chromium is not installed — run: npx playwright install chromium');
    return;
  }
  const { context, page, errors } = await openEngine(browser, { initScript: SEED_SCRIPT });
  try {
    const snap = await page.evaluate(() => window.__pickaboo.snapshot());
    assert.equal(snap.version, '5.0');
    assert.ok(snap.sprites > 0, 'engine should spawn sprites on load');
    assert.deepEqual(errors, [], `engine produced errors: ${errors.join(' | ')}`);
  } finally {
    await context.close();
  }
});

test('hovering a sprite arms the countdown and detonation is counted', async t => {
  if (!browser) {
    if (process.env.CI) assert.fail('Chromium is not installed in CI');
    t.skip('Chromium is not installed');
    return;
  }
  const { context, page, errors } = await openEngine(browser, { initScript: SEED_SCRIPT });
  try {
    // Park the pointer directly on a sprite
    const target = await page.evaluate(() => ({ x: sprites[0].x, y: sprites[0].y }));
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(400);

    const armed = await page.evaluate(() => sprites.filter(s => s.state === 'countdown').length);
    assert.ok(armed > 0, 'pointer contact should arm at least one countdown');

    // Fast-track the countdown and confirm the detonation registers
    await page.evaluate(() => sprites.filter(s => s.state === 'countdown').forEach(s => s.triggerCountdown(true)));
    await page.waitForTimeout(1800);
    const snap = await page.evaluate(() => window.__pickaboo.snapshot());
    assert.ok(snap.booms > 0, 'detonations should be counted');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('sprite coordinates stay finite under adversarial pointer overlap', async t => {
  if (!browser) {
    if (process.env.CI) assert.fail('Chromium is not installed in CI');
    t.skip('Chromium is not installed');
    return;
  }
  const { context, page, errors } = await openEngine(browser, { initScript: SEED_SCRIPT });
  try {
    // Slam the pointer onto every sprite, then jitter it across the canvas
    for (let i = 0; i < 12; i++) {
      const pos = await page.evaluate((idx) => {
        const s = sprites[idx % sprites.length];
        return { x: s.x, y: s.y };
      }, i);
      await page.mouse.move(pos.x, pos.y);
    }
    await page.waitForTimeout(1200);

    const snap = await page.evaluate(() => window.__pickaboo.snapshot());
    const bad = snap.positions.filter(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
                                         !Number.isFinite(p.vx) || !Number.isFinite(p.vy));
    assert.deepEqual(bad, [], 'no sprite may hold a NaN/Infinite coordinate');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('the pointer is dropped when it leaves the viewport', async t => {
  if (!browser) {
    if (process.env.CI) assert.fail('Chromium is not installed in CI');
    t.skip('Chromium is not installed');
    return;
  }
  const { context, page } = await openEngine(browser, { initScript: SEED_SCRIPT });
  try {
    await page.mouse.move(400, 300);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => pointers.size), 1, 'mouse pointer should be tracked');
    const pointerId = await page.evaluate(() => [...pointers.keys()][0]);

    // Real browsers fire pointerleave on <html> when the cursor exits the window
    await page.evaluate((id) => {
      document.documentElement.dispatchEvent(
        new PointerEvent('pointerleave', { pointerType: 'mouse', pointerId: id }));
    }, pointerId);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => pointers.size), 0,
      'a stale pointer must not keep luring sprites after the cursor leaves');

    // …and the window-level mouseout fallback (relatedTarget === null) must clear too
    await page.mouse.move(500, 350);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => pointers.size), 1);
    await page.evaluate(() => {
      window.dispatchEvent(new MouseEvent('mouseout', { relatedTarget: null, bubbles: true }));
    });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => pointers.size), 0,
      'leaving the window must clear the reticle');
  } finally {
    await context.close();
  }
});

test('simulation speed is independent of the display refresh rate', async t => {
  if (!browser) {
    if (process.env.CI) assert.fail('Chromium is not installed in CI');
    t.skip('Chromium is not installed');
    return;
  }
  const timeToContact = async (fps) => {
    const { context, page } = await openEngine(browser, {
      initScript: `${SEED_SCRIPT}\n${rafOverride(1000 / fps)}`
    });
    try {
      await page.evaluate(() => {
        // Isolate one sprite 300px from the cursor; park the rest in corners
        const pointer = { x: 600, y: 400 };
        pointers.set(999, pointer);
        sprites.forEach((s, i) => {
          if (i === 0) { s.x = pointer.x + 300; s.y = pointer.y; s.vx = 0; s.vy = 0; s.state = 'idle'; }
          else { s.x = 20 + (i % 3) * 8; s.y = 20; s.vx = 0; s.vy = 0; s.state = 'idle'; }
        });
      });
      const started = Date.now();
      let elapsed = null;
      for (let i = 0; i < 120 && elapsed === null; i++) {
        await page.waitForTimeout(50);
        const state = await page.evaluate(() => sprites[0].state);
        if (state === 'countdown') elapsed = Date.now() - started;
      }
      return elapsed;
    } finally {
      await context.close();
    }
  };

  const slow = await timeToContact(30);
  const fast = await timeToContact(120);
  console.log(`      ↳ time-to-contact: ${slow}ms @30fps vs ${fast}ms @120fps`);

  assert.ok(slow !== null && fast !== null, 'the sprite never reached the cursor');
  const ratio = slow / fast;
  assert.ok(ratio > 0.7 && ratio < 1.43,
    `approach speed must not depend on refresh rate, got ${slow}ms @30fps vs ${fast}ms @120fps ` +
    `(ratio ${ratio.toFixed(2)})`);
});

test('the particle budget is enforced under sustained chain detonations', async t => {
  if (!browser) {
    if (process.env.CI) assert.fail('Chromium is not installed in CI');
    t.skip('Chromium is not installed');
    return;
  }
  const { context, page, errors } = await openEngine(browser, { initScript: SEED_SCRIPT });
  try {
    const result = await page.evaluate(() => {
      for (let round = 0; round < 4; round++) {
        sprites.forEach(s => { if (s.state !== 'dead') s.explode(); });
      }
      return { particles: particles.length, cap: MAX_PARTICLES };
    });
    assert.ok(result.particles <= result.cap,
      `particle budget exceeded: ${result.particles} > ${result.cap}`);
    assert.ok(result.particles > 0, 'explosions should still produce particles');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('HUD toggles expose and apply their state', async t => {
  if (!browser) {
    if (process.env.CI) assert.fail('Chromium is not installed in CI');
    t.skip('Chromium is not installed');
    return;
  }
  const { context, page, errors } = await openEngine(browser, { initScript: SEED_SCRIPT });
  try {
    const sandbox = page.locator('#btnSandbox');
    await sandbox.click();
    assert.equal(await sandbox.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => sandboxMode), true);
    assert.equal(await page.locator('#telemetry').isVisible(), true);

    const motion = page.locator('#btnMotion');
    await motion.click();
    assert.equal(await motion.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.__pickaboo.snapshot().reduceMotion), true);

    const sound = page.locator('#btnSound');
    await sound.click();
    assert.equal(await sound.getAttribute('aria-pressed'), 'false');

    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('swipe left opens the 150-sprite interactive playground on mobile', async t => {
  if (!browser) {
    if (process.env.CI) assert.fail('Chromium is not installed in CI');
    t.skip('Chromium is not installed');
    return;
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.addInitScript(SEED_SCRIPT);
  await page.goto(ENGINE_URL);
  await page.waitForTimeout(400);
  try {
    await page.mouse.move(330, 420);
    await page.mouse.down();
    await page.mouse.move(70, 420, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(450);

    const state = await page.evaluate(() => ({
      pos: window.__pager.getPosition(),
      sprites: window.__sprites.snapshot(),
      returnHidden: document.getElementById('sideScreenReturnBtn').hidden,
      page0Inert: document.getElementById('profileHubPage').hasAttribute('inert'),
      page0AriaHidden: document.getElementById('profileHubPage').getAttribute('aria-hidden'),
      page1AriaHidden: document.getElementById('spritePlaygroundPage').getAttribute('aria-hidden'),
    }));
    assert.equal(state.pos, 1, 'swiping left should move HomePager to page 1');
    assert.equal(state.sprites.spriteCount, 150, 'playground must spawn exactly 150 sprites');
    assert.ok(state.sprites.hitRadius >= 14 && state.sprites.hitRadius <= 24,
      `hitRadius ${state.sprites.hitRadius} should be density-scaled in [14, 24]`);
    assert.equal(state.returnHidden, false, 'return button should be visible on page 1');
    assert.equal(state.page0Inert, true, 'page 0 must become inert when offscreen');
    assert.equal(state.page0AriaHidden, 'true');
    assert.equal(state.page1AriaHidden, 'false');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('multi-modal navigation and return affordances work on desktop', async t => {
  if (!browser) {
    if (process.env.CI) assert.fail('Chromium is not installed in CI');
    t.skip('Chromium is not installed');
    return;
  }
  const { context, page, errors } = await openEngine(browser, { initScript: SEED_SCRIPT });
  try {
    await page.locator('#btnExploreSprites').click();
    await page.waitForTimeout(420);
    assert.equal(await page.evaluate(() => window.__pager.getPosition()), 1);

    await page.locator('#sideScreenReturnBtn').click();
    await page.waitForTimeout(420);
    assert.equal(await page.evaluate(() => window.__pager.getPosition()), 0);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(420);
    assert.equal(await page.evaluate(() => window.__pager.getPosition()), 1);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(420);
    assert.equal(await page.evaluate(() => window.__pager.getPosition()), 0);

    await page.locator('.pager-dot[data-page="1"]').click();
    await page.waitForTimeout(420);
    assert.equal(await page.evaluate(() => window.__pager.getPosition()), 1);

    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('150-sprite playground supports tap ripple, hold supernova, and grab/fling with finite coords', async t => {
  if (!browser) {
    if (process.env.CI) assert.fail('Chromium is not installed in CI');
    t.skip('Chromium is not installed');
    return;
  }
  const { context, page, errors } = await openEngine(browser, { initScript: SEED_SCRIPT });
  try {
    await page.locator('#btnExploreSprites').click();
    await page.waitForTimeout(420);

    const emptyPt = await page.evaluate(() => {
      const snap = window.__sprites.snapshot();
      for (let x = 100; x < 1100; x += 40) {
        for (let y = 100; y < 700; y += 40) {
          if (!snap.positions.some(p => Math.hypot(p.x - x, p.y - y) <= snap.hitRadius + 6)) {
            return { x, y };
          }
        }
      }
      return { x: 600, y: 400 };
    });

    await page.mouse.click(emptyPt.x, emptyPt.y);
    await page.waitForTimeout(50);
    const afterTap = await page.evaluate(() => window.__sprites.snapshot());
    assert.ok(afterTap.ripples >= 1, 'quick tap should spawn a ripple');

    await page.mouse.move(emptyPt.x, emptyPt.y);
    await page.mouse.down();
    await page.waitForTimeout(340);
    await page.mouse.up();
    await page.waitForTimeout(50);

    const spritePt = await page.evaluate(() => window.__sprites.snapshot().positions[0]);
    await page.mouse.move(spritePt.x, spritePt.y);
    await page.mouse.down();
    await page.mouse.move(spritePt.x + 120, spritePt.y - 80, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const finalSnap = await page.evaluate(() => window.__sprites.snapshot());
    assert.equal(finalSnap.spriteCount, 150);
    for (const p of finalSnap.positions) {
      assert.ok(
        Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.vx) && Number.isFinite(p.vy),
        `non-finite sprite state: ${JSON.stringify(p)}`
      );
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
