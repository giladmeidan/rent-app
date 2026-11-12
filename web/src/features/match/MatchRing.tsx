import { useTranslation } from 'react-i18next';

import { bucket } from './bucket';

type Props = {
  /** The match score, 0-100. */
  score: number;
  size: 'md' | 'lg';
  /** Adds "התאמה" under the ring. */
  label?: boolean;
};

const SIZES = {
  md: 'size-12 border-2 text-label',
  lg: 'size-14 border-4 text-h3',
} as const;

// A high score is the brand's accent ring; good and partial are neutral.
const TONES = {
  high: 'border-accent bg-accent-soft text-accent-strong',
  good: 'border-border-strong bg-surface-subtle text-ink-muted',
  partial: 'border-border-strong bg-surface-subtle text-ink-muted',
} as const;

/**
 * The score as a ring (Inbox.dc.html): "94%" in Rubik (Fredoka is never used below 24px), with an
 * optional "התאמה" label under it. The visible parts are `aria-hidden`; a screen reader gets
 * "התאמה 94%". The colour only repeats the words. `MatchBadge` is the pill of search and the map.
 */
export function MatchRing({ score, size, label = false }: Props) {
  const { t } = useTranslation();
  const level = bucket(score);
  return (
    <span
      data-testid="match-ring"
      data-bucket={level}
      className="inline-flex flex-col items-center gap-0.5"
    >
      <span
        aria-hidden="true"
        className={`flex items-center justify-center rounded-full tabular-nums ${SIZES[size]} ${TONES[level]}`}
      >
        {t('match.card.score', { score })}
      </span>
      {label && (
        <span aria-hidden="true" className="text-caption font-semibold text-ink-muted">
          {t('match.ring.label')}
        </span>
      )}
      <span className="sr-only">{t('match.badge', { score })}</span>
    </span>
  );
}
