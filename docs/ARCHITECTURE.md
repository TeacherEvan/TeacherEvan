# PickaBoo Engine v4.0 — Architecture & Creative Computing Specs

The **PickaBoo Engine** is an interactive 2D physics and procedural sound simulation built for the **TeacherEvan** portfolio showcase. It embodies the core philosophy: *"I build things that scale, things that teach, and things that explode."*

---

## 1. System Architecture

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                            USER INTERACTION                             │
  │     - Desktop: Mouse move & click crosshair reticle                     │
  │     - Mobile: Multi-touch pointer events (touch-action: none)           │
  └────────────────────────────────────┬────────────────────────────────────┘
                                       │
                                       ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                      PHYSICS & STEERING LOOP (60 FPS)                   │
  │   - Attraction vector: F = ((R_max - dist) / R_max) * Strength          │
  │   - Boids-style damping: v *= 0.94 + periodic wave wandering            │
  │   - Boundary reflections: -0.85 restitution coefficient                 │
  └───────────────────┬─────────────────────────────────┬───────────────────┘
                      │                                 │
                      ▼                                 ▼
  ┌─────────────────────────────────────┐  ┌────────────────────────────────┐
  │         AUDIO SYNTHESIS             │  │       PARTICLE EXPLOSIONS      │
  │  - Web Audio Stereo Panner          │  │  - Radial velocity impulse     │
  │  - Exponential pitch-sliding beeps  │  │  - Kinetic shockwave rings     │
  │  - Filtered sub-bass thump & noise  │  │  - Cascading chain reactions   │
  └─────────────────────────────────────┘  └────────────────────────────────┘
```

---

## 2. Mathematical & Physical Principles

### 2.1 Attraction & Steering Force
Each sprite computes the Euclidean distance $d$ to the closest active pointer:
$$d = \sqrt{(x_{ptr} - x)^2 + (y_{ptr} - y)^2}$$

When $d < R_{detect}$ (default 380px), a normalized steering impulse is applied:
$$\vec{F}_{steer} = \left(\frac{\vec{P}_{ptr} - \vec{P}}{d}\right) \cdot \left(\frac{R_{detect} - d}{R_{detect}}\right) \cdot k_{force}$$

### 2.2 Cascading Chain Reactions
Upon detonation at $(x_0, y_0)$, an outward blast impulse is applied to all active neighbors within blast radius $R_{blast} = 260$px:
$$\vec{v}_{neighbor} \mathrel{+}= \left(\frac{\vec{P}_{neighbor} - \vec{P}_0}{\|\vec{P}_{neighbor} - \vec{P}_0\|}\right) \cdot \left(1 - \frac{d}{R_{blast}}\right) \cdot F_{impulse}$$

Neighboring sprites enter an accelerated countdown state ($\tau \le 1.4$s), initiating a chain reaction cascade.

### 2.3 Camera Trauma & Screen Shake
Camera shake uses an exponential trauma model ($trauma \in [0, 1]$):
$$\text{offset}_x = \text{random}(-1, 1) \cdot trauma^2 \cdot \text{maxShake}$$
$$\text{offset}_y = \text{random}(-1, 1) \cdot trauma^2 \cdot \text{maxShake}$$

Trauma decays linearly with time ($\frac{d(trauma)}{dt} = -1.5$), creating sharp impacts with smooth dissipation.

---

## 3. Procedural Web Audio Engine

No external `.mp3` or `.wav` files are loaded. Sound is synthesized mathematically:
1. **Countdown Ticks**: Pure sine wave with exponential frequency ramp based on remaining seconds:
   $$f(t) = 360 + (4 - \lceil t \rceil) \cdot 230 \text{ Hz}$$
2. **Spatial Panning**: Stereo panning calculated from normalized canvas coordinates:
   $$\text{pan} = \frac{2x}{W} - 1 \quad \in [-1, 1]$$
3. **Explosion Transient**: A dual-stage synthesizer combining a sub-bass sine drop ($140\text{ Hz} \to 28\text{ Hz}$) with an exponentially decaying low-pass filtered noise burst ($450\text{ Hz} \to 50\text{ Hz}$).

---

## 4. Educator Physics Sandbox Mode

Pressing **`D`** or clicking **🎓 Sandbox** overlays:
* **Velocity Vectors**: Rendered in antique gold showing magnitude and heading.
* **Proximity Rings**: Visualizing detection thresholds ($d = 46$px contact, $d = 380$px attraction).
* **Live Telemetry**: FPS, active particle count, shockwave count, and chain multipliers.
