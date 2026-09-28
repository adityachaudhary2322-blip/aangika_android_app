/**
 * The Aangika mark: an open palm drawn as one continuous stroke, set in a
 * rounded tile. Drawn rather than an emoji so it follows the palette and
 * renders the same on every platform.
 */
export default function BrandMark({ size = 36, className = '' }) {
  return (
    <span
      className={
        'inline-flex shrink-0 items-center justify-center rounded-[30%] '
        + 'bg-gradient-to-br from-fill-a to-fill-b text-white shadow-glow ' + className
      }
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.6}
        height={size * 0.6}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 12.5V6.8a1.4 1.4 0 0 1 2.8 0V11" />
        <path d="M9.8 10.6V4.9a1.4 1.4 0 0 1 2.8 0v5.7" />
        <path d="M12.6 10.6V5.6a1.4 1.4 0 0 1 2.8 0v6" />
        <path d="M15.4 11.4V8.6a1.4 1.4 0 0 1 2.8 0v5.2c0 3.9-2.8 6.7-6.4 6.7h-.4c-2.3 0-3.9-1-5.1-2.8L4.4 14.3a1.4 1.4 0 0 1 2.3-1.6L7 13" />
      </svg>
    </span>
  );
}
