import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext.jsx';

/**
 * Sun / moon theme switch.
 *
 * Both icons are always mounted and stacked on top of each other; the swap is a
 * cross-fade plus a quarter turn, not a conditional render. Swapping the JSX
 * instead would remount the icon and there would be nothing to animate between
 * -- the icon would just pop.
 *
 * `variant="overlay"` is for chrome that floats over live video, where the
 * backdrop is the camera rather than the theme's page colour.
 */
export default function ThemeToggle({ variant = 'surface', compact = false, className = '' }) {
  const { isDark, toggleTheme } = useTheme();

  const skin = variant === 'overlay'
    ? 'chrome-plate text-slate-900 dark:text-white'
    : 'border border-subtle bg-card-high text-ink';

  // Size is a prop rather than a caller-supplied class: both would land in the
  // same utilities layer, and Tailwind emits h-7 before h-9, so an `h-7`
  // passed through className loses to the base and silently does nothing.
  const box = compact ? 'h-7 w-7' : 'h-9 w-9';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      // aria-pressed would be ambiguous here ("pressed" meaning dark? light?),
      // so the label states the ACTION and the live state is announced by it
      // changing after the tap.
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light theme' : 'Dark theme'}
      className={
        'relative flex shrink-0 items-center justify-center ' +
        'overflow-hidden rounded-full transition active:scale-90 ' +
        box + ' ' + skin + ' ' + className
      }
    >
      <Sun
        size={compact ? 13 : 16}
        aria-hidden="true"
        className={
          'absolute transition-all duration-300 ' +
          (isDark
            ? 'rotate-90 scale-50 opacity-0'
            : 'rotate-0 scale-100 text-amber opacity-100')
        }
      />
      <Moon
        size={compact ? 13 : 16}
        aria-hidden="true"
        className={
          'absolute transition-all duration-300 ' +
          (isDark
            ? 'rotate-0 scale-100 text-secondary opacity-100'
            : '-rotate-90 scale-50 opacity-0')
        }
      />
    </button>
  );
}
