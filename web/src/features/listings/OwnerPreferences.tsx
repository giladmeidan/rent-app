import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { ContractMonths, Household, ListingOut } from './api';
import { HOUSEHOLDS } from './constants';

/** The households' and contract lengths' labels, shared by the wizard step and this block. Static
 * keys, so `i18n-check` verifies each one. */
export function usePreferenceLabels() {
  const { t } = useTranslation();
  const households: Record<Household, string> = {
    single: t('listings.prefs.household.single'),
    couple: t('listings.prefs.household.couple'),
    family: t('listings.prefs.household.family'),
    roommates: t('listings.prefs.household.roommates'),
  };
  const contract: Record<ContractMonths, string> = {
    6: t('listings.prefs.contract.6'),
    12: t('listings.prefs.contract.12'),
    24: t('listings.prefs.contract.24'),
    36: t('listings.prefs.contract.36'),
  };
  return { households, contract };
}

type Props = {
  listing: Pick<ListingOut, 'accepted_households' | 'smoking_allowed' | 'min_contract_months'>;
};

/**
 * "מה בעל הדירה מחפש" (Listing.dc.html, after "מיקום"): a chip per preference the owner set. Not
 * rendered when none is set (every household, smokers welcome, no minimum). No owner identity.
 */
export function OwnerPreferences({ listing }: Props) {
  const { t } = useTranslation();
  const headingId = useId();
  const labels = usePreferenceLabels();

  const chips: string[] = [];
  const accepted = HOUSEHOLDS.filter((h) => listing.accepted_households.includes(h));
  if (accepted.length > 0 && accepted.length < HOUSEHOLDS.length) {
    chips.push(
      new Intl.ListFormat('he', { type: 'disjunction' }).format(
        accepted.map((h) => labels.households[h]),
      ),
    );
  }
  if (!listing.smoking_allowed) chips.push(t('listing.ownerLooksFor.noSmokers'));
  if (listing.min_contract_months !== null) {
    chips.push(
      t('listing.ownerLooksFor.minContract', {
        label: labels.contract[listing.min_contract_months],
      }),
    );
  }
  if (chips.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-[10px]">
      <h2 id={headingId} className="text-[17px] font-extrabold">
        {t('listing.ownerLooksFor.title')}
      </h2>
      <ul className="flex flex-wrap gap-2 rounded-2xl border border-border bg-surface px-4 py-[14px]">
        {chips.map((chip) => (
          <li
            key={chip}
            className="rounded-full border border-border bg-surface-subtle px-3 py-[6px] text-[13px] font-semibold"
          >
            {chip}
          </li>
        ))}
      </ul>
    </section>
  );
}
