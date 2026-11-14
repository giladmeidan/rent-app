import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ClampedText } from '../../components/ClampedText';
import { focusRing } from '../../components/focusRing';
import { ApiError } from '../listings/api';
import { hasStatus } from '../applications/api';
import { formatDate, todayInIsrael } from '../listings/format';
import { compareLifestyle, type LifestyleAnswers } from '../lifestyle/keys';
import { lifestyleTopic } from '../lifestyle/topic';
import { profileHref } from '../profile/links';
import type { PersonCardOut } from './api';
import { useLikeCard, useUnlikeCard } from './useMarketPeople';

const conjunction = new Intl.ListFormat('he', { type: 'conjunction' });

type Props = {
  card: PersonCardOut;
  /** The card's area names, already resolved (an id with no name is left out). */
  areaNames: string[];
  /** The viewer's own answers, compared with the card's (no score: Q15). */
  viewerLifestyle: LifestyleAnswers;
  /** The page's path, where the profile link returns to. */
  next: string;
  /** The heading level under the page's own headings. */
  titleAs?: 'h2' | 'h3';
  /** The like made the pair mutual: the direct chat's id. */
  onMutual: (card: PersonCardOut, conversationId: string) => void;
  /** The card is gone (404): the page says so, since the card left the list. */
  onGone: () => void;
};

type LikeError = 'gone' | 'rateLimited' | 'needsCard' | 'failed';

/** What a failed like or unlike shows; `null` for 401 (`RequireUser` leaves the page). */
function errorKind(error: unknown): LikeError | null {
  if (hasStatus(error, 401)) return null;
  if (hasStatus(error, 404)) return 'gone';
  if (hasStatus(error, 429)) return 'rateLimited';
  if (error instanceof ApiError && error.status === 403 && error.detail === 'card_required') {
    return 'needsCard';
  }
  return 'failed';
}

/**
 * One person in שוק השותפים: their card as another person sees it (0010h). The name, age, gender,
 * areas, move-in date and "about me" (plain text, never a link), their answers set beside the
 * viewer's own (a count and the topics that differ, no score) and the like toggle.
 */
export function MarketPersonCard({
  card,
  areaNames,
  viewerLifestyle,
  next,
  titleAs: Title = 'h2',
  onMutual,
  onGone,
}: Props) {
  const { t } = useTranslation();
  const headingId = useId();
  const aboutId = `${headingId}-about`;
  const [error, setError] = useState<Exclude<LikeError, 'gone'> | null>(null);
  const like = useLikeCard();
  const unlike = useUnlikeCard();
  const inFlight = useRef(false);
  const pending = like.isPending || unlike.isPending;
  const name = card.display_name;
  // A stored move-in that has passed means today.
  const today = todayInIsrael();
  const moveIn = card.move_in_date > today ? card.move_in_date : today;
  const gender = t(`profile.room.gender.${card.gender}`);
  const { shared, same, differing } = compareLifestyle(viewerLifestyle, card.lifestyle);

  async function toggle() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      if (card.liked_by_me) {
        await unlike.mutateAsync(card);
      } else {
        const result = await like.mutateAsync(card);
        if (result.conversation_id !== null) onMutual(card, result.conversation_id);
      }
    } catch (caught) {
      const kind = errorKind(caught);
      if (kind === 'gone') onGone();
      else setError(kind);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <li>
      <Card
        as="article"
        aria-labelledby={headingId}
        tabIndex={-1}
        padding="sm"
        className="flex flex-col gap-3"
      >
        <div className="flex items-start gap-3">
          <Avatar name={name} photoUrl={card.photo_url} size="md" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {/* `overflow-wrap: anywhere` (no Tailwind token): a long unbroken name wraps. */}
            <Title
              id={headingId}
              dir="auto"
              className="min-w-0 max-w-full text-start [overflow-wrap:anywhere] text-h3"
            >
              {name}
            </Title>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">
                {card.age === null ? gender : t('applicants.room.line', { gender, age: card.age })}
              </Badge>
              {card.liked_me && (
                <Badge tone="accent" data-testid="market-person-liked-me">
                  {t('market.people.likedMe')}
                </Badge>
              )}
            </div>
            {areaNames.length > 0 && (
              <p className="text-start text-caption text-ink-muted">
                {t('people.areas', { areas: conjunction.format(areaNames) })}
              </p>
            )}
            <p className="text-start text-caption text-ink-muted">
              {t('people.moveIn', { date: formatDate(moveIn) })}
              {card.move_in_flexible && <> {t('applicants.flexible')}</>}
            </p>
          </div>
        </div>
        {card.about_me !== null && card.about_me !== '' && (
          <div className="flex flex-col gap-1">
            <p className="text-start text-label text-ink-muted">{t('people.aboutMe')}</p>
            {/* Free text from another person: a text node only, never HTML and never a link; line
                breaks kept, direction from its first strong character. */}
            <ClampedText
              lines={4}
              id={aboutId}
              describedBy={headingId}
              textProps={{
                'data-testid': 'market-person-about',
                dir: 'auto',
                className:
                  'whitespace-pre-line break-words rounded-md bg-surface-subtle px-3 py-3 text-start text-body-sm text-ink',
              }}
            >
              {card.about_me}
            </ClampedText>
          </div>
        )}
        {shared > 0 && (
          <p data-testid="market-person-alike" className="text-start text-body-sm text-ink-muted">
            <span className="block">{t('market.people.alike', { same, shared })}</span>
            {differing.length > 0 && (
              <span className="block">
                {t('market.people.differs', {
                  topics: differing.map((key) => lifestyleTopic(key, t)).join(', '),
                })}
              </span>
            )}
          </p>
        )}
        <div className="flex flex-col items-start gap-2">
          {/* `busy` keeps the focused button focusable while it runs (aria-disabled, not disabled). */}
          <Button
            size="md"
            variant={card.liked_by_me ? 'soft' : 'primary'}
            aria-pressed={card.liked_by_me}
            aria-describedby={headingId}
            busy={pending}
            onClick={() => void toggle()}
          >
            {t('market.people.like')}
            {card.liked_by_me && <span aria-hidden="true">✓</span>}
          </Button>
          {error !== null && (
            <p role="alert" className="text-body-sm font-semibold text-danger">
              {error === 'rateLimited' && t('people.errors.rateLimited')}
              {error === 'failed' && t('common.error')}
              {error === 'needsCard' && (
                <>
                  {t('market.people.likeNeedsCard')}{' '}
                  <Link
                    to={profileHref(next, 'about', 'looking')}
                    className={`inline-flex min-h-[44px] items-center rounded underline underline-offset-4 ${focusRing}`}
                  >
                    {t('market.people.toProfile')}
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
      </Card>
    </li>
  );
}
