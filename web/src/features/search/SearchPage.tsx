import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
import { MarketViewSwitch } from '../people/MarketViewSwitch';
import { useIsDesktop } from '../../components/useMediaQuery';
import { usePageTitle } from '../../app/usePageTitle';
import { useMe } from '../auth/useMe';
import type { ListingType } from '../listings/api';
import { ProfileNudge } from '../match/ProfileNudge';
import { hasLooking } from '../profile/api';
import { useProfile } from '../profile/useProfile';
import { ActiveFilterTags } from './ActiveFilterTags';
import { FiltersForm, type FormFilters } from './FiltersForm';
import { countActive, parseFilters, toSearchParams, type Sort } from './filters';
import { pickMapParams, writeMapPosition } from './mapPosition';
import { SearchMap } from './SearchMap';
import { SearchResults } from './SearchResults';
import { SortSelect } from './SortSelect';
import { useSearch } from './useSearch';
import { ViewToggle, type View } from './ViewToggle';

type Props = {
  /** The side's one listing type (spec 0010a): `/search` is apartments, `/market` rooms. */
  type: ListingType;
};

/**
 * `/search` (apartments) and `/market` (rooms). An old `/search?listing_type=room…` link lands on
 * `/market` with its other params (replacing the entry); any other `listing_type` is ignored.
 */
export function SearchPage({ type }: Props) {
  const [searchParams] = useSearchParams();
  if (type === 'apartment' && searchParams.get('listing_type') === 'room') {
    const rest = new URLSearchParams(searchParams);
    rest.delete('listing_type');
    const query = rest.toString();
    return <Navigate replace to={query === '' ? '/market' : `/market?${query}`} />;
  }
  return <SearchView type={type} />;
}

/**
 * The URL is the only filter state (plus `view=map`, and the map's position `c`, `z`, `pin`, which
 * are not filters: spec 0009w); the panel's open state and the map's box are component state. The
 * type is the page's, never the URL's: it is part of every query key, so the two sides never share
 * a cached result.
 */
