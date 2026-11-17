(function (root) {
    'use strict';

    const SPARK_CAPACITY = 360;
    // Equivalent to 0.93 per 1/60s frame: lambda = -ln(0.93) * 60 ~= 4.354 / s
    const DRAG_LAMBDA = 4.354;

    class SpriteSparks {
        constructor(capacity = SPARK_CAPACITY) {
            this.capacity = Math.max(1, capacity | 0);
            this.items = [];
            this._pool = [];
            this.cursor = 0;
        }

        get length() {
            return this.items.length;
        }

        /**
         * Emit `count` sparks from a point using pooled spark objects.
         *
         * @param {number} x
         * @param {number} y
         * @param {string} color
         * @param {{count?: number, speed?: number, driftX?: number, driftY?: number, sizeScale?: number, decayScale?: number, rng?: () => number}} [opts]
         */
        burst(x, y, color, opts = {}) {
            const {
                count = 8,
                speed = 3,
                driftX = 0,
                driftY = 0,
                sizeScale = 1,
                decayScale = 1,
                rng = Math.random,
            } = opts;

            for (let i = 0; i < count; i++) {
                const angle = rng() * Math.PI * 2;
                const v = speed * (0.35 + rng() * 0.75);
                this._place(
                    x,
                    y,
                    Math.cos(angle) * v + driftX,
                    Math.sin(angle) * v + driftY,
                    (1.55 + rng() * 1.45) * decayScale,
                    (1.2 + rng() * 1.9) * sizeScale,
                    rng() * Math.PI * 2,
                    10 + rng() * 14,
                    color
                );
            }
        }

        _place(x, y, vx, vy, decay, size, twinklePhase, twinkleSpeed, color) {
            let spark;
            if (this.items.length < this.capacity) {
                spark = this._pool.pop() || {
                    x: 0,
                    y: 0,
                    vx: 0,
                    vy: 0,
                    life: 1,
                    decay: 1,
                    size: 1,
                    twinklePhase: 0,
                    twinkleSpeed: 10,
                    color: '#ffffff',
                };
                this.items.push(spark);
            } else {
                spark = this.items[this.cursor];
                this.cursor = (this.cursor + 1) % this.capacity;
            }

            spark.x = x;
            spark.y = y;
            spark.vx = vx;
            spark.vy = vy;
            spark.life = 1;
            spark.decay = decay;
            spark.size = size;
            spark.twinklePhase = twinklePhase;
            spark.twinkleSpeed = twinkleSpeed;
            spark.color = color;
        }

        /**
         * Advance spark simulation smoothly across any refresh rate.
         * @param {number} [dtSeconds]
         */
        update(dtSeconds = 1 / 60) {
            const safeDt = Math.max(0, Math.min(0.05, dtSeconds));
            const dtScale = safeDt * 60;
            const drag = Math.exp(-DRAG_LAMBDA * safeDt);

            for (let i = this.items.length - 1; i >= 0; i--) {
                const s = this.items[i];
                s.x += s.vx * dtScale;
                s.y += s.vy * dtScale;
                s.vx *= drag;
                s.vy *= drag;
                s.twinklePhase += s.twinkleSpeed * safeDt;
                s.life -= s.decay * safeDt;
                if (s.life <= 0) {
                    const expired = this.items[i];
                    const last = this.items.pop();
                    if (i < this.items.length) this.items[i] = last;
                    if (this._pool.length < this.capacity) this._pool.push(expired);
                }
            }
            if (this.cursor >= this.items.length) this.cursor = 0;
        }

        render(ctx, { additive = false, reducedMotion = false } = {}) {
            if (this.items.length === 0) return;
            ctx.save();
            if (additive) ctx.globalCompositeOperation = 'lighter';
            ctx.lineCap = 'round';

            for (let i = 0; i < this.items.length; i++) {
                const s = this.items[i];
                const life = Math.max(0, Math.min(1, s.life));
                const twinkle = reducedMotion ? 1 : 0.78 + 0.22 * Math.sin(s.twinklePhase);
                const alpha = life * life * twinkle;
                const radius = s.size * (0.45 + 0.65 * life);
                const speedSq = s.vx * s.vx + s.vy * s.vy;

                if (!reducedMotion && speedSq > 0.35) {
                    const tailLen = Math.min(14, Math.sqrt(speedSq) * (1.2 + life));
                    const inv = 1 / Math.sqrt(speedSq);
                    const tx = s.x - s.vx * inv * tailLen;
                    const ty = s.y - s.vy * inv * tailLen;

                    ctx.globalAlpha = alpha * 0.88;
                    ctx.strokeStyle = s.color;
                    ctx.lineWidth = Math.max(0.8, radius * 1.15);
                    ctx.beginPath();
                    ctx.moveTo(tx, ty);
                    ctx.lineTo(s.x, s.y);
                    ctx.stroke();

                    if (life > 0.42) {
                        ctx.globalAlpha = alpha * 0.85;
                        ctx.fillStyle = '#ffffff';
                        ctx.beginPath();
                        ctx.arc(s.x, s.y, Math.max(0.55, radius * 0.48), 0, Math.PI * 2);
                        ctx.fill();
                    }
                } else {
                    ctx.globalAlpha = alpha * 0.35;
                    ctx.fillStyle = s.color;
                    ctx.beginPath();
                    ctx.arc(s.x, s.y, radius * 1.9, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.globalAlpha = alpha;
                    ctx.beginPath();
                    ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.restore();
        }

        clear() {
            while (this.items.length > 0) {
                const item = this.items.pop();
                if (this._pool.length < this.capacity) this._pool.push(item);
            }
            this.cursor = 0;
        }
    }

    /** Safe haptic vibration wrapper (vibrates only when hardware/browser allows). */
    function triggerHaptic(pattern = 10) {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            try {
                navigator.vibrate(pattern);
            } catch (_e) {
                // Ignore devices without haptics
            }
        }
    }

    root.TeacherEvan = root.TeacherEvan || {};
    root.TeacherEvan.SpriteSparks = {
        SpriteSparks,
        SPARK_CAPACITY,
        triggerHaptic,
    };
})(window);
