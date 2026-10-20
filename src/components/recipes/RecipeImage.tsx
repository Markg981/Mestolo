import { cx } from '../ui';

const PALETTES = [
  ['var(--saffron)', 'var(--saffron-wash)'],
  ['var(--basil)', 'var(--basil-wash)'],
  ['var(--tomato)', 'var(--tomato-wash)'],
  ['var(--ink)', 'var(--surface-sunk)'],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Elegant placeholder: the recipe initial on a tile pattern, coloured from the title. */
export function RecipePlaceholder({ title, className, large }: { title: string; className?: string; large?: boolean }) {
  const [fg, bg] = PALETTES[hash(title) % PALETTES.length];
  const initial = (title.trim()[0] ?? 'M').toUpperCase();
  return (
    <div aria-hidden className={cx('relative flex items-center justify-center overflow-hidden', className)} style={{ background: bg }}>
      <svg className="absolute inset-0 h-full w-full opacity-40" preserveAspectRatio="none" viewBox="0 0 40 40">
        <defs>
          <pattern id={`p${hash(title)}`} width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M0 10 L10 0" stroke={fg} strokeWidth="0.6" opacity="0.5" />
          </pattern>
        </defs>
        <rect width="40" height="40" fill={`url(#p${hash(title)})`} />
      </svg>
      <span className="relative font-display font-extrabold" style={{ color: fg, fontSize: large ? '7rem' : '3.2rem', fontStretch: '75%' }}>
        {initial}
      </span>
    </div>
  );
}

export function RecipeImage({ imageId, title, alt, size = 'thumb', className, priority }: { imageId: string | null; title: string; alt?: string; size?: 'thumb' | 'full'; className?: string; priority?: boolean }) {
  if (!imageId) return <RecipePlaceholder title={title} className={className} large={size === 'full'} />;
  return (
    <img
      src={`/api/images/${imageId}${size === 'thumb' ? '?size=thumb' : ''}`}
      alt={alt ?? ''}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={cx('object-cover', className)}
    />
  );
}
