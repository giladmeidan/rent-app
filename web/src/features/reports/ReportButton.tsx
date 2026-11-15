import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import type { ReportReason } from './api';
import { ReportDialog, type ReportTarget } from './ReportDialog';

/** An outline flag (brand iconography: 2 px stroke, round caps, `currentColor`). Decorative. */
export function FlagIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 21V4" />
      <path d="M5 4h12l-2 4 2 4H5" />
    </svg>
  );
}

type Props = {
  target: ReportTarget;
  /** The dialog's title. */
  title: string;
  reasons: readonly ReportReason[];
  /** The visible text; `report.button` by default. */
  label?: string;
  /** The id of what the button reports on (a card's heading). */
  describedBy?: string;
  /** The button's accessible name, when it must say more than the visible text (a chat). */
  ariaLabel?: string;
  /** A line in the dialog between the intro and the reasons (a group chat). */
  hint?: string;
};

/** The report button and its dialog, mounted anew on each opening so every opening starts empty. */
export function ReportButton({
  target,
  title,
  reasons,
  label,
  describedBy,
  ariaLabel,
  hint,
}: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState({ open: false, key: 0 });
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={<FlagIcon />}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        onClick={() => setState((s) => ({ open: true, key: s.key + 1 }))}
      >
        {label ?? t('report.button')}
      </Button>
      {state.key > 0 && (
        <ReportDialog
          key={state.key}
          target={target}
          title={title}
          reasons={reasons}
          hint={hint}
          open={state.open}
          onClose={() => setState((s) => ({ ...s, open: false }))}
        />
      )}
    </>
  );
}
