import { useTranslation } from 'react-i18next';

import { Badge, type BadgeTone } from '../../components/Badge';
import { bucket } from './bucket';

// A results page shows many badges, and the brand allows one accent-filled element per screen:
// a high score is accent-soft, good and partial are neutral (amber stays the colour of "differs").
const tone: Record<ReturnType<typeof bucket>, BadgeTone> = {
  high: 'accent',
  good: 'neutral',
  partial: 'neutral',
};

/** The "התאמה 87%" pill. The words carry the meaning; the colour only repeats it. "87%" is one
 * European-number run (bidi W5), so it needs no `dir`. */
export function MatchBadge({ score }: { score: number }) {
  const { t } = useTranslation();
  return (
    <Badge
      size="md"
      tone={tone[bucket(score)]}
      data-testid="match-badge"
      data-bucket={bucket(score)}
    >
      {t('match.badge', { score })}
    </Badge>
  );
}
