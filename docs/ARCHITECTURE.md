# PickaBoo Engine v4.1 — Architecture & Creative Computing Specs

The **PickaBoo Engine** is an interactive 2D physics and procedural sound simulation built for the **TeacherEvan** portfolio showcase. It embodies the core philosophy: *"I build things that scale, things that teach, and things that explode."*

Single source of truth: [`docs/index.html`](index.html) · Tests: [`tests/`](../tests/) · Banner pipeline: [`scripts/capture_banner.js`](../scripts/capture_banner.js)

---

## 1. System Architecture

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                            USER INTERACTION                             │
  │     - Desktop: Mouse move & click crosshair reticle                     │
  │     - Mobile: Multi-touch pointer events (touch-action: none)           │
  └───────────────────────┬─────────────────────────┬───────────────────────┘
                          │                         │
                          ▼                         ▼
  ┌────────────────────────────────────┐   ┌──────────────────────────────────┐
  │        POINTER LIFECYCLE            │   │      FIXED-STEP SIMULATION       │
  │  - Map<pointerId, {x, y}>          │   │  - 60 Hz accumulator (PHYS_DT)  │
  │  - pointerleave/blur ⇒ purge stale  │   │  - dt-scaled forces (px/s²)     │
  └────────────────────┬───────────────┘   └───────────────┬──────────────────┘
                       │                                   │
                       ▼                                   ▼
  ┌────────────────────────────────────────────┐  ┌──────────────────────────────┐
  │              AESTHETICS & FEEDBACK          │  │          SIMULATION          │
  │  - Trauma-based camera shake (render only) │  │  - Steering / wander forces  │
  │  - Jitter, shockwave rings, spark trails   │  │  - Exponential damping       │
  │  - Screen shake disabled by reduced motion │  │  - Blast impulse + chaining  │
  └────────────────────────────────────────────┘  └───────────────┬──────────────┘
                                                                │
                                                                ▼
  ┌─────────────────────────────────────┐  ┌────────────────────────────────┐
  │         AUDIO SYNTHESIS             │  │       PARTICLE EXPLOSIONS      │
  │  - Web Audio Stereo Panner          │  │  - Radial velocity impulse     │
  │  - Exponential pitch-sliding beeps  │  │  - Kinetic shockwave rings     │
  │  - Filtered sub-bass thump & noise  │  │  - Cascading chain reactions   │
  └─────────────────────────────────────┘  │  - Global particle ceiling     │
                                           └────────────────────────────────┘
