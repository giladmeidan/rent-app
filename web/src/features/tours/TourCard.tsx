import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useConfirm } from '../../components/Dialog';
import { useOnline } from '../../components/useOnline';
import type { ThreadOut } from '../chat/api';
import { tourErrorText } from './errors';
import { formatTourWhen } from './format';
import { SlotPicker } from './SlotPicker';
import { useCancelTour } from './useTourActions';

/**
 * The tour card of a chat thread: the seeker books, moves or cancels, the lister cancels or is
 * pointed to their tour times. Nothing for a flatmate, a direct chat, or a closed chat with no
 * tour. `id` is the chat's (= the application's) id.
 */
export function TourCard({ id, thread }: { id: string; thread: ThreadOut }) {
  const { t } = useTranslation();
  const online = useOnline();
  const [confirm, confirmDialog] = useConfirm();
  const cancel = useCancelTour(id);
  const [picking, setPicking] = useState(false);
  const [done, setDone] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // After a booking, a move or a cancel its button is gone or stale: the heading takes focus (a
  // parent effect, so it runs after the dialog gave focus back to its opener).
  useEffect(() => {
    if (done > 0) headingRef.current?.focus();
  }, [done]);

  const { tour, my_role: role, listing } = thread;
  const party = role === 'seeker' || role === 'owner';
  if (!party || (tour === null && !(listing !== null && thread.can_send))) return null;

  async function onCancel() {
    if (tour === null) return;
    const ok = await confirm({
      title: t('tours.card.cancelConfirm'),
      confirmLabel: t('tours.card.cancel'),
      tone: 'danger',
    });
    if (!ok) return;
    cancel.mutate(tour.id, { onSuccess: () => setDone((n) => n + 1) });
  }

  let content;
  if (tour !== null) {
    content = (
      <>
        <p className="text-body">
          {t('tours.card.booked', { when: formatTourWhen(tour.starts_at) })}
        </p>
        <div className="flex flex-wrap gap-2">
          {role === 'seeker' && (
            <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
              {t('tours.card.reschedule')}
            </Button>
          )}
          <Button variant="ghost" size="sm" busy={cancel.isPending} onClick={() => void onCancel()}>
            {t('tours.card.cancel')}
          </Button>
        </div>
      </>
    );
  } else if (role === 'seeker') {
    content = (
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setPicking(true)}>
        {t('tours.card.book')}
      </Button>
    );
  } else {
    content = (
      <>
        <p className="text-body text-ink-muted">{t('tours.card.ownerHint')}</p>
        {listing !== null && (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            to={`/me/listings/${listing.id}/tours`}
          >
            {t('listings.mine.tours')}
          </Button>
        )}
      </>
    );
  }

  return (
    <Card padding="md" className="flex flex-col gap-3">
      <h2 ref={headingRef} tabIndex={-1} className="text-h3 focus:outline-none">
        {t('tours.card.title')}
      </h2>
      {content}
      {cancel.isError && (
        <p role="alert" className="text-body-sm font-semibold text-danger">
          {tourErrorText(t, cancel.error, online)}
        </p>
      )}
      {role === 'seeker' && (
        <SlotPicker
          open={picking}
          onClose={() => setPicking(false)}
          onDone={() => setDone((n) => n + 1)}
          conversationId={id}
          tourId={tour?.id ?? null}
        />
      )}
      {confirmDialog}
    </Card>
  );
}
