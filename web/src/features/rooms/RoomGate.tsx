import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ListingDetail } from '../listings/api';
import { roomSectionHref } from '../profile/links';
import { genderPreferenceLabel } from './flatmates';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const primary = `inline-flex min-h-[52px] items-center justify-center rounded-[14px] bg-accent px-5 text-base font-bold text-white ${focusRing}`;

/**
 * A women- or men-only room and a seeker without the profile's room section (or without any
 * profile): why, and the way to the room section and back here (PRODUCT.md "Rooms"). Plain text in
 * the apply section: it is a state, not an event.
 */
export function RoomGate({ listing }: { listing: ListingDetail }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-start text-[15px]">
        {t('rooms.apply.roomSectionRequired', {
          who: genderPreferenceLabel(t, listing.gender_preference),
        })}
      </p>
      <Link to={roomSectionHref(`/listings/${listing.id}`)} className={`${primary} w-full`}>
        {t('rooms.apply.fillRoomSection')}
      </Link>
    </div>
  );
}