```

---

## 2. Mathematical & Physical Principles

### 2.1 Fixed Timestep & Frame-Rate Independence
Rendering runs on `requestAnimationFrame`; **simulation** runs on a fixed step of $\Delta t = 1/60$ s. A real-time accumulator consumes whole steps and renders the remainder:

$$n_{steps} = \left\lfloor \frac{t_{acc}}{\Delta t} \right\rfloor, \qquad t_{acc} \leftarrow t_{acc} - n_{steps}\Delta t$$

Consequence: the game plays *identically* at 30 Hz, 60 Hz and 120 Hz. Position integration is $\vec{P} \leftarrow \vec{P} + \vec{v}\,\Delta t$ — never per-frame — and damping is expressed exponentially rather than as a per-frame multiplier:

$$e^{-\frac{k}{\Delta t}} \Big|_{\Delta t = 1/60} = e^{-3.72/60} \approx 0.94$$

so the legacy `v *= 0.94` feel is preserved *without* the old frame-rate coupling.

### 2.2 Attraction & Steering Force
Each sprite computes the Euclidean distance $d$ to the closest active pointer:
$$d = \sqrt{(x_{ptr} - x)^2 + (y_{ptr} - y)^2}$$

When $d < R_{detect}$ (380 px), a normalized steering **acceleration** is applied:
$$\vec{a}_{steer} = \left(\frac{\vec{P}_{ptr} - \vec{P}}{d}\right) \cdot \left(\frac{R_{detect} - d}{R_{detect}}\right) \cdot a_{max}, \qquad a_{max} = 2600\ \text{px/s}^2$$

The velocity is clamped to $v_{max} = 720$ px/s, which yields a terminal chase speed of $a_{max}/k \approx 700$ px/s — fast enough to feel eager, slow enough to stay readable.

### 2.3 Cascading Chain Reactions
Upon detonation at $(x_0, y_0)$, an outward blast **impulse** is applied to all active neighbours within blast radius $R_{blast} = 260$ px:
$$\vec{v}_{neighbor} \mathrel{+}= \left(\frac{\vec{P}_{neighbor} - \vec{P}_0}{\|\vec{P}_{neighbor} - \vec{P}_0\|}\right) \cdot \left(1 - \frac{d}{R_{blast}}\right) \cdot F_{impulse}, \qquad F_{impulse} = 900\ \text{px/s}$$

Neighbouring sprites enter an accelerated countdown state ($\tau \le 1.4$ s), initiating a chain-reaction cascade.

### 2.4 Camera Trauma & Screen Shake
Camera shake uses an exponential trauma model ($\sigma \in [0, 1]$):
$$\text{offset}_x = \text{random}(-1, 1) \cdot \sigma^2 \cdot \text{maxShake}$$
$$\text{offset}_y = \text{random}(-1, 1) \cdot \sigma^2 \cdot \text{maxShake}$$

Trauma decays linearly ($\frac{d\sigma}{dt} = -1.5$). The shake is applied **only at render time**, never to the simulation, so it cannot corrupt physics state.

---

## 3. Procedural Web Audio Engine

No external `.mp3` or `.wav` files are loaded. Sound is synthesized mathematically:
1. **Countdown Ticks**: Pure sine wave with exponential frequency ramp based on remaining seconds:
   $$f(t) = 360 + (4 - \lceil t \rceil) \cdot 230\ \text{Hz}$$
2. **Spatial Panning**: Stereo panning calculated from normalized canvas coordinates:
   $$\text{pan} = \frac{2x}{W} - 1 \quad \in [-1, 1]$$
3. **Explosion Transient**: A dual-stage synthesizer combining a sub-bass sine drop ($140\ \text{Hz} \to 28\ \text{Hz}$) with an exponentially decaying low-pass filtered noise burst ($450\ \text{Hz} \to 50\ \text{Hz}$).

---

## 4. Educator Physics Sandbox Mode

Pressing **`D`** or clicking **🎓 Sandbox** overlays:
* **Velocity Vectors**: Rendered in antique gold showing magnitude and heading ($v$ scaled by 0.12 s).
* **Detection Ring**: The 380 px steering radius (indigo, faint).
* **Contact Ring**: The 46 px detonation trigger (gold, dashed).
* **Live Telemetry**: FPS, active particle count, shockwave count and chain multipliers.

---

## 5. Stability, Budgets & Accessibility

| Control | Value | Purpose |
| :--- | :--- | :--- |
| `PHYS_DT` | 1/60 s | Fixed simulation step |
| `MAX_SPEED` | 720 px/s | Hard velocity clamp |
| `MAX_PARTICLES` | 900 | Global particle ceiling — oldest particles are evicted first |
| `DAMPING_K` | 3.7 /s | Exponential velocity decay |
| `GRAVITY` | 500 px/s² | Particle falloff |

* **Pointer lifecycle** — the mouse pointer is dropped on `pointerleave`, `pointerout`, window `blur` and tab hide, so a stale reticle can never keep luring sprites.
* **Finite-state guarantees** — steering divides by $d$; a zero-distance guard (`d > 1e-6`) makes NaN coordinates structurally impossible.
* **Reduced motion** — `prefers-reduced-motion: reduce` (plus a manual **🌀 Motion** toggle) disables camera shake, freezes jitter and scales particle counts to 45 %.
* **Accessible controls** — `aria-pressed` on every toggle, `role="img"` + label on the canvas, visible focus rings, and pinch-zoom left enabled.

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

## 7. Verification

`npm test` runs two suites:

* **`tests/repo.test.js`** — static integrity: single engine file, no retired generators, version consistency across engine/banner/asset/README, README link resolution, GIF/SVG validity, CI wiring.
* **`tests/engine.test.js`** — headless Chromium behaviour: clean boot, countdown arming, detonation counting, NaN guards under pointer overlap, pointer teardown, **frame-rate independence (30 Hz vs 120 Hz)**, particle budget, and HUD toggle state.
