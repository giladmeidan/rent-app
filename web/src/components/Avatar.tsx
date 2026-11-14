import { useState } from 'react';

import { cx } from './cx';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';
export type AvatarTone = 'neutral' | 'accent';

// 40 / 48 / 56 / 96 px. `sm` reads as body text (the flatmates list), `md` and `lg` as h3, `xl` as h1.
const SIZE: Record<AvatarSize, string> = {
  sm: 'size-10 text-body font-semibold',
  md: 'size-12 text-h3 font-semibold',
  lg: 'size-14 text-h3 font-semibold',
  xl: 'size-24 text-h1 font-semibold',
};

const TONE: Record<AvatarTone, string> = {
  neutral: 'bg-surface-subtle text-ink-muted',
  accent: 'bg-accent-soft text-accent-strong',
};

type Props = {
  /** The person's name: its first code point is shown without a photo (or when it fails to load). */
  name: string;
  /** The small address of the person's photo (spec 0010j), or none. */
  photoUrl?: string | null;
  size: AvatarSize;
  tone?: AvatarTone;
  className?: string;
};

/**
 * A person's photo in a circle, or their initial (spec 0010k). Decorative (`aria-hidden`): every
 * site shows the name as text beside it.
 */
export function Avatar({ name, photoUrl = null, size, tone = 'neutral', className }: Props) {
  // A photo that failed to load shows the initial; a new address is tried again.
  const [failed, setFailed] = useState(false);
  const [triedUrl, setTriedUrl] = useState(photoUrl);
  if (triedUrl !== photoUrl) {
    setTriedUrl(photoUrl);
    setFailed(false);
  }
  const photo = failed ? null : photoUrl;

  return (
    <span
      aria-hidden="true"
      className={cx(
        'flex flex-none items-center justify-center overflow-hidden rounded-full',
        SIZE[size],
        TONE[tone],
        className,
      )}
    >
      {photo === null ? (
        (Array.from(name)[0] ?? '')
      ) : (
        <img
          src={photo}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full rounded-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
