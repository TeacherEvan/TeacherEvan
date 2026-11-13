(function (root) {
    'use strict';

    const { SPRITE_PALETTES, hexToRgbChannels } = root.TeacherEvan.SpritePalette;
    const { SpriteTrail, TRAIL_CAPACITY, TRAIL_MAX_SEGMENT } = root.TeacherEvan.SpriteTrail;
    const { SpriteSparks } = root.TeacherEvan.SpriteSparks;

    const SPRITE_COUNT = 100;
    const TAP_SLOP_PX = 14;
    const NOTE_ZONES = 10;
    const GRAB_SCALE = 1.75;
    const MAX_CONNECTIONS_PER_SPRITE = 4;
    const MAX_FRAME_DT_SEC = 0.05; // 20 fps floor to avoid huge jumps on tab resume
    const SPRING_SUB_DT_SEC = 0.00833; // 120 Hz precision ceiling

    function hueForX(x, width) {
        if (!(width > 0)) return 0;
        const zone = Math.min(NOTE_ZONES - 1, Math.max(0, Math.floor((x / width) * NOTE_ZONES)));
        return Math.round((zone / (NOTE_ZONES - 1)) * 300);
    }

    function expDecay(current, target, decay, dt) {
        const safeDt = Math.max(dt, 0);
        return target + (current - target) * Math.exp(-decay * safeDt);
    }

    function stepSpringSubstepped(pos, vel, target, stiffness, damping, dt) {
        const safeDt = Math.min(Math.max(dt, 0), MAX_FRAME_DT_SEC);
        const steps = Math.max(1, Math.ceil(safeDt / SPRING_SUB_DT_SEC));
        const subDt = safeDt / steps;

        for (let i = 0; i < steps; i++) {
            const accel = -stiffness * (pos - target) - damping * vel;
            vel += accel * subDt;
            pos += vel * subDt;
        }

        if (Math.abs(pos - target) < 0.001 && Math.abs(vel) < 0.005) {
            return [target, 0];
        }
        return [pos, vel];
    }

    class SpritePlayground {
        /**
         * @param {HTMLCanvasElement} canvas
         */
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
            this.particles = [];
            this.particleCount = SPRITE_COUNT;
            this.animationFrameId = null;
            this.isPaused = true;
            this.lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
            this.elapsedTime = 0;
            this.partitionCellSize = 130;
            this.spatialGrid = [];
            this.gridCols = 0;
            this.gridRows = 0;
            this.connectionCounts = new Uint8Array(SPRITE_COUNT);
            this.mousePosition = { x: -1000, y: -1000 };
            this.mouseInfluenceRadius = 185;
            this.connectionDistance = 148;
            this.particleTypes = ['circle', 'square', 'triangle', 'diamond'];
            this.colorPalette = SPRITE_PALETTES;
            this.constellationInk = { light: '10, 109, 149', dark: '0, 240, 255' };

            this._glowCache = new Map();
            this._backdropCanvas = null;
            this._backdropTheme = null;
            this._backdropW = 0;
            this._backdropH = 0;
            this._singularityEmitCarry = 0;

            this.activePointers = new Map();
            this.grabbedSprites = new Map();
            this.ripples = [];
            this.sparks = new SpriteSparks();
            this.reducedMotion = Boolean(
                typeof window !== 'undefined' &&
                    typeof window.matchMedia === 'function' &&
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches
            );
            this.onInteractionCallback = null;

            this.resize();
            this.createParticles();
            this.bindEvents();
        }

        bindEvents() {
            this._onResize = () => this.handleViewportResize();
            this._onMouseLeave = () => this.handleMouseLeave();
            this._onPointerDown = (e) => this.handlePointerDown(e);
            this._onPointerMove = (e) => this.handlePointerMove(e);
            this._onPointerUp = (e) => this.handlePointerUp(e);
            this._onBlur = () => this.clearActivePointers();

            window.addEventListener('resize', this._onResize);
            window.addEventListener('blur', this._onBlur);
            this.canvas.addEventListener('mouseleave', this._onMouseLeave);
            this.canvas.addEventListener('pointerleave', this._onMouseLeave);
            this.canvas.addEventListener('pointerdown', this._onPointerDown);
            window.addEventListener('pointermove', this._onPointerMove, { passive: true });
            window.addEventListener('pointerup', this._onPointerUp);
            window.addEventListener('pointercancel', this._onPointerUp);
        }

        clearActivePointers() {
            for (const grab of this.grabbedSprites.values()) {
                grab.particle.isGrabbed = false;
                grab.particle.trail.clear();
            }
            this.grabbedSprites.clear();
            this.activePointers.clear();
            this.handleMouseLeave();
        }

        resize() {
            const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
            const dpr = Math.min(Math.max(rawDpr, 1), 2);
            const w = window.innerWidth || 800;
            const h = window.innerHeight || 600;
            this.dpr = dpr;
            this.canvas.width = Math.round(w * dpr);
            this.canvas.height = Math.round(h * dpr);
            this.canvas.style.width = w + 'px';
            this.canvas.style.height = h + 'px';
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.logicalWidth = w;
            this.logicalHeight = h;
            this._rebuildBackdropCache();
            this.initializeSpatialPartitioning();
        }

        _rebuildBackdropCache() {
            if (typeof document === 'undefined') return;
            const w = Math.max(1, Math.round(this.logicalWidth));
            const h = Math.max(1, Math.round(this.logicalHeight));
            const dark = this.isDarkTheme();

            if (!this._backdropCanvas) {
                this._backdropCanvas = document.createElement('canvas');
            }
            this._backdropCanvas.width = w;
            this._backdropCanvas.height = h;
            this._backdropW = w;
            this._backdropH = h;
            this._backdropTheme = dark ? 'dark' : 'light';

            const bctx = this._backdropCanvas.getContext('2d');
            if (!bctx) return;

            bctx.fillStyle = dark ? '#0e0c16' : '#f4f1ff';
            bctx.fillRect(0, 0, w, h);

            // Soft layered cosmic nebula wash computed once per resize (zero per-frame gradient cost)
            const radius = Math.max(w, h) * 0.72;
            const g1 = bctx.createRadialGradient(w * 0.36, h * 0.42, 0, w * 0.36, h * 0.42, radius);
            if (dark) {
                g1.addColorStop(0, 'rgba(91, 33, 182, 0.16)');
                g1.addColorStop(0.55, 'rgba(30, 27, 75, 0.08)');
                g1.addColorStop(1, 'rgba(14, 12, 22, 0)');
            } else {
                g1.addColorStop(0, 'rgba(167, 139, 250, 0.18)');
                g1.addColorStop(1, 'rgba(244, 241, 255, 0)');
            }
            bctx.fillStyle = g1;
            bctx.fillRect(0, 0, w, h);

            const g2 = bctx.createRadialGradient(w * 0.72, h * 0.62, 0, w * 0.72, h * 0.62, radius * 0.85);
            if (dark) {
                g2.addColorStop(0, 'rgba(0, 180, 216, 0.09)');
                g2.addColorStop(1, 'rgba(14, 12, 22, 0)');
            } else {
                g2.addColorStop(0, 'rgba(14, 165, 233, 0.10)');
                g2.addColorStop(1, 'rgba(244, 241, 255, 0)');
            }
            bctx.fillStyle = g2;
            bctx.fillRect(0, 0, w, h);
        }

        _getGlowStamp(color, rgb) {
            let stamp = this._glowCache.get(color);
            if (stamp) return stamp;
            if (typeof document === 'undefined') return null;

            const size = 48;
            const half = size / 2;
            stamp = document.createElement('canvas');
            stamp.width = size;
            stamp.height = size;
            const gctx = stamp.getContext('2d');
            if (gctx) {
                const grad = gctx.createRadialGradient(half, half, 0, half, half, half);
                grad.addColorStop(0, `rgba(${rgb}, 0.65)`);
                grad.addColorStop(0.32, `rgba(${rgb}, 0.24)`);
                grad.addColorStop(0.7, `rgba(${rgb}, 0.05)`);
                grad.addColorStop(1, `rgba(${rgb}, 0)`);
                gctx.fillStyle = grad;
                gctx.fillRect(0, 0, size, size);
            }
            this._glowCache.set(color, stamp);
            return stamp;
        }

        clearAllParticleTrails() {
            for (let i = 0; i < this.particles.length; i++) {
                this.particles[i].trail.clear();
            }
        }

        handleViewportResize() {
            this.clearAllParticleTrails();
            this.resize();
            for (let i = 0; i < this.particles.length; i++) {
                this.wrapParticleIntoViewport(this.particles[i]);
            }
        }

        initializeSpatialPartitioning() {
            this.gridCols = Math.max(1, Math.ceil(this.logicalWidth / this.partitionCellSize));
            this.gridRows = Math.max(1, Math.ceil(this.logicalHeight / this.partitionCellSize));
            this.spatialGrid = Array.from({ length: this.gridRows }, () =>
                Array.from({ length: this.gridCols }, () => [])
            );
        }

        updateSpatialPartitionGrid() {
            for (let r = 0; r < this.gridRows; r++) {
                const row = this.spatialGrid[r];
                for (let c = 0; c < this.gridCols; c++) {
                    row[c].length = 0;
                }
            }

            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                const gx = Math.max(0, Math.min(this.gridCols - 1, Math.floor(p.x / this.partitionCellSize)));
                const gy = Math.max(0, Math.min(this.gridRows - 1, Math.floor(p.y / this.partitionCellSize)));
                this.spatialGrid[gy][gx].push(p);
            }
        }

        /** Zero-allocation spatial neighbor visitor. */
        forEachNeighbor(particle, visitor) {
            const gx = Math.max(0, Math.min(this.gridCols - 1, Math.floor(particle.x / this.partitionCellSize)));
            const gy = Math.max(0, Math.min(this.gridRows - 1, Math.floor(particle.y / this.partitionCellSize)));

            for (let dy = -1; dy <= 1; dy++) {
                const ny = gy + dy;
                if (ny < 0 || ny >= this.gridRows) continue;
                const row = this.spatialGrid[ny];
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = gx + dx;
                    if (nx < 0 || nx >= this.gridCols) continue;
                    const cell = row[nx];
                    for (let k = 0; k < cell.length; k++) {
                        const other = cell[k];
                        if (other !== particle) {
                            visitor(other);
                        }
                    }
                }
            }
        }

        isDarkTheme() {
            return document.documentElement.getAttribute('data-theme') !== 'light';
        }

        createSingleParticle(id) {
            const palette = this.colorPalette[this.isDarkTheme() ? 'dark' : 'light'];
            const colorSet = palette[id % palette.length];
            const variant = Math.random();
            let color = colorSet.accent;
            if (variant < 0.45) color = colorSet.primary;
            else if (variant < 0.75) color = colorSet.secondary;

            const rgb = hexToRgbChannels(color);
            const depth = 0.78 + Math.random() * 0.44;
            const baseSize = (2.4 + Math.random() * 2.4) * depth;
            const angle = Math.random() * Math.PI * 2;
            const initialSpeed = 0.45 + Math.random() * 0.95;

            return {
                id,
                x: Math.random() * this.logicalWidth,
                y: Math.random() * this.logicalHeight,
                vx: Math.cos(angle) * initialSpeed,
                vy: Math.sin(angle) * initialSpeed,
                heading: angle,
                depth,
                color,
                rgb,
                size: baseSize,
                baseSize,
                type: this.particleTypes[id % this.particleTypes.length],
                neighborhoodRadius: 125,
                maxSpeed: 1.95 * (0.85 + 0.15 * depth),
                maxForce: 0.045,
                trail: new SpriteTrail(TRAIL_CAPACITY),
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: 1.3 + Math.random() * 1.8, // radians / sec
                pop: 1,
                popV: 0,
                energy: 0, // [0..1] flash from ripples / fling / supernova
                isGrabbed: false,
            };
        }

        createParticles() {
            this.particles.length = 0;
            for (let i = 0; i < SPRITE_COUNT; i++) {
                this.particles.push(this.createSingleParticle(i));
            }
        }

        applyFlockingBehavior(particle, dt) {
            const dtScale = dt * 60;
            let sepX = 0;
            let sepY = 0;
            let alignX = 0;
            let alignY = 0;
            let cohX = 0;
            let cohY = 0;
            let neighborCount = 0;
            const maxDistSq = particle.neighborhoodRadius * particle.neighborhoodRadius;

            this.forEachNeighbor(particle, (other) => {
                const dx = other.x - particle.x;
                const dy = other.y - particle.y;
                const distSq = dx * dx + dy * dy;
                if (distSq < maxDistSq && distSq > 1e-4) {
                    neighborCount++;
                    const dist = Math.sqrt(distSq);
                    if (dist < 34) {
                        const factor = (34 - dist) / (34 * dist);
                        sepX -= dx * factor * 18;
                        sepY -= dy * factor * 18;
                    }
                    alignX += other.vx;
                    alignY += other.vy;
                    cohX += other.x;
                    cohY += other.y;
                }
            });

            // Passive hover repulsion only when no pointer is pressed/grabbed (prevents singularity fight)
            if (this.activePointers.size === 0 && this.grabbedSprites.size === 0) {
                const mouseDx = this.mousePosition.x - particle.x;
                const mouseDy = this.mousePosition.y - particle.y;
                const mouseDistSq = mouseDx * mouseDx + mouseDy * mouseDy;
                const mouseRadiusSq = this.mouseInfluenceRadius * this.mouseInfluenceRadius;

                if (mouseDistSq < mouseRadiusSq && mouseDistSq > 1e-4) {
                    const mouseDist = Math.sqrt(mouseDistSq);
                    const influence = 1 - mouseDist / this.mouseInfluenceRadius;
                    const push = influence * influence * 0.48 * dtScale;
                    particle.vx -= (mouseDx / mouseDist) * push;
                    particle.vy -= (mouseDy / mouseDist) * push;
                }
            }

            if (neighborCount > 0) {
                alignX /= neighborCount;
                alignY /= neighborCount;
                cohX = cohX / neighborCount - particle.x;
                cohY = cohY / neighborCount - particle.y;
            }

            const forceScale = particle.maxForce * dtScale;
            particle.vx += sepX * 1.45 * forceScale;
            particle.vy += sepY * 1.45 * forceScale;
            particle.vx += alignX * 0.08 * forceScale;
            particle.vy += alignY * 0.08 * forceScale;
            particle.vx += cohX * 0.008 * forceScale;
            particle.vy += cohY * 0.008 * forceScale;

            // Gentle swirl wander so sprites never stall completely
            const wanderAngle = this.elapsedTime * 0.45 + particle.id * 0.71;
            particle.vx += Math.cos(wanderAngle) * 0.014 * dtScale;
            particle.vy += Math.sin(wanderAngle) * 0.014 * dtScale;

            // Smooth exponential decay of excess kinetic speed (preserves fling/supernova impulses!)
            const speed = Math.hypot(particle.vx, particle.vy);
            if (speed > particle.maxSpeed) {
                const targetSpeed = expDecay(speed, particle.maxSpeed, 2.75, dt);
                const ratio = targetSpeed / speed;
                particle.vx *= ratio;
                particle.vy *= ratio;
                particle.energy = Math.min(1, Math.max(particle.energy, (speed - particle.maxSpeed) / 7));
            } else if (speed < 0.35 && speed > 1e-5) {
                const boost = expDecay(speed, 0.55, 2.0, dt) / speed;
                particle.vx *= boost;
                particle.vy *= boost;
            }
        }

        updateParticlePositions(dt = 1 / 60) {
            const safeDt = Math.max(0.001, Math.min(MAX_FRAME_DT_SEC, dt));
            const dtScale = safeDt * 60;
            this.elapsedTime += safeDt;

            this.updateSpatialPartitionGrid();

            const nowTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
            this._singularityEmitCarry += safeDt;
            const emitSingularSparks = this._singularityEmitCarry >= 0.042;
            if (emitSingularSparks) this._singularityEmitCarry %= 0.042;

            for (const ptr of this.activePointers.values()) {
                const heldDuration = nowTime - ptr.startTime;
                const travelled = Math.hypot(
                    ptr.x - (ptr.startX ?? ptr.x),
                    ptr.y - (ptr.startY ?? ptr.y)
                );
                if (!ptr.isSingularity && heldDuration >= 280 && travelled <= TAP_SLOP_PX) {
                    ptr.isSingularity = true;
                    this.notifyInteraction({ type: 'singularity_start', x: ptr.x, y: ptr.y });
                }
                if (ptr.isSingularity && emitSingularSparks) {
                    const angle = Math.random() * Math.PI * 2;
                    const spawnDist = 36 + Math.random() * 72;
                    this.emitSparks(
                        ptr.x + Math.cos(angle) * spawnDist,
                        ptr.y + Math.sin(angle) * spawnDist,
                        this.noteInk(ptr.x),
                        {
                            count: 2,
                            speed: 1.4,
                            sizeScale: 1.05,
                            driftX: -Math.cos(angle) * 2.1 - Math.sin(angle) * 1.4,
                            driftY: -Math.sin(angle) * 2.1 + Math.cos(angle) * 1.4,
                        }
                    );
                }
            }

            for (let i = 0; i < this.particles.length; i++) {
                const particle = this.particles[i];
                this.advancePop(particle, safeDt);
                particle.energy = expDecay(particle.energy, 0, 3.6, safeDt);

                if (particle.isGrabbed) {
                    particle.trail.clear();
                    particle.energy = 1;
                    continue;
                }

                particle.trail.push(particle.x, particle.y);
                this.applyFlockingBehavior(particle, safeDt);

                for (const ptr of this.activePointers.values()) {
                    const dx = ptr.x - particle.x;
                    const dy = ptr.y - particle.y;
                    const dist = Math.hypot(dx, dy);

                    if (ptr.isSingularity) {
                        if (dist > 10) {
                            const pull = Math.min(2.6, 420 / (dist + 55)) * dtScale;
                            const nx = dx / dist;
                            const ny = dy / dist;
                            const tangentX = -ny;
                            const tangentY = nx;
                            particle.vx += nx * pull * 0.14 + tangentX * pull * 0.20;
                            particle.vy += ny * pull * 0.14 + tangentY * pull * 0.20;
                            if (dist < 140) {
                                particle.energy = Math.min(1, particle.energy + 0.08 * dtScale);
                            }
                        }
                    } else if (dist < 250 && dist > 20) {
                        const nx = dx / dist;
                        const ny = dy / dist;
                        const tangentX = -ny;
                        const tangentY = nx;
                        particle.vx += (tangentX * 0.36 + nx * 0.14) * dtScale;
                        particle.vy += (tangentY * 0.36 + ny * 0.14) * dtScale;
                    }
                }

                for (let rIdx = 0; rIdx < this.ripples.length; rIdx++) {
                    const ripple = this.ripples[rIdx];
                    const dx = particle.x - ripple.x;
                    const dy = particle.y - ripple.y;
                    const dist = Math.hypot(dx, dy);
                    if (Math.abs(dist - ripple.radius) < 32 && dist > 1e-4) {
                        const push = 1.9 * Math.max(0, 1 - (ripple.t ?? 0)) * dtScale;
                        particle.vx += (dx / dist) * push;
                        particle.vy += (dy / dist) * push;
                        particle.energy = Math.min(1, particle.energy + 0.25 * dtScale);
                    }
                }

                particle.x += particle.vx * dtScale;
                particle.y += particle.vy * dtScale;

                // Smooth heading interpolation so fast directional turns don't snap
                const speed = Math.hypot(particle.vx, particle.vy);
                if (speed > 0.2) {
                    const targetHeading = Math.atan2(particle.vy, particle.vx);
                    let diff = targetHeading - particle.heading;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    particle.heading += diff * (1 - Math.exp(-14 * safeDt));
                }

                particle.pulsePhase += particle.pulseSpeed * safeDt;
                const breath = this.reducedMotion ? 1 : 0.86 + 0.16 * Math.sin(particle.pulsePhase);
                particle.size = particle.baseSize * breath;

                if (this.wrapParticleIntoViewport(particle)) {
                    particle.trail.clear();
                }
            }

            for (let i = this.ripples.length - 1; i >= 0; i--) {
                const r = this.ripples[i];
                r.t = (r.t ?? 0) + safeDt * 1.75; // ~0.57s lifetime at every refresh rate
                const t = Math.min(1, r.t);
                const eased = 1 - Math.pow(1 - t, 3);
                r.radius = 4 + (r.maxRadius - 4) * eased;
                r.alpha = (r.baseAlpha ?? 0.85) * Math.pow(1 - t, 1.55);
                if (r.t >= 1 || r.alpha <= 0.005) {
                    this.ripples.splice(i, 1);
                }
            }

            this.sparks.update(safeDt);
        }

        advancePop(particle, dt = 1 / 60) {
            if (this.reducedMotion) {
                particle.pop = particle.isGrabbed ? 1.35 : 1;
                particle.popV = 0;
                return;
            }
            const target = particle.isGrabbed ? GRAB_SCALE : 1;
            const [nextPop, nextVel] = stepSpringSubstepped(
                particle.pop,
                particle.popV || 0,
                target,
                380,
                25,
                dt
            );
            particle.pop = Math.max(0.2, nextPop);
            particle.popV = nextVel;
        }

        noteInk(x, alpha = 1) {
            const hue = hueForX(x, this.logicalWidth);
            const lightness = this.isDarkTheme() ? 68 : 42;
            return `hsla(${hue}, 100%, ${lightness}%, ${alpha})`;
        }

        emitSparks(x, y, color, opts) {
            const capRatio = this.reducedMotion ? 0.4 : 1;
            const scaledOpts = opts && opts.count
                ? Object.assign({}, opts, { count: Math.max(1, Math.round(opts.count * capRatio)) })
                : opts;
            this.sparks.burst(x, y, color, scaledOpts);
        }

        wrapParticleIntoViewport(particle) {
            const width = this.logicalWidth;
            const height = this.logicalHeight;
            if (!(width > 0) || !(height > 0)) return false;

            let wrapped = false;
            if (particle.x < 0) {
                particle.x += width;
                wrapped = true;
            } else if (particle.x > width) {
                particle.x -= width;
                wrapped = true;
            }
            if (particle.y < 0) {
                particle.y += height;
                wrapped = true;
            } else if (particle.y > height) {
                particle.y -= height;
                wrapped = true;
            }

            if (particle.x < 0 || particle.x > width)
                particle.x = Math.max(0, Math.min(width, particle.x));
            if (particle.y < 0 || particle.y > height)
                particle.y = Math.max(0, Math.min(height, particle.y));

            return wrapped;
        }

        handleMouseLeave() {
            this.mousePosition.x = -1000;
            this.mousePosition.y = -1000;
        }

        onInteraction(callback) {
            this.onInteractionCallback = callback;
        }

        notifyInteraction(event) {
            if (typeof this.onInteractionCallback === 'function') {
                this.onInteractionCallback(event);
            }
        }

        computeHitRadius(pointerType = 'mouse') {
            const area = Math.max(1, this.logicalWidth * this.logicalHeight);
            const base = Math.max(14, Math.min(22, Math.sqrt(area / (SPRITE_COUNT * 24))));
            return pointerType === 'touch' ? Math.min(30, base * 1.3) : base;
        }

        hitTestSprite(clientX, clientY, pointerType = 'mouse') {
            if (!this.canvas) return null;
            const rect = this.canvas.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;
            const hitRadius = this.computeHitRadius(pointerType);
            const hitRadiusSq = hitRadius * hitRadius;

            let best = null;
            let bestDistSq = hitRadiusSq;
            for (let i = this.particles.length - 1; i >= 0; i--) {
                const p = this.particles[i];
                const dx = p.x - x;
                const dy = p.y - y;
                const d2 = dx * dx + dy * dy;
                if (d2 <= bestDistSq) {
                    best = p;
                    bestDistSq = d2;
                }
            }
            return best;
        }

        handlePointerDown(e) {
            if (this.isPaused || !this.canvas) return;
            if (typeof e.button === 'number' && e.button !== 0 && e.pointerType === 'mouse') return;

            if (typeof this.canvas.setPointerCapture === 'function' && e.pointerId !== undefined) {
                try {
                    this.canvas.setPointerCapture(e.pointerId);
                } catch (_err) {
                    // Synthetic test events may lack active native capture
                }
            }

            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const hit = this.hitTestSprite(e.clientX, e.clientY, e.pointerType);
            if (hit) {
                hit.isGrabbed = true;
                hit.trail.clear();
                hit.popV = (hit.popV || 0) + 2.4;
                hit.energy = 1;
                this.emitSparks(x, y, hit.color, { count: 9, speed: 2.6, sizeScale: 1.1 });
                this.grabbedSprites.set(e.pointerId, {
                    particle: hit,
                    lastX: x,
                    lastY: y,
                    vx: 0,
                    vy: 0,
                    lastTime: typeof performance !== 'undefined' ? performance.now() : Date.now(),
                });
                this.notifyInteraction({ type: 'grab', x, y, speed: 2 });
            } else {
                this.activePointers.set(e.pointerId, {
                    x,
                    y,
                    startX: x,
                    startY: y,
                    startTime: typeof performance !== 'undefined' ? performance.now() : Date.now(),
                    isSingularity: false,
                });
                this.notifyInteraction({ type: 'touch', x, y, speed: 1 });
            }
        }

        handlePointerMove(e) {
            if (this.isPaused || !this.canvas) return;
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Passive hover repulsion only for mouse hover with no active grab/touch
            if (
                this.activePointers.size === 0 &&
                this.grabbedSprites.size === 0 &&
                (!e.pointerType || e.pointerType === 'mouse')
            ) {
                this.mousePosition.x = x;
                this.mousePosition.y = y;
            }

            const grab = this.grabbedSprites.get(e.pointerId);
            if (grab) {
                const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                const dtMs = Math.max(4, now - grab.lastTime);
                const dtSec = dtMs / 1000;
                const instVx = ((x - grab.lastX) / dtMs) * 16.67;
                const instVy = ((y - grab.lastY) / dtMs) * 16.67;
                const smooth = 1 - Math.exp(-26 * dtSec);
                grab.vx += (instVx - grab.vx) * smooth;
                grab.vy += (instVy - grab.vy) * smooth;
                grab.lastX = x;
                grab.lastY = y;
                grab.lastTime = now;

                grab.particle.x = x;
                grab.particle.y = y;
                grab.particle.energy = 1;

                const speed = Math.hypot(grab.vx, grab.vy);
                if (speed > 1.5 && Math.random() < 0.45) {
                    this.emitSparks(x, y, grab.particle.color, {
                        count: 1,
                        speed: 0.9,
                        driftX: -grab.vx * 0.12,
                        driftY: -grab.vy * 0.12,
                    });
                }
                this.notifyInteraction({ type: 'drag', x, y, speed });
            } else if (this.activePointers.has(e.pointerId)) {
                const ptr = this.activePointers.get(e.pointerId);
                const moveDx = x - ptr.x;
                const moveDy = y - ptr.y;
                const moveDist = Math.hypot(moveDx, moveDy);
                ptr.x = x;
                ptr.y = y;
                if (moveDist > 2) {
                    this.emitSparks(x, y, this.noteInk(x), {
                        count: 2,
                        speed: 1.0,
                        sizeScale: 1.05,
                        driftX: -moveDx * 0.09,
                        driftY: -moveDy * 0.09,
                    });
                }
                this.notifyInteraction({ type: 'swirl', x, y, speed: 1.2 });
            }
        }

        handlePointerUp(e) {
            if (!this.canvas) return;
            if (typeof this.canvas.releasePointerCapture === 'function' && e.pointerId !== undefined) {
                try {
                    if (this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(e.pointerId)) {
                        this.canvas.releasePointerCapture(e.pointerId);
                    }
                } catch (_err) {
                    // Ignore
                }
            }

            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const grab = this.grabbedSprites.get(e.pointerId);
            if (grab) {
                grab.particle.isGrabbed = false;
                grab.particle.trail.clear();
                grab.particle.vx = Math.max(-13, Math.min(13, grab.vx || 0));
                grab.particle.vy = Math.max(-13, Math.min(13, grab.vy || 0));
                grab.particle.energy = 1;
                this.grabbedSprites.delete(e.pointerId);
                const speed = Math.hypot(grab.vx, grab.vy);
                if (speed > 1.8) {
                    this.emitSparks(x, y, grab.particle.color, {
                        count: Math.min(18, 6 + Math.round(speed)),
                        speed: 2.4 + speed * 0.32,
                        sizeScale: 1.15,
                        driftX: grab.vx * 0.24,
                        driftY: grab.vy * 0.24,
                    });
                }
                this.notifyInteraction({ type: 'fling', x, y, speed });
            } else if (this.activePointers.has(e.pointerId)) {
                const ptr = this.activePointers.get(e.pointerId);
                const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                const heldDuration = now - ptr.startTime;
                const travelled = Math.hypot(
                    ptr.x - (ptr.startX ?? ptr.x),
                    ptr.y - (ptr.startY ?? ptr.y)
                );

                if (ptr.isSingularity) {
                    for (let i = 0; i < this.particles.length; i++) {
                        const particle = this.particles[i];
                        if (particle.isGrabbed) continue;
                        const dx = particle.x - ptr.x;
                        const dy = particle.y - ptr.y;
                        const dist = Math.hypot(dx, dy) || 1;
                        if (dist < 380) {
                            const blast = Math.min(14, (1 - dist / 380) * 12.5 + 3);
                            particle.vx = (dx / dist) * blast;
                            particle.vy = (dy / dist) * blast;
                            particle.popV = (particle.popV || 0) + 3.2;
                            particle.energy = 1;
                        }
                    }
                    this.ripples.push({
                        x: ptr.x,
                        y: ptr.y,
                        radius: 6,
                        maxRadius: 310,
                        alpha: 1.0,
                        baseAlpha: 1.0,
                        t: 0,
                        hue: hueForX(ptr.x, this.logicalWidth),
                    });
                    this.emitSparks(ptr.x, ptr.y, this.noteInk(ptr.x), {
                        count: 34,
                        speed: 6.2,
                        sizeScale: 1.35,
                        decayScale: 0.78,
                    });
                    this.emitSparks(ptr.x, ptr.y, '#ffe680', {
                        count: 14,
                        speed: 4.0,
                        sizeScale: 1.2,
                        decayScale: 0.85,
                    });
                    this.notifyInteraction({ type: 'supernova', x: ptr.x, y: ptr.y, speed: 5 });
                } else if (
                    heldDuration < 280 &&
                    travelled <= TAP_SLOP_PX &&
                    e.type !== 'pointercancel'
                ) {
                    this.ripples.push({
                        x: ptr.x,
                        y: ptr.y,
                        radius: 4,
                        maxRadius: 195,
                        alpha: 0.9,
                        baseAlpha: 0.9,
                        t: 0,
                        hue: hueForX(ptr.x, this.logicalWidth),
                    });
                    this.emitSparks(ptr.x, ptr.y, this.noteInk(ptr.x), {
                        count: 16,
                        speed: 3.6,
                        sizeScale: 1.15,
                    });
                    this.notifyInteraction({ type: 'ripple', x: ptr.x, y: ptr.y, speed: 3 });
                }
                this.activePointers.delete(e.pointerId);
            }
        }

        drawParticleShape(ctx, particle, x, y, size, alpha) {
            const stamp = this._getGlowStamp(particle.color, particle.rgb);
            const energy = particle.energy || 0;

            if (stamp) {
                const haloRadius = size * (2.9 + energy * 1.4 + (particle.isGrabbed ? 1.2 : 0));
                ctx.save();
                if (this.isDarkTheme()) ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = alpha * (0.48 + 0.34 * energy);
                ctx.drawImage(stamp, x - haloRadius, y - haloRadius, haloRadius * 2, haloRadius * 2);
                ctx.restore();
            }

            ctx.save();
            ctx.globalAlpha = alpha * Math.min(1, 0.72 + 0.22 * particle.depth + 0.12 * energy);
            const vx = particle.vx || 0;
            const vy = particle.vy || 0;
            const speed = Math.hypot(vx, vy);

            ctx.translate(x, y);
            if (!this.reducedMotion && speed > 0.65 && !particle.isGrabbed) {
                const stretch = Math.min(1.65, 1 + speed * 0.065);
                const squash = 1 / Math.sqrt(stretch);
                ctx.rotate(particle.heading);
                ctx.scale(stretch, squash);
            }

            ctx.fillStyle = particle.color;
            this.renderShapeGeometry(ctx, particle.type, size);
            ctx.fill();

            // Luminous specular core
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = alpha * Math.min(0.95, 0.66 + 0.28 * energy);
            this.renderShapeGeometry(ctx, particle.type, size * 0.42);
            ctx.fill();
            ctx.restore();
        }

        renderShapeGeometry(ctx, type, size) {
            ctx.beginPath();
            switch (type) {
                case 'square':
                    ctx.rect(-size * 0.88, -size * 0.88, size * 1.76, size * 1.76);
                    break;
                case 'triangle':
                    ctx.moveTo(size * 1.15, 0);
                    ctx.lineTo(-size * 0.85, size * 0.92);
                    ctx.lineTo(-size * 0.85, -size * 0.92);
                    ctx.closePath();
                    break;
                case 'diamond':
                    ctx.moveTo(size * 1.2, 0);
                    ctx.lineTo(0, size * 0.85);
                    ctx.lineTo(-size * 1.2, 0);
                    ctx.lineTo(0, -size * 0.85);
                    ctx.closePath();
                    break;
                case 'circle':
                default:
                    ctx.arc(0, 0, size, 0, Math.PI * 2);
                    break;
            }
        }

        renderParticles() {
            const dark = this.isDarkTheme();
            const themeKey = dark ? 'dark' : 'light';

            if (this._backdropTheme !== themeKey || !this._backdropCanvas) {
                this._rebuildBackdropCache();
            }

            if (this._backdropCanvas) {
                this.ctx.drawImage(this._backdropCanvas, 0, 0, this.logicalWidth, this.logicalHeight);
            } else {
                this.ctx.fillStyle = dark ? '#0e0c16' : '#f4f1ff';
                this.ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
            }

            const particleAlpha = 0.92;

            this.drawConnections(particleAlpha);
            this.drawTrails(particleAlpha);
            if (this.ripples.length > 0) this.drawRipples();

            // Active singularity vortex indicator
            for (const ptr of this.activePointers.values()) {
                if (!ptr.isSingularity) continue;
                const pulse = this.reducedMotion ? 0 : Math.sin(this.elapsedTime * 7.2) * 3.5;
                const hue = hueForX(ptr.x, this.logicalWidth);
                const lightness = dark ? 68 : 45;
                const spin = this.reducedMotion ? 0 : this.elapsedTime * 3.2;

                this.ctx.save();
                if (dark) this.ctx.globalCompositeOperation = 'lighter';
                const vortexStamp = this._getGlowStamp(`singularity:${hue}`, dark ? '0, 240, 255' : '109, 40, 217');
                if (vortexStamp) {
                    const r = 46 + pulse;
                    this.ctx.globalAlpha = 0.72;
                    this.ctx.drawImage(vortexStamp, ptr.x - r, ptr.y - r, r * 2, r * 2);
                }

                this.ctx.globalAlpha = 0.82;
                this.ctx.strokeStyle = `hsla(${hue}, 100%, ${lightness}%, 0.75)`;
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.arc(ptr.x, ptr.y, 24 + pulse, spin, spin + Math.PI * 1.45);
                this.ctx.stroke();

                this.ctx.strokeStyle = 'rgba(212, 175, 55, 0.78)';
                this.ctx.lineWidth = 1.4;
                this.ctx.beginPath();
                this.ctx.arc(ptr.x, ptr.y, 15 - pulse * 0.5, -spin * 1.4, -spin * 1.4 + Math.PI * 1.3);
                this.ctx.stroke();
                this.ctx.restore();
            }

            for (let i = 0; i < this.particles.length; i++) {
                const particle = this.particles[i];
                if (particle.isGrabbed) {
                    const orbitRadius =
                        particle.size * 2.9 * (this.reducedMotion ? 1 : 1 + 0.07 * Math.sin(this.elapsedTime * 11));
                    this.ctx.save();
                    this.ctx.globalAlpha = 0.85;
                    this.ctx.strokeStyle = particle.color;
                    this.ctx.lineWidth = 2.2;
                    this.ctx.beginPath();
                    this.ctx.arc(particle.x, particle.y, orbitRadius, 0, Math.PI * 2);
                    this.ctx.stroke();

                    this.ctx.strokeStyle = 'rgba(212, 175, 55, 0.85)';
                    this.ctx.lineWidth = 1.2;
                    this.ctx.beginPath();
                    this.ctx.arc(
                        particle.x,
                        particle.y,
                        orbitRadius * 1.35,
                        this.elapsedTime * 4,
                        this.elapsedTime * 4 + Math.PI * 1.25
                    );
                    this.ctx.stroke();
                    this.ctx.restore();
                }

                this.drawParticleShape(
                    this.ctx,
                    particle,
                    particle.x,
                    particle.y,
                    particle.size * (particle.pop ?? 1),
                    particleAlpha
                );
            }

            this.sparks.render(this.ctx, { additive: dark, reducedMotion: this.reducedMotion });
        }

        drawRipples() {
            const ctx = this.ctx;
            const dark = this.isDarkTheme();
            ctx.save();
            if (dark) ctx.globalCompositeOperation = 'lighter';
            for (let i = 0; i < this.ripples.length; i++) {
                const r = this.ripples[i];
                const a = Math.max(0, r.alpha);
                const hue = r.hue ?? hueForX(r.x, this.logicalWidth);
                const lightness = dark ? 68 : 42;
                const ink = (alpha) => `hsla(${hue}, 100%, ${lightness}%, ${alpha})`;

                ctx.fillStyle = ink(a * 0.08);
                ctx.beginPath();
                ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = ink(a);
                ctx.lineWidth = 0.9 + 2.5 * a;
                ctx.beginPath();
                ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
                ctx.stroke();

                ctx.strokeStyle = `rgba(212, 175, 55, ${a * 0.6})`;
                ctx.lineWidth = 0.6 + 1.3 * a;
                ctx.beginPath();
                ctx.arc(r.x, r.y, r.radius * 0.72, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.restore();
        }

        drawConnections(alpha) {
            const fallbackInk = this.isDarkTheme()
                ? this.constellationInk.dark
                : this.constellationInk.light;
            const maxDistSq = this.connectionDistance * this.connectionDistance;
            this.ctx.save();
            this.ctx.lineWidth = 0.9;
            this.connectionCounts.fill(0);

            for (let i = 0; i < this.particles.length; i++) {
                const p1 = this.particles[i];
                if (this.connectionCounts[p1.id] >= MAX_CONNECTIONS_PER_SPRITE) continue;
                const linkInk = p1.rgb || fallbackInk;

                this.forEachNeighbor(p1, (p2) => {
                    if (p1.id >= p2.id) return;
                    if (
                        this.connectionCounts[p1.id] >= MAX_CONNECTIONS_PER_SPRITE ||
                        this.connectionCounts[p2.id] >= MAX_CONNECTIONS_PER_SPRITE
                    ) {
                        return;
                    }
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < maxDistSq) {
                        this.connectionCounts[p1.id]++;
                        this.connectionCounts[p2.id]++;
                        const boost = 1 + 0.55 * Math.max(p1.energy, p2.energy);
                        const opacity = Math.min(0.65, alpha * 0.28 * (1 - distSq / maxDistSq) * boost);
                        this.ctx.strokeStyle = `rgba(${linkInk}, ${opacity})`;
                        this.ctx.beginPath();
                        this.ctx.moveTo(p1.x, p1.y);
                        this.ctx.lineTo(p2.x, p2.y);
                        this.ctx.stroke();
                    }
                });
            }
            this.ctx.restore();
        }

        drawTrails(alpha) {
            if (this.reducedMotion) return;
            const ctx = this.ctx;
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            let currentRgb = '255, 255, 255';
            let currentBoost = 0;

            // Render each contiguous run in 3 smooth tapered bands (removes beaded joint overlap & cuts draw calls 4x)
            const strokeRun = (run) => {
                const n = run.length;
                if (n < 2) return;
                const b1 = Math.max(1, Math.floor((n - 1) * 0.35));
                const b2 = Math.max(b1 + 1, Math.floor((n - 1) * 0.72));
                const bands = [
                    [0, b1, 0.14, 0.75],
                    [b1, Math.min(n - 1, b2), 0.28, 1.35],
                    [Math.min(n - 1, b2), n - 1, 0.48, 2.0],
                ];
                for (let b = 0; b < 3; b++) {
                    const start = bands[b][0];
                    const end = bands[b][1];
                    if (end <= start) continue;
                    const segAlpha = Math.min(0.85, alpha * bands[b][2] * (1 + 0.35 * currentBoost));
                    ctx.strokeStyle = `rgba(${currentRgb}, ${segAlpha})`;
                    ctx.lineWidth = bands[b][3];
                    ctx.beginPath();
                    ctx.moveTo(run[start].x, run[start].y);
                    for (let i = start + 1; i < end; i++) {
                        const xc = (run[i].x + run[i + 1].x) * 0.5;
                        const yc = (run[i].y + run[i + 1].y) * 0.5;
                        ctx.quadraticCurveTo(run[i].x, run[i].y, xc, yc);
                    }
                    ctx.lineTo(run[end].x, run[end].y);
                    ctx.stroke();
                }
            };

            for (let i = 0; i < this.particles.length; i++) {
                const particle = this.particles[i];
                if (!particle.trail || particle.trail.length < 2) continue;
                currentRgb = particle.rgb;
                currentBoost = particle.energy || 0;
                particle.trail.forEachRun(strokeRun, TRAIL_MAX_SEGMENT);
            }
            ctx.restore();
        }

        _tick() {
            if (this.isPaused) return;
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const dt = Math.min(MAX_FRAME_DT_SEC, Math.max(0.001, (now - (this.lastFrameTime || now)) / 1000));
            this.lastFrameTime = now;

            // Update and render every single rAF frame cleanly (zero skipped renders at 60/120/144Hz)
            this.updateParticlePositions(dt);
            this.renderParticles();

            this.animationFrameId = requestAnimationFrame(() => this._tick());
        }

        resume() {
            if (!this.isPaused) return;
            this.isPaused = false;
            this.lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
            this.resize();
            this.animationFrameId = requestAnimationFrame(() => this._tick());
        }

        pause() {
            this.isPaused = true;
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
            this.clearActivePointers();
        }

        setReducedMotion(flag) {
            this.reducedMotion = Boolean(flag);
        }

        getSnapshot() {
            return {
                spriteCount: this.particles.length,
                grabbed: this.grabbedSprites.size,
                ripples: this.ripples.length,
                activePointers: this.activePointers.size,
                hitRadius: this.computeHitRadius(),
                isPaused: this.isPaused,
                positions: this.particles.map((p) => ({
                    x: p.x,
                    y: p.y,
                    vx: p.vx,
                    vy: p.vy,
                })),
            };
        }
    }

    root.TeacherEvan = root.TeacherEvan || {};
    root.TeacherEvan.SpritePlayground = SpritePlayground;
    root.TeacherEvan.SPRITE_COUNT = SPRITE_COUNT;
})(window);
