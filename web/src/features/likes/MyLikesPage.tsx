import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { usePageTitle } from '../../app/usePageTitle';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { focusRing } from '../../components/focusRing';
import { Loading } from '../../components/Loading';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
import { Skeleton } from '../../components/Skeleton';
import { fetchAreas } from '../areas/api';
import type { LifestyleAnswers } from '../lifestyle/keys';
import { ListingCard } from '../listings/ListingCard';
import { ApiError } from '../listings/api';
import { MarketPersonCard } from '../people/MarketPersonCard';
import { useMyPeopleLikes } from '../people/useMarketPeople';
import { todayInIsrael } from '../listings/format';
import { MatchBadge } from '../match/MatchBadge';
import { MatchChips } from '../match/MatchChips';
import { hasLooking, type LookingProfile } from '../profile/api';
import { profileHref } from '../profile/links';
import { useProfile } from '../profile/useProfile';
import type { LikedRoomOut, LikeStateOut } from './api';
import { LikeRoomButton } from './LikeRoomButton';
import { MutualBanner } from './MutualBanner';
import { useMyLikes } from './useMyLikes';

type GoneReason = 'gone' | 'alreadyApplied' | 'personGone';

function RoomList({
  items,
  like,
  profile,
  empty,
  onMutual,
  onToMine,
  onGone,
}: {
  items: LikedRoomOut[];
  like: LikeStateOut;
  /** The seeker's profile, which words the match chips (`undefined`: none, no looking part, or not
   * loaded). */
  profile: LookingProfile | undefined;
  empty: ReactNode;
  onMutual: (applicationId: string) => void;
  /** A card left its place for (or from) "mine": an unlike, or a like that is not mutual. */
  onToMine: () => void;
  /** A failed like or unlike takes the card out of the lists (spec 0009g). */
  onGone: (reason: GoneReason) => void;
}) {
  const today = todayInIsrael();
  if (items.length === 0) return empty;
  return (
    <ul className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map(({ listing }) => (
        <li key={listing.id}>
          {/* `h3`: the cards sit under the section `<h2>`s. */}
          <ListingCard
            listing={listing}
            today={today}
            to={`/listings/${listing.id}`}
            titleAs="h3"
            coverUrl={listing.cover?.small_url}
            seekerBirthYear={profile?.birth_year}
            badge={listing.match && <MatchBadge score={listing.match.score} />}
          >
            {listing.match && (
              <MatchChips match={listing.match} listing={listing} profile={profile} />
            )}
            {/* Above the card's stretched link, so a click reaches the button. */}
            <div className="relative z-10">
              <LikeRoomButton
                listingId={listing.id}
                like={like}
                onMutual={onMutual}
                onUnliked={onToMine}
                onLikedNotMutual={onToMine}
                onGone={onGone}
              />
            </div>
          </ListingCard>
        </li>
      ))}
    </ul>
  );
}

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

/** `/me/likes`, any account (`RequireUser`, spec 0010b): the rooms that liked the caller and the ones
 * they liked. */
export function MyLikesPage() {
  const { t } = useTranslation();
  usePageTitle(t('likes.title'));
  const likes = useMyLikes();
  const stored = useProfile().data;
  const profile = hasLooking(stored) ? stored : undefined;
  // Kept here, not in the lists: the card that made the match leaves them on the refetch.
  const [mutualId, setMutualId] = useState<string | null>(null);
  // Why a card left after a failed like or unlike (spec 0009g): page state, so it outlives the
  // refetch that drops the card. `tick` makes the same reason twice take focus again.
  const [gone, setGone] = useState<{ reason: GoneReason; tick: number } | null>(null);
  const goneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (gone === null) return;
    goneRef.current?.focus();
    goneRef.current?.scrollIntoView({ block: 'center' });
  }, [gone]);
  const onGone = (reason: GoneReason) => {
    setMutualId(null);
    setGone((old) => ({ reason, tick: (old?.tick ?? 0) + 1 }));
  };
  const onMutual = (applicationId: string) => {
    setGone(null);
    setMutualId(applicationId);
  };
  // After a successful unlike, or a like that only moved the card to "mine" (spec 0009t): the
  // card's button leaves, so focus goes to the "mine" heading once the lists are refetched. A
  // failed like or unlike never sets this.
  const focusMine = useRef(false);
  const mineRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focusMine.current || likes.isFetching) return;
    focusMine.current = false;
    mineRef.current?.focus();
  }, [likes.isFetching, likes.dataUpdatedAt]);
  const toMine = () => {
    focusMine.current = true;
  };

  let body;
  if (likes.isPending) {
    body = (
      <Loading>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 w-full rounded-lg" />
          ))}
        </div>
      </Loading>
    );
  } else if (likes.isError && likes.data === undefined) {
    body = <ErrorState onRetry={() => likes.refetch()} />;
  } else {
    body = (
      <>
        <section className="flex flex-col gap-4" aria-labelledby="likes-liked-me">
          <h2 id="likes-liked-me" className="text-start font-display text-h2">
            {t('likes.likedMe')}
          </h2>
          <RoomList
            items={likes.data.liked_me}
            like={{ liked_by_me: false, liked_me: true }}
            onMutual={onMutual}
            onToMine={toMine}
            onGone={onGone}
            profile={profile}
            empty={
              <EmptyState
                pose="sleep"
                message={t('likes.likedMeEmpty')}
                action={
                  <Button variant="ghost" to={profileHref('/me/likes', 'about', 'looking')}>
                    {t('likes.toProfile')}
                  </Button>
                }
              />
            }
          />
        </section>
        <section className="flex flex-col gap-4" aria-labelledby="likes-mine">
          <h2
            ref={mineRef}
            id="likes-mine"
            tabIndex={-1}
            className="text-start font-display text-h2 focus:outline-none"
          >
            {t('likes.mine')}
          </h2>
          <RoomList
            items={likes.data.mine}
            like={{ liked_by_me: true, liked_me: false }}
            onMutual={onMutual}
            onToMine={toMine}
            onGone={onGone}
            profile={profile}
            empty={
              <EmptyState
                pose={likes.data.liked_me.length === 0 ? undefined : 'sleep'}
                message={t('likes.mineEmpty')}
              />
            }
          />
        </section>
      </>
    );
  }

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
        {gone?.reason === 'gone' && <span>{t('likes.errors.gone')}</span>}
        {gone?.reason === 'personGone' && <span>{t('market.people.gone')}</span>}
        {gone?.reason === 'alreadyApplied' && (
          <>
            <span>{t('likes.errors.alreadyApplied')}</span>
            <Link
              to="/market/mine"
              className={`inline-flex min-h-[44px] items-center rounded underline underline-offset-4 ${focusRing}`}
            >
              {t('applications.viewMine')}
            </Link>
          </>
        )}
      </div>
      {mutualId !== null && (
        <div className="flex flex-col gap-3">
          <MutualBanner applicationId={mutualId} />
        </div>
      )}
      {body}
      <PeopleSections
        viewerLifestyle={stored?.lifestyle ?? {}}
        onMutual={onMutual}
        onGone={() => onGone('personGone')}
      />
    </PageContainer>
  );
}
