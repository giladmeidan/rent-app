import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePageTitle } from '../../app/usePageTitle';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
import { retryAfterText } from '../../components/retryAfter';
import { Skeleton } from '../../components/Skeleton';
import { fetchAreas } from '../areas/api';
import type { LifestyleAnswers } from '../lifestyle/keys';
import { ApiError } from '../listings/api';
import { MarketPersonCard } from '../people/MarketPersonCard';
import { useMyPeopleLikes } from '../people/useMarketPeople';
import { profileHref } from '../profile/links';
import { useProfile } from '../profile/useProfile';
import { MutualBanner } from './MutualBanner';

const cardGrid = 'grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3';
const h2Class = 'text-start font-display text-h2';

/**
 * The people part of the likes page (spec 0010i), from `GET /me/people-likes`: the people who liked
 * the caller, the people they liked and their matches, each with its own empty state. Without a card
 * (403 `card_required`) the three give way to one nudge. The lists are edited in place by a like
 * (`useLikeCard`), so a card that moves does not take the page's focus with it.
 */
function PeopleSections({
  viewerLifestyle,
  onMutual,
  onGone,
}: {
  viewerLifestyle: LifestyleAnswers;
  onMutual: (conversationId: string) => void;
  onGone: () => void;
}) {
  const { t } = useTranslation();
  const people = useMyPeopleLikes();
  const areas = useQuery({ queryKey: ['areas'], queryFn: fetchAreas });
  const areaName = new Map((areas.data ?? []).map((a) => [a.id, a.name_he]));

  if (people.data === undefined) {
    if (people.isPending) {
      return (
        <Loading>
          <Skeleton className="h-40 w-full rounded-lg" />
        </Loading>
      );
    }
    if (people.error instanceof ApiError && people.error.status === 403) {
      return (
        <EmptyState
          message={t('likes.people.cardRequired')}
          action={
            <Button variant="primary" to={profileHref('/me/likes', 'about', 'looking')}>
              {t('market.people.toProfile')}
            </Button>
          }
        />
      );
    }
    if (people.error instanceof ApiError && people.error.status === 429) {
      const { retryAfter } = people.error;
      return (
        <EmptyState
          message={
            retryAfter !== null
              ? t('people.browseRateLimitedIn', { when: retryAfterText(t, retryAfter) })
              : t('people.browseRateLimited')
          }
        />
      );
    }
    return <ErrorState onRetry={() => void people.refetch()} />;
  }

  const { liked_me: likedMe, mine, matches } = people.data;
  const cards = (list: typeof likedMe) => (
    <ul className={cardGrid}>
      {list.map((card) => (
        <MarketPersonCard
          key={card.card_id}
          card={card}
          areaNames={card.area_ids.flatMap((id) => areaName.get(id) ?? [])}
          viewerLifestyle={viewerLifestyle}
          next="/me/likes"
          titleAs="h3"
          onMutual={(_card, conversationId) => onMutual(conversationId)}
          onGone={onGone}
        />
      ))}
    </ul>
  );
  return (
    <>
      <section className="flex flex-col gap-4" aria-labelledby="likes-people-liked-me">
        <h2 id="likes-people-liked-me" className={h2Class}>
          {t('likes.people.likedMe')}
        </h2>
        {likedMe.length === 0 ? (
          <EmptyState message={t('likes.people.likedMeEmpty')} />
        ) : (
          cards(likedMe)
        )}
      </section>
      <section className="flex flex-col gap-4" aria-labelledby="likes-people-mine">
        <h2 id="likes-people-mine" className={h2Class}>
          {t('likes.people.mine')}
        </h2>
        {mine.length === 0 ? <EmptyState message={t('likes.people.mineEmpty')} /> : cards(mine)}
      </section>
      <section className="flex flex-col gap-4" aria-labelledby="likes-people-matches">
        <h2 id="likes-people-matches" className={h2Class}>
          {t('likes.people.matches')}
        </h2>
        {matches.length === 0 ? (
          <EmptyState message={t('likes.people.matchesEmpty')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {matches.map((match) => (
              <li
                key={match.conversation_id}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
              >
                <Avatar name={match.display_name} photoUrl={match.photo_url} size="sm" />
                <span
                  dir="auto"
                  className="min-w-0 flex-1 [overflow-wrap:anywhere] text-start text-body"
                >
                  {match.display_name}
                </span>
                <Button variant="secondary" size="sm" to={`/chat/${match.conversation_id}`}>
                  {t('likes.toChat')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** `/me/likes`, any account (`RequireUser`, spec 0010b): people only (spec 0010i, 0010m): the people
 * who liked the caller, the ones they liked and their matches. The rooms that invited the caller
 * moved to the room applications of `/market/mine`. */
export function MyLikesPage() {
  const { t } = useTranslation();
  usePageTitle(t('likes.title'));
  const stored = useProfile().data;
  // A person match (spec 0010i): kept here, not in the lists, since the card that made the match
  // leaves them on the refetch.
  const [mutualId, setMutualId] = useState<string | null>(null);
  // A person card that left after a failed like (spec 0009g): page state, so it outlives the
  // refetch that drops the card. `tick` makes it twice take focus again.
  const [gone, setGone] = useState<{ tick: number } | null>(null);
  const goneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (gone === null) return;
    goneRef.current?.focus();
    goneRef.current?.scrollIntoView({ block: 'center' });
  }, [gone]);
  const onGone = () => {
    setMutualId(null);
    setGone((old) => ({ tick: (old?.tick ?? 0) + 1 }));
  };
  const onMutual = (conversationId: string) => {
    setGone(null);
    setMutualId(conversationId);
  };

  return (
    <PageContainer width="wide" className="flex flex-col gap-6">
      <PageHeader title={t('likes.title')} />
      {/* Always mounted, so the text change is announced; it takes focus when set. Empty, it is
          `sr-only` (out of the flow), so it adds no gap under the <h1>. */}
      <div
        ref={goneRef}
        role="alert"
        tabIndex={-1}
        className={
          gone === null
            ? 'sr-only'
            : 'flex flex-wrap items-center gap-x-3 rounded-lg bg-surface-subtle px-4 py-3 text-start text-body font-semibold text-warning focus:outline-none'
        }
      >
        {gone !== null && <span>{t('market.people.gone')}</span>}
      </div>
      {mutualId !== null && (
        <div className="flex flex-col gap-3">
          <MutualBanner key={mutualId} applicationId={mutualId} />
        </div>
      )}
      <PeopleSections
        viewerLifestyle={stored?.lifestyle ?? {}}
        onMutual={onMutual}
        onGone={onGone}
      />
    </PageContainer>
  );
}
