import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { ApiError } from '../listings/api';

export type TourWindowIn = components['schemas']['TourWindowIn'];
export type TourWindowOut = components['schemas']['TourWindowOut'];
export type TourWindowsOut = components['schemas']['TourWindowsOut'];
export type TourSlotsOut = components['schemas']['TourSlotsOut'];
export type SlotOut = components['schemas']['SlotOut'];
export type TourOut = components['schemas']['TourOut'];
export type TourAgendaItemOut = components['schemas']['TourAgendaItemOut'];
/** A tour line of a chat message (`MessageOut.tour`, `LastMessageOut.tour`). */
export type TourLineOut = components['schemas']['TourLineOut'];

/** The lister's upcoming windows of one listing, with their booked slots. */
export async function fetchTourWindows(listingId: string): Promise<TourWindowsOut> {
  const { data, error, response } = await api.GET('/listings/{listing_id}/tour-windows', {
    params: { path: { listing_id: listingId } },
  });
  if (data === undefined) {
    throw new ApiError('GET', '/listings/{id}/tour-windows', response.status, error);
  }
  return data;
}

/** Opens a window (Israel wall time). 409 `window_overlap`, … and 422 `invalid_window` throw. */
export async function createTourWindow(
  listingId: string,
  body: TourWindowIn,
): Promise<TourWindowOut> {
  const { data, error, response } = await api.POST('/listings/{listing_id}/tour-windows', {
    params: { path: { listing_id: listingId } },
    body,
  });
  if (data === undefined) {
    throw new ApiError(
      'POST',
      '/listings/{id}/tour-windows',
      response.status,
      error,
      response.headers,
    );
  }
  return data;
}

/** 409 `window_has_tours` throws. */
export async function deleteTourWindow(windowId: string): Promise<void> {
  const { error, response } = await api.DELETE('/tour-windows/{window_id}', {
    params: { path: { window_id: windowId } },
  });
  if (!response.ok) {
    throw new ApiError('DELETE', '/tour-windows/{id}', response.status, error, response.headers);
  }
}

/** The free slots of a shortlisted application's listing, and its current tour. */
export async function fetchTourSlots(applicationId: string): Promise<TourSlotsOut> {
  const { data, error, response } = await api.GET('/applications/{application_id}/tour-slots', {
    params: { path: { application_id: applicationId } },
  });
  if (data === undefined) {
    throw new ApiError('GET', '/applications/{id}/tour-slots', response.status, error);
  }
  return data;
}

/** Books a slot at once. 409 `slot_unavailable`, `tour_exists`, `listing_not_live` throw. */
export async function bookTour(applicationId: string, startsAt: string): Promise<TourOut> {
  const { data, error, response } = await api.POST('/applications/{application_id}/tour', {
    params: { path: { application_id: applicationId } },
    body: { starts_at: startsAt },
  });
  if (data === undefined) {
    throw new ApiError('POST', '/applications/{id}/tour', response.status, error, response.headers);
  }
  return data;
}

/** Moves a booked tour to another free slot. */
export async function rescheduleTour(tourId: string, startsAt: string): Promise<TourOut> {
  const { data, error, response } = await api.POST('/tours/{tour_id}/reschedule', {
    params: { path: { tour_id: tourId } },
    body: { starts_at: startsAt },
  });
  if (data === undefined) {
    throw new ApiError('POST', '/tours/{id}/reschedule', response.status, error, response.headers);
  }
  return data;
}

/** Cancels a tour (its seeker or the listing's owner). 409 `tour_not_cancellable` throws. */
export async function cancelTour(tourId: string): Promise<TourOut> {
  const { data, error, response } = await api.POST('/tours/{tour_id}/cancel', {
    params: { path: { tour_id: tourId } },
  });
  if (data === undefined) {
    throw new ApiError('POST', '/tours/{id}/cancel', response.status, error, response.headers);
  }
  return data;
}

/** The caller's upcoming booked tours, as lister and as seeker, earliest first (spec 0018b). */
export async function fetchAgenda(): Promise<TourAgendaItemOut[]> {
  const { data, error, response } = await api.GET('/tours');
  if (data === undefined) throw new ApiError('GET', '/tours', response.status, error);
  return data;
}
