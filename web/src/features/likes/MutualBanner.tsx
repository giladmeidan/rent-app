import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** "A mutual match": the chat of the shortlisted application the like created. */
export function MutualBanner({ applicationId }: { applicationId: string }) {
  const { t } = useTranslation();
  const chat = useRef<HTMLAnchorElement>(null);
  // The like button that made the match has just unmounted: focus moves to the way forward.
  useEffect(() => {
    chat.current?.focus();
  }, []);
  return (
    <div
      role="status"
      className="flex flex-col items-start gap-2 rounded-2xl border border-accent-tint bg-accent-tint px-4 py-[14px]"
    >
      <p className="text-start text-[15px] font-bold text-accent-text">{t('likes.mutual')}</p>
      <Link
        ref={chat}
        to={`/chat/${applicationId}`}
        className={`inline-flex min-h-[44px] items-center rounded-full bg-accent px-4 text-[15px] font-bold text-white ${focusRing}`}
      >
        {t('likes.toChat')}
      </Link>
    </div>
  );
}
