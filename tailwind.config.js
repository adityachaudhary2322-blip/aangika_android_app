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
        card: themed('--bg-surface'),
        'card-high': themed('--bg-surface-high'),
        'card-highest': themed('--bg-surface-highest'),

        // Accents. In light these are the 600/700 ramp so they stay legible as
        // TEXT on white; in dark they are the bright 300/400 ramp.
        primary: themed('--accent-brand'),
        secondary: themed('--accent-cyan'),
        amber: themed('--accent-amber'),
        rose: themed('--accent-rose'),

        // Type.
        ink: themed('--text-primary'),
        'ink-dim': themed('--text-muted'),

        // Hairlines. Solid colours rather than white-at-low-alpha: a
        // `border-white/10` is invisible on an off-white page.
        subtle: themed('--border-subtle'),
        strong: themed('--border-strong'),
      },
      borderColor: {
        subtle: themed('--border-subtle'),
        strong: themed('--border-strong'),
      },
      boxShadow: {
        glow: '0 0 24px -4px rgb(var(--accent-brand) / 0.45)',
        'glow-cyan': '0 0 24px -4px rgb(var(--accent-cyan) / 0.45)',
        card: 'var(--shadow-card)',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
