(function (root) {
    'use strict';

    const { SPRITE_PALETTES, hexToRgbChannels } = root.TeacherEvan.SpritePalette;
    const { SpriteTrail, TRAIL_CAPACITY, TRAIL_MAX_SEGMENT } = root.TeacherEvan.SpriteTrail;
    const { SpriteSparks } = root.TeacherEvan.SpriteSparks;

    const SPRITE_COUNT = 150;
    const PHYSICS_STEP_MS = 1000 / 60;
    const STEP_JITTER_MS = 2;
    const MAX_STEPS_PER_FRAME = 2;
    const TAP_SLOP_PX = 14;
    const NOTE_ZONES = 10;
    const GRAB_SCALE = 1.7;
    const MAX_CONNECTIONS_PER_SPRITE = 4;

    function hueForX(x, width) {
        if (!(width > 0)) return 0;
        const zone = Math.min(NOTE_ZONES - 1, Math.max(0, Math.floor((x / width) * NOTE_ZONES)));
        return Math.round((zone / (NOTE_ZONES - 1)) * 300);
    }

    class SpritePlayground {
        /**
         * @param {HTMLCanvasElement} canvas
         */
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.particles = [];
            this.particleCount = SPRITE_COUNT;
            this.animationFrameId = null;
            this.isPaused = true;
            this.lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
            this.partitionCellSize = 120;
            this.spatialGrid = [];
            this.gridCols = 0;
            this.gridRows = 0;
            this.connectionCounts = new Uint8Array(SPRITE_COUNT);
            this.mousePosition = { x: -1000, y: -1000 };
            this.mouseInfluenceRadius = 200;
            this.connectionDistance = 140;
            this.particleTypes = ['circle', 'square', 'triangle', 'diamond'];
            this.colorPalette = SPRITE_PALETTES;
            this.canvasTint = { light: '244, 241, 255', dark: '14, 12, 22' };
            this.constellationInk = { light: '10, 109, 149', dark: '0, 240, 255' };

            this.activePointers = new Map();
            this.grabbedSprites = new Map();
            this.ripples = [];
            this.sparks = new SpriteSparks();
            this.stepAccumulator = 0;
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
            this._onMouseMove = (e) => this.handleMouseMove(e);
            this._onMouseLeave = () => this.handleMouseLeave();
            this._onTouchMove = (e) => this.handleTouchMove(e);
            this._onPointerDown = (e) => this.handlePointerDown(e);
            this._onPointerMove = (e) => this.handlePointerMove(e);
            this._onPointerUp = (e) => this.handlePointerUp(e);
            this._onBlur = () => this.clearActivePointers();

            window.addEventListener('resize', this._onResize);
            window.addEventListener('blur', this._onBlur);
            this.canvas.addEventListener('mousemove', this._onMouseMove);
            this.canvas.addEventListener('mouseleave', this._onMouseLeave);
            this.canvas.addEventListener('pointerleave', this._onMouseLeave);
            this.canvas.addEventListener('touchmove', this._onTouchMove, { passive: true });
            this.canvas.addEventListener('touchend', this._onMouseLeave);
            this.canvas.addEventListener('pointerdown', this._onPointerDown);
            window.addEventListener('pointermove', this._onPointerMove);
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
            const dpr = window.devicePixelRatio || 1;
            const w = window.innerWidth || 800;
            const h = window.innerHeight || 600;
            this.canvas.width = w * dpr;
            this.canvas.height = h * dpr;
            this.canvas.style.width = w + 'px';
            this.canvas.style.height = h + 'px';
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.logicalWidth = w;
            this.logicalHeight = h;
            this.initializeSpatialPartitioning();
        }

        clearAllParticleTrails() {
            for (let i = 0; i < this.particles.length; i++) {
                this.particles[i].trail.clear();
            }
        }

        handleViewportResize() {
            this.clearAllParticleTrails();
            this.resize();
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
                const gx = Math.floor(p.x / this.partitionCellSize);
                const gy = Math.floor(p.y / this.partitionCellSize);
                if (gx >= 0 && gx < this.gridCols && gy >= 0 && gy < this.gridRows) {
                    this.spatialGrid[gy][gx].push(p);
                }
            }
        }

        /** Zero-allocation spatial neighbor visitor. */
        forEachNeighbor(particle, visitor) {
            const gx = Math.floor(particle.x / this.partitionCellSize);
            const gy = Math.floor(particle.y / this.partitionCellSize);

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
            const colorSet = palette[Math.floor(Math.random() * palette.length)];
            const variant = Math.random();
            let color = colorSet.accent;
            if (variant < 0.4) color = colorSet.primary;
            else if (variant < 0.7) color = colorSet.secondary;

            const baseSize = 2 + Math.random() * 3;
            return {
                id,
                x: Math.random() * this.logicalWidth,
                y: Math.random() * this.logicalHeight,
                vx: (Math.random() - 0.5) * 1.5,
                vy: (Math.random() - 0.5) * 1.5,
                color,
                rgb: hexToRgbChannels(color),
                size: baseSize,
                baseSize,
                type: this.particleTypes[Math.floor(Math.random() * this.particleTypes.length)],
                neighborhoodRadius: 120,
                maxSpeed: 1.8,
                maxForce: 0.04,
                trail: new SpriteTrail(TRAIL_CAPACITY),
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: 0.02 + Math.random() * 0.03,
                pop: 1,
                popV: 0,
                isGrabbed: false,
            };
        }

        createParticles() {
            this.particles.length = 0;
            for (let i = 0; i < SPRITE_COUNT; i++) {
                this.particles.push(this.createSingleParticle(i));
            }
        }

        applyFlockingBehavior(particle) {
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
                if (distSq < maxDistSq && distSq > 0) {
                    neighborCount++;
                    const dist = Math.sqrt(distSq);
                    if (dist < 30) {
                        sepX -= dx / dist;
                        sepY -= dy / dist;
                    }
                    alignX += other.vx;
                    alignY += other.vy;
                    cohX += other.x;
                    cohY += other.y;
                }
            });

            // Pointer repulsion
            const mouseDx = this.mousePosition.x - particle.x;
            const mouseDy = this.mousePosition.y - particle.y;
            const mouseDistSq = mouseDx * mouseDx + mouseDy * mouseDy;
            const mouseRadiusSq = this.mouseInfluenceRadius * this.mouseInfluenceRadius;

            if (mouseDistSq < mouseRadiusSq && mouseDistSq > 0) {
                const mouseDist = Math.sqrt(mouseDistSq);
                const influence = 1 - mouseDist / this.mouseInfluenceRadius;
                particle.vx -= (mouseDx / mouseDist) * influence * 0.5;
                particle.vy -= (mouseDy / mouseDist) * influence * 0.5;
            }

            if (neighborCount > 0) {
                alignX /= neighborCount;
                alignY /= neighborCount;
                cohX = cohX / neighborCount - particle.x;
                cohY = cohY / neighborCount - particle.y;
            }

            const separationWeight = 1.8;
            const alignmentWeight = 1.0;
            const cohesionWeight = 0.8;

            particle.vx += sepX * separationWeight * particle.maxForce;
            particle.vy += sepY * separationWeight * particle.maxForce;
            particle.vx += alignX * alignmentWeight * particle.maxForce * 0.1;
            particle.vy += alignY * alignmentWeight * particle.maxForce * 0.1;
            particle.vx += cohX * cohesionWeight * particle.maxForce * 0.01;
            particle.vy += cohY * cohesionWeight * particle.maxForce * 0.01;

            const speed = Math.hypot(particle.vx, particle.vy);
            if (speed > particle.maxSpeed) {
                particle.vx = (particle.vx / speed) * particle.maxSpeed;
                particle.vy = (particle.vy / speed) * particle.maxSpeed;
            }
        }

        updateParticlePositions() {
            this.updateSpatialPartitionGrid();

            const nowTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
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
                if (ptr.isSingularity && Math.random() < 0.3) {
                    const angle = Math.random() * Math.PI * 2;
                    const spawnDist = 35 + Math.random() * 65;
                    this.emitSparks(
                        ptr.x + Math.cos(angle) * spawnDist,
                        ptr.y + Math.sin(angle) * spawnDist,
                        this.noteInk(ptr.x),
                        {
                            count: 1,
                            speed: 1.5,
                            driftX: -Math.cos(angle) * 1.8 - Math.sin(angle) * 1.2,
                            driftY: -Math.sin(angle) * 1.8 + Math.cos(angle) * 1.2,
                        }
                    );
                }
            }

            for (let i = 0; i < this.particles.length; i++) {
                const particle = this.particles[i];
                this.advancePop(particle);

                if (particle.isGrabbed) {
                    particle.trail.clear();
                    continue;
                }

                particle.trail.push(particle.x, particle.y);
                this.applyFlockingBehavior(particle);

                for (const ptr of this.activePointers.values()) {
                    const dx = ptr.x - particle.x;
                    const dy = ptr.y - particle.y;
                    const dist = Math.hypot(dx, dy);

                    if (ptr.isSingularity) {
                        if (dist > 8) {
                            const pull = Math.min(2.5, 400 / (dist + 50));
                            const tangentX = -dy / dist;
                            const tangentY = dx / dist;
                            particle.vx += (dx / dist) * pull * 0.12 + tangentX * pull * 0.18;
                            particle.vy += (dy / dist) * pull * 0.12 + tangentY * pull * 0.18;
                        }
                    } else if (dist < 250 && dist > 20) {
                        const tangentX = -dy / dist;
                        const tangentY = dx / dist;
                        particle.vx += tangentX * 0.4 + (dx / dist) * 0.15;
                        particle.vy += tangentY * 0.4 + (dy / dist) * 0.15;
                    }
                }

                for (let rIdx = 0; rIdx < this.ripples.length; rIdx++) {
                    const ripple = this.ripples[rIdx];
                    const dx = particle.x - ripple.x;
                    const dy = particle.y - ripple.y;
                    const dist = Math.hypot(dx, dy);
                    if (Math.abs(dist - ripple.radius) < 30 && dist > 0) {
                        const push = 1.8 * Math.max(0, 1 - (ripple.t ?? 0));
                        particle.vx += (dx / dist) * push;
                        particle.vy += (dy / dist) * push;
                    }
                }

                particle.x += particle.vx;
                particle.y += particle.vy;

                particle.pulsePhase += particle.pulseSpeed;
                particle.size =
                    particle.baseSize * (0.8 + 0.2 * Math.sin(particle.pulsePhase));

                if (this.wrapParticleIntoViewport(particle)) {
                    particle.trail.clear();
                }
            }

            for (let i = this.ripples.length - 1; i >= 0; i--) {
                const r = this.ripples[i];
                r.t = (r.t ?? 0) + 0.03;
                const t = Math.min(1, r.t);
                const eased = 1 - Math.pow(1 - t, 3);
                r.radius = 2 + (r.maxRadius - 2) * eased;
                r.alpha = (r.baseAlpha ?? 0.85) * Math.pow(1 - t, 1.6);
                if (r.t >= 1 || r.alpha <= 0.005) {
                    this.ripples.splice(i, 1);
                }
            }

            this.sparks.update();
        }

        advancePop(particle) {
            if (this.reducedMotion) {
                particle.pop = 1;
                particle.popV = 0;
                return;
            }
            const target = particle.isGrabbed ? GRAB_SCALE : 1;
            particle.popV = ((particle.popV || 0) + (target - particle.pop) * 0.22) * 0.72;
            particle.pop = Math.max(0, particle.pop + particle.popV);
        }

        noteInk(x, alpha = 1) {
            const hue = hueForX(x, this.logicalWidth);
            const lightness = this.isDarkTheme() ? 66 : 42;
            return `hsla(${hue}, 100%, ${lightness}%, ${alpha})`;
        }

        emitSparks(x, y, color, opts) {
            if (this.reducedMotion) return;
            this.sparks.burst(x, y, color, opts);
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

        handleMouseMove(e) {
            const rect = this.canvas.getBoundingClientRect();
            this.mousePosition.x = e.clientX - rect.left;
            this.mousePosition.y = e.clientY - rect.top;
        }

        handleTouchMove(e) {
            if (e.touches.length > 0) {
                const rect = this.canvas.getBoundingClientRect();
                this.mousePosition.x = e.touches[0].clientX - rect.left;
                this.mousePosition.y = e.touches[0].clientY - rect.top;
            }
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

        computeHitRadius() {
            const area = Math.max(1, this.logicalWidth * this.logicalHeight);
            return Math.max(14, Math.min(24, Math.sqrt(area / (SPRITE_COUNT * 18))));
        }

        hitTestSprite(clientX, clientY) {
            if (!this.canvas) return null;
            const rect = this.canvas.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;
            const hitRadius = this.computeHitRadius();
            const hitRadiusSq = hitRadius * hitRadius;

            for (let i = this.particles.length - 1; i >= 0; i--) {
                const p = this.particles[i];
                const dx = p.x - x;
                const dy = p.y - y;
                if (dx * dx + dy * dy <= hitRadiusSq) {
                    return p;
                }
            }
            return null;
        }

        handlePointerDown(e) {
            if (this.isPaused || !this.canvas) return;
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const hit = this.hitTestSprite(e.clientX, e.clientY);
            if (hit) {
                hit.isGrabbed = true;
                hit.trail.clear();
                hit.popV = (hit.popV || 0) + 0.25;
                this.emitSparks(x, y, hit.color, { count: 6, speed: 2.2 });
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

            const grab = this.grabbedSprites.get(e.pointerId);
            if (grab) {
                const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                const dt = Math.max(1, now - grab.lastTime);
                grab.vx = ((x - grab.lastX) / dt) * 16.67;
                grab.vy = ((y - grab.lastY) / dt) * 16.67;
                grab.lastX = x;
                grab.lastY = y;
                grab.lastTime = now;

                grab.particle.x = x;
                grab.particle.y = y;

                const speed = Math.hypot(grab.vx, grab.vy);
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
                        count: 1,
                        speed: 0.8,
                        driftX: -moveDx * 0.08,
                        driftY: -moveDy * 0.08,
                    });
                }
                this.notifyInteraction({ type: 'swirl', x, y, speed: 1.2 });
            }
        }

        handlePointerUp(e) {
            if (!this.canvas) return;
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const grab = this.grabbedSprites.get(e.pointerId);
            if (grab) {
                grab.particle.isGrabbed = false;
                grab.particle.trail.clear();
                grab.particle.vx = Math.max(-12, Math.min(12, grab.vx || 0));
                grab.particle.vy = Math.max(-12, Math.min(12, grab.vy || 0));
                this.grabbedSprites.delete(e.pointerId);
                const speed = Math.hypot(grab.vx, grab.vy);
                if (speed > 2) {
                    this.emitSparks(x, y, grab.particle.color, {
                        count: Math.min(14, 4 + Math.round(speed)),
                        speed: 2 + speed * 0.3,
                        driftX: grab.vx * 0.25,
                        driftY: grab.vy * 0.25,
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
                        if (dist < 360) {
                            const blast = Math.min(14, (1 - dist / 360) * 12 + 3);
                            particle.vx = (dx / dist) * blast;
                            particle.vy = (dy / dist) * blast;
                            particle.popV = (particle.popV || 0) + 0.35;
                        }
                    }
                    this.ripples.push({
                        x: ptr.x,
                        y: ptr.y,
                        radius: 4,
                        maxRadius: 280,
                        alpha: 1.0,
                        baseAlpha: 1.0,
                        t: 0,
                        hue: hueForX(ptr.x, this.logicalWidth),
                    });
                    this.emitSparks(ptr.x, ptr.y, this.noteInk(ptr.x), { count: 24, speed: 5.5 });
                    this.notifyInteraction({ type: 'supernova', x: ptr.x, y: ptr.y, speed: 5 });
                } else if (
                    heldDuration < 280 &&
                    travelled <= TAP_SLOP_PX &&
                    e.type !== 'pointercancel'
                ) {
                    this.ripples.push({
                        x: ptr.x,
                        y: ptr.y,
                        radius: 2,
                        maxRadius: 180,
                        alpha: 0.85,
                        baseAlpha: 0.85,
                        t: 0,
                        hue: hueForX(ptr.x, this.logicalWidth),
                    });
                    this.emitSparks(ptr.x, ptr.y, this.noteInk(ptr.x), { count: 10, speed: 3.2 });
                    this.notifyInteraction({ type: 'ripple', x: ptr.x, y: ptr.y, speed: 3 });
                }
                this.activePointers.delete(e.pointerId);
            }
        }

        drawParticleShape(ctx, particle, x, y, size, alpha) {
            ctx.save();
            ctx.globalAlpha = alpha;
            const vx = particle.vx || 0;
            const vy = particle.vy || 0;
            const speed = Math.hypot(vx, vy);

            ctx.translate(x, y);
            if (!this.reducedMotion && speed > 0.8 && !particle.isGrabbed) {
                const angle = Math.atan2(vy, vx);
                const stretch = Math.min(1.8, 1 + speed * 0.08);
                const squash = 1 / Math.sqrt(stretch);
                ctx.rotate(angle);
                ctx.scale(stretch, squash);
            }

            ctx.fillStyle = particle.color;
            this.renderShapeGeometry(ctx, particle.type, size);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = alpha * 0.72;
            this.renderShapeGeometry(ctx, particle.type, size * 0.42);
            ctx.fill();
            ctx.restore();
        }

        renderShapeGeometry(ctx, type, size) {
            ctx.beginPath();
            switch (type) {
                case 'square':
                    ctx.rect(-size, -size, size * 2, size * 2);
                    break;
                case 'triangle':
                    ctx.moveTo(0, -size * 1.15);
                    ctx.lineTo(size, size * 0.85);
                    ctx.lineTo(-size, size * 0.85);
                    ctx.closePath();
                    break;
                case 'diamond':
                    ctx.moveTo(0, -size * 1.15);
                    ctx.lineTo(size * 0.9, 0);
                    ctx.lineTo(0, size * 1.15);
                    ctx.lineTo(-size * 0.9, 0);
                    ctx.closePath();
                    break;
                case 'circle':
                default:
                    ctx.arc(0, 0, size, 0, Math.PI * 2);
                    break;
            }
        }

        renderParticles() {
            const baseBg = this.isDarkTheme() ? this.canvasTint.dark : this.canvasTint.light;
            const bgColor = `rgba(${baseBg}, 0.08)`;
            this.ctx.fillStyle = bgColor;
            this.ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);

            const particleAlpha = 0.85;

            this.drawConnections(particleAlpha);
            this.drawTrails(particleAlpha);
            if (this.ripples.length > 0) this.drawRipples();

            for (const ptr of this.activePointers.values()) {
                if (!ptr.isSingularity) continue;
                const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                const pulse = Math.sin(now / 140) * 4;
                const hue = hueForX(ptr.x, this.logicalWidth);
                const lightness = this.isDarkTheme() ? 68 : 45;
                this.ctx.save();
                this.ctx.strokeStyle = `hsla(${hue}, 100%, ${lightness}%, 0.65)`;
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.arc(ptr.x, ptr.y, 24 + pulse, 0, Math.PI * 2);
                this.ctx.stroke();
                this.ctx.fillStyle = `hsla(${hue}, 100%, ${lightness}%, 0.15)`;
                this.ctx.fill();
                this.ctx.restore();
            }

            for (let i = 0; i < this.particles.length; i++) {
                const particle = this.particles[i];
                if (particle.isGrabbed) {
                    this.ctx.save();
                    this.ctx.globalAlpha = 0.6 * particleAlpha;
                    this.ctx.strokeStyle = particle.color;
                    this.ctx.lineWidth = 3;
                    this.ctx.shadowColor = particle.color;
                    this.ctx.shadowBlur = 20;
                    this.ctx.beginPath();
                    this.ctx.arc(
                        particle.x,
                        particle.y,
                        particle.size * 2.8 * (1 + 0.08 * Math.sin(this.lastFrameTime / 90)),
                        0,
                        Math.PI * 2
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

            this.sparks.render(this.ctx, { additive: this.isDarkTheme() });
        }

        drawRipples() {
            const ctx = this.ctx;
            ctx.save();
            for (let i = 0; i < this.ripples.length; i++) {
                const r = this.ripples[i];
                const a = Math.max(0, r.alpha);
                const hue = r.hue ?? hueForX(r.x, this.logicalWidth);
                const lightness = this.isDarkTheme() ? 66 : 42;
                const ink = (alpha) => `hsla(${hue}, 100%, ${lightness}%, ${alpha})`;

                ctx.fillStyle = ink(a * 0.1);
                ctx.beginPath();
                ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = ink(a);
                ctx.lineWidth = 0.8 + 2.4 * a;
                ctx.beginPath();
                ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
                ctx.stroke();

                ctx.strokeStyle = ink(a * 0.5);
                ctx.lineWidth = 0.6 + 1.2 * a;
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
            this.ctx.lineWidth = 0.8;
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
                        const opacity = alpha * 0.34 * (1 - distSq / maxDistSq);
                        this.ctx.strokeStyle = `rgba(${linkInk}, ${opacity})`;
                        this.ctx.beginPath();
                        this.ctx.moveTo(p1.x, p1.y);
                        this.ctx.lineTo(p2.x, p2.y);
                        this.ctx.stroke();
                    }
                });
            }
        }

        drawTrails(alpha) {
            const ctx = this.ctx;
            ctx.globalAlpha = alpha * 0.4;
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const strokeRun = (run) => {
                if (run.length < 2) return;
                ctx.beginPath();
                ctx.moveTo(run[0].x, run[0].y);
                for (let i = 1; i < run.length; i++) {
                    ctx.lineTo(run[i].x, run[i].y);
                }
                ctx.stroke();
            };

            for (let i = 0; i < this.particles.length; i++) {
                const particle = this.particles[i];
                if (!particle.trail || particle.trail.length < 2) continue;
                ctx.strokeStyle = particle.color;
                particle.trail.forEachRun(strokeRun, TRAIL_MAX_SEGMENT);
            }
            ctx.globalAlpha = 1;
        }

        _tick() {
            if (this.isPaused) return;
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const dtMs = Math.min(100, Math.max(1, now - (this.lastFrameTime || now)));
            this.lastFrameTime = now;

            this.stepAccumulator += dtMs;
            const steps = Math.min(
                MAX_STEPS_PER_FRAME,
                Math.floor((this.stepAccumulator + STEP_JITTER_MS) / PHYSICS_STEP_MS)
            );
            if (steps > 0) {
                this.stepAccumulator = Math.max(0, this.stepAccumulator - steps * PHYSICS_STEP_MS);
                for (let i = 0; i < steps; i++) this.updateParticlePositions();
                this.renderParticles();
            }
            this.animationFrameId = requestAnimationFrame(() => this._tick());
        }

        resume() {
            if (!this.isPaused) return;
            this.isPaused = false;
            this.lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
            this.stepAccumulator = 0;
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
