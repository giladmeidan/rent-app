import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { ChoiceGroup } from '../../components/ChoiceGroup';
import { Dialog } from '../../components/Dialog';
import { Field } from '../../components/Field';
import { retryAfterText } from '../../components/retryAfter';
import { Textarea } from '../../components/Textarea';
import { useOnline } from '../../components/useOnline';
import { hasStatus } from '../applications/api';
import { clearSession } from '../auth/useLogout';
import { ApiError } from '../listings/api';
import type { ReportReason, ReportTargetType } from './api';
import { reasonLabel } from './reasons';
import { useReport } from './useReport';

/** The API's note limit (`NOTE_MAX_LENGTH`). */
const NOTE_MAX = 500;
/** The counter is announced only near the limit. */
const ANNOUNCE_BELOW = 50;

export type ReportTarget = { type: ReportTargetType; id: string };

type Outcome = 'form' | 'sent' | 'already' | 'gone';
type SendError = { kind: 'failed' } | { kind: 'rateLimited'; retryAfter: number | null };

/** True when a FastAPI 422 `detail` list has an item at `loc` `["body", "note"]`. */
function isNoteError(detail: unknown): boolean {
  return (
    Array.isArray(detail) &&
    detail.some((item: unknown) => {
      if (typeof item !== 'object' || item === null || !('loc' in item)) return false;
      const loc: unknown = item.loc;
      return Array.isArray(loc) && loc.length === 2 && loc[0] === 'body' && loc[1] === 'note';
    })
  );
}

type Props = {
  target: ReportTarget;
  title: string;
  reasons: readonly ReportReason[];
  /** A line between the intro and the reasons. */
  hint?: string;
  open: boolean;
  /** Esc, the backdrop, ביטול or סגירה: the parent closes it. A running request is not cancelled. */
  onClose: () => void;
};

/**
 * The one report dialog (spec 0011b): a reason, an optional note, then "thank you" (or "already
 * reported", or "no longer here"). Mount it anew (a new `key`) for each opening, so it starts
 * empty. The report reaches only homie's team: nothing else happens.
 */
export function ReportDialog({ target, title, reasons, hint, open, onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const report = useReport();
  const online = useOnline();
  const id = useId();
  const counterId = `${id}-counter`;
  const errorId = `${id}-error`;
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [noteInvalid, setNoteInvalid] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const [outcome, setOutcome] = useState<Outcome>('form');
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Same-tick guard: a double click sends one request (every attempt counts toward the limit).
  const inFlight = useRef(false);

  // The answer replaces the form: focus moves to סגירה.
  useEffect(() => {
    if (outcome !== 'form') closeRef.current?.focus();
  }, [outcome]);

  function submit() {
    if (reason === null || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setNoteInvalid(false);
    const trimmed = note.trim();
    report.mutate(
      {
        target_type: target.type,
        target_id: target.id,
        reason,
        note: trimmed === '' ? null : trimmed,
      },
      {
        onSettled: () => {
          inFlight.current = false;
        },
        onSuccess: (out) => setOutcome(out.already_reported ? 'already' : 'sent'),
        onError: (caught) => {
          if (hasStatus(caught, 401)) {
            clearSession(queryClient);
          } else if (hasStatus(caught, 404)) {
            setOutcome('gone');
          } else if (hasStatus(caught, 429)) {
            const retryAfter = caught instanceof ApiError ? caught.retryAfter : null;
            setError({ kind: 'rateLimited', retryAfter });
          } else if (
            caught instanceof ApiError &&
            caught.status === 422 &&
            isNoteError(caught.detail)
          ) {
            setNoteInvalid(true);
            noteRef.current?.focus();
          } else {
            setError({ kind: 'failed' });
          }
        },
      },
    );
  }

  const done = outcome !== 'form';
  const left = NOTE_MAX - note.length;

  let errorText: string | null = null;
  if (error?.kind === 'rateLimited') {
    errorText =
      error.retryAfter !== null
        ? t('report.errors.rateLimitedIn', { when: retryAfterText(t, error.retryAfter) })
        : t('report.errors.rateLimited');
  } else if (error?.kind === 'failed') {
    errorText = online ? t('report.errors.failed') : t('common.offline');
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={t('report.intro')}
      actions={
        done ? (
          <Button ref={closeRef} variant="primary" onClick={onClose}>
            {t('report.close')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={reason === null}
              busy={report.isPending}
            >
              {t('report.submit')}
            </Button>
          </>
        )
      }
    >
      {outcome === 'gone' && (
        <p role="alert" className="text-start text-body">
          {t('report.gone')}
        </p>
      )}
      {(outcome === 'sent' || outcome === 'already') && (
        <p role="status" className="text-start text-body">
          {outcome === 'sent' ? t('report.sent') : t('report.already')}
        </p>
      )}
      {!done && (
        <>
          {hint !== undefined && <p className="text-start text-body-sm text-ink-muted">{hint}</p>}
          <ChoiceGroup
            legend={t('report.reasonLegend')}
            name={`report-${target.id}`}
            options={reasons.map((value) => ({ value, label: reasonLabel(t, value) }))}
            value={reason}
            onChange={setReason}
            stacked
          />
          <div className="flex flex-col gap-1.5">
            <Field
              label={t('report.note')}
              error={noteInvalid ? t('report.errors.noteInvalid') : undefined}
            >
              <Textarea
                ref={noteRef}
                rows={4}
                maxLength={NOTE_MAX}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setNoteInvalid(false);
                }}
                aria-describedby={errorText !== null ? `${counterId} ${errorId}` : counterId}
              />
            </Field>
            <p
              id={counterId}
              className="text-start text-caption text-ink-muted"
              aria-live={left <= ANNOUNCE_BELOW ? 'polite' : undefined}
            >
              {t('listings.fields.charsLeft', { count: left })}
            </p>
            {errorText !== null && (
              <p
                id={errorId}
                role="alert"
                className="text-start text-body-sm font-semibold text-danger"
              >
                {errorText}
              </p>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
