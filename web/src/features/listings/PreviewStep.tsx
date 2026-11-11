import { useTranslation } from 'react-i18next';

import { ErrorState } from '../../components/ErrorState';
import type { ListingInBody } from './api';
import { LISTING_CAP } from './constants';
import { ListingCard } from './ListingCard';
import { OwnerPreferences } from './OwnerPreferences';

/** What a failed publish shows above the button (401 and 403 redirect instead). */
export type PublishError = 'capReached' | 'areaInactive' | 'invalid' | 'failed';

type Props = {
  body: ListingInBody;
  today: string;
  error: PublishError | null;
  onRetry: () => void;
  onBackToDetails: () => void;
};

const fieldError = 'text-sm font-semibold text-[#B91C1C]';
const secondary =
  'min-h-[44px] self-start rounded-full border-[1.5px] border-[#D6D3D1] bg-white px-4 text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Step 4: the card exactly as "my listings" will render it, the owner's preferences as the listing
 * page shows them, and the publish errors. */
export function PreviewStep({ body, today, error, onRetry, onBackToDetails }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted">{t('listings.preview.hint')}</p>
      <ListingCard listing={body} today={today} />
      <OwnerPreferences listing={body} />
      {error === 'capReached' && (
        <p role="alert" className={fieldError}>
          {t('listings.errors.capReached', { cap: LISTING_CAP })}
        </p>
      )}
      {error === 'areaInactive' && (
        <div role="alert" className="flex flex-col gap-2">
          <p className={fieldError}>{t('listings.errors.areaInactive')}</p>
          <button type="button" onClick={onBackToDetails} className={secondary}>
            {t('listings.preview.backToDetails')}
          </button>
        </div>
      )}
      {error === 'invalid' && (
        <p role="alert" className={fieldError}>
          {t('common.error')}
        </p>
      )}
      {error === 'failed' && <ErrorState onRetry={onRetry} />}
    </div>
  );
}
