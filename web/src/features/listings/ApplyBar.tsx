import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { useMe } from '../auth/useMe';
import { canApply } from '../applications/canApply';
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
 * apply (a visitor, or an account that `canApply` here with no live application, on a room that
 * fits; never on its own listing, spec 0010b), and only where
 * `IntersectionObserver` exists. The apply form stays in `ApplySection`.
 */
export function ApplyBar({ listing, target, headingRef }: Props) {
  const { t } = useTranslation();
  const me = useMe();
  const mayApply = me.data != null && canApply(me.data, listing);
  const mine = useMyApplications(mayApply);
  const [below, setBelow] = useState(false);

  const showBar =
    me.data === null ||
    (mayApply &&
      !me.isError &&
      mine.isSuccess &&
      !mine.data.some((a) => a.listing.id === listing.id && a.status !== 'withdrawn') &&
      listing.room_fit !== false);

  useEffect(() => {
    const node = target.current;
    if (!showBar || node === null || typeof IntersectionObserver === 'undefined') return;
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
  }, [showBar, target]);

  if (!showBar || !below) return null;

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
        {/* The section's own wording: "I'm interested" on a room (spec 0010l). */}
        {listing.listing_type === 'room' ? t('applications.room.cta') : t('applications.apply')}
      </Button>
    </div>
  );
}
