import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { fetchRentEstimate, type RentEstimateRange } from './api';
import type { ListingForm } from './validate';

const DEBOUNCE_MS = 400;
const HOUR_MS = 60 * 60 * 1000;

/** `value`, once it has not changed for `ms`. */
function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return debounced;
}

/**
 * The official average rent for the apartment being filled in (0014c), or `undefined`: a room,
 * address or rooms missing, a `reason` answer, an error, or while the facts are still changing or
 * loading. Never blocks the wizard and never changes the form.
 */
export function useRentEstimate(form: ListingForm): RentEstimateRange | undefined {
  const live = [form.city.trim(), form.street.trim(), form.rooms.trim()] as const;
  const city = useDebouncedValue(live[0], DEBOUNCE_MS);
  const street = useDebouncedValue(live[1], DEBOUNCE_MS);
  const rooms = useDebouncedValue(live[2], DEBOUNCE_MS);
  const enabled =
    form.listing_type === 'apartment' &&
    city !== '' &&
    street !== '' &&
    rooms !== '' &&
    Number.isFinite(Number(rooms));
  const settled = live[0] === city && live[1] === street && live[2] === rooms;
  const { data } = useQuery({
    queryKey: ['rent-estimate', city, street, rooms],
    queryFn: () => fetchRentEstimate(city, street, rooms),
    enabled,
    staleTime: HOUR_MS,
    retry: false,
  });
  return enabled && settled ? (data?.estimate ?? undefined) : undefined;
}
