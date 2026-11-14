import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Tag } from '../../components/Tag';
import { cx } from '../../components/cx';
import { focusRing } from '../../components/focusRing';
import type { PhotoOut } from './api';

/** The neutral photo placeholder icon of the card. */
function PlaceholderIcon() {
  return (
    <svg
      aria-hidden="true"
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      className="text-ink-muted"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M21 16l-5-5-8 8" />
    </svg>
  );
}

// The photo box: 16:10, edge to edge on a phone, from `lg` with its width capped (start-aligned), so
// it is at most 480 px tall (16:10 at 768 px).
const BOX = '-mx-4 aspect-[16/10] md:-mx-6 lg:mx-0 lg:max-w-3xl lg:rounded-lg';

/** The loading skeleton's box: the gallery's own, so nothing shifts when the page arrives. */
export const GALLERY_SKELETON = `${BOX} lg:col-span-2`;

type Props = {
  /** The listing's photos in order (spec 0010d); the first is the cover. */
  photos: PhotoOut[];
  /** The listing's title, which words each image's `alt`. */
  title: string;
};

/**
 * The listing page's photos (spec 0010k, Listing.dc.html's gallery): a main image, a "n / total"
 * counter and a row of thumbnails when there are several. No photos: the card's neutral placeholder
 * band. Render it with `key={listing.id}` so a new listing starts at the first photo.
 */
export function Gallery({ photos, title }: Props) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState(0);
  // The main image's address that failed to load (the placeholder takes its place).
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (photos.length === 0) {
    return (
      <div className="-mx-4 flex h-40 items-center justify-center bg-surface-subtle md:-mx-6 lg:col-span-2 lg:mx-0 lg:h-64 lg:rounded-lg">
        <PlaceholderIcon />
      </div>
    );
  }

  // `photos` can shrink under the page (a refetch after a delete).
  const index = Math.min(picked, photos.length - 1);
  const total = photos.length;
  const main = photos[index] as PhotoOut;
  const failed = failedUrl === main.large_url;

  return (
    <div className="flex flex-col gap-2 lg:col-span-2">
      <div
        className={cx(
          BOX,
          'relative flex items-center justify-center overflow-hidden bg-surface-subtle',
        )}
      >
        {failed ? (
          <PlaceholderIcon />
        ) : (
          <img
            src={main.large_url}
            alt={t('listing.photos.alt', { title, n: index + 1, total })}
            decoding="async"
            className="absolute inset-0 size-full object-cover"
            onError={() => setFailedUrl(main.large_url)}
          />
        )}
        {total > 1 && (
          // `dir="ltr"`: in a right-to-left line "2 / 3" would read "3 / 2".
          <Tag
            tone="inverse"
            size="sm"
            aria-hidden="true"
            dir="ltr"
            className="absolute bottom-3 end-3"
          >
            {t('listing.photos.counter', { n: index + 1, total })}
          </Tag>
        )}
      </div>
      {total > 1 && (
        <div className="flex gap-2 overflow-x-auto p-1 lg:max-w-3xl">
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              type="button"
              aria-label={t('listing.photos.show', { n: i + 1, total })}
              aria-pressed={i === index}
              onClick={() => setPicked(i)}
              className={cx(
                'h-14 flex-none aspect-[16/10] overflow-hidden rounded-md border-2 bg-surface-subtle',
                i === index ? 'border-accent' : 'border-transparent',
                focusRing,
              )}
            >
              <img
                src={photo.small_url}
                alt=""
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
