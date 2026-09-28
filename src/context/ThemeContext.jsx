import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import {
  DEFAULT_PALETTE, CUSTOM, DEFAULT_CUSTOM_ACCENT, getPalette, customAccentVars,
  CUSTOM_VAR_NAMES,
} from '../config/themes.js';

/**
 * Theme ownership.
 *
 * The class on <html> is the single source of truth for what the page looks
 * like; this context is the single source of truth for what the class should
 * be. Nothing else may write to documentElement.classList, or the two will
 * disagree and a re-render will snap the theme back.
 *
 * THREE THINGS THIS HANDLES THAT A useState + localStorage PAIR DOES NOT:
 *
 * 1. The pre-paint class. index.html runs a tiny inline script that applies the
 *    stored theme before React exists, because a React effect runs AFTER first
 *    paint -- a dark-mode user would get a white flash on every cold load. The
 *    initial state here is read back off that same class so the two agree from
 *    the first render rather than fighting on mount.
 *
 * 2. Following the OS, but only until the user disagrees. With nothing stored
 *    we track prefers-color-scheme live. The moment someone hits the toggle the
 *    choice is written to localStorage and the OS listener stops mattering --
 *    an explicit choice must be able to disagree with the system.
 *
 * 3. The theme-color meta, so the phone's own status bar and the PWA task
 *    switcher match the app instead of staying navy behind a white page.
 */

const STORAGE_KEY = 'app_theme';
const PALETTE_KEY = 'app_palette';
const ACCENT_KEY = 'app_accent';
const AMBIENT_KEY = 'app_ambient';
const MASCOT_KEY = 'app_mascot';

function readPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}
const LIGHT = 'light';
const DARK = 'dark';

const ThemeContext = createContext(null);

function prefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStored() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === LIGHT || saved === DARK ? saved : null;
  } catch {
    // Private mode / storage disabled. The theme still works, it just will not
    // survive a reload.
    return null;
  }
}

/** What the page is showing right now, per the class the boot script set. */
function readApplied() {
  if (typeof document === 'undefined') return null;
  return document.documentElement.classList.contains(DARK) ? DARK : LIGHT;
}

function apply(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle(DARK, theme === DARK);
  // Belt and braces for form controls and scrollbars, which read the CSS
  // property rather than the class.
  root.style.colorScheme = theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === DARK ? '#0C0B14' : '#F7F6FB');
}

/**
 * Palette and custom accent. The palette is an attribute the stylesheet keys
 * off; a custom accent overrides three variables inline, recomputed per mode
 * because the readable shade differs on a light and a dark page.
 */
function applyPalette(palette, accent, theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (palette === DEFAULT_PALETTE || palette === CUSTOM) root.removeAttribute('data-palette');
  else root.setAttribute('data-palette', palette);
  for (const name of CUSTOM_VAR_NAMES) root.style.removeProperty(name);
  if (palette === CUSTOM) {
    const vars = customAccentVars(accent, theme === DARK) || {};
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  }
}

export function ThemeProvider({ children }) {
  // Stored choice wins; failing that, whatever the boot script already painted;
  // failing that, the OS.
  const [theme, setTheme] = useState(
    () => readStored() || readApplied() || (prefersDark() ? DARK : LIGHT)
  );
  const [explicit, setExplicit] = useState(() => readStored() !== null);
  const [palette, setPaletteState] = useState(() => {
    const p = readPref(PALETTE_KEY, DEFAULT_PALETTE);
    return p === CUSTOM || getPalette(p) ? p : DEFAULT_PALETTE;
  });
  const [customAccent, setCustomAccentState] = useState(
    () => readPref(ACCENT_KEY, DEFAULT_CUSTOM_ACCENT)
  );
  const [ambientOn, setAmbientOn] = useState(() => readPref(AMBIENT_KEY, 'on') !== 'off');
  const [mascotOn, setMascotOn] = useState(() => readPref(MASCOT_KEY, 'on') !== 'off');

  useEffect(() => {
    apply(theme);
  }, [theme]);

  useEffect(() => {
    applyPalette(palette, customAccent, theme);
  }, [palette, customAccent, theme]);

  const setPalette = useCallback((id) => {
    setPaletteState(id);
    writePref(PALETTE_KEY, id);
  }, []);
  const setCustomAccent = useCallback((hex) => {
    setCustomAccentState(hex);
    setPaletteState(CUSTOM);
    writePref(ACCENT_KEY, hex);
    writePref(PALETTE_KEY, CUSTOM);
  }, []);
  const setAmbient = useCallback((on) => {
    setAmbientOn(on);
    writePref(AMBIENT_KEY, on ? 'on' : 'off');
  }, []);
  const setMascot = useCallback((on) => {
    setMascotOn(on);
    writePref(MASCOT_KEY, on ? 'on' : 'off');
  }, []);

  // Track the OS only while the user has expressed no preference of their own.
  useEffect(() => {
    if (explicit || typeof window === 'undefined' || !window.matchMedia) {
      return undefined;
    }
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setTheme(e.matches ? DARK : LIGHT);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [explicit]);

  const choose = useCallback((next) => {
    const value = next === DARK ? DARK : LIGHT;
    setTheme(value);
    setExplicit(true);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch { /* private mode */ }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === DARK ? LIGHT : DARK;
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch { /* private mode */ }
      return next;
    });
    setExplicit(true);
  }, []);

  const value = useMemo(() => ({
    theme,
    isDark: theme === DARK,
    /** False while still following the OS, for a UI that wants to say so. */
    isExplicit: explicit,
    setTheme: choose,
    toggleTheme,
    palette,
    setPalette,
    customAccent,
    setCustomAccent,
    /** The animated layer to draw, or null. */
    ambient: ambientOn ? (getPalette(palette)?.ambient || null) : null,
    ambientOn,
    setAmbient,
    mascotOn,
    setMascot,
  }), [
    theme, explicit, choose, toggleTheme, palette, setPalette, customAccent,
    setCustomAccent, ambientOn, setAmbient, mascotOn, setMascot,
  ]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * Read the theme.
 *
 * Throws outside a provider rather than handing back a plausible default: a
 * silent fallback means a component renders in the wrong theme forever and the
 * missing <ThemeProvider> is never found.
 */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() must be used inside a <ThemeProvider>.');
  }
  return ctx;
}

export default ThemeContext;
