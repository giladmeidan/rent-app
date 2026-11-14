import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import type { ListingInBody } from './api';
import { LISTING_CAP } from './constants';
import { ListingCard } from './ListingCard';
import { OwnerPreferences } from './OwnerPreferences';
import { RoomPreview } from './RoomPreview';

/** What a failed publish shows above the button (401 and 403 redirect instead). */
export type PublishError = 'capReached' | 'expired' | 'areaInactive' | 'invalid' | 'failed';

type Props = {
  body: ListingInBody;
  today: string;
  /** The first photo's address (spec 0010e), shown on the card as "my listings" will. */
  coverUrl: string | null;
  error: PublishError | null;
  onRetry: () => void;
  onBackToDetails: () => void;
};

const alertText = 'text-body-sm font-medium text-danger';

/** The last step: the card exactly as "my listings" will render it, a room's flatmates and questionnaire,
 * the owner's preferences as the listing page shows them, and the publish errors. The step's
 * heading and hint are the wizard's. */
export function PreviewStep({ body, today, coverUrl, error, onRetry, onBackToDetails }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <ListingCard listing={body} today={today} coverUrl={coverUrl} />
      {body.listing_type === 'room' && <RoomPreview body={body} />}
      <OwnerPreferences listing={body} />
      {error === 'capReached' && (
        <p role="alert" className={alertText}>
          {t('listings.errors.capReached', { cap: LISTING_CAP })}
        </p>
      )}
      {error === 'expired' && (
        <p role="alert" className={alertText}>
          {t('listings.errors.expired')}
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
