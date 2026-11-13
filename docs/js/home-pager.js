(function (root) {
    'use strict';

    const DRAG_DEAD_ZONE_PX = 8;
    const RUBBER_BAND_FACTOR = 0.35;

    function resolveSwipe({ dx, dy, dtMs, currentPosition, width }) {
        if (!width || width <= 0) return currentPosition;

        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        if (absDx < 1.4 * absDy) {
            return currentPosition;
        }

        const velocity = dtMs > 0 ? absDx / dtMs : 0;
        const distanceRatio = absDx / width;

        let delta = 0;
        if (distanceRatio > 0.2 || velocity > 0.45) {
            // Swiping left (negative dx) moves from Page 0 to Page 1
            // Swiping right (positive dx) moves from Page 1 to Page 0
            delta = dx < 0 ? 1 : -1;
        }

        return Math.max(0, Math.min(1, currentPosition + delta));
    }

    function applyRubberBand(offsetPx, width) {
        if (!width || width <= 0) return offsetPx;
        if (offsetPx > 0) return offsetPx * RUBBER_BAND_FACTOR;
        if (offsetPx < -width) return -width + (offsetPx + width) * RUBBER_BAND_FACTOR;
        return offsetPx;
    }

    class HomePager {
        constructor(trackEl, options = {}) {
            this.track = trackEl || document.getElementById('homePagerTrack');
            this.container = options.container || document.getElementById('mainViewport');
            this.page0 = options.page0 || document.getElementById('profileHubPage');
            this.page1 = options.page1 || document.getElementById('spritePlaygroundPage');
            this.position = 0; // 0 = Profile Hub + PickaBoo, 1 = 150-Sprite Playground
            this.isDragging = false;
            this.axisLocked = false;
            this.startX = 0;
            this.startY = 0;
            this.startTime = 0;
            this.currentDx = 0;
            this.currentDy = 0;
            this.onPageChange = options.onPageChange || null;
            this.onGestureUnlock = options.onGestureUnlock || null;
            this.isSpriteTouchedFn = options.isSpriteTouchedFn || (() => false);

            this.boundPointerDown = this.handlePointerDown.bind(this);
            this.boundPointerMove = this.handlePointerMove.bind(this);
            this.boundPointerUp = this.handlePointerUp.bind(this);
            this.boundKeyDown = this.handleKeyDown.bind(this);

            this.attach();
        }

        attach() {
            if (!this.container) return;
            this.container.addEventListener('pointerdown', this.boundPointerDown, { passive: false });
            window.addEventListener('pointermove', this.boundPointerMove, { passive: false });
            window.addEventListener('pointerup', this.boundPointerUp);
            window.addEventListener('pointercancel', this.boundPointerUp);
            window.addEventListener('keydown', this.boundKeyDown);
            this.updateLayerTransform(false);
        }

        handlePointerDown(e) {
            if (
                e.target &&
                (e.target.closest('button') ||
                    e.target.closest('a') ||
                    e.target.closest('input') ||
                    e.target.closest('[data-no-swipe]'))
            ) {
                return;
            }

            // On Page 1, yield to direct sprite grabs; on Page 0, swiping left is never blocked.
            if (this.position === 1 && this.isSpriteTouchedFn(e.clientX, e.clientY)) {
                return;
            }

            if (typeof this.onGestureUnlock === 'function') {
                this.onGestureUnlock();
            }

            this.isDragging = true;
            this.axisLocked = false;
            this.startX = e.clientX;
            this.startY = e.clientY;
            this.startTime = performance.now();
            this.currentDx = 0;
            this.currentDy = 0;

            if (this.track) {
                this.track.style.transition = 'none';
            }
        }

        handlePointerMove(e) {
            if (!this.isDragging) return;

            this.currentDx = e.clientX - this.startX;
            this.currentDy = e.clientY - this.startY;

            if (!this.axisLocked) {
                if (Math.hypot(this.currentDx, this.currentDy) < DRAG_DEAD_ZONE_PX) return;
                if (Math.abs(this.currentDx) < 1.4 * Math.abs(this.currentDy)) {
                    this.isDragging = false;
                    this.currentDx = 0;
                    this.currentDy = 0;
                    this.updateLayerTransform(true);
                    return;
                }
                this.axisLocked = true;
            }

            const width = window.innerWidth || 800;
            const baseOffset = -this.position * width;
            const totalOffset = applyRubberBand(baseOffset + this.currentDx, width);

            if (this.track) {
                this.track.style.transform = `translateX(${totalOffset}px)`;
            }
        }

        handlePointerUp(e) {
            if (!this.isDragging) return;
            this.isDragging = false;

            if (e && e.type === 'pointercancel') {
                this.goTo(this.position, true);
                return;
            }

            const dtMs = performance.now() - this.startTime;
            const width = window.innerWidth || 800;

            const newPos = resolveSwipe({
                dx: this.currentDx,
                dy: this.currentDy,
                dtMs,
                currentPosition: this.position,
                width,
            });

            this.goTo(newPos, true);
        }

        handleKeyDown(e) {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

            if (e.key === 'ArrowRight') {
                if (typeof this.onGestureUnlock === 'function') this.onGestureUnlock();
                this.goTo(1, true);
            } else if (e.key === 'ArrowLeft' || e.key === 'Escape') {
                this.goTo(0, true);
            }
        }

        goTo(targetPosition, smooth = true) {
            const clamped = Math.max(0, Math.min(1, targetPosition));
            const changed = clamped !== this.position;
            this.position = clamped;

            this.updateLayerTransform(smooth);

            if (changed && typeof this.onPageChange === 'function') {
                this.onPageChange(this.position);
            }
        }

        updateLayerTransform(smooth = true) {
            if (!this.track) return;

            const reduced = Boolean(
                typeof window !== 'undefined' &&
                    typeof window.matchMedia === 'function' &&
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches
            );

            this.track.style.transition =
                smooth && !reduced ? 'transform 380ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none';
            const offsetPercent = -this.position * 100;
            this.track.style.transform = `translateX(${offsetPercent}vw)`;

            if (this.page0) {
                if (this.position !== 0) {
                    this.page0.setAttribute('inert', '');
                    this.page0.setAttribute('aria-hidden', 'true');
                } else {
                    this.page0.removeAttribute('inert');
                    this.page0.setAttribute('aria-hidden', 'false');
                }
            }

            if (this.page1) {
                if (this.position !== 1) {
                    this.page1.setAttribute('inert', '');
                    this.page1.setAttribute('aria-hidden', 'true');
                } else {
                    this.page1.removeAttribute('inert');
                    this.page1.setAttribute('aria-hidden', 'false');
                }
            }
        }

        getPosition() {
            return this.position;
        }
    }

    root.TeacherEvan = root.TeacherEvan || {};
    root.TeacherEvan.HomePager = {
        HomePager,
        resolveSwipe,
        applyRubberBand,
        DRAG_DEAD_ZONE_PX,
        RUBBER_BAND_FACTOR,
    };
})(window);
