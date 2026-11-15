import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { retryAfterText } from '../../components/retryAfter';
import { DisclosureButton } from '../applicants/DisclosureButton';
import { RoomDetails } from '../applicants/RoomDetails';
import { RoomLine } from '../applicants/RoomLine';
import { hasStatus } from '../applications/api';
import { ApiError, type MyListingOut } from '../listings/api';
import { formatDate, todayInIsrael } from '../listings/format';
import { MatchChips } from '../match/MatchChips';
import { MatchRing } from '../match/MatchRing';
import { personReason } from '../match/reasons';
import { ReasonList } from '../match/ReasonList';
import { PERSON_REASONS } from '../reports/reasons';
import { ReportButton } from '../reports/ReportButton';
import type { Criterion, ReasonKind } from '../match/types';
import type { PersonOut } from './api';
import { useLikePerson, useUnlikePerson } from './useLikePerson';

const conjunction = new Intl.ListFormat('he', { type: 'conjunction' });

/** An outcome after which the card is gone from the refetched list (the API drops a person with an
 * open application or who no longer fits), so the page, not the card, shows it. */
export type PageAlert = { kind: 'alreadyApplied' | 'gone'; name: string };

type Props = {
  person: PersonOut;
  /** The room (`MyListingOut`): its answers are compared with the person's. */
  listing: MyListingOut;
  /** The person's area names, already resolved (an id with no name is left out). */
  areaNames: string[];
  onAlert: (alert: PageAlert) => void;
};

type LikeError = 'alreadyApplied' | 'gone' | 'notLive' | 'rateLimited' | 'failed';
type InlineError = Exclude<LikeError, 'alreadyApplied' | 'gone'>;

/** The alert a failed like / unlike shows; `null` for 401 (`RequireUser` leaves the page) and 403
 * (no role gate since spec 0010b; `/me` is re-checked). */
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
export function PersonCard({ person, listing, areaNames, onAlert }: Props) {
  const { t } = useTranslation();
  const headingId = useId();
  const [whyOpen, setWhyOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState<InlineError | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
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

  async function toggle() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      if (person.liked_by_me) {
        await unlike.mutateAsync(person.id);
      } else {
        // An invite (spec 0010l): the person's application answers it, in the inbox.
        await like.mutateAsync(person.id);
      }
    } catch (caught) {
      const kind = errorKind(caught);
      if (kind === 'alreadyApplied' || kind === 'gone') onAlert({ kind, name });
      else {
        setRetryAfter(caught instanceof ApiError ? caught.retryAfter : null);
        setError(kind);
      }
    } finally {
      inFlight.current = false;
    }
  }

  const line = (criterion: Criterion, kind: ReasonKind) => personReason(criterion, kind, person, t);
  const reasons: { kind: ReasonKind; text: string }[] = [
    ...match.agrees.map((criterion) => ({
      kind: 'agree' as const,
      text: line(criterion, 'agree'),
    })),
    ...(match.differs !== null
      ? [{ kind: 'differ' as const, text: line(match.differs, 'differ') }]
      : []),
  ];

  return (
    <li>
      <Card as="article" aria-labelledby={headingId} padding="sm" className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Avatar name={name} photoUrl={person.photo_url} size="md" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div
              data-testid="person-name-row"
              className="flex flex-wrap items-center gap-x-2 gap-y-1"
            >
              {/* `overflow-wrap: anywhere` (no Tailwind token): a long unbroken name wraps. */}
              <h2 id={headingId} className="min-w-0 max-w-full [overflow-wrap:anywhere] text-h3">
                {name}
              </h2>
            </div>
            <RoomLine gender={person.gender} age={person.age} />
            {areaNames.length > 0 && (
              <p className="text-start text-caption text-ink-muted">
                {t('people.areas', { areas: conjunction.format(areaNames) })}
              </p>
            )}
            <p className="text-start text-caption text-ink-muted">
              {t('people.moveIn', { date: formatDate(moveIn) })}
              {person.move_in_flexible && <> {t('applicants.flexible')}</>}
            </p>
          </div>
          <div className="flex-none">
            <MatchRing score={match.score} size="md" label />
          </div>
        </div>
        <MatchChips voice="person" match={match} person={person} />
        {person.about_me !== null && person.about_me !== '' && (
          <div className="flex flex-col gap-1">
            <p className="text-start text-label text-ink-muted">{t('people.aboutMe')}</p>
            {/* Free text from a seeker: React children only, line breaks kept, direction from its
              first strong character. */}
            <p
              data-testid="person-about"
              dir="auto"
              className="whitespace-pre-line break-words rounded-md bg-surface-subtle px-3 py-3 text-start text-body-sm text-ink"
            >
              {person.about_me}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-x-4">
            <DisclosureButton
              open={whyOpen}
              controls={whyId}
              describedBy={headingId}
              onToggle={() => setWhyOpen((o) => !o)}
            >
              {t('applicants.why')}
            </DisclosureButton>
            <DisclosureButton
              open={moreOpen}
              controls={moreId}
              describedBy={headingId}
              onToggle={() => setMoreOpen((o) => !o)}
            >
              {t('people.moreDetails')}
            </DisclosureButton>
          </div>
          {/* Always in the DOM, so `aria-controls` names them; a display class would override
            `hidden`, so it is set only when open. */}
          <div id={whyId} hidden={!whyOpen} className={whyOpen ? 'flex flex-col gap-3' : undefined}>
            <ReasonList lines={reasons} />
          </div>
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
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* `busy` keeps the focused button focusable while it runs (aria-disabled, not disabled). */}
            <Button
              size="md"
              variant={person.liked_by_me ? 'soft' : 'primary'}
              aria-pressed={person.liked_by_me}
              aria-describedby={headingId}
              busy={pending}
              onClick={() => void toggle()}
            >
              {t('people.invite')}
              {person.liked_by_me && <span aria-hidden="true">✓</span>}
            </Button>
            <ReportButton
              target={{ type: 'room_person', id: person.id }}
              title={t('report.title.person', { name })}
              reasons={PERSON_REASONS}
              describedBy={headingId}
            />
          </div>
          {error !== null && (
            <p role="alert" className="text-body-sm font-semibold text-danger">
              {error === 'notLive' && t('people.notLive')}
              {error === 'rateLimited' &&
                (retryAfter !== null
                  ? t('people.errors.inviteRateLimitedIn', { when: retryAfterText(t, retryAfter) })
                  : t('people.errors.inviteRateLimited'))}
              {error === 'failed' && t('common.error')}
            </p>
          )}
        </div>
      </Card>
    </li>
  );
}
