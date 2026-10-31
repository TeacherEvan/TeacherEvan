# Surgical Investigation Notes: teacherevan-profile (PickaBoo Engine v4.1)

**Date:** 2026-10-22  
**Role:** Project Manager  
**Mode:** Project-Manager (Direct Build & Remediation)  
**Target:** PickaBoo Engine v4.1 & Banner Asset Pipeline  

---

## 1. Context & Discrepancy Analysis

The user investigated why the "engineering notes" banner/game differed from or was not as comprehensive as the primary live engine showcased in the README.

### Comparison
- **Top Banner & Live Engine (`assets/pickaboo-loop.gif`, `docs/index.html`):**
  Full interactive HTML5 Canvas engine featuring Mulberry32 deterministic PRNG, spatial Web Audio synthesis, camera trauma shake, cascading chain-reaction explosions, multi-pointer tracking, and 60Hz fixed-timestep physics.
- **Engineering Notes Banner (`assets/pickaboo-banner.svg`):**
  A vector SVG banner powered exclusively by CSS keyframe animations. It is non-interactive and features a fixed single-sprite loop at coordinate (580, 120), hardcoded sparks, and 2 ambient roamers. It serves as an accessible, lightweight vector illustration for GitHub profiles where scripts and interactive canvas are blocked by GitHub's Camo sanitizer.

---

## 2. Audit Findings & Remediations Built

### P0 (Critical): Lifecycle & Temp Directory Cleanup in `scripts/capture_banner.js`
- **Issue:** `FRAMES_DIR` and browser launch were uncontained outside a `try/finally` block; execution errors orphaned `/tmp/pb_capture_*` frames and Chromium processes. Command execution interpolated file paths into shell strings.
- **Fix:**
  - Removed unused `PALETTE` constant.
  - Replaced shell string `execSync` with safe `execFileSync('ffmpeg', [...])`.
  - Used `pathToFileURL` for cross-platform file paths.
  - Wrapped capture and encode pipeline in `try ... finally` guaranteeing `browser.close()` and `fs.rmSync(FRAMES_DIR, { recursive: true, force: true })`.

### P1 (High): Browser Pooling & CI Failure Enforcement in `tests/engine.test.js`
- **Issue:** 7 separate browser launches created massive spawn overhead. Swallowing launch errors led to silent `t.skip()` in CI without verifying engine behaviour.
- **Fix:**
  - Shared a single Chromium instance across the suite using `test.before` and `test.after`.
  - Isolated tests with `browser.newContext()` and per-test cleanup.
  - Added strict assertion failures when `process.env.CI` is active instead of skipping.
  - Adopted `pathToFileURL` from `node:url` for cross-platform RFC 8089 paths.

### P1 (High): Render Allocation Overhead & Redundant Serialization in `scripts/banner.html`
- **Issue:** `window.__renderFrame(t)` called `canvas.toDataURL('image/png')` needlessly on every tick and frame during both capture and live playback. `drawGhost()` created redundant linear gradients where color stops were identical.
- **Fix:**
  - Removed unused `canvas.toDataURL('image/png')` return from `__renderFrame`.
  - Replaced two-stop identical `createLinearGradient` with `ctx.fillStyle = col;`.

### P1 (High): Structural GIF Inspector in `scripts/lib/gif.js`
- **Issue:** Naive 2-byte scanning for `0x21 0xf9` and `0x21 0xff` across raw LZW payload risked false positives.
- **Fix:**
  - Enforced structural GCE verification: `buf[i] === 0x21 && buf[i + 1] === 0xf9 && buf[i + 2] === 0x04 && buf[i + 7] === 0x00`.
  - Verified Application Extension block length (`0x0b`) and `NETSCAPE2.0` / `ANIMEXTS1.0` signatures.

---

## 3. Verification Results
- All 17 node:test tests pass cleanly.
- `npm run build:gif` captures 150 frames, encodes via FFmpeg with optimized Lanczos/Bayer palette pipeline, and validates output GIF integrity (800x267, 120 frames, looping).
