// Helpers for driving the listing wizard in tests.
import { fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { expect, vi } from 'vitest';

import he from '../../../locales/he.json';
import type { UserOut } from '../../../api/client';
import { renderRoutes, testQueryClient } from '../../auth/__tests__/harness';
import { ME_KEY } from '../../auth/useMe';
import type { ListingType } from '../api';
import { EditListingPage } from '../EditListingPage';
import { addDays, todayInIsrael } from '../format';
import { MyListingsPage } from '../MyListingsPage';
import { NewListingPage } from '../NewListingPage';
import { gushDan, owner } from './fixtures';

export const routes = (
  <Routes>
    <Route path="/" element={<p>home</p>} />
    <Route path="/login" element={<p>login</p>} />
    <Route path="/listings/new" element={<NewListingPage />} />
    <Route path="/me/listings" element={<MyListingsPage />} />
    <Route path="/me/listings/:id/edit" element={<EditListingPage />} />
  </Routes>
);

/** A query client that already holds `me` (an owner unless given), as `RequireUser` leaves it in
 * the app: the wizard's type choice is the owner's (spec 0010b). */
export function meClient(me: UserOut = owner, client = testQueryClient()) {
  client.setQueryData(ME_KEY, me);
  return client;
}

/** Renders `/listings/new`; a client without `me` gets the owner (`meClient`). */
export function renderWizard(client = testQueryClient()) {
  if (client.getQueryData(ME_KEY) === undefined) meClient(owner, client);
  return renderRoutes('/listings/new', routes, client);
}

export const nextButton = () => screen.getByRole('button', { name: he.listings.next });
export const progress = () => screen.getByRole('progressbar');

/** Step 1: picks the type labelled `label` and goes on to the details. */
export function chooseTypeAndContinue(label: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(nextButton());
}

export function chooseApartmentAndContinue() {
  chooseTypeAndContinue(he.listings.type.apartment);
}

export const field = (label: string) => screen.getByLabelText(label);

export function change(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
}

/** Waits until the city picker has loaded `GET /areas`. */
export async function areasLoaded() {
  await vi.waitFor(() => {
    expect(field(he.listings.fields.city)).not.toBeDisabled();
  });
}

export const IN_30_DAYS = addDays(todayInIsrael(), 30);

/** The AC4 values. A room's furnished choice reads the room forms (spec 0009b). */
/** Fills the details step with valid values; `shelter` is the protected space's option label
 * (required since 0015b), or `null` to pick none. */
export function fillValidDetails(
  type: ListingType = 'apartment',
  shelter: string | null = he.listings.shelter.none,
) {
  const f = he.listings.fields;
  change(f.city, gushDan.name_he); // the full name picks it (spec 0021b)
  change(f.street, 'כצנלסון');
  change(f.rooms, '3.5');
  change(f.floor, '3');
  change(f.totalFloors, '5');
  change(f.size, '95');
  change(f.price, '7200');
  change(f.availableFrom, IN_30_DAYS);
  fireEvent.click(screen.getByRole('switch', { name: f.elevator }));
  if (shelter !== null) {
    const group = screen.getByRole('group', { name: f.shelter });
    fireEvent.click(within(group).getByRole('radio', { name: shelter }));
  }
  change(f.parking, '1');
  fireEvent.click(
    screen.getByLabelText(
      (type === 'room' ? he.listings.furnishedRoom : he.listings.furnished).partial,
    ),
  );
  fireEvent.click(screen.getByRole('switch', { name: f.pets }));
  change(f.description, 'דירה מוארת');
}

/** The alert whose id is in the input's `aria-describedby`. */
export function errorFor(input: HTMLElement): HTMLElement {
  expect(input).toHaveAttribute('aria-invalid', 'true');
  const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
  const alerts = ids
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => el?.getAttribute('role') === 'alert');
  expect(alerts).toHaveLength(1);
  return alerts[0] as HTMLElement;
}

/** Renders the wizard, chooses `type`, fills the AC4 values and goes to the preferences, through
 * the photos step with no photo (spec 0010e). */
export async function toPreferences(client = testQueryClient(), type: ListingType = 'apartment') {
  const view = renderWizard(client);
  chooseTypeAndContinue(he.listings.type[type]);
  await areasLoaded();
  fillValidDetails(type);
  fireEvent.click(nextButton());
  expect(progress()).toHaveAttribute('aria-valuenow', '3');
  fireEvent.click(nextButton());
  expect(progress()).toHaveAttribute('aria-valuenow', '4');
  return view;
}
