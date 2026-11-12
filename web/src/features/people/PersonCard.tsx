import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RoomDetails } from '../applicants/RoomDetails';
import { hasStatus } from '../applications/api';
import { ApiError, type MyListingOut } from '../listings/api';
import { formatDate, todayInIsrael } from '../listings/format';
import { AgreeIcon, DifferIcon } from '../match/icons';
import { MatchBadge } from '../match/MatchBadge';
import { personReason, personShort } from '../match/reasons';
import type { Criterion, ReasonKind } from '../match/types';
import type { PersonOut } from './api';
import { useLikePerson, useUnlikePerson } from './useLikePerson';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const fieldError = 'text-sm font-semibold text-danger';
const disclosure = `inline-flex min-h-[44px] items-center gap-1 self-start rounded-xl text-sm font-semibold text-accent-strong ${focusRing}`;
const chip = 'rounded-full px-[10px] py-1 text-xs font-semibold';
const agreeChip = `${chip} bg-accent-soft text-accent-strong`;
const differChip = `${chip} bg-surface-subtle text-warning`;
const conjunction = new Intl.ListFormat('he', { type: 'conjunction' });

export type Mutual = { name: string; applicationId: string };
/** An outcome after which the card is gone from the refetched list (the API drops a person with an
 * open application or who no longer fits), so the page, not the card, shows it. */
export type PageAlert = { kind: 'alreadyApplied' | 'gone'; name: string };

type Props = {
  person: PersonOut;
  /** The room (`MyListingOut`): its answers are compared with the person's. */
  listing: MyListingOut;
  /** The person's area names, already resolved (an id with no name is left out). */
  areaNames: string[];
  onMutual: (mutual: Mutual) => void;
  onAlert: (alert: PageAlert) => void;
};

type LikeError = 'alreadyApplied' | 'gone' | 'notLive' | 'rateLimited' | 'failed';
type InlineError = Exclude<LikeError, 'alreadyApplied' | 'gone'>;

/** The alert a failed like / unlike shows; `null` for 401 / 403 (`RequireOwner` leaves the page). */
function errorKind(error: unknown): LikeError | null {
  if (hasStatus(error, 401) || hasStatus(error, 403)) return null;
  if (hasStatus(error, 404)) return 'gone';
  if (hasStatus(error, 429)) return 'rateLimited';
  if (hasStatus(error, 409)) {
    return error instanceof ApiError && error.detail === 'already_applied'
      ? 'alreadyApplied'
      : 'notLive';
  }
  return 'failed';
}

/** One person on a room's people page: the inbox card's anatomy (0006g / 0007c) for someone who
 * has not applied. Free text (`about_me`) is plain text; the chips and reasons are fact-free. */
