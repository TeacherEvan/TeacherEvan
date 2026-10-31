# Cumulative Project Recommendations

**Project:** PickaBoo Engine v4.1 (`TeacherEvan/teacherevan-profile`)  
**Last Updated:** 2026-10-22  

---

## Remediated Architecture & Pipeline Items

1. **[RESOLVED] Safe Resource Lifecycle in Banner Capture**
   - **Target:** `scripts/capture_banner.js`
   - **Remediation:** Enclosed execution in `try ... finally` block ensuring `browser.close()` and temporary frames directory removal (`fs.rmSync(FRAMES_DIR, { recursive: true, force: true })`). Replaced `execSync` with `execFileSync`.

2. **[RESOLVED] Browser Process Pooling & Hard CI Gate**
   - **Target:** `tests/engine.test.js`
   - **Remediation:** Shared a single Chromium instance across tests using `test.before` and `test.after`, isolated pages using `browser.newContext()`, and enforced hard failures on launch failure in CI environments (`process.env.CI`).

3. **[RESOLVED] Canvas Rendering & DataURL Optimization**
   - **Target:** `scripts/banner.html`
   - **Remediation:** Removed redundant per-frame `toDataURL` Base64 serializations and replaced two-stop identical gradient allocations with flat fill styles.

4. **[RESOLVED] Structural GIF Binary Parsing**
   - **Target:** `scripts/lib/gif.js`
   - **Remediation:** Added structural length checks and block termination byte guards for GCE (`0x21 0xF9 0x04 ... 0x00`) and Application Extension Netscape loop signatures.

---

## Future High-Leverage Improvements

1. **Deterministic Frame Hash Visual Regression Test**
   - **Priority:** Medium
   - **Effort:** 0.5 day
   - **Specification:** Add a test verifying MD5/SHA256 pixel hashes for predetermined frames (e.g. frame 0, 75, 149) in `scripts/banner.html` to prevent accidental choreography regressions during palette updates.

2. **Telemetry Performance Benchmark Endpoint**
   - **Priority:** Low
   - **Effort:** 1 day
   - **Specification:** Expose a telemetry export method `window.__pickaboo.getMetrics()` returning frame-time histograms, particle counts, and memory allocations for automated perf benchmarking in headless CI.
