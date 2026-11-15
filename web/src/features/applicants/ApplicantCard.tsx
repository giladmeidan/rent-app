import { useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ClampedText } from '../../components/ClampedText';
import { cx } from '../../components/cx';
import { focusRing } from '../../components/focusRing';
import { useOnline } from '../../components/useOnline';
import { hasStatus } from '../applications/api';
import { ApplicationStatusChip } from '../applications/ApplicationStatusChip';
import { appliedOn } from '../applications/format';
import type { LifestyleAnswers } from '../lifestyle/keys';
import { MatchChips } from '../match/MatchChips';
import { MatchRing } from '../match/MatchRing';
import { applicantMoveIn, householdName, ownerReason } from '../match/reasons';
import { ReasonList } from '../match/ReasonList';
import { PERSON_REASONS } from '../reports/reasons';
import { ReportButton } from '../reports/ReportButton';
import type { ReasonKind } from '../match/types';
import type { ApplicantOut, ApplicantStatus } from './api';
import { ProfileFacts } from './ApplicantDetails';
import { DisclosureButton } from './DisclosureButton';
import { RoomDetails } from './RoomDetails';
import { RoomLine } from './RoomLine';
import { useSetApplicantStatus } from './useSetApplicantStatus';

/** What the page does once a change is settled (it owns focus, the announcement and the alert). */
export type CardOutcome =
  | { kind: 'changed'; applicant: ApplicantOut }
  | { kind: 'gone' }
  | { kind: 'conflict' }
  | { kind: 'failed' };

type Props = {
  listingId: string;
  applicant: ApplicantOut;
  /** The `<h2>`'s id: the card's label, the actions' description and a focus target. */
  headingId: string;
  /** The listing's `parking_spots`, for the owner-voice parking line. */
  spots: number;
  /** The listing's own questionnaire answers, compared with a room applicant's (0007c). */
  flatLifestyle: LifestyleAnswers;
  /** Whether the listing is a room now (0007c: the "fill the flat's questionnaire" hint). */
  flatIsRoom: boolean;
  /** Asks before a decline (the page's kit dialog); resolves `false` on cancel. */
  confirmDecline: (name: string) => Promise<boolean>;
  onSettled: (outcome: CardOutcome, button: HTMLButtonElement | null) => void;
  /** `stacked`: the phone card, with its disclosures. `compact`: the desktop grid's card (0009u):
   * a message preview, no disclosures (the pane has them) and a name button that selects it. */
  layout: 'stacked' | 'compact';
  /** Compact only: whether this card's applicant is the one the pane shows. */
  selected?: boolean;
  /** Compact only: selects this applicant. */
  onSelect?: () => void;
  /** Compact only: the id of the pane the name button controls. */
  paneId?: string;
};

/** The chat link's icon (today's path): decorative, the link is named by its `aria-label`. */
export function ChatIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a8 8 0 0 1-11.6 7.2L4 21l1.8-5A8 8 0 1 1 21 12z" />
    </svg>
  );
}

/** The owner-voice reason lines of an applicant: the agreeing criteria, then the differing one. */
export function reasonLines(
  { match, profile }: Pick<ApplicantOut, 'match' | 'profile'>,
  spots: number,
  t: TFunction,
): { kind: ReasonKind; text: string }[] {
  if (match === null || profile === null) return [];
  return [
    ...match.agrees.map((criterion) => ({
      kind: 'agree' as const,
      text: ownerReason(criterion, 'agree', profile, spots, t),
    })),
    ...(match.differs !== null
      ? [
          {
            kind: 'differ' as const,
            text: ownerReason(match.differs, 'differ', profile, spots, t),
          },
        ]
      : []),
  ];
}

/** One applicant in the owner's inbox (Inbox.dc.html): the score ring at the inline end, a household /
 * move-in line, two chips, the message in a quiet box (clamped, with "הצגת עוד") and the disclosures
 * and actions. An applicant from before Slice 6 has no profile and no match: a "no score" badge only.
 * A room applicant (0007c) also has a gender / age line and a "עוד פרטים" disclosure. */
