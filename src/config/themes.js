/**
 * Palettes the user can pick, in Settings and from the guide.
 *
 * The colours themselves live in src/index.css (generated so every accent
 * clears contrast in both modes); `swatch` here is only for the picker.
 * `ambient` names the animated layer drawn behind the app, if any.
 */
export const PALETTES = [
  // Made for the glass style: deep, softly lit backdrops (teal mist, warm copper).
  { id: 'lagoon', name: 'Lagoon', swatch: ['#2F9E7A', '#2B6F8F'] },
  { id: 'copper', name: 'Copper', swatch: ['#C8672A', '#7A3413'] },
  { id: 'iris', name: 'Iris', swatch: ['#7C3AED', '#0D9488'] },
  { id: 'ocean', name: 'Ocean', swatch: ['#2563EB', '#0891B2'] },
  { id: 'forest', name: 'Forest', swatch: ['#059669', '#B45309'] },
  { id: 'ember', name: 'Ember', swatch: ['#EA580C', '#0F766E'] },
  { id: 'sakura', name: 'Cherry blossom', swatch: ['#DB2777', '#9333EA'], ambient: 'sakura' },
  { id: 'autumn', name: 'Autumn', swatch: ['#D97706', '#BE123C'], ambient: 'autumn' },
  { id: 'winter', name: 'Winter', swatch: ['#0284C7', '#4F46E5'], ambient: 'winter' },
  { id: 'fireflies', name: 'Fireflies', swatch: ['#15803D', '#A16207'], ambient: 'fireflies' },
];

/** The palette with no data-palette attribute (the stylesheet's :root values). */
export const DEFAULT_PALETTE = 'iris';
/** What a new user starts on (index.html's boot script agrees). */
export const INITIAL_PALETTE = 'lagoon';

/** Visual style: 'glass' (frosted surfaces over a lit backdrop) or 'classic'. */
export const UI_STYLES = ['glass', 'classic'];
export const DEFAULT_UI_STYLE = 'glass';
export const CUSTOM = 'custom';
export const DEFAULT_CUSTOM_ACCENT = '#E11D48';

export const getPalette = (id) => PALETTES.find((p) => p.id === id) || null;

// ── Custom accent ───────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}

const channels = (rgb) => rgb.join(' ');

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Walk lightness from `start` in `step` until `ok(rgb)` holds. */
function findLightness(h, s, start, step, ok) {
  for (let l = start; l > 0.05 && l < 0.95; l += step) {
    const rgb = hslToRgb(h, s, l);
    if (ok(rgb)) return rgb;
  }
  return hslToRgb(h, s, step < 0 ? 0.2 : 0.85);
}

const WHITE = [255, 255, 255];
const PAGE_LIGHT = [248, 247, 252];
const PAGE_DARK = [14, 13, 20];

/**
 * CSS variables for a user-picked accent. The colour is never trusted as-is:
 * its hue and saturation are kept, and lightness is searched until it clears
 * 4.5:1 as text on the page (either mode) and 3.5:1 under white text as a
 * fill. A pale yellow pick therefore becomes a readable ochre, not a ghost.
 */
export function customAccentVars(hex, dark) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [h, s0] = rgbToHsl(rgb);
  // Near-greys stay grey; anything with colour is kept vivid enough to read.
  const s = s0 < 0.08 ? s0 : Math.max(0.45, Math.min(s0, 0.9));
  const brand = dark
    ? findLightness(h, s, 0.55, 0.02, (c) => contrast(c, PAGE_DARK) >= 4.5)
    : findLightness(h, s, 0.5, -0.02, (c) => contrast(c, PAGE_LIGHT) >= 4.5);
  const fillA = findLightness(h, s, 0.5, -0.02, (c) => contrast(WHITE, c) >= 3.5);
  const fillB = findLightness(h + 18, s, 0.4, -0.02, (c) => contrast(WHITE, c) >= 4.5);
  return {
    '--accent-brand': channels(brand),
    '--fill-a': channels(fillA),
    '--fill-b': channels(fillB),
  };
}

export const CUSTOM_VAR_NAMES = ['--accent-brand', '--fill-a', '--fill-b'];
