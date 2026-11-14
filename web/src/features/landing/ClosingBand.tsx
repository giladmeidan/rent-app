import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { OWNER_SIGNUP } from './links';

/**
 * Main.html §6: the ink band that ends the page (no footer), with the two CTAs, the seeker's first.
 * No turtle here: the mascot never sits on ink.
 */
export function ClosingBand() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="landing-closing" className="py-8 lg:py-12">
      <div className="landing-reveal flex flex-col items-center gap-4 rounded-lg bg-ink px-4 py-8 text-center text-on-ink lg:p-14">
        <h2 id="landing-closing" className="font-display text-h1 lg:text-display">
          {t('landing.closing.title')}
        </h2>
        <p className="text-body text-on-ink">{t('landing.closing.text')}</p>
        <div className="flex w-full max-w-md flex-col gap-3 lg:w-auto lg:max-w-none lg:flex-row lg:justify-center">
          <Button to="/search" variant="secondary" size="lg" className="w-full lg:w-auto">
            {t('landing.cta.seeker')}
          </Button>
          <Button to={OWNER_SIGNUP} variant="inverse" size="lg" className="w-full lg:w-auto">
            {t('landing.cta.owner')}
          </Button>
        </div>
      </div>
    </section>
  );
}