export function PersonCard({ person, listing, areaNames, onMutual, onAlert }: Props) {
  const { t } = useTranslation();
  const headingId = useId();
  const [whyOpen, setWhyOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState<InlineError | null>(null);
  const like = useLikePerson(listing.id);
  const unlike = useUnlikePerson(listing.id);
  const inFlight = useRef(false);
  const pending = like.isPending || unlike.isPending;
  const whyId = `${headingId}-why`;
  const moreId = `${headingId}-more`;
  const { match } = person;
  const name = person.display_name;
  // A stored move-in that has passed means today (as the inbox shows it).
  const today = todayInIsrael();
  const moveIn = person.move_in_date > today ? person.move_in_date : today;
  const gender = t(`profile.room.gender.${person.gender}`);

  async function toggle() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      if (person.liked_by_me) {
        await unlike.mutateAsync(person.id);
      } else {
        const result = await like.mutateAsync(person.id);
        if (result.application_id !== null) {
          onMutual({ name, applicationId: result.application_id });
        }
      }
    } catch (caught) {
      const kind = errorKind(caught);
      if (kind === 'alreadyApplied' || kind === 'gone') onAlert({ kind, name });
      else setError(kind);
    } finally {
      inFlight.current = false;
    }
  }

  const chips: { kind: ReasonKind; text: string }[] = [];
  const top = match.agrees[0];
  if (top !== undefined) chips.push({ kind: 'agree', text: personShort(top, 'agree', person, t) });
  if (match.differs !== null) {
    chips.push({ kind: 'differ', text: personShort(match.differs, 'differ', person, t) });
  }
  const line = (criterion: Criterion, kind: ReasonKind) => personReason(criterion, kind, person, t);

  return (
    <li>
      <article
        aria-labelledby={headingId}
        className="flex flex-col gap-3 rounded-[20px] border border-border bg-surface p-4"
      >
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-accent-soft text-[17px] font-extrabold text-accent-strong"
          >
            {Array.from(name)[0] ?? ''}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id={headingId}
                className="min-w-0 max-w-full [overflow-wrap:anywhere] text-[17px] font-extrabold"
              >
                {name}
              </h2>
              <MatchBadge score={match.score} />
              {person.liked_me && (
                <span
                  data-testid="person-liked-me"
                  className="rounded-full bg-surface-subtle px-2 py-[2px] text-[12px] font-bold text-warning"
                >
                  {t('people.likedMe')}
                </span>
              )}
            </div>
            <p className="text-start text-[13px] text-ink-muted">
              {person.age === null
                ? gender
                : t('applicants.room.line', { gender, age: person.age })}
            </p>
            {areaNames.length > 0 && (
              <p className="text-start text-[13px] text-ink-muted">
                {t('people.areas', { areas: conjunction.format(areaNames) })}
              </p>
            )}
            <p className="text-start text-[13px] text-ink-muted">
              {t('people.moveIn', { date: formatDate(moveIn) })}
              {person.move_in_flexible && <> {t('applicants.flexible')}</>}
            </p>
          </div>
        </div>
        {person.about_me !== null && person.about_me !== '' && (
          <div className="flex flex-col gap-1">
            <p className="text-start text-[13px] font-bold text-ink-muted">{t('people.aboutMe')}</p>
            {/* Free text from a seeker: React children only, line breaks kept, direction from its
                first strong character. */}
            <p
              data-testid="person-about"
              dir="auto"
              className="whitespace-pre-line break-words text-start text-[15px] leading-relaxed"
            >
              {person.about_me}
            </p>
          </div>
        )}
        {chips.length > 0 && (
          <ul data-testid="match-chips" className="flex flex-wrap gap-[6px]">
            {chips.map(({ kind, text }) => (
              <li key={kind} className={kind === 'agree' ? agreeChip : differChip}>
                {text}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            aria-expanded={whyOpen}
            aria-controls={whyId}
            aria-describedby={headingId}
            onClick={() => setWhyOpen((o) => !o)}
            className={disclosure}
          >
            {t('applicants.why')}
            <Chevron open={whyOpen} />
          </button>
          <div id={whyId} hidden={!whyOpen} className={whyOpen ? 'flex flex-col gap-3' : undefined}>
            <ul className="flex flex-col gap-2">
              {match.agrees.map((criterion) => (
                <li key={criterion} className="flex items-center gap-[10px] text-sm">
                  <AgreeIcon />
                  <span>{line(criterion, 'agree')}</span>
                </li>
              ))}
              {match.differs !== null && (
                <li className="flex items-center gap-[10px] text-sm text-ink-muted">
                  <DifferIcon />
                  <span>{line(match.differs, 'differ')}</span>
                </li>
              )}
            </ul>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls={moreId}
            aria-describedby={headingId}
            onClick={() => setMoreOpen((o) => !o)}
            className={disclosure}
          >
            {t('people.moreDetails')}
            <Chevron open={moreOpen} />
          </button>
          <div
            id={moreId}
            hidden={!moreOpen}
            className={moreOpen ? 'flex flex-col gap-3' : undefined}
          >
            <RoomDetails
              room={{ gender: person.gender, age: person.age, lifestyle: person.lifestyle }}
              flat={listing.lifestyle}
              flatIsRoom
            />
          </div>
        </div>
        <div className="flex flex-col items-start gap-2">
          {/* `aria-disabled`, not `disabled`: the focused button stays focusable while it runs. */}
          <button
            type="button"
            aria-pressed={person.liked_by_me}
            aria-describedby={headingId}
            aria-disabled={pending}
            aria-busy={pending}
            onClick={() => void toggle()}
            className={`inline-flex min-h-[44px] items-center justify-center gap-1 rounded-xl px-4 text-[15px] font-bold aria-disabled:opacity-60 ${focusRing} ${
              person.liked_by_me
                ? 'border-[1.5px] border-accent bg-accent-soft text-accent-strong'
                : 'bg-accent text-on-ink'
            }`}
          >
            {t('people.like')}
            {person.liked_by_me && <span aria-hidden="true">✓</span>}
          </button>
          {error !== null && (
            <p role="alert" className={fieldError}>
              {error === 'notLive' && t('people.notLive')}
              {error === 'rateLimited' && t('people.errors.rateLimited')}
              {error === 'failed' && t('common.error')}
            </p>
          )}
        </div>
      </article>
    </li>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform motion-reduce:transition-none${open ? ' rotate-180' : ''}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
