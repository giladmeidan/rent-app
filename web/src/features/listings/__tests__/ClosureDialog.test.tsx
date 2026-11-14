import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import {
  deferred,
  empty,
  json,
  mockApi,
  renderAt,
  testQueryClient,
} from '../../auth/__tests__/harness';
import type { MyListingOut } from '../api';
import { ClosureDialog } from '../ClosureDialog';
import { MY_LISTINGS_KEY } from '../useMyListings';
import { listing } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const c = he.listings.closure;
const OPEN = 'open';

/** An opener that mounts a fresh dialog per opening, as `MyListingsPage` does. */
function Harness({ l, onSaved }: { l: MyListingOut; onSaved: () => void }) {
  const [state, setState] = useState({ open: false, key: 0 });
  return (
    <>
      <button type="button" onClick={() => setState((s) => ({ open: true, key: s.key + 1 }))}>
        {OPEN}
      </button>
      {state.key > 0 && (
        <ClosureDialog
          key={state.key}
          listing={l}
          open={state.open}
          onClose={() => setState((s) => ({ ...s, open: false }))}
          onSaved={() => {
            setState((s) => ({ ...s, open: false }));
            onSaved();
          }}
        />
      )}
    </>
  );
}

function renderDialog(l: MyListingOut, onSaved = vi.fn()) {
  const client = testQueryClient();
  client.setQueryData<MyListingOut[]>(MY_LISTINGS_KEY, [l]);
  renderAt('/me/listings', <Harness l={l} onSaved={onSaved} />, client);
  const opener = screen.getByRole('button', { name: OPEN });
  opener.focus();
  fireEvent.click(opener);
  return { client, opener, onSaved };
}

const dialog = () => screen.getByRole('dialog', { name: c.title });
const reason = (name: string) =>
  within(screen.getByRole('group', { name: c.reason })).getByRole('radio', { name });
const rent = () => screen.queryByLabelText(c.finalRent);
const save = () => screen.getByRole('button', { name: c.save });

describe('ClosureDialog', () => {
  it('ac15 save sends the reason and the rent', async () => {
    const l = listing({ status: 'paused' });
    const put = deferred();
    const api = mockApi({ [`PUT /listings/${l.id}/closure`]: [put.promise] });
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const { client, opener, onSaved } = renderDialog(l);

    // Named by its title, described by the privacy line. Modal: the browser moves focus to the
    // first answer (jsdom does not; the e2e checks it), and it returns to the opener on close.
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog()).toHaveAccessibleDescription(c.intro);
    expect(
      within(screen.getByRole('group', { name: c.reason }))
        .getAllByRole('radio')
        .map((radio) => (radio as HTMLInputElement).labels?.[0]?.textContent),
    ).toEqual([c.reasons.rentedHere, c.reasons.rentedElsewhere, c.reasons.notRenting]);
    // Save waits for a reason; the rent shows for a "rented" reason only.
    expect(save()).toBeDisabled();
    expect(rent()).toBeNull();
    fireEvent.click(reason(c.reasons.notRenting));
    expect(rent()).toBeNull();
    expect(save()).toBeEnabled();
    fireEvent.click(reason(c.reasons.rentedElsewhere));
    expect(rent()).toHaveAccessibleDescription(he.listings.fields.optional);
    expect(screen.getByText(he.listings.units.ils)).toBeVisible();
    // Digits only, as the wizard's price.
    fireEvent.change(rent() as HTMLElement, { target: { value: '6,8a00' } });
    expect(rent()).toHaveValue('6800');

    fireEvent.click(save());
    await vi.waitFor(() => {
      expect(save()).toBeDisabled();
    });
    expect(save()).toHaveAttribute('aria-busy', 'true');
    const [call] = api.calls(`PUT /listings/${l.id}/closure`);
    expect(call?.body).toEqual({ reason: 'rented_elsewhere', final_rent_ils: 6800 });
    expect(call?.request.credentials).toBe('include');
    put.resolve(empty());
    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    // Closed, focus back on the opener, and the cached row holds the answer.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
    expect(client.getQueryData<MyListingOut[]>(MY_LISTINGS_KEY)?.[0]).toMatchObject({
      close_reason: 'rented_elsewhere',
      final_rent_ils: 6800,
    });
  });

  it('ac15 range, not renting, skip, Esc and a failed save', async () => {
    const l = listing({ status: 'paused', close_reason: 'rented_here', final_rent_ils: 7000 });
    const api = mockApi({
      [`PUT /listings/${l.id}/closure`]: [json({ detail: 'boom' }, 500), empty()],
    });
    const { opener, onSaved } = renderDialog(l);

    // Pre-filled with the stored answer.
    expect(reason(c.reasons.rentedHere)).toBeChecked();
    expect(rent()).toHaveValue('7000');
    // A rent outside 500-100000: the range message, nothing sent.
    for (const value of ['499', '100001']) {
      fireEvent.change(rent() as HTMLElement, { target: { value } });
      fireEvent.click(save());
      expect(
        screen.getByText(i18n.t('listings.errors.range', { min: 500, max: 100_000 })),
      ).toBeVisible();
    }
    expect(rent()).toHaveAttribute('aria-invalid', 'true');
    expect(api.calls(`PUT /listings/${l.id}/closure`)).toHaveLength(0);

    // "Not renting" hides the rent and sends `null`; a failed PUT keeps the dialog open.
    fireEvent.click(reason(c.reasons.notRenting));
    expect(rent()).toBeNull();
    fireEvent.click(save());
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(he.common.error);
    expect(api.calls(`PUT /listings/${l.id}/closure`)[0]?.body).toEqual({
      reason: 'not_renting',
      final_rent_ils: null,
    });
    expect(dialog()).toBeVisible();
    expect(onSaved).not.toHaveBeenCalled();

    // "לא עכשיו" closes it without a request; focus returns to the opener.
    fireEvent.click(screen.getByRole('button', { name: c.skip }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
    // Esc too (the native `cancel`), and a new opening starts from the stored answer again.
    fireEvent.click(opener);
    expect(reason(c.reasons.rentedHere)).toBeChecked();
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => {
      dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
    expect(api.calls(`PUT /listings/${l.id}/closure`)).toHaveLength(1);
  });
});
