import { useTranslation } from 'react-i18next';

import { ChoiceGroup } from '../../components/ChoiceGroup';
import type { ListingType } from './api';

type Props = { value: ListingType | null; onChange: (value: ListingType) => void };

export function TypeStep({ value, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <ChoiceGroup
      legend={t('listings.type.label')}
      name="listing_type"
      options={[
        { value: 'apartment', label: t('listings.type.apartment') },
        { value: 'room', label: t('listings.type.room') },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}
