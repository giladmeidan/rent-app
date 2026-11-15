import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { CONTACT_EMAIL_INLINE } from '../../app/contact';
import { usePageTitle } from '../../app/usePageTitle';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
import { privacyDoc, termsDoc } from './content';

/**
 * `/terms` and `/privacy` (spec 0013f): static text from `he.json`, one `h2` per section, each with
 * an `id` so a link can land on it (`/privacy#deletion`). Nothing is fetched.
 */
export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const doc = (kind === 'terms' ? termsDoc : privacyDoc)(t, CONTACT_EMAIL_INLINE);
  usePageTitle(doc.title);

  // The router does not scroll to a hash: do it for the section the link names.
  useEffect(() => {
    if (hash.length > 1)
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash, kind]);

  return (
    <PageContainer as="article" width="narrow" className="flex flex-col gap-6">
      <PageHeader title={doc.title} />
      <p className="text-body-sm text-ink-muted">{t('legal.updated', { date: t('legal.date') })}</p>
      <p className="text-body leading-relaxed">{doc.intro}</p>
      {doc.sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-3">
          <h2 id={section.id} className="scroll-mt-6 font-display text-h2">
            {section.title}
          </h2>
          {section.blocks.map((block, i) =>
            'p' in block ? (
              <p key={i} className="text-body leading-relaxed">
                {block.p}
              </p>
            ) : (
              <ul key={i} className="flex list-disc flex-col gap-2 ps-6 text-body leading-relaxed">
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            ),
          )}
        </div>
      ))}
    </PageContainer>
  );
}
