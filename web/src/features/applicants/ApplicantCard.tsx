import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { hasStatus } from '../applications/api';
import { ApplicationStatusChip } from '../applications/ApplicationStatusChip';
import { appliedOn } from '../applications/format';
import type { LifestyleAnswers } from '../lifestyle/keys';
import { AgreeIcon, DifferIcon } from '../match/icons';
import { MatchBadge } from '../match/MatchBadge';
import { MatchChips } from '../match/MatchChips';
import {
  applicantMoveIn,
  contractName,
  householdName,
  ownerReason,
  parkingName,
} from '../match/reasons';
import type { ApplicantOut, ApplicantProfileOut, ApplicantRoom, ApplicantStatus } from './api';
import { RoomDetails } from './RoomDetails';
import { useSetApplicantStatus } from './useSetApplicantStatus';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const fieldError = 'text-sm font-semibold text-danger';
const button = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-[15px] disabled:opacity-60 ${focusRing}`;
const primary = `${button} bg-accent font-bold text-on-ink`;
const secondary = `${button} border-[1.5px] border-accent bg-accent-soft font-bold text-accent-strong`;
const outline = `${button} border-[1.5px] border-border-strong bg-surface font-semibold`;
const disclosure = `inline-flex min-h-[44px] items-center gap-1 self-start rounded-xl text-sm font-semibold text-accent-strong ${focusRing}`;
const iconLink = `inline-flex min-h-[44px] w-11 flex-none items-center justify-center rounded-xl border-[1.5px] border-border-strong bg-surface ${focusRing}`;

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
  onSettled: (outcome: CardOutcome, button: HTMLButtonElement | null) => void;
};

/** One applicant in the owner's inbox (Inbox.dc.html): the score, a household / move-in line, two
 * chips and a "למה ההתאמה?" disclosure (InboxDesktop.dc.html's reasons and details). An applicant
 * from before Slice 6 has no profile and no match: a "no score" pill only. A room applicant (0007c)
 * also has a gender / age line and a "עוד פרטים" disclosure with their questionnaire answers. */
export function ApplicantCard({
  listingId,
  applicant,
  headingId,
  spots,
  flatLifestyle,
  flatIsRoom,
  onSettled,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const panelId = `${headingId}-why`;
  const morePanelId = `${headingId}-more`;
  const { match, profile, room } = applicant;
  const change = useSetApplicantStatus(listingId, applicant.id);
  // Same-tick guard: a double click sends one request.
  const inFlight = useRef(false);
  const name = applicant.applicant_name;

  async function onAction(status: ApplicantStatus, target: HTMLButtonElement) {
    if (inFlight.current) return;
    if (status === 'declined' && !window.confirm(t('applicants.declineConfirm', { name }))) {
      return;
    }
    inFlight.current = true;
    try {
      // `mutateAsync` settles even if this card has left the list by then (filtered out).
      const updated = await change.mutateAsync(status);
      onSettled({ kind: 'changed', applicant: updated }, null);
    } catch (error) {
      // 401 / 403: `RequireOwner` leaves the page.
      if (hasStatus(error, 401) || hasStatus(error, 403)) return;
      if (hasStatus(error, 404)) onSettled({ kind: 'gone' }, null);
      else if (hasStatus(error, 409)) onSettled({ kind: 'conflict' }, null);
      else onSettled({ kind: 'failed' }, target);
    } finally {
      inFlight.current = false;
    }
  }

  const actions: { status: ApplicantStatus; label: string; className: string }[] =
    applicant.status === 'submitted'
      ? [
          { status: 'shortlisted', label: t('applicants.actions.shortlist'), className: primary },
          { status: 'declined', label: t('applicants.actions.decline'), className: outline },
        ]
      : applicant.status === 'shortlisted'
        ? [
            {
              status: 'submitted',
              label: t('applicants.actions.unshortlist'),
              className: secondary,
            },
            { status: 'declined', label: t('applicants.actions.decline'), className: outline },
          ]
        : [];

  // 404 is the page's alert; 401 / 403 leave the page.
  const showError =
    change.isError &&
    !hasStatus(change.error, 401) &&
    !hasStatus(change.error, 403) &&
    !hasStatus(change.error, 404);

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
                tabIndex={-1}
                className="min-w-0 max-w-full [overflow-wrap:anywhere] text-[17px] font-extrabold focus:outline-none"
              >
                {name}
              </h2>
              <ApplicationStatusChip viewer="owner" status={applicant.status} />
              {match !== null ? (
                <MatchBadge score={match.score} />
              ) : (
                <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-surface-subtle px-[10px] py-[6px] text-[13px] font-semibold text-ink-muted">
                  {t('match.noScore')}
                </span>
              )}
            </div>
            <p className="text-start text-[13px] text-ink-muted">
              {t('applicants.appliedAt', { date: appliedOn(applicant.created_at) })}
            </p>
            {room !== null && <RoomLine room={room} />}
            {profile !== null && (
              <p className="text-start text-[13px] text-ink-muted">
                {t('applicants.summary', {
                  household: householdName(profile.household, t),
                  date: applicantMoveIn(profile),
                })}
                {profile.move_in_flexible && <> {t('applicants.flexible')}</>}
              </p>
            )}
          </div>
        </div>
        {profile !== null && match !== null && (
          <MatchChips voice="owner" match={match} profile={profile} spots={spots} />
        )}
        {applicant.source === 'like' ? (
          // A mutual match has no message: the tag stands where it would be.
          <p
            data-testid="applicant-mutual"
            className="inline-flex self-start rounded-full bg-accent-soft px-[10px] py-1 text-xs font-semibold text-accent-strong"
          >
            {t('applicants.mutual')}
          </p>
        ) : (
          // Free text from a seeker: React children only (never linkified or HTML), line breaks
          // kept, direction from its first strong character.
          <p
            data-testid="applicant-message"
            dir="auto"
            className="whitespace-pre-line break-words text-start text-[15px] leading-relaxed"
          >
            {applicant.message}
          </p>
        )}
        {profile !== null && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              aria-describedby={headingId}
              onClick={() => setOpen((o) => !o)}
              className={disclosure}
            >
              {t('applicants.why')}
              <Chevron open={open} />
            </button>
            {/* Always in the DOM, so `aria-controls` names it; a display class would override
                `hidden`, so it is set only when open. */}
            <div id={panelId} hidden={!open} className={open ? 'flex flex-col gap-3' : undefined}>
              {match !== null && (
                <ul className="flex flex-col gap-2">
                  {match.agrees.map((criterion) => (
                    <li key={criterion} className="flex items-center gap-[10px] text-sm">
                      <AgreeIcon />
                      <span>{ownerReason(criterion, 'agree', profile, spots, t)}</span>
                    </li>
                  ))}
                  {match.differs !== null && (
                    <li className="flex items-center gap-[10px] text-sm text-ink-muted">
                      <DifferIcon />
                      <span>{ownerReason(match.differs, 'differ', profile, spots, t)}</span>
                    </li>
                  )}
                </ul>
              )}
              <ProfileFacts profile={profile} />
            </div>
          </div>
        )}
        {room !== null && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-controls={morePanelId}
              aria-describedby={headingId}
              onClick={() => setMoreOpen((o) => !o)}
              className={disclosure}
            >
              {t('applicants.more')}
              <Chevron open={moreOpen} />
            </button>
            {/* Always in the DOM, as the "why" panel is. */}
            <div
              id={morePanelId}
              hidden={!moreOpen}
              className={moreOpen ? 'flex flex-col gap-3' : undefined}
            >
              <RoomDetails room={room} flat={flatLifestyle} flatIsRoom={flatIsRoom} />
            </div>
          </div>
        )}
        {(actions.length > 0 || showError) && (
          <div className="flex flex-col items-start gap-2">
            {actions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {actions.map((action) => (
                  <button
                    key={action.status}
                    type="button"
                    onClick={(event) => void onAction(action.status, event.currentTarget)}
                    disabled={change.isPending}
                    aria-busy={change.isPending && change.variables === action.status}
                    aria-describedby={headingId}
                    className={action.className}
                  >
                    {action.label}
                  </button>
                ))}
                {applicant.status === 'shortlisted' && (
                  // The chat opens on shortlist (0005a); its id is the application's.
                  <Link
                    to={`/chat/${applicant.id}`}
                    aria-label={t('chat.withName', { name })}
                    aria-describedby={headingId}
                    className={iconLink}
                  >
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
                  </Link>
                )}
              </div>
            )}
            {showError && (
              <p role="alert" className={fieldError}>
                {t('common.error')}
              </p>
            )}
          </div>
        )}
      </article>
    </li>
  );
}

/** The disclosure buttons' chevron, turned while open. */
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

/** A room applicant's gender and, when given, age (0007c): plain text in the page's direction. */
function RoomLine({ room }: { room: ApplicantRoom }) {
  const { t } = useTranslation();
  const gender = t(`profile.room.gender.${room.gender}`);
  return (
    <p className="text-start text-[13px] text-ink-muted">
      {room.age === null ? gender : t('applicants.room.line', { gender, age: room.age })}
    </p>
  );
}

/** The applicant's housing details (InboxDesktop.dc.html's grid, without ages or occupation). */
function ProfileFacts({ profile }: { profile: ApplicantProfileOut }) {
  const { t } = useTranslation();
  const moveIn = applicantMoveIn(profile);
  const rows = [
    {
      key: 'household',
      label: t('applicants.profile.household'),
      value: householdName(profile.household, t),
    },
    {
      key: 'moveIn',
      label: t('applicants.profile.moveIn'),
      value: profile.move_in_flexible
        ? `${moveIn} (${t('listings.fields.entryFlexible')})`
        : moveIn,
    },
    {
      key: 'contract',
      label: t('applicants.profile.contract'),
      value: contractName(profile.contract_months, t),
    },
    {
      key: 'pets',
      label: t('applicants.profile.pets'),
      value: profile.has_pets ? t('listing.yes') : t('listing.no'),
    },
    {
      key: 'smoker',
      label: t('applicants.profile.smoker'),
      value: profile.smoker ? t('applicants.profile.yes') : t('applicants.profile.no'),
    },
    {
      key: 'parking',
      label: t('applicants.profile.parking'),
      value: parkingName(profile.parking_needed, t),
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-[10px]">
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex min-w-0 flex-col gap-[2px] rounded-xl bg-surface-subtle px-3 py-[10px]"
        >
          <dt className="text-xs text-ink-muted">{row.label}</dt>
          <dd className="text-sm font-bold">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
