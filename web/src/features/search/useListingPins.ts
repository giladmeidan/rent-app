import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Pin } from '../../components/map/MapCanvas';
import { useMyApplications } from '../applications/useMyApplications';
import { useMe } from '../auth/useMe';
import { useMyLikes } from '../likes/useMyLikes';
import { readSeen } from '../listings/seen';
import type { ListingPublic } from './api';
import { openApplicationIds, toPins } from './pins';

const NONE: ReadonlySet<string> = new Set();

/**
 * The map pins of `items` with the person's marks joined in by listing id (spec 0009v): a
 * seeker's liked rooms (`GET /me/likes`), open applications (`GET /me/applications`, submitted or
 * shortlisted) and this device's seen listings. A visitor or an owner sends neither request; a
 * failing one only drops its marks (the hooks' own 401 handling stays).
 */
export function useListingPins(items: readonly ListingPublic[]): Pin[] {
  const { t } = useTranslation();
  const isSeeker = useMe().data?.role === 'seeker';
  const likes = useMyLikes(isSeeker);
  const applications = useMyApplications(isSeeker);
  const mine = isSeeker ? likes.data?.mine : undefined;
  const mineApplications = isSeeker ? applications.data : undefined;

  const liked = useMemo(
    () => (mine === undefined ? NONE : new Set(mine.map((like) => like.listing.id))),
    [mine],
  );
  const applied = useMemo(
    () => (mineApplications === undefined ? NONE : openApplicationIds(mineApplications)),
    [mineApplications],
  );

  // The seen store is read once per computation of the pins.
  return useMemo(
    () => toPins(items, { t, seen: readSeen(), liked, applied }),
    [items, t, liked, applied],
  );
}
