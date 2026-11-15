import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { cx } from '../components/cx';
import { focusRing } from '../components/focusRing';
import { PageContainer } from '../components/PageContainer';
import { CONTACT_EMAIL } from './contact';

const link = cx(
  'inline-flex min-h-tap items-center rounded-md px-2 text-body-sm text-ink-muted hover:text-ink hover:underline',
  focusRing,
);

/**
 * The footer of every page but the landing and chat (spec 0013f; design/screens-v1/Main.dc.html
 * lines 121-125): the terms, the privacy policy and the contact address, three centred muted links.
 * `index.css` keeps its last line above the tab bar below `lg`.
 */
export function SiteFooter() {
  const { t } = useTranslation();
  return (
    <footer data-site-footer="" className="border-t border-border pt-2">
      <PageContainer width="wide">
        <nav
          aria-label={t('footer.label')}
          className="flex flex-wrap items-center justify-center gap-x-4"
        >
          <Link to="/terms" className={link}>
            {t('footer.terms')}
          </Link>
          <Link to="/privacy" className={link}>
            {t('footer.privacy')}
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
            {t('footer.contact')}
          </a>
        </nav>
      </PageContainer>
    </footer>
  );
}
