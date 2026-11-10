import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { FiltersForm, type FormFilters } from './FiltersForm';
import { DEFAULT_SORT, countActive, parseFilters, toSearchParams, type Sort } from './filters';
import { ResultsList } from './ResultsList';
import { SearchMap } from './SearchMap';
import { SortSelect } from './SortSelect';
import { useSearch } from './useSearch';
import { ViewToggle, type View } from './ViewToggle';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * `/search`: the URL is the only filter state (plus `view=map`); the panel's open state and the
 * map's box are component state.
 */
export function SearchPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseFilters(searchParams);
  const { view, ...filtersWithoutView } = filters;
  const active = countActive(filters);
  // The map view sends its own query; the list's key never holds `view`.
  const search = useSearch(filtersWithoutView, view !== 'map');
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const apply = (values: FormFilters) => {
    setSearchParams(toSearchParams({ ...parseFilters(searchParams), ...values }));
  };
  // Clear keeps the view: it is not a filter.
  const clear = () => setSearchParams(view === 'map' ? { view: 'map' } : {});
  const sort = (value: Sort) => setSearchParams(toSearchParams({ ...filters, sort: value }));
  const switchView = (next: View) =>
    setSearchParams(toSearchParams({ ...filters, view: next === 'map' ? 'map' : undefined }));

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-start text-2xl font-extrabold">{t('search.title')}</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border-[1.5px] px-4 text-[15px] font-semibold ${active > 0 ? 'border-accent bg-accent-tint text-accent-text' : 'border-[#D6D3D1] bg-white'} ${focusRing}`}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 7h16M7 12h10M10 17h4" />
          </svg>
          {active > 0 ? t('search.filtersActive', { count: active }) : t('search.filters')}
        </button>
        <ViewToggle view={view ?? 'list'} onChange={switchView} />
        <SortSelect value={filters.sort ?? DEFAULT_SORT} onChange={sort} />
      </div>

      <div id={panelId} hidden={!open}>
        <FiltersForm
          key={searchParams.toString()}
          filters={filters}
          onApply={apply}
          onClear={clear}
        />
      </div>

      {view === 'map' ? (
        <SearchMap filters={filtersWithoutView} onShowList={() => switchView('list')} />
      ) : (
        <ResultsList search={search} hasFilters={active > 0} onClear={clear} />
      )}
    </section>
  );
}
