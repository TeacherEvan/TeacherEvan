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
const { chromium } = require('playwright');

const ENGINE_URL = 'file://' + path.resolve(__dirname, '..', 'docs', 'index.html');

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

async function launch() {
  try {
    return await chromium.launch({ args: ['--no-sandbox'] });
  } catch (_) {
    return null;
  }
}

async function openEngine(browser, { initScript } = {}) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  if (initScript) await page.addInitScript(initScript);
  await page.goto(ENGINE_URL);
  await page.waitForTimeout(400);
  return { page, errors };
}

test('engine boots clean and exposes its state', async t => {
  const browser = await launch();
  if (!browser) { t.skip('Chromium is not installed — run: npx playwright install chromium'); return; }
  try {
    const { page, errors } = await openEngine(browser, { initScript: SEED_SCRIPT });
    const snap = await page.evaluate(() => window.__pickaboo.snapshot());
    assert.equal(snap.version, '4.1');
    assert.ok(snap.sprites > 0, 'engine should spawn sprites on load');
    assert.deepEqual(errors, [], `engine produced errors: ${errors.join(' | ')}`);
  } finally {
    await browser.close();
  }
});

test('hovering a sprite arms the countdown and detonation is counted', async t => {
  const browser = await launch();
  if (!browser) { t.skip('Chromium is not installed'); return; }
  try {
    const { page, errors } = await openEngine(browser, { initScript: SEED_SCRIPT });

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
    await browser.close();
  }
});

test('sprite coordinates stay finite under adversarial pointer overlap', async t => {
  const browser = await launch();
  if (!browser) { t.skip('Chromium is not installed'); return; }
  try {
    const { page, errors } = await openEngine(browser, { initScript: SEED_SCRIPT });

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
    await browser.close();
  }
});

test('the pointer is dropped when it leaves the viewport', async t => {
  const browser = await launch();
  if (!browser) { t.skip('Chromium is not installed'); return; }
  try {
    const { page } = await openEngine(browser, { initScript: SEED_SCRIPT });

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
    await browser.close();
  }
});

test('simulation speed is independent of the display refresh rate', async t => {
  const browser = await launch();
  if (!browser) { t.skip('Chromium is not installed'); return; }
  try {
    // Time-to-contact is the metric that matters: a frame-coupled simulation
    // closes the gap to the cursor at a rate proportional to the refresh rate,
    // so the same choreography must take the same wall-clock time everywhere.
    const timeToContact = async (fps) => {
      const { page } = await openEngine(browser, {
        initScript: `${SEED_SCRIPT}\n${rafOverride(1000 / fps)}`
      });
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
      await page.close();
      return elapsed;
    };

    const slow = await timeToContact(30);
    const fast = await timeToContact(120);
    console.log(`      ↳ time-to-contact: ${slow}ms @30fps vs ${fast}ms @120fps`);

    assert.ok(slow !== null && fast !== null, 'the sprite never reached the cursor');
    const ratio = slow / fast;
    assert.ok(ratio > 0.7 && ratio < 1.43,
      `approach speed must not depend on refresh rate, got ${slow}ms @30fps vs ${fast}ms @120fps ` +
      `(ratio ${ratio.toFixed(2)})`);
  } finally {
    await browser.close();
  }
});

test('the particle budget is enforced under sustained chain detonations', async t => {
  const browser = await launch();
  if (!browser) { t.skip('Chromium is not installed'); return; }
  try {
    const { page, errors } = await openEngine(browser, { initScript: SEED_SCRIPT });

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
    await browser.close();
  }
});

test('HUD toggles expose and apply their state', async t => {
  const browser = await launch();
  if (!browser) { t.skip('Chromium is not installed'); return; }
  try {
    const { page, errors } = await openEngine(browser, { initScript: SEED_SCRIPT });

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
    await browser.close();
  }
});
