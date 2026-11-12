import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PageContainer } from '../../components/PageContainer';
import { usePageTitle } from '../../app/usePageTitle';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { Skeleton } from '../../components/Skeleton';
import { ListingCard } from '../listings/ListingCard';
import { todayInIsrael } from '../listings/format';
import type { LikedRoomOut, LikeStateOut } from './api';
import { LikeRoomButton } from './LikeRoomButton';
import { MutualBanner } from './MutualBanner';
import { useMyLikes } from './useMyLikes';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function RoomList({
  items,
  like,
  empty,
  onMutual,
  onToMine,
}: {
  items: LikedRoomOut[];
  like: LikeStateOut;
  empty: ReactNode;
  onMutual: (applicationId: string) => void;
  /** A card left its place for (or from) "mine": an unlike, or a like that is not mutual. */
  onToMine: () => void;
}) {
  const today = todayInIsrael();
  if (items.length === 0) return empty;
  return (
    <ul className="flex flex-col gap-4">
      {items.map(({ listing }) => (
        <li key={listing.id}>
          {/* `h3`: the cards sit under the section `<h2>`s. */}
          <ListingCard listing={listing} today={today} to={`/listings/${listing.id}`} titleAs="h3">
            {/* Above the card's stretched link, so a click reaches the button. */}
            <div className="relative z-10">
              <LikeRoomButton
                listingId={listing.id}
                like={like}
                onMutual={onMutual}
                onUnliked={onToMine}
                onLikedNotMutual={onToMine}
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
  // Kept here, not in the lists: the card that made the match leaves them on the refetch.
  const [mutualId, setMutualId] = useState<string | null>(null);
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
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[200px] w-full" />
          <Skeleton className="h-[200px] w-full" />
        </div>
      </Loading>
    );
  } else if (likes.isError && likes.data === undefined) {
    body = <ErrorState onRetry={() => void likes.refetch()} />;
  } else {
    body = (
      <>
        <section className="flex flex-col gap-3" aria-labelledby="likes-liked-me">
          <h2 id="likes-liked-me" className="text-start text-xl font-extrabold">
            {t('likes.likedMe')}
          </h2>
          <RoomList
            items={likes.data.liked_me}
            like={{ liked_by_me: false, liked_me: true }}
            onMutual={setMutualId}
            onToMine={toMine}
            empty={
              <div className="flex flex-col items-start gap-2">
                <EmptyState message={t('likes.likedMeEmpty')} />
                <Link
                  to="/me/profile?section=room"
                  className={`inline-flex min-h-[44px] items-center rounded text-accent-strong underline underline-offset-4 ${focusRing}`}
                >
                  {t('likes.toProfile')}
                </Link>
              </div>
            }
          />
        </section>
        <section className="flex flex-col gap-3" aria-labelledby="likes-mine">
          <h2
            ref={mineRef}
            id="likes-mine"
            tabIndex={-1}
            className="text-start text-xl font-extrabold focus:outline-none"
          >
            {t('likes.mine')}
          </h2>
          <RoomList
            items={likes.data.mine}
            like={{ liked_by_me: true, liked_me: false }}
            onMutual={setMutualId}
            onToMine={toMine}
            empty={<EmptyState message={t('likes.mineEmpty')} />}
          />
        </section>
      </>
    );
  }

  return (
    <PageContainer width="narrow" className="flex flex-col gap-5">
      <h1 className="text-start text-2xl font-extrabold">{t('likes.title')}</h1>
      {mutualId !== null && <MutualBanner applicationId={mutualId} />}
      {body}
    </PageContainer>
  );
}
