/**
 * The Aangika mark: the "A" formed by two reaching hands, from the team HealX
 * logo (brand/aangika_logo.png; regenerate every size with
 * scripts/brand/make_brand.py). Transparent, so it sits on every theme; served
 * from /brand so it is precached and works offline.
 */
export default function BrandMark({ size = 36, className = '' }) {
  return (
    <img
      src="/brand/mark-256.png"
      alt="Aangika"
      width={size}
      height={size}
      draggable={false}
      className={'shrink-0 select-none drop-shadow-[0_0_10px_rgba(99,102,241,0.35)] ' + className}
      style={{ width: size, height: size }}
    />
  );
}
