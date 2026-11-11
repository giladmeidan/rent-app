import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { hasStatus } from '../applications/api';
import { ApplicationStatusChip } from '../applications/ApplicationStatusChip';
import { appliedOn } from '../applications/format';
import type { ApplicantOut, ApplicantStatus } from './api';
import { useSetApplicantStatus } from './useSetApplicantStatus';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const fieldError = 'text-sm font-semibold text-[#B91C1C]';
const button = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-[15px] disabled:opacity-60 ${focusRing}`;
const primary = `${button} bg-accent font-bold text-white`;
const secondary = `${button} border-[1.5px] border-accent bg-accent-tint font-bold text-accent-text`;
const outline = `${button} border-[1.5px] border-[#D6D3D1] bg-white font-semibold`;

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
  onSettled: (outcome: CardOutcome, button: HTMLButtonElement | null) => void;
};

/** One applicant in the owner's inbox (Inbox.dc.html's card without the match parts). */
export function ApplicantCard({ listingId, applicant, headingId, onSettled }: Props) {
  const { t } = useTranslation();
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
        className="flex flex-col gap-3 rounded-[20px] border border-line bg-white p-4"
      >
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-accent-tint text-[17px] font-extrabold text-accent-text"
          >
            {Array.from(name)[0] ?? ''}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id={headingId}
                tabIndex={-1}
                className="break-words text-[17px] font-extrabold focus:outline-none"
              >
                {name}
              </h2>
              <ApplicationStatusChip viewer="owner" status={applicant.status} />
            </div>
            <p className="text-start text-[13px] text-muted">
              {t('applicants.appliedAt', { date: appliedOn(applicant.created_at) })}
            </p>
          </div>
        </div>
        {/* Free text from a seeker: React children only (never linkified or HTML), line breaks
            kept, direction from its first strong character. */}
        <p
          data-testid="applicant-message"
          dir="auto"
          className="whitespace-pre-line break-words text-start text-[15px] leading-relaxed"
        >
          {applicant.message}
        </p>
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
