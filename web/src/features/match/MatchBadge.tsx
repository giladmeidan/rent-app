import { useTranslation } from 'react-i18next';

import { bucket } from './bucket';

// As the artboards: a high score is solid accent; good and partial are neutral (amber stays the
// colour of "differs").
const tone = {
  high: 'bg-accent text-on-ink',
  good: 'bg-surface-subtle text-ink-muted',
  partial: 'bg-surface-subtle text-ink-muted',
} as const;

/** The "התאמה 87%" pill. The words carry the meaning; the colour only repeats it. "87%" is one
 * European-number run (bidi W5), so it needs no `dir`. */
export function MatchBadge({ score }: { score: number }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid="match-badge"
      data-bucket={bucket(score)}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-[10px] py-[6px] text-[13px] font-bold ${tone[bucket(score)]}`}
    >
      {t('match.badge', { score })}
    </span>
  );
}
