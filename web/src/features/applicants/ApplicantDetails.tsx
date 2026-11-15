import { useTranslation } from 'react-i18next';

import { applicantMoveIn, contractName, householdName, parkingName } from '../match/reasons';
import type { ApplicantProfileOut } from './api';

/** The applicant's housing details (InboxDesktop.dc.html's grid, without ages or occupation). */
export function ProfileFacts({ profile }: { profile: ApplicantProfileOut }) {
  const { t } = useTranslation();
  const moveIn = applicantMoveIn(profile);
  const rows = [
    {
      key: 'household',
      label: t('applicants.profile.household'),
      value: householdName(profile.household, t),
    },
    {
      key: 'moveIn',
      label: t('applicants.profile.moveIn'),
      value: profile.move_in_flexible
        ? `${moveIn} (${t('listings.fields.entryFlexible')})`
        : moveIn,
    },
    {
      key: 'contract',
      label: t('applicants.profile.contract'),
      value: contractName(profile.contract_months, t),
    },
    {
      key: 'pets',
      label: t('applicants.profile.pets'),
      value: profile.has_pets ? t('listing.yes') : t('listing.no'),
    },
    {
      key: 'smoker',
      label: t('applicants.profile.smoker'),
      value: profile.smoker ? t('applicants.profile.yes') : t('applicants.profile.no'),
    },
    {
      key: 'parking',
      label: t('applicants.profile.parking'),
      value: parkingName(profile.parking_needed, t),
    },
    // No row without a need (0015b).
    ...(profile.shelter_needed === 'any'
      ? []
      : [
          {
            key: 'shelter',
            label: t('applicants.profile.shelter'),
            value:
              profile.shelter_needed === 'mamad'
                ? t('profile.shelter.mamad')
                : t('profile.shelter.protected'),
          },
        ]),
  ];
  return (
    <dl className="grid grid-cols-2 gap-2">
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex min-w-0 flex-col gap-0.5 rounded-md bg-surface-subtle px-3 py-2"
        >
          <dt className="text-caption text-ink-muted">{row.label}</dt>
          <dd className="text-body-sm font-semibold">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
