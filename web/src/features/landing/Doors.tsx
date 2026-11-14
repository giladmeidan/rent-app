import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { cx } from '../../components/cx';
import { focusRing } from '../../components/focusRing';
import { Tag } from '../../components/Tag';
import { formatIls } from '../listings/format';
import { EXAMPLE_SCORE } from './example';
import { Chevron, Icon } from './Icon';
import { OWNER_SIGNUP, SECTION, SEEKER_SIGNUP } from './links';

type DoorProps = {
  id: string;
  to: string;
  icon: ReactNode;
  title: string;
  text: string;
  more: string;
  /** The decorative mini-illustration. */
  mini: ReactNode;
  /** The wide tiles (map, owner): from `lg` the text and the illustration side by side. */
  wide?: boolean;
};

/** One door: the whole card is one link, named by its `<h3>` alone. */
function Door({ id, to, icon, title, text, more, mini, wide = false }: DoorProps) {
  const titleId = `landing-door-${id}`;
  const body = (
    <>
      <span className="flex size-11 items-center justify-center rounded-md bg-accent-soft text-accent-strong">
        {icon}
      </span>
      <h3 id={titleId} className="text-h3">
        {title}
      </h3>
      <p className="text-body-sm text-ink-muted">{text}</p>
    </>
  );
  const moreLabel = (
    <span className="mt-auto inline-flex min-h-tap items-center gap-1 text-label text-accent">
      {more}
      <Chevron size={16} />
    </span>
  );
  const illustration = (
    <div aria-hidden="true" className="flex flex-col">
      {mini}
    </div>
  );
  return (
    <Link
      to={to}
      aria-labelledby={titleId}
      data-door={id}
      className={cx(
        'landing-door landing-reveal flex flex-col gap-3 overflow-hidden rounded-lg border border-border bg-surface p-5',
        focusRing,
        wide ? 'lg:col-span-4 lg:grid lg:grid-cols-[1fr_1.2fr] lg:gap-5' : 'lg:col-span-2',
      )}
    >
      {wide ? (
        <>
          <div className="flex flex-col gap-3">
            {body}
            {moreLabel}
          </div>
          {illustration}
        </>
      ) : (
        <>
          {body}
          {illustration}
          {moreLabel}
        </>
      )}
    </Link>
  );
}

const mini = 'flex min-h-[6.5rem] flex-1 flex-col justify-center rounded-md bg-surface-subtle p-3';
const avatar =
  'flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-surface bg-accent-soft text-body font-medium text-accent-strong';

/** The sketched map's five price pins; the selected one is the example's 7,200 ₪. */
const PINS = [
  { price: 6400, top: '18%', start: '12%' },
  { price: 7200, top: '42%', start: '40%', on: true },
  { price: 5900, top: '68%', start: '18%' },
  { price: 8100, top: '22%', start: '66%' },
  { price: 6800, top: '72%', start: '62%' },
];

/**
 * Main.html §2, "מה מחכה בפנים": four doors into the site. From `lg` a six-column bento (map 4,
 * match 2, market 2, owner 4); below it one column.
 */
export function Doors() {
  const { t } = useTranslation();
  const ils = t('listings.units.ils');
  const initials = [...t('landing.doors.market.initials')];
  const applicants = [
    {
      name: t('landing.doors.owner.row1.name'),
      meta: t('landing.doors.owner.row1.meta'),
      score: 94,
    },
    {
      name: t('landing.doors.owner.row2.name'),
      meta: t('landing.doors.owner.row2.meta'),
      score: 87,
    },
    {
      name: t('landing.doors.owner.row3.name'),
      meta: t('landing.doors.owner.row3.meta'),
      score: 81,
    },
  ];

  return (
    <section aria-labelledby="landing-doors" className={SECTION}>
      <div>
        <h2 id="landing-doors" className="font-display text-h2">
          {t('landing.doors.title')}
        </h2>
        <p className="mt-1 text-body text-ink-muted">{t('landing.doors.subtitle')}</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-6">
        <Door
          id="map"
          wide
          to="/search?view=map"
          title={t('landing.doors.map.title')}
          text={t('landing.doors.map.text')}
          more={t('landing.doors.map.more')}
          icon={
            <Icon size={22}>
              <path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2z" />
              <path d="M9 4v14M15 6v14" />
            </Icon>
          }
          mini={
            <div className={cx(mini, 'landing-map relative min-h-[10.625rem]')}>
              {PINS.map((pin) => (
                <span
                  key={pin.price}
                  style={{ insetBlockStart: pin.top, insetInlineStart: pin.start }}
                  className={cx(
                    'absolute rounded-full border px-2.5 py-1 text-caption shadow-pin',
                    pin.on === true
                      ? 'border-ink bg-ink text-on-ink'
                      : 'border-border-strong bg-surface text-ink',
                  )}
                >
                  {`${formatIls(pin.price)} ${ils}`}
                </span>
              ))}
            </div>
          }
        />
        <Door
          id="match"
          to={SEEKER_SIGNUP}
          title={t('landing.doors.match.title')}
          text={t('landing.doors.match.text')}
          more={t('landing.doors.match.more')}
          icon={
            <Icon size={22}>
              <path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.4l6-.8z" />
            </Icon>
          }
          mini={
            <div className={mini}>
              <div className="flex items-center gap-3">
                <span className="font-display text-h1 text-accent-strong">{`${String(EXAMPLE_SCORE)}%`}</span>
                <span className="text-body-sm text-ink-muted">
                  {t('landing.doors.match.caption')}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ inlineSize: `${String(EXAMPLE_SCORE)}%` }}
                />
              </div>
            </div>
          }
        />
        <Door
          id="market"
          to="/market"
          title={t('landing.doors.market.title')}
          text={t('landing.doors.market.text')}
          more={t('landing.doors.market.more')}
          icon={
            <Icon size={22}>
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
              <circle cx="17.5" cy="9" r="2.5" />
              <path d="M17 14.6c2.4.2 4 1.7 4.5 4.4" />
            </Icon>
          }
          mini={
            <div className={mini}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex">
                  {initials.map((letter, i) => (
                    <span key={letter} className={cx(avatar, i > 0 && '-ms-3.5')}>
                      {letter}
                    </span>
                  ))}
                </span>
                <span className="ms-2 inline-flex text-accent">
                  <Icon size={22}>
                    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
                  </Icon>
                </span>
                <Tag tone="accent" size="sm">
                  {t('landing.doors.market.badge')}
                </Tag>
              </div>
            </div>
          }
        />
        <Door
          id="owner"
          wide
          to={OWNER_SIGNUP}
          title={t('landing.doors.owner.title')}
          text={t('landing.doors.owner.text')}
          more={t('landing.doors.owner.more')}
          icon={
            <Icon size={22}>
              <path d="M4 5h16v11H8l-4 4z" />
              <path d="M8 9h8M8 12.5h5" />
            </Icon>
          }
          mini={
            <div className={cx(mini, 'gap-2')}>
              {applicants.map((row) => (
                <div key={row.name} className="flex items-center gap-2.5 rounded-sm bg-surface p-2">
                  <span className={avatar}>{[...row.name][0]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-label">{row.name}</p>
                    <p className="text-caption text-ink-muted">{row.meta}</p>
                  </div>
                  <Tag tone="accent" size="sm">{`${String(row.score)}%`}</Tag>
                </div>
              ))}
            </div>
          }
        />
      </div>
    </section>
  );
}
