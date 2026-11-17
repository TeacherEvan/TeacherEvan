# 100-Sprite Interactive Playground v5.0 — Architecture & Creative Computing Specs

The **100-Sprite Interactive Playground** is a real-time 2D physics, particle, and procedural sound showcase built for **TeacherEvan**. It embodies the core philosophy: *"I build things that scale, things that teach, and things that explode."*

Single source of truth: [`docs/index.html`](index.html) + classic `file://`-safe IIFE modules (`docs/js/*.js`) · Tests: [`tests/`](../tests/) · Banner pipeline: [`scripts/capture_banner.js`](../scripts/capture_banner.js)

---

## 1. System Architecture

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                            USER INTERACTION                             │
  │     - Desktop: Mouse drag/fling, tap ripples, hold for supernova        │
  │     - Mobile: Multi-touch pointer events (touch-action: none)           │
  └───────────────────────┬─────────────────────────┬───────────────────────┘
                          │                         │
                          ▼                         ▼
  ┌────────────────────────────────────┐   ┌──────────────────────────────────┐
  │        POINTER LIFECYCLE           │   │      FIXED-STEP SIMULATION       │
  │  - Grab/fling & hold state         │   │  - 60 Hz accumulator             │
  │  - pointerleave/blur/visibility    │   │    (FIXED_DT_SEC = 1/60)         │
  │    purge stale pointers            │   │  - MAX_SUBSTEPS = 4              │
  └────────────────────┬───────────────┘   └───────────────┬──────────────────┘
                       │                                   │
                       ▼                                   ▼
  ┌────────────────────────────────────────────┐  ┌──────────────────────────────┐
  │              AESTHETICS & FEEDBACK         │  │          SIMULATION          │
  │  - Tapered SpriteTrail ring buffers        │  │  - Toroidal boids flocking   │
  │  - Pre-rendered radial glow stamps         │  │  - Spatial hash grid (130px) │
  │  - Educator Telemetry & Physics HUD (D)    │  │  - Sub-stepped grab springs  │
  └────────────────────────────────────────────┘  │  - Singularity / Supernova   │
                                                  └───────────────┬──────────────┘
                                                                  │
                                                                  ▼
  ┌─────────────────────────────────────┐  ┌────────────────────────────────┐
  │         AUDIO SYNTHESIS             │  │       PARTICLE EFFECTS         │
  │  - AmbientSoundscape (Web Audio)    │  │  - Velocity-aligned sparks     │
  │  - 4-oscillator Amaj9 drone pad     │  │    (SpriteSparks pool)         │
  │  - 10-zone pentatonic FM chimes     │  │  - Expanding tap ripples       │
  │  - 8-voice polyphony cap & panning  │  │  - Supernova radial impulse    │
  └─────────────────────────────────────┘  └────────────────────────────────┘
```

---

## 2. Mathematical & Physical Principles

### 2.1 Fixed Timestep & Frame-Rate Independence
Rendering runs on `requestAnimationFrame`; **simulation** runs on a fixed step of $\Delta t = 1/60$ s (`FIXED_DT_SEC`). A real-time accumulator (`_accumulator`) consumes whole steps (capped at `MAX_SUBSTEPS = 4` per frame to prevent spiral-of-death) and renders the remainder:

$$n_{steps} = \min\left(\left\lfloor \frac{t_{acc}}{\Delta t} \right\rfloor,\ \text{MAX\_SUBSTEPS}\right), \qquad t_{acc} \leftarrow t_{acc} - n_{steps}\Delta t$$

Consequence: the simulation plays *identically* at 30 Hz, 60 Hz, and 120 Hz. Position integration and `SpriteTrail` ring-buffer pushes execute at an invariant 60 Hz, and damping is expressed exponentially via `expDecay`:

$$v \leftarrow v \cdot e^{-k \Delta t}$$

### 2.2 Boids Flocking & Spatial Hash Grid
Sprites (`SPRITE_COUNT = 100`) flock across a toroidal canvas (wrapping seamlessly across screen edges). Neighbor queries use a zero-allocation spatial hash grid (`130px` cells) via `forEachNeighbor`, computing separation, alignment, and cohesion forces without per-frame array allocations.

When grabbed, a sprite is driven by a sub-stepped spring (`stepSpringSubstepped`) toward the pointer and released with its fling velocity.

### 2.3 Singularity & Supernova
Holding a pointer in place creates a gravitational singularity that pulls nearby sprites inward. Releasing the hold triggers a radial supernova impulse, scattering sprites outward and emitting velocity-aligned `SpriteSparks`.

### 2.4 Tap Ripples & Tapered Trails
Quick taps spawn expanding concentric ripples. Each sprite maintains a `SpriteTrail` ring buffer (`TRAIL_MAX_SEGMENT = 160px`) pushed once per fixed 60 Hz step, keeping trail length consistent across all refresh rates.

---

## 3. Procedural Web Audio Engine

No external `.mp3` or `.wav` files are loaded. Sound is synthesized mathematically in `docs/js/ambient-soundscape.js`:
1. **Amaj9 Drone Pad**: A 4-oscillator ambient drone pad.
2. **Pentatonic FM Chimes**: 10-zone pentatonic FM chimes (`A3`..`F#5`) with an 8-voice polyphony cap and synchronous `AudioContext.resume()` on user gesture.
3. **Spatial Panning**: Stereo panning calculated from normalized canvas coordinates:
   $$\text{pan} = \frac{2x}{W} - 1 \quad \in [-1, 1]$$

