import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { usePageTitle } from '../../app/usePageTitle';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Mascot } from '../../components/Mascot';
import { PageContainer } from '../../components/PageContainer';
import { Tag } from '../../components/Tag';
import { useIsDesktop } from '../../components/useMediaQuery';
import { ListingCard } from '../listings/ListingCard';
import { todayInIsrael } from '../listings/format';
import { MatchBadge } from '../match/MatchBadge';
import { EXAMPLE_SCORE, exampleListing } from './example';

/** An outline icon (the artboard's paths): stroke 2, round caps, `currentColor`. */
function Icon({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

// Main.dc.html:41: the chevron points to the inline end in RTL.
const chevron = (
  <Icon size={20}>
    <path d="M15 6l-6 6 6 6" />
  </Icon>
);

/**
 * The visitor's `/` (Main.dc.html, in the homie brand): the hero with the two role CTAs, the hello
 * turtle above a static example card, "איך זה עובד" and the trust strip. Static: no API call. One
 * column below `lg`; from `lg` a two-column hero and three step columns.
 */
export function LandingPage() {
  const { t } = useTranslation();
  usePageTitle(undefined);
  const desktop = useIsDesktop();
  const today = todayInIsrael();

  const steps = [
    { title: t('landing.how.step1.title'), text: t('landing.how.step1.text') },
    { title: t('landing.how.step2.title'), text: t('landing.how.step2.text') },
    { title: t('landing.how.step3.title'), text: t('landing.how.step3.text') },
  ];

  return (
    <PageContainer width="wide">
      <div className="flex flex-col gap-6 max-lg:mx-auto max-lg:max-w-page lg:gap-12">
        {/* The hero: the inline-start column (the right, in RTL) holds the copy and the CTAs. */}
        <div className="grid gap-6 lg:grid-cols-2 lg:items-center lg:gap-12 lg:py-12">
          <div className="flex flex-col items-start gap-4">
            <Tag tone="accent">{t('landing.badge')}</Tag>
            <h1 className="whitespace-pre-line font-display text-h1 lg:text-display">
              {t('landing.title')}
            </h1>
            <p className="text-body text-ink-muted lg:max-w-xl">{t('landing.subtitle')}</p>
            <div className="mt-2 flex w-full flex-col gap-3 lg:w-auto lg:flex-row">
              <Button
                to="/signup?role=owner&next=%2Flistings%2Fnew"
                size="lg"
                className="w-full lg:w-auto"
                icon={
                  <Icon size={22}>
                    <path d="M3 11l9-8 9 8" />
                    <path d="M5 10v10h14V10" />
                    <path d="M10 20v-6h4v6" />
                  </Icon>
                }
                end={chevron}
              >
                {t('landing.cta.owner')}
              </Button>
              <Button
                to="/search"
                variant="secondary"
                size="lg"
                className="w-full lg:w-auto"
                icon={
                  <Icon size={22}>
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" />
                  </Icon>
                }
                end={chevron}
              >
                {t('landing.cta.seeker')}
              </Button>
            </div>
          </div>

          {/* The visual group: the page's one turtle (decorative), above the example card. */}
          <div className="flex flex-col items-center gap-4 lg:w-full lg:max-w-md lg:justify-self-center">
            <Mascot pose="hello" width={desktop ? 200 : 160} />
            <figure className="flex w-full flex-col gap-2">
              <figcaption className="text-body-sm text-ink-muted">
                {t('landing.example.caption')}
              </figcaption>
              <ListingCard
                listing={exampleListing({
                  street: t('landing.example.street'),
                  city: t('landing.example.city'),
                  today,
                })}
                today={today}
                badge={<MatchBadge score={EXAMPLE_SCORE} />}
                titleAs="p"
              />
            </figure>
          </div>
        </div>

        <section aria-labelledby="landing-how" className="flex flex-col gap-4">
          <h2 id="landing-how" className="font-display text-h2">
            {t('landing.how.title')}
          </h2>
          <ol className="grid gap-3 lg:grid-cols-3">
            {steps.map((step, i) => (
              <Card key={step.title} as="li" padding="md" className="flex items-start gap-4">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-h3 text-accent-strong"
                >
                  {i + 1}
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="text-h3">{step.title}</h3>
                  <p className="text-body-sm text-ink-muted">{step.text}</p>
                </div>
              </Card>
            ))}
          </ol>
        </section>

        {/* What is true today (Q2). A separator is inside its <li>: a bare element between
            items is invalid. */}
        <ul className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-label text-ink">
          <li className="inline-flex items-center gap-1.5">
            <span className="inline-flex text-ink-muted">
              <Icon size={18}>
                <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />
                <path d="M9 12l2 2 4-4" />
              </Icon>
            </span>
            {t('landing.trust.verified')}
          </li>
          <li className="inline-flex items-center gap-2.5">
            <span aria-hidden="true" className="text-ink-muted">
              ·
            </span>
            {t('landing.trust.noBrokers')}
          </li>
          <li className="inline-flex items-center gap-2.5">
            <span aria-hidden="true" className="text-ink-muted">
              ·
            </span>
            {t('landing.trust.free')}
          </li>
        </ul>
      </div>
    </PageContainer>
  );
}
