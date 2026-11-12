import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';

/** "A mutual match": the chat of the shortlisted application the like created. */
export function MutualBanner({ applicationId }: { applicationId: string }) {
  const { t } = useTranslation();
  const chat = useRef<HTMLAnchorElement>(null);
  // The like button that made the match has just unmounted: focus moves to the way forward.
  useEffect(() => {
    chat.current?.focus();
  }, []);
  // The kit has no notice component: this is the one inline tint panel (spec 0009qa). The button is
  // `ink`, so the banner adds no accent fill; its text is `accent-strong` on `accent-soft`.
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent-soft px-4 py-3.5"
    >
      <p className="text-start text-body font-medium text-accent-strong">{t('likes.mutual')}</p>
      <Button ref={chat} variant="primary" to={`/chat/${applicationId}`}>
        {t('likes.toChat')}
      </Button>
    </div>
  );
}