---

## 4. Educator Telemetry & Physics HUD

Pressing **`D`** or clicking **`🎓 HUD`** (`#btnHud`) toggles the interactive Educator Telemetry & Physics HUD, overlaying:
* **Velocity Vectors**: Live heading and magnitude for each sprite.
* **Spatial Partition Grid**: The `130px` spatial hash grid cells.
* **Neighborhood Radii**: Boids interaction radii.
* **Live Telemetry**: Tabular-nums overlay showing FPS, frame time (ms), fixed steps, and active sparks.

Pressing **`T`** toggles between Dark Academia and Light Academia themes (`rethemeParticles()`).

---

## 5. Stability, Budgets & Accessibility

| Control | Value | Purpose |
| :--- | :--- | :--- |
| `FIXED_DT_SEC` | 1/60 s | Fixed simulation step |
| `MAX_SUBSTEPS` | 4 | Spiral-of-death cap per render frame |
| `SPRITE_COUNT` | 100 | Fixed boids population |
| `CELL_SIZE` | 130 px | Spatial hash grid cell size |
| `TRAIL_MAX_SEGMENT` | 160 px | Maximum trail segment length |

* **Pointer lifecycle** — active pointers are cleared on `pointerleave`, `pointerout`, window `blur`, and `visibilitychange` (tab hide), so a stale pointer can never keep luring sprites.
* **Finite-state guarantees** — zero-distance guards prevent `NaN` coordinates under pointer overlap.
* **Reduced motion** — `prefers-reduced-motion: reduce` (plus a manual **🌀 Motion** toggle) scales down motion effects.
* **Accessible controls** — `aria-pressed` on every toggle, `role="img"` + label on the canvas, visible focus rings, `44px` coarse-pointer touch targets, and pinch-zoom left enabled.

---

## 6. Asset Pipeline

```
scripts/banner.html ──(deterministic __renderFrame(t))──▶ 150 PNG frames
        │                                                          │
        │ scripts/capture_banner.js (Playwright)                 │
        ▼                                                          ▼
   assets/pickaboo-banner.svg ◀── hand-authored vector banner   FFmpeg palettegen/paletteuse
                                                                   ▼
                                                    assets/pickaboo-loop.gif (800px, 20 fps, looping)
```

The Playwright renderer is the **only** generator of `assets/pickaboo-loop.gif`; the encoded artifact is inspected (dimensions, frame count, loop flag, size) before the script reports success.

---

## 7. Direct 100-Sprite Playground (v5.0)

* **Direct Fullscreen Playground (`docs/index.html`):** Boots straight into the 100-sprite canvas with perceptual `oklch()` Dark Academia chrome, tabular counters, `any-pointer: coarse` 44px touch targets, and `prefers-reduced-motion` support.
* **100-Sprite Boids (`docs/js/sprite-engine.js`):** Hardcoded `SPRITE_COUNT = 100` with continuous delta-time exponential damping (`expDecay`), sub-stepped grab springs (`stepSpringSubstepped`), pre-rendered radial glow stamps, cached nebula backdrop, zero-allocation `forEachNeighbor` spatial grid visitor (`130px` cells), deduplicated constellation lines (`p1.id < p2.id`, capped at `4` links per sprite), tapered `SpriteTrail` ring buffers (`TRAIL_MAX_SEGMENT = 160px`), and velocity-aligned `SpriteSparks`.
* **Procedural Pentatonic Soundscape (`docs/js/ambient-soundscape.js`):** 4-oscillator Amaj9 drone pad + 10-zone pentatonic FM chimes (`A3`..`F#5`) with stereo panning and synchronous `AudioContext.resume()` on user gesture.

---

## 8. Verification

`npm test` runs two suites:

* **`tests/repo.test.js`** — static integrity: single engine file, no retired generators, version consistency across engine/banner/asset/README, README link resolution, GIF/SVG validity, CI wiring.
* **`tests/engine.test.js`** — headless Chromium behaviour: clean boot, countdown arming, detonation counting, NaN guards under pointer overlap, pointer teardown, **frame-rate independence (30 Hz vs 120 Hz)**, particle budget, and HUD toggle state.