export function ApplicantCard({
  listingId,
  applicant,
  headingId,
  spots,
  flatLifestyle,
  flatIsRoom,
  confirmDecline,
  onSettled,
  layout,
  selected = false,
  onSelect,
  paneId,
}: Props) {
  const { t } = useTranslation();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const panelId = `${headingId}-why`;
  const morePanelId = `${headingId}-more`;
  const { match, profile, room } = applicant;
  const change = useSetApplicantStatus(listingId, applicant.id);
  // Same-tick guard: a double click sends one request (and asks once).
  const inFlight = useRef(false);
  const name = applicant.applicant_name;
  const compact = layout === 'compact';

  async function onAction(status: ApplicantStatus, target: HTMLButtonElement) {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (status === 'declined' && !(await confirmDecline(name))) return;
      // `mutateAsync` settles even if this card has left the list by then (filtered out).
      const updated = await change.mutateAsync(status);
      onSettled({ kind: 'changed', applicant: updated }, null);
    } catch (error) {
      // 401: `RequireUser` leaves the page; 403: none since spec 0010b (`/me` is re-checked).
      if (hasStatus(error, 401) || hasStatus(error, 403)) return;
      if (hasStatus(error, 404)) onSettled({ kind: 'gone' }, null);
      else if (hasStatus(error, 409)) onSettled({ kind: 'conflict' }, null);
      else onSettled({ kind: 'failed' }, target);
    } finally {
      inFlight.current = false;
    }
  }

  const actions: {
    status: ApplicantStatus;
    label: string;
    variant: 'primary' | 'soft' | 'secondary';
  }[] =
    applicant.status === 'submitted'
      ? [
          { status: 'shortlisted', label: t('applicants.actions.shortlist'), variant: 'primary' },
          { status: 'declined', label: t('applicants.actions.decline'), variant: 'secondary' },
        ]
      : applicant.status === 'shortlisted'
        ? [
            { status: 'submitted', label: t('applicants.actions.unshortlist'), variant: 'soft' },
            { status: 'declined', label: t('applicants.actions.decline'), variant: 'secondary' },
          ]
        : [];

  // 404 is the page's alert; 401 / 403 leave the page.
  const showError =
    change.isError &&
    !hasStatus(change.error, 401) &&
    !hasStatus(change.error, 403) &&
    !hasStatus(change.error, 404);

  const reasons = reasonLines(applicant, spots, t);

  return (
    <Card
      as="article"
      aria-labelledby={headingId}
      padding="sm"
      variant={compact && selected ? 'selected' : 'default'}
      className={cx('flex flex-col gap-3', compact && 'relative')}
    >
      <div className="flex items-start gap-3">
        <Avatar
          name={name}
          photoUrl={applicant.photo_url}
          size="md"
          tone={compact && selected ? 'accent' : 'neutral'}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div
            data-testid="applicant-name-row"
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            {/* `overflow-wrap: anywhere` (no Tailwind token): a long unbroken name wraps. */}
            <h2
              id={headingId}
              tabIndex={-1}
              className="min-w-0 max-w-full [overflow-wrap:anywhere] text-h3 focus:outline-none"
            >
              {compact ? (
                // The card's stretched control: the ::after covers the card, so a click anywhere on
                // it selects (the action row sits above it, `relative z-10`). Not `Card interactive`:
                // its ring follows a link's focus, never a button's.
                <button
                  type="button"
                  aria-controls={paneId}
                  aria-current={selected ? 'true' : undefined}
                  onClick={onSelect}
                  className={cx('text-start after:absolute after:inset-0', focusRing)}
                >
                  {name}
                </button>
              ) : (
                name
              )}
            </h2>
            <ApplicationStatusChip viewer="owner" status={applicant.status} />
            {applicant.source === 'like' && (
              <Badge tone="accent" data-testid="applicant-mutual">
                {t('applicants.mutual')}
              </Badge>
            )}
          </div>
          <p className="text-start text-caption text-ink-muted">
            {t('applicants.appliedAt', { date: appliedOn(applicant.created_at) })}
          </p>
          {room !== null && <RoomLine gender={room.gender} age={room.age} />}
          {profile !== null && (
            <p className="text-start text-caption text-ink-muted">
              {t('applicants.summary', {
                household: householdName(profile.household, t),
                date: applicantMoveIn(profile),
              })}
              {profile.move_in_flexible && <> {t('applicants.flexible')}</>}
            </p>
          )}
        </div>
        <div className="flex-none">
          {match !== null ? (
            <MatchRing score={match.score} size="md" label />
          ) : (
            <Badge tone="neutral">{t('match.noScore')}</Badge>
          )}
        </div>
      </div>
      {profile !== null && match !== null && (
        <MatchChips voice="owner" match={match} profile={profile} spots={spots} />
      )}
      {/* Whenever there is one, whatever the source (spec 0010l: optional on a room). */}
      {applicant.message !== null &&
        (compact ? (
          // A two-line preview for scanning; the pane shows the whole message, so nothing is hidden.
          // Line breaks fold into spaces here, so a blank first line cannot leave a lone "…" line.
          <p
            dir="auto"
            data-testid="applicant-message"
            className="line-clamp-2 whitespace-normal break-words text-body-sm text-ink-muted"
          >
            {applicant.message}
          </p>
        ) : (
          // Free text from a seeker: React text children only (never linkified or HTML), line breaks
          // kept, direction from its first strong character.
          <ClampedText
            lines={4}
            id={`${headingId}-message`}
            describedBy={headingId}
            textProps={{
              dir: 'auto',
              'data-testid': 'applicant-message',
              className:
                'self-stretch whitespace-pre-line break-words rounded-md bg-surface-subtle px-3 py-3 text-body-sm text-ink',
            }}
          >
            {applicant.message}
          </ClampedText>
        ))}
      {!compact && (profile !== null || room !== null) && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-x-4">
            {profile !== null && (
              <DisclosureButton
                open={open}
                controls={panelId}
                describedBy={headingId}
                onToggle={() => setOpen((o) => !o)}
              >
                {t('applicants.why')}
              </DisclosureButton>
            )}
            {room !== null && (
              <DisclosureButton
                open={moreOpen}
                controls={morePanelId}
                describedBy={headingId}
                onToggle={() => setMoreOpen((o) => !o)}
              >
                {t('applicants.more')}
              </DisclosureButton>
            )}
          </div>
          {/* Always in the DOM, so `aria-controls` names them; a display class would override
              `hidden`, so it is set only when open. */}
          {profile !== null && (
            <div id={panelId} hidden={!open} className={open ? 'flex flex-col gap-3' : undefined}>
              {match !== null && <ReasonList lines={reasons} />}
              <ProfileFacts profile={profile} />
            </div>
          )}
          {room !== null && (
            <div
              id={morePanelId}
              hidden={!moreOpen}
              className={moreOpen ? 'flex flex-col gap-3' : undefined}
            >
              <RoomDetails room={room} flat={flatLifestyle} flatIsRoom={flatIsRoom} />
            </div>
          )}
        </div>
      )}
      {(actions.length > 0 || showError) && (
        <div className={cx('flex flex-col gap-2', compact && 'relative z-10')}>
          {actions.length > 0 && (
            <div className="flex gap-2">
              {actions.map((action) => (
                <Button
                  key={action.status}
                  variant={action.variant}
                  size="md"
                  onClick={(event) => void onAction(action.status, event.currentTarget)}
                  disabled={change.isPending}
                  aria-busy={change.isPending && change.variables === action.status}
                  aria-describedby={headingId}
                  className="flex-1"
                >
                  {action.label}
                </Button>
              ))}
              {applicant.status === 'shortlisted' && (
                // The chat opens on shortlist (0005a); its id is the application's.
                <Button
                  to={`/chat/${applicant.id}`}
                  variant="secondary"
                  icon={<ChatIcon />}
                  aria-label={t('chat.withName', { name })}
                  aria-describedby={headingId}
                  className="flex-none"
                />
              )}
            </div>
          )}
          {showError && (
            <p role="alert" className="text-body-sm font-semibold text-danger">
              {online ? t('applicants.errors.actionFailed') : t('common.offline')}
            </p>
          )}
        </div>
      )}
      {!compact && (
        <div className="flex justify-end">
          <ReportButton
            target={{ type: 'applicant', id: applicant.id }}
            title={t('report.title.person', { name })}
            reasons={PERSON_REASONS}
            describedBy={headingId}
          />
        </div>
      )}
    </Card>
  );
}
