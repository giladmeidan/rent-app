import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { useMe } from '../auth/useMe';
import { useMyApplications } from '../applications/useMyApplications';
import type { ListingDetail } from './api';

type Props = {
  listing: ListingDetail;
  /** The page's action column: the bar shows while it is below the screen. */
  target: RefObject<HTMLElement | null>;
  /** The apply section's `<h2>`, which takes focus after the jump. */
  headingRef: RefObject<HTMLElement | null>;
};

/**
 * The phone's sticky bar: one button that jumps to the apply section. It shows only while the
 * action column is below the viewport (never over the footer), only to someone who can still
 * apply (a visitor, or a seeker with no live application on a room that fits), and only where
 * `IntersectionObserver` exists. The apply form stays in `ApplySection`.
 */
export function ApplyBar({ listing, target, headingRef }: Props) {
  const { t } = useTranslation();
  const me = useMe();
  const isSeeker = me.data?.role === 'seeker';
  const mine = useMyApplications(isSeeker);
  const [below, setBelow] = useState(false);

  const canApply =
    me.data === null ||
    (isSeeker &&
      !me.isError &&
      mine.isSuccess &&
      !mine.data.some((a) => a.listing.id === listing.id && a.status !== 'withdrawn') &&
      listing.room_fit !== false);

  useEffect(() => {
    const node = target.current;
    if (!canApply || node === null || typeof IntersectionObserver === 'undefined') return;
    // The bottom margin counts the action column as "below" a little before it is out of sight.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry !== undefined) {
          setBelow(!entry.isIntersecting && entry.boundingClientRect.top > 0);
        }
      },
      { rootMargin: '0px 0px -96px 0px' },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [canApply, target]);

  if (!canApply || !below) return null;

  function jump() {
    target.current?.scrollIntoView({ block: 'start' });
    headingRef.current?.focus({ preventScroll: true });
  }

  return (
    <div
      data-sticky-footer
      data-testid="apply-bar"
      // The safe-area inset keeps the button clear of the iPhone home indicator.
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <Button variant="primary" size="lg" fullWidth onClick={jump}>
        {t('applications.apply')}
      </Button>
    </div>
  );
}
