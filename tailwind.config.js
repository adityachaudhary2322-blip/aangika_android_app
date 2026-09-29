/** @type {import('tailwindcss').Config} */

/**
 * Every semantic colour resolves through a CSS variable rather than a literal
 * hex, which is what makes one class name mean two different things in the two
 * themes. `bg-card` is the same class in both; only the variable underneath it
 * moves. That is why adding the light theme did not require rewriting hundreds
 * of `bg-card` / `text-ink` call sites.
 *
 * The variables hold SPACE-SEPARATED RGB CHANNELS ("15 23 42"), not `rgb(...)`
 * strings, so that Tailwind's `<alpha-value>` placeholder still works: without
 * that, `bg-card/60` would silently produce an invalid colour and render
 * nothing. See src/index.css for the values.
 */
const themed = (name) => `rgb(var(${name}) / <alpha-value>)`;
/**
 * Surfaces and hairlines also take a style-level multiplier: the glass style
 * (index.css, [data-style="glass"]) lowers --card-alpha / --line-alpha so
 * every `bg-card` and `border-subtle` in the app turns to frosted glass
 * without touching each component. Classic leaves both at 1 (unchanged).
 */
const surface = (name) => `rgb(var(${name}) / calc(<alpha-value> * var(--card-alpha, 1)))`;
const line = (name) => `rgb(var(${name}) / calc(<alpha-value> * var(--line-alpha, 1)))`;
const lineStrong = (name) => `rgb(var(${name}) / calc(<alpha-value> * var(--line-strong-alpha, 1)))`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Theme is switched by putting `.dark` on <html>, not by the OS media query,
  // because the user's explicit choice has to be able to disagree with the OS.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Page and raised surfaces, lightest-to-deepest in whichever theme.
        surface: themed('--bg-main'),
        'surface-low': themed('--bg-deep'),
        card: surface('--bg-surface'),
        'card-high': surface('--bg-surface-high'),
        'card-highest': surface('--bg-surface-highest'),

        // Accents. In light these are the 600/700 ramp so they stay legible as
        // TEXT on white; in dark they are the bright 300/400 ramp.
        primary: themed('--accent-brand'),
        secondary: themed('--accent-cyan'),
        amber: themed('--accent-amber'),
        // Deep gradient stops that carry white text in every palette.
        'fill-a': themed('--fill-a'),
        'fill-b': themed('--fill-b'),
        'fill-c': themed('--fill-c'),
        'fill-d': themed('--fill-d'),
        rose: themed('--accent-rose'),

        // Type.
        ink: themed('--text-primary'),
        'ink-dim': themed('--text-muted'),

        // Hairlines. Solid colours rather than white-at-low-alpha: a
        // `border-white/10` is invisible on an off-white page.
        subtle: line('--border-subtle'),
        strong: lineStrong('--border-strong'),
      },
      borderColor: {
        subtle: line('--border-subtle'),
        strong: lineStrong('--border-strong'),
      },
      boxShadow: {
        glow: '0 10px 30px -12px rgb(var(--fill-a) / 0.55)',
        'glow-cyan': '0 10px 30px -12px rgb(var(--fill-c) / 0.55)',
        card: 'var(--shadow-card)',
      },
      fontFamily: {
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
