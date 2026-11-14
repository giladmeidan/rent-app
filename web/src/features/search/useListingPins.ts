import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Pin } from '../../components/map/MapCanvas';
import { useSide } from '../../app/side';
import { useMyApplications } from '../applications/useMyApplications';
import { useMe } from '../auth/useMe';
import { readSeen } from '../listings/seen';
import type { ListingPublic } from './api';
import { openApplicationIds, toPins } from './pins';

const NONE: ReadonlySet<string> = new Set();

/**
 * The map pins of `items` with the person's marks joined in by listing id (spec 0009v): a
 * person's open applications (`GET /me/applications`, submitted or shortlisted) and this device's
 * seen listings (spec 0010l: no "liked" mark; a seeker's rooms are their applications). On the
 * market any signed-in account asks for them (spec 0010b: any account applies to rooms); on the
 * apartments side only a seeker does. A visitor sends no request; a failing one only drops its
 * marks (the hook's own 401 handling stays).
 */
export function useListingPins(items: readonly ListingPublic[]): Pin[] {
  const { t } = useTranslation();
  const side = useSide();
  const me = useMe().data;
  const wantsMine = me != null && (side === 'market' || me.role === 'seeker');
  const applications = useMyApplications(wantsMine);
  const mineApplications = wantsMine ? applications.data : undefined;

  const applied = useMemo(
    () => (mineApplications === undefined ? NONE : openApplicationIds(mineApplications)),
    [mineApplications],
  );

  // The seen store is read once per computation of the pins.
  return useMemo(() => toPins(items, { t, seen: readSeen(), applied }), [items, t, applied]);
}
