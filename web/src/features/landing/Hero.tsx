import { useTranslation } from 'react-i18next';

import exampleHome from '../../assets/landing/example-home.jpg';
import { Button } from '../../components/Button';
import { Mascot } from '../../components/Mascot';
import { Tag } from '../../components/Tag';
import { useIsDesktop } from '../../components/useMediaQuery';
import { ListingCard } from '../listings/ListingCard';
import { MatchBadge } from '../match/MatchBadge';
import { EXAMPLE_SCORE, exampleListing } from './example';
import { Check, Chevron, Icon } from './Icon';
import { OWNER_SIGNUP } from './links';

export const HERO_TITLE_ID = 'landing-title';

/**
 * Main.html §1: the accent-soft panel. The inline-start column (the right, in RTL) holds the copy,
 * the two role CTAs, the market link and the trust claims; the inline-end one the page's one
 * turtle above the example card (with a stock photo, Unsplash: Minh Pham).
 */
export function Hero({ today }: { today: string }) {
  const { t } = useTranslation();
  const desktop = useIsDesktop();

  const trust = [
    t('landing.trust.verified'),
    t('landing.trust.noBrokers'),
    t('landing.trust.free'),
  ];

  return (
    <section
      aria-labelledby={HERO_TITLE_ID}
      className="landing-dots grid gap-6 rounded-lg bg-accent-soft px-4 py-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-12 lg:p-14"
    >
      <div className="flex flex-col items-start gap-4">
        <Tag tone="neutral">{t('landing.badge')}</Tag>
        <h1 id={HERO_TITLE_ID} className="whitespace-pre-line font-display text-h1 lg:text-display">
          {t('landing.title')}
        </h1>
        <p className="text-body text-ink-muted lg:max-w-xl">{t('landing.subtitle')}</p>
        <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row">
          <Button
            to={OWNER_SIGNUP}
            size="lg"
            className="w-full lg:w-auto"
            icon={
              <Icon size={22}>
                <path d="M3 11l9-8 9 8" />
                <path d="M5 10v10h14V10" />
                <path d="M10 20v-6h4v6" />
              </Icon>
            }
            end={<Chevron />}
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
            end={<Chevron />}
          >
            {t('landing.cta.seeker')}
          </Button>
        </div>
        {/* The market's entry point (spec 0010a), under the two CTAs. */}
        <Button to="/market" variant="ghost" size="lg" className="w-full lg:w-auto">
          {t('landing.cta.market')}
        </Button>
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {trust.map((claim) => (
            <li key={claim} className="inline-flex items-center gap-1.5 text-label">
              <span className="inline-flex text-accent">
                <Check />
              </span>
              {claim}
            </li>
          ))}
        </ul>
      </div>

      {/* The collage: the turtle (decorative) sits above the example card's top edge. */}
      <div className="relative mx-auto w-full max-w-md pt-24 lg:pt-[7.5rem]">
        <Mascot pose="hello" width={desktop ? 190 : 150} className="absolute start-2 top-0" />
        <figure className="relative">
          {/* Read by a screen reader before the card. */}
          <figcaption className="sr-only">{t('landing.example.caption')}</figcaption>
          <ListingCard
            listing={exampleListing({
              street: t('landing.example.street'),
              city: t('landing.example.city'),
              today,
            })}
            today={today}
            badge={<MatchBadge score={EXAMPLE_SCORE} />}
            titleAs="p"
            coverUrl={exampleHome}
          />
        </figure>
      </div>
    </section>
  );
}
