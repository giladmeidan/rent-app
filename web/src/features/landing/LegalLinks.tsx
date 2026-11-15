import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { cx } from '../../components/cx';
import { focusRing } from '../../components/focusRing';

const link = cx(
  'inline-flex min-h-tap items-center rounded-md px-2 text-body-sm text-ink-muted hover:text-ink hover:underline',
  focusRing,
);

/** The landing's only legal links (spec 0013f): one centred line under the closing band. The landing
 * keeps "no footer" (PRODUCT.md "Landing v2"), so this is no landmark and has no contact link. */
export function LegalLinks() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 pb-4">
      <Link to="/terms" className={link}>
        {t('footer.terms')}
      </Link>
      <Link to="/privacy" className={link}>
        {t('footer.privacy')}
      </Link>
    </div>
  );
}