function SearchView({ type }: Props) {
  const { t } = useTranslation();
  const title = type === 'room' ? t('market.title') : t('search.title');
  usePageTitle(title);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseFilters(searchParams);
  const { view, ...urlFilters } = filters;
  const filtersWithoutView = { ...urlFilters, listing_type: type };
  const active = countActive(filters);
  // The map view sends its own query; the list's key never holds `view`.
  const search = useSearch(filtersWithoutView, view !== 'map');
  // A visitor never requests the profile; any signed-in account may have one (spec 0010b). Its
  // looking part (0010c) words the match chips and decides the sort select until the API has
  // answered; without it, as without a profile.
  const me = useMe();
  const stored = useProfile(me.data != null).data;
  const profile = hasLooking(stored) ? stored : undefined;
  const hasProfile = profile !== undefined;
  // The API picks the order from the cookie on the search itself, so its answer decides; before
  // it, the URL's sort, where `match` without a profile is `newest`, as the API will answer.
  const sortValue: Sort =
    search.data?.pages[0]?.sort ??
    (filters.sort === 'match' && !hasProfile
      ? 'newest'
      : (filters.sort ?? (hasProfile ? 'match' : 'newest')));
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const titleId = useId();
  // From `lg` up the panel is always open beside the results, and the toggle is gone.
  const isDesktop = useIsDesktop();
  // Focus after an action that removes the control used (spec 0009t): a filter Apply or Clear that
  // changed the URL remounts the form (its `key`), so focus goes to the results count line; "show
  // the list" on a failed map removes its button, so focus goes to the pressed list button.
  const countRef = useRef<HTMLParagraphElement>(null);
  const listButtonRef = useRef<HTMLButtonElement>(null);
  const focusCount = useRef(false);
  const focusListButton = useRef(false);
  // The side map's "open the full map" is gone after the switch: focus goes to the pressed map button.
  const mapButtonRef = useRef<HTMLButtonElement>(null);
  const focusMapButton = useRef(false);
  // The filters part of the URL (with `view`, without the map's position): the form's key and what
  // "did the filters change" compares, so a map move never remounts the form or moves focus.
  const filtersKey = toSearchParams(filters).toString();

  useEffect(() => {
    if (focusCount.current) {
      focusCount.current = false;
      countRef.current?.focus();
    }
    if (focusListButton.current && view !== 'map') {
      focusListButton.current = false;
      listButtonRef.current?.focus();
    }
    if (focusMapButton.current && view === 'map') {
      focusMapButton.current = false;
      mapButtonRef.current?.focus();
    }
  }, [filtersKey, view]);

  /** `next` with the current map position carried along, so the map stays where it is. */
  const withMapPosition = (next: URLSearchParams) => {
    for (const [key, value] of pickMapParams(searchParams)) next.set(key, value);
    return next;
  };
  /** Goes to `next`; when that changes the filters, focus moves to the count line after it. */
  const setFilters = (next: URLSearchParams) => {
    if (toSearchParams(parseFilters(next)).toString() !== filtersKey) focusCount.current = true;
    setSearchParams(next);
  };
  const apply = (values: FormFilters) => {
    setFilters(withMapPosition(toSearchParams({ ...parseFilters(searchParams), ...values })));
  };
  // Clear keeps the view and the map's position: they are not filters.
  const clear = () =>
    setFilters(withMapPosition(new URLSearchParams(view === 'map' ? { view: 'map' } : {})));
  const sort = (value: Sort) =>
    setSearchParams(withMapPosition(toSearchParams({ ...filters, sort: value })));
  const switchView = (next: View) =>
    setSearchParams(
      withMapPosition(toSearchParams({ ...filters, view: next === 'map' ? 'map' : undefined })),
    );

  const toggle = (
    <Button
      variant={active > 0 ? 'soft' : 'secondary'}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={() => setOpen((o) => !o)}
      icon={
        <svg
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
      }
    >
      {active > 0 ? t('search.filtersActive', { count: active }) : t('search.filters')}
    </Button>
  );

  return (
    <PageContainer as="section" width="wide" className="flex flex-col gap-4">
      <PageHeader title={title} actions={isDesktop ? undefined : toggle} />
      {type === 'room' && <MarketViewSwitch current="rooms" />}

      {/* The side panel: the artboard's 280px (18rem). */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
        <Card
          as="section"
          padding={isDesktop ? 'lg' : 'md'}
          id={panelId}
          hidden={!isDesktop && !open}
          aria-labelledby={titleId}
        >
          <FiltersForm
            key={filtersKey}
            filters={filters}
            onApply={apply}
            onClear={clear}
            titleId={titleId}
            type={type}
          />
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ActiveFilterTags filters={filters} className="w-full min-w-0 lg:w-auto lg:flex-1" />
            <div className="ms-auto flex flex-wrap items-center gap-3">
              <SortSelect
                value={sortValue}
                withMatch={hasProfile || sortValue === 'match'}
                onChange={sort}
              />
              <ViewToggle
                view={view ?? 'list'}
                onChange={switchView}
                listButtonRef={listButtonRef}
                mapButtonRef={mapButtonRef}
              />
            </div>
          </div>

          <ProfileNudge />

          {view === 'map' ? (
            <SearchMap
              filters={filtersWithoutView}
              profile={profile}
              countRef={countRef}
              hasFilters={active > 0}
              onClear={clear}
              fullMap
              onShowList={() => {
                focusListButton.current = true;
                switchView('list');
              }}
            />
          ) : (
            <SearchResults
              search={search}
              profile={profile}
              hasFilters={active > 0}
              onClear={clear}
              countRef={countRef}
              filtersKey={filtersKey}
              onOpenFullMap={(position) => {
                // The same filters in the map view at the side map's place, as a new history entry.
                focusMapButton.current = true;
                const next = toSearchParams({ ...filters, view: 'map' });
                setSearchParams(
                  position === undefined
                    ? next
                    : writeMapPosition(next, { center: position.center, zoom: position.zoom }),
                );
              }}
            />
          )}
        </div>
      </div>
    </PageContainer>
  );
}
