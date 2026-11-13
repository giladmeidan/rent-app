import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import type { ListingDetail } from '../listings/api';
import { profileHref } from '../profile/links';
import { genderPreferenceLabel } from './flatmates';

/**
 * A women- or men-only room and a seeker without the profile's personal part (or without any
 * profile): why, and the way to both parts of the profile ("עליי" and "מה מחפשים", 0010c) and back
 * here (PRODUCT.md "Rooms"). Plain text in the apply section: it is a state, not an event.
 */
export function RoomGate({ listing }: { listing: ListingDetail }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-3">
      <p tabIndex={-1} className="text-start text-body focus:outline-none">
        {t('rooms.apply.roomSectionRequired', {
          who: genderPreferenceLabel(t, listing.gender_preference),
        })}
      </p>
      <Button
        variant="primary"
        size="lg"
        fullWidth
        to={profileHref(`/listings/${listing.id}`, 'about', 'looking')}
      >
        {t('rooms.apply.fillRoomSection')}
      </Button>
    </div>
  );
}
