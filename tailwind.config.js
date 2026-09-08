/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Stitch dark palette
        surface: '#0B1326',
        'surface-low': '#060E20',
        card: '#171F33',
        'card-high': '#222A3D',
        'card-highest': '#2D3449',
        primary: '#4EDEA3',
        secondary: '#4CD7F6',
        amber: '#F59E0B',
        rose: '#F43F5E',
        ink: '#DAE2FD',
        'ink-dim': '#BBCAAF',
      },
      borderColor: {
        subtle: 'rgba(255,255,255,0.08)',
      },
      boxShadow: {
        glow: '0 0 24px -4px rgba(78,222,163,0.45)',
        'glow-cyan': '0 0 24px -4px rgba(76,215,246,0.45)',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
