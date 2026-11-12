import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import type { ListingInBody } from './api';
import { LISTING_CAP } from './constants';
import { ListingCard } from './ListingCard';
import { OwnerPreferences } from './OwnerPreferences';
import { RoomPreview } from './RoomPreview';

/** What a failed publish shows above the button (401 and 403 redirect instead). */
export type PublishError = 'capReached' | 'areaInactive' | 'invalid' | 'failed';

type Props = {
  body: ListingInBody;
  today: string;
  error: PublishError | null;
  onRetry: () => void;
  onBackToDetails: () => void;
};

const alertText = 'text-body-sm font-medium text-danger';

/** Step 4: the card exactly as "my listings" will render it, a room's flatmates and questionnaire,
 * the owner's preferences as the listing page shows them, and the publish errors. The step's
 * heading and hint are the wizard's. */
export function PreviewStep({ body, today, error, onRetry, onBackToDetails }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <ListingCard listing={body} today={today} />
      {body.listing_type === 'room' && <RoomPreview body={body} />}
      <OwnerPreferences listing={body} />
      {error === 'capReached' && (
        <p role="alert" className={alertText}>
          {t('listings.errors.capReached', { cap: LISTING_CAP })}
        </p>
      )}
      {error === 'areaInactive' && (
        <div role="alert" className="flex flex-col gap-2">
          <p className={alertText}>{t('listings.errors.areaInactive')}</p>
          <Button variant="secondary" onClick={onBackToDetails} className="self-start">
            {t('listings.preview.backToDetails')}
          </Button>
        </div>
      )}
      {error === 'invalid' && (
        <p role="alert" className={alertText}>
          {t('common.error')}
        </p>
      )}
      {error === 'failed' && <ErrorState onRetry={onRetry} />}
    </div>
  );
}
