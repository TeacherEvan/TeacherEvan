(function (root) {
    'use strict';

    /** Trail history length. */
    const TRAIL_CAPACITY = 12;

    /**
     * Longest trail segment that may be drawn, in CSS pixels.
     * Splits runs on teleports (edge wrap, grab-drag, resize).
     */
    const TRAIL_MAX_SEGMENT = 160;

    class SpriteTrail {
        /**
         * @param {number} [capacity] Ring-buffer size.
         */
        constructor(capacity = TRAIL_CAPACITY) {
            this.capacity = Math.max(2, Math.floor(capacity));
            this.points = [];
            this.head = 0;
            this.length = 0;
            this._run = [];
        }

        /** Append a position using pooled point objects (zero steady-state alloc). */
        push(x, y) {
            let point = this.points[this.head];
            if (!point) {
                point = { x: 0, y: 0 };
                this.points[this.head] = point;
            }
            point.x = x;
            point.y = y;

            this.head = (this.head + 1) % this.capacity;
            if (this.length < this.capacity) this.length += 1;
        }

        /** Drop the whole history after any teleport so no cross-canvas streak is drawn. */
        clear() {
            this.length = 0;
            this.head = 0;
        }

        _indexAt(i) {
            return (this.head - this.length + i + this.capacity * 2) % this.capacity;
        }

        /**
         * Visit every contiguous run of points as a polyline, splitting wherever
         * consecutive points are further apart than `maxSegment`.
         *
         * @param {(run: Array<{x: number, y: number}>) => void} visit
         * @param {number} [maxSegment]
         */
        forEachRun(visit, maxSegment = TRAIL_MAX_SEGMENT) {
            const run = this._run;
            run.length = 0;

            for (let i = 0; i < this.length; i++) {
                const point = this.points[this._indexAt(i)];
                const previous = run.length > 0 ? run[run.length - 1] : null;

                if (
                    previous &&
                    (Math.abs(point.x - previous.x) > maxSegment ||
                        Math.abs(point.y - previous.y) > maxSegment)
                ) {
                    visit(run);
                    run.length = 0;
                }

                run.push(point);
            }

            if (run.length > 1) visit(run);
            run.length = 0;
        }
    }

    root.TeacherEvan = root.TeacherEvan || {};
    root.TeacherEvan.SpriteTrail = {
        SpriteTrail,
        TRAIL_CAPACITY,
        TRAIL_MAX_SEGMENT,
    };
})(window);
