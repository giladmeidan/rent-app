import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { SORTS, type Sort } from './filters';

type Props = {
  value: Sort;
  /** Offer "לפי התאמה" (first): a seeker with a profile, or an answer sorted by match. */
  withMatch: boolean;
  onChange: (sort: Sort) => void;
};

/** The sort order; a change applies at once (no apply button). */
export function SortSelect({ value, withMatch, onChange }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const labels: Record<Sort, string> = {
    match: t('search.sort.match'),
    newest: t('search.sort.newest'),
    price_asc: t('search.sort.price_asc'),
    price_desc: t('search.sort.price_desc'),
  };
  const options = SORTS.filter((sort) => withMatch || sort !== 'match');

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm font-bold">
        {t('search.sort.label')}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          const next = options.find((sort) => sort === e.target.value);
          if (next !== undefined) onChange(next);
        }}
        className="min-h-[44px] rounded-xl border-[1.5px] border-border-strong bg-surface px-3 text-start text-[15px] font-semibold text-ink focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-soft"
      >
        {options.map((sort) => (
          <option key={sort} value={sort}>
            {labels[sort]}
          </option>
        ))}
      </select>
    </div>
  );
}
