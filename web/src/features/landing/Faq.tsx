import { useTranslation } from 'react-i18next';

import { cx } from '../../components/cx';
import { focusRing } from '../../components/focusRing';
import { Icon } from './Icon';

/**
 * Main.html §5, "שאלות נפוצות": five native `<details>` (no JS state), the first open. From `lg`
 * the heading takes the inline-start third and the questions the other two.
 */
export function Faq() {
  const { t } = useTranslation();
  const questions = [
    { q: t('landing.faq.q1.q'), a: t('landing.faq.q1.a') },
    { q: t('landing.faq.q2.q'), a: t('landing.faq.q2.a') },
    { q: t('landing.faq.q3.q'), a: t('landing.faq.q3.a') },
    { q: t('landing.faq.q4.q'), a: t('landing.faq.q4.a') },
    { q: t('landing.faq.q5.q'), a: t('landing.faq.q5.a') },
  ];
  return (
    <section
      aria-labelledby="landing-faq"
      className="grid gap-4 py-8 lg:grid-cols-3 lg:items-start lg:gap-12 lg:py-12"
    >
      <div>
        <h2 id="landing-faq" className="font-display text-h2">
          {t('landing.faq.title')}
        </h2>
        <p className="mt-1 text-body text-ink-muted">{t('landing.faq.subtitle')}</p>
      </div>
      <div className="flex flex-col gap-2 lg:col-span-2">
        {questions.map((item, i) => (
          <details
            key={item.q}
            open={i === 0}
            className="group rounded-lg border border-border bg-surface px-4 py-1"
          >
            <summary
              className={cx(
                'flex min-h-13 cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-body font-medium [&::-webkit-details-marker]:hidden',
                focusRing,
              )}
            >
              {item.q}
              <span className="inline-flex text-ink-muted transition-transform motion-reduce:transition-none group-open:rotate-180">
                <Icon size={20}>
                  <path d="M6 9l6 6 6-6" />
                </Icon>
              </span>
            </summary>
            <p className="pb-4 text-body text-ink-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
