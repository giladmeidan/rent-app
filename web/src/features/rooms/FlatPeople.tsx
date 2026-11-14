import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import type { FlatPersonOut } from '../listings/api';
import { AnswerList } from './RoomFacts';

/** "{age} · {gender}", or whichever of the two is known; null when neither is. */
function ageGenderLine(
  t: ReturnType<typeof useTranslation>['t'],
  person: FlatPersonOut,
): string | null {
  const gender = person.gender === null ? null : t(`profile.room.gender.${person.gender}`);
  if (person.age !== null && gender !== null) {
    return t('rooms.people.ageGender', { age: person.age, gender });
  }
  if (person.age !== null) return t('rooms.people.age', { age: person.age });
  return gender;
}

function PersonRow({ person }: { person: FlatPersonOut }) {
  const { t } = useTranslation();
  const line = ageGenderLine(t, person);
  return (
    <Card as="li" padding="sm" className="flex items-start gap-3">
      <Avatar name={person.display_name} photoUrl={person.photo_url} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          {/* `overflow-wrap: anywhere` (no Tailwind token): a long unbroken name wraps. */}
          <p dir="auto" className="min-w-0 text-body font-semibold [overflow-wrap:anywhere]">
            {person.display_name}
          </p>
          {person.lister && <Badge tone="accent">{t('rooms.people.lister')}</Badge>}
        </div>
        {line !== null && <p className="text-start text-caption text-ink-muted">{line}</p>}
        {person.about_me !== null && (
          <p dir="auto" className="whitespace-pre-line break-words text-body-sm text-ink">
            {person.about_me}
          </p>
        )}
        <AnswerList answers={person.lifestyle} />
      </div>
    </Card>
  );
}

/**
 * A room's "גרים בדירה" (0010f): the lister when they live there, then the flatmates who chose to
 * be shown, as the API orders them. The API sends people only to a seeker (decision 13), so the
 * page renders this only when the list is not empty.
 */
export function FlatPeople({ people }: { people: FlatPersonOut[] }) {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <section
      data-testid="flat-people"
      aria-labelledby={headingId}
      className="flex flex-col gap-2.5"
    >
      <h2 id={headingId} className="text-h3 font-semibold">
        {t('rooms.people.title')}
      </h2>
      <ul aria-labelledby={headingId} className="flex flex-col gap-2.5">
        {people.map((person, i) => (
          // No id of any kind on a person: the API's order is the identity here.
          <PersonRow key={`${String(i)}-${person.display_name}`} person={person} />
        ))}
      </ul>
    </section>
  );
}
