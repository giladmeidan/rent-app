import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { usePageTitle } from '../../app/usePageTitle';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { focusRing } from '../../components/focusRing';
import { Loading } from '../../components/Loading';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
import { Skeleton } from '../../components/Skeleton';
import { ListingCard } from '../listings/ListingCard';
import { todayInIsrael } from '../listings/format';
import { MatchBadge } from '../match/MatchBadge';
import { MatchChips } from '../match/MatchChips';
import { useProfile } from '../profile/useProfile';
import type { SeekerProfileOut } from '../profile/api';
import type { LikedRoomOut, LikeStateOut } from './api';
import { LikeRoomButton } from './LikeRoomButton';
import { MutualBanner } from './MutualBanner';
import { useMyLikes } from './useMyLikes';

type GoneReason = 'gone' | 'alreadyApplied';

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
  /** The seeker's profile, which words the match chips (`undefined`: none, or not loaded). */
  profile: SeekerProfileOut | undefined;
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

/** `/me/likes`, seekers only (`RequireSeeker`): the rooms that liked the seeker and the ones they liked. */
export function MyLikesPage() {
  const { t } = useTranslation();
  usePageTitle(t('likes.title'));
  const likes = useMyLikes();
  const profile = useProfile().data ?? undefined;
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
                  <Button variant="ghost" to="/me/profile?section=room">
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
    </PageContainer>
  );
}
