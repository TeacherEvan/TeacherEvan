(function (root) {
    'use strict';

    /** @type {{ light: Array<{primary: string, secondary: string, accent: string}>, dark: Array<{primary: string, secondary: string, accent: string}> }} */
    const SPRITE_PALETTES = {
        // Dawn nebula backdrop (#f4f1ff): mid-tone saturated inks.
        light: [
            { primary: '#0a86ad', secondary: '#096b8c', accent: '#0a8fb0' }, // cyan
            { primary: '#b3129e', secondary: '#8f0d7f', accent: '#cf1f8f' }, // magenta
            { primary: '#a67c00', secondary: '#8f6f00', accent: '#b07d00' }, // amber
            { primary: '#0f8a3d', secondary: '#0b6e31', accent: '#169044' }, // green
            { primary: '#c81e3a', secondary: '#a5162e', accent: '#e02444' }, // red
            { primary: '#c05600', secondary: '#9c4500', accent: '#d4700a' }, // orange
            { primary: '#1f4fd8', secondary: '#1840b0', accent: '#2f66e8' }, // blue
            { primary: '#6d28d9', secondary: '#571fb0', accent: '#8547e8' }, // purple
            { primary: '#c2185b', secondary: '#9e1349', accent: '#d92b6f' }, // pink
        ],
        // Cosmic void / Dark Academia backdrop (#0e0c16): saturated neon inks.
        dark: [
            { primary: '#00f0ff', secondary: '#0088ff', accent: '#7ffcff' }, // cyan
            { primary: '#e000ff', secondary: '#8a00ff', accent: '#ff8cff' }, // magenta
            { primary: '#ffc700', secondary: '#ff8c00', accent: '#ffe680' }, // amber
            { primary: '#22ff00', secondary: '#7dff5c', accent: '#c8ffb0' }, // lime
            { primary: '#ff4d6d', secondary: '#ff2e4d', accent: '#ff9aa2' }, // red
            { primary: '#ff8a1f', secondary: '#ff6a00', accent: '#ffc28a' }, // orange
            { primary: '#3d7bff', secondary: '#6ea8ff', accent: '#b6d0ff' }, // blue
            { primary: '#a855f7', secondary: '#8b5cf6', accent: '#d8b4fe' }, // purple
            { primary: '#ff5fa2', secondary: '#ff8dc2', accent: '#ffc2dd' }, // pink
        ],
    };

    /**
     * Convert `#rrggbb` (or `#rgb`) to `r, g, b` channels for canvas `rgba(...)`.
     * Computed once per sprite at spawn time to avoid hot-path parsing.
     *
     * @param {string} hex
     * @returns {string}
     */
    function hexToRgbChannels(hex) {
        if (typeof hex !== 'string') return '255, 255, 255';
        let value = hex.trim().replace('#', '');
        if (value.length === 3) {
            value = value
                .split('')
                .map((c) => c + c)
                .join('');
        }
        if (!/^[0-9a-fA-F]{6}$/.test(value)) return '255, 255, 255';
        const num = parseInt(value, 16);
        return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
    }

    root.TeacherEvan = root.TeacherEvan || {};
    root.TeacherEvan.SpritePalette = {
        SPRITE_PALETTES,
        hexToRgbChannels,
    };
})(window);
