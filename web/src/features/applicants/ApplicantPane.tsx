import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { focusRing } from '../../components/focusRing';
import { ownerTone } from '../applications/ApplicationStatusChip';
import { appliedOn } from '../applications/format';
import type { LifestyleAnswers } from '../lifestyle/keys';
import { MatchRing } from '../match/MatchRing';
import { ReasonList } from '../match/ReasonList';
import type { ApplicantOut, ApplicantStatus } from './api';
import { ProfileFacts } from './ApplicantDetails';
import { ChatIcon, reasonLines } from './ApplicantCard';
import { DisclosureButton } from './DisclosureButton';
import { RoomDetails } from './RoomDetails';
import { RoomLine } from './RoomLine';

type Props = {
  /** The aside's id: what the cards' name buttons control (`aria-controls`). */
  id: string;
  applicant: ApplicantOut;
  /** The listing's `parking_spots`, for the owner-voice parking line. */
  spots: number;
  /** The listing's own questionnaire answers, compared with a room applicant's (0007c). */
  flatLifestyle: LifestyleAnswers;
  /** Whether the listing is a room now (0007c: the "fill the flat's questionnaire" hint). */
  flatIsRoom: boolean;
};

/**
 * The desktop inbox's detail pane (InboxDesktop.dc.html's aside): the selected applicant's head
 * with the large score ring, housing facts, reasons, a room applicant's answers behind "עוד
 * פרטים", the full message and, once shortlisted, the chat link. The page renders it with
 * `key={applicant.id}`, so every new selection starts at the top with the disclosure closed.
 * It has no status actions (the selected card's own stay beside it) and no live region.
 */
export function ApplicantPane({ id, applicant, spots, flatLifestyle, flatIsRoom }: Props) {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const { match, profile, room } = applicant;
  const name = applicant.applicant_name;
  const headingId = `${id}-name`;
  const morePanelId = `${id}-more`;
  const statusLabel: Record<ApplicantStatus, string> = {
    submitted: t('applicants.status.submitted'),
    shortlisted: t('applicants.status.shortlisted'),
    declined: t('applicants.status.declined'),
  };
  return (
    // `tabIndex` makes the pane keyboard-scrollable when it is taller than the viewport. The
    // `max-h` is viewport-relative, so no spacing token fits (3rem = the sticky `top-6` twice).
    <aside
      id={id}
      aria-label={t('applicants.pane.label')}
      tabIndex={0}
      className={`sticky top-6 max-h-[calc(100dvh-3rem)] w-96 flex-none self-start overflow-y-auto rounded-lg ${focusRing}`}
    >
      <Card padding="md" className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={name} photoUrl={applicant.photo_url} size="lg" tone="accent" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {/* `overflow-wrap: anywhere` (no Tailwind token): a long unbroken name wraps. */}
            <h2 id={headingId} className="font-display text-h2 [overflow-wrap:anywhere]">
              {name}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={ownerTone[applicant.status]} data-testid="pane-status">
                {statusLabel[applicant.status]}
              </Badge>
              {applicant.source === 'like' && (
                <Badge tone="accent" data-testid="pane-mutual">
                  {t('applicants.mutual')}
                </Badge>
              )}
            </div>
            {room !== null && <RoomLine gender={room.gender} age={room.age} />}
            <p className="text-start text-caption text-ink-muted">
              {t('applicants.appliedAt', { date: appliedOn(applicant.created_at) })}
            </p>
          </div>
          <div className="flex-none">
            {match !== null ? (
              <MatchRing score={match.score} size="lg" />
            ) : (
              <Badge tone="neutral">{t('match.noScore')}</Badge>
            )}
          </div>
        </div>
        {profile !== null && <ProfileFacts profile={profile} />}
        {profile !== null && match !== null && (
          <section className="flex flex-col gap-2">
            <h3 className="text-h3">{t('applicants.why')}</h3>
            <ReasonList lines={reasonLines(applicant, spots, t)} />
          </section>
        )}
        {room !== null && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-x-4">
              <DisclosureButton
                open={moreOpen}
                controls={morePanelId}
                describedBy={headingId}
                onToggle={() => setMoreOpen((o) => !o)}
              >
                {t('applicants.more')}
              </DisclosureButton>
            </div>
            {/* Always in the DOM, so `aria-controls` names it; a display class would override
                `hidden`, so it is set only when open. */}
            <div
              id={morePanelId}
              hidden={!moreOpen}
              className={moreOpen ? 'flex flex-col gap-3' : undefined}
            >
              <RoomDetails room={room} flat={flatLifestyle} flatIsRoom={flatIsRoom} />
            </div>
          </div>
        )}
        {/* Whenever there is one, whatever the source (spec 0010l: optional on a room). */}
        {applicant.message !== null && (
          <section className="flex flex-col gap-2">
            <h3 className="text-h3">{t('applicants.pane.message')}</h3>
            {/* Free text from a seeker: React text children only (never linkified or HTML), line
                breaks kept, direction from its first strong character. */}
            <p
              dir="auto"
              data-testid="pane-message"
              className="whitespace-pre-line break-words rounded-md bg-surface-subtle px-3 py-3 text-body-sm text-ink"
            >
              {applicant.message}
            </p>
          </section>
        )}
        {applicant.status === 'shortlisted' && (
          <Button to={`/chat/${applicant.id}`} variant="secondary" fullWidth icon={<ChatIcon />}>
            {t('applicants.pane.chat')}
          </Button>
        )}
      </Card>
    </aside>
  );
}
