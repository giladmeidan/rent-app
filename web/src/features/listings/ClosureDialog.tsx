import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { ChoiceGroup } from '../../components/ChoiceGroup';
import { Dialog } from '../../components/Dialog';
import { Field } from '../../components/Field';
import { TextInput } from '../../components/TextInput';
import type { CloseReason, MyListingOut } from './api';
import { CLOSE_REASONS } from './constants';
import { useSaveClosure } from './useSaveClosure';
import { LIMITS } from './validate';

/** "הושכרה במקום אחר" (0014b). A literal map, so `i18n-check` sees every key. */
export function closeReasonLabel(t: TFunction, reason: CloseReason): string {
  return {
    rented_here: t('listings.closure.reasons.rentedHere'),
    rented_elsewhere: t('listings.closure.reasons.rentedElsewhere'),
    not_renting: t('listings.closure.reasons.notRenting'),
  }[reason];
}

type Props = {
  listing: Pick<MyListingOut, 'id' | 'close_reason' | 'final_rent_ils'>;
  open: boolean;
  /** "לא עכשיו", Esc or the backdrop: nothing is sent. */
  onClose: () => void;
  /** The answer was stored; the parent closes the dialog and announces it. */
  onSaved: () => void;
};

/**
 * What happened to an apartment that is paused or expired (0014b): optional, private to the owner,
 * pre-filled with an earlier answer. The rent is asked only for a "rented" reason. Mount it anew
 * (a new `key`) for each opening, so it starts from the stored answer.
 */
export function ClosureDialog({ listing, open, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const save = useSaveClosure(listing.id);
  const [reason, setReason] = useState<CloseReason | null>(listing.close_reason);
  const [rent, setRent] = useState(
    listing.final_rent_ils === null ? '' : String(listing.final_rent_ils),
  );
  const [rangeError, setRangeError] = useState(false);
  const rented = reason === 'rented_here' || reason === 'rented_elsewhere';
  const { min, max } = LIMITS.price_ils;

  const submit = () => {
    if (reason === null) return;
    const finalRent = rented && rent !== '' ? Number(rent) : null;
    if (finalRent !== null && (finalRent < min || finalRent > max)) {
      setRangeError(true);
      return;
    }
    save.mutate({ reason, final_rent_ils: finalRent }, { onSuccess: onSaved });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('listings.closure.title')}
      description={t('listings.closure.intro')}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('listings.closure.skip')}
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={reason === null || save.isPending}
            aria-busy={save.isPending}
          >
            {t('listings.closure.save')}
          </Button>
        </>
      }
    >
      <ChoiceGroup
        legend={t('listings.closure.reason')}
        name={`closure-${listing.id}`}
        options={CLOSE_REASONS.map((value) => ({ value, label: closeReasonLabel(t, value) }))}
        value={reason}
        onChange={setReason}
      />
      {rented && (
        <Field
          label={t('listings.closure.finalRent')}
          hint={t('listings.fields.optional')}
          error={rangeError ? t('listings.errors.range', { min, max }) : undefined}
        >
          <TextInput
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={rent}
            onChange={(e) => {
              setRent(e.target.value.replace(/\D/g, ''));
              setRangeError(false);
            }}
            end={t('listings.units.ils')}
          />
        </Field>
      )}
      {save.isError && (
        <p role="alert" className="text-label text-danger">
          {t('common.error')}
        </p>
      )}
    </Dialog>
  );
}
