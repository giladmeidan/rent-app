import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { deferred, empty, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { RequireOwner } from '../../auth/RequireOwner';
import { cardTitle } from '../../listings/cardTitle';
import { listing, owner } from '../../listings/__tests__/fixtures';
import { FlatmatesPage } from '../FlatmatesPage';
import { flatmate } from './fixtures';

type Reply = Parameters<typeof mockApi>[0][string][number];

const ROOM = listing({ listing_type: 'room' });
const ACTIVE = { ...ROOM, flatmate_invite_active: true };
const APARTMENT = listing();
const PATH = `/me/listings/${ROOM.id}/flatmates`;
const MINE = 'GET /me/listings';
const LIST = `GET /listings/${ROOM.id}/flatmates`;
const CREATE = `POST /listings/${ROOM.id}/flatmate-invite`;
const DISABLE = `DELETE /listings/${ROOM.id}/flatmate-invite`;
const removeRoute = (f: { id: string }) => `DELETE /listings/${ROOM.id}/flatmates/${f.id}`;
const linkOf = (token: string) => `${window.location.origin}/flatmates/join#${token}`;

const routes = (
  <Routes>
    <Route path="/login" element={<p>login</p>} />
    <Route element={<RequireOwner />}>
      <Route path="/me/listings" element={<p>mine</p>} />
      <Route path="/me/listings/:id/flatmates" element={<FlatmatesPage />} />
    </Route>
  </Routes>
);

function renderPage({
  mine = [json([ROOM, APARTMENT])],
  list = [json([])],
  extra = {},
  path = PATH,
}: {
  mine?: Reply[];
  list?: Reply[];
  extra?: Record<string, Reply[]>;
  path?: string;
} = {}) {
  const api = mockApi({ 'GET /me': [json(owner)], [MINE]: mine, [LIST]: list, ...extra });
  const view = renderRoutes(path, routes);
  return { api, view };
}

function reset(view: { unmount: () => void }) {
  view.unmount();
  vi.unstubAllGlobals();
}

/** The kit's confirm dialog (0009qb): `window.confirm` is never called, so every test spies on it. */
const confirmSpy = () => vi.spyOn(window, 'confirm');
const noDialog = () =>
  waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
/** Answers the open dialog named `title` with its `choice` button, and waits for it to close. */
async function answer(title: string, choice: string) {
  const box = await screen.findByRole('dialog', { name: title });
  fireEvent.click(within(box).getByRole('button', { name: choice }));
  await noDialog();
}
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
});

// The page's <h1> once the listing has loaded (its <h1> already shows while "my listings" loads):
// the list's <h2> is there only then.
const heading = async () => {
  await screen.findByRole('heading', { level: 2, name: he.flatmates.list.title });
  return screen.getByRole('heading', { level: 1, name: he.flatmates.title });
};
const button = (name: string) => screen.getByRole('button', { name });
const alerts = () => screen.queryAllByRole('alert');

describe('FlatmatesPage', () => {
  it('ac1_invite_flow', async () => {
    // No link yet: the hint and "create". The POST answers the token; the link shows once.
    let { api, view } = renderPage({
      mine: [json([ROOM]), json([ACTIVE])],
      extra: { [CREATE]: [json({ token: 'T' }, 201)] },
    });
    expect(await heading()).toBeVisible();
    expect(screen.getByText(cardTitle(i18n.t, ROOM))).toBeVisible();
    expect(screen.getByText(he.flatmates.invite.hint)).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
    // Two clicks in the same tick send one POST (a second would rotate the link just shown).
    fireEvent.click(button(he.flatmates.invite.create));
    fireEvent.click(button(he.flatmates.invite.create));
    const input = await screen.findByRole('textbox', { name: he.flatmates.invite.linkLabel });
    expect(input).toHaveValue(linkOf('T'));
    // The create button is gone: the focus moves to the link.
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(input.closest('.text-start')).not.toBeNull();
    expect(screen.getByText(he.flatmates.invite.onceWarning)).toBeVisible();
    expect(api.calls(CREATE)).toHaveLength(1);
    // "My listings" refetched (the link is active now); the shown link stays.
    await waitFor(() => {
      expect(api.calls(MINE)).toHaveLength(2);
    });
    expect(screen.getByRole('textbox')).toHaveValue(linkOf('T'));
    expect(screen.queryByText(he.flatmates.invite.active)).toBeNull();

    // Copy: the clipboard gets the link, and the status says so.
    writeText.mockResolvedValueOnce(undefined);
    fireEvent.click(button(he.flatmates.invite.copy));
    expect(await screen.findByText(he.flatmates.invite.copied)).toHaveAttribute('role', 'status');
    expect(writeText).toHaveBeenCalledWith(linkOf('T'));

    // A failing clipboard selects the input's text instead.
    writeText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(button(he.flatmates.invite.copy));
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    const field = input as HTMLInputElement;
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(linkOf('T').length);
    expect(screen.queryByText(he.flatmates.invite.copied)).toBeNull();
    reset(view);

    // After a remount with an active link: no token, the "active" text, rotate and disable.
    ({ api, view } = renderPage({
      mine: [json([ACTIVE]), json([ACTIVE]), json([ROOM])],
      extra: { [CREATE]: [json({ token: 'T2' }, 201)], [DISABLE]: [empty()] },
    }));
    expect(await screen.findByText(he.flatmates.invite.active)).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: he.flatmates.invite.create })).toBeNull();

    // Confirm declined: nothing is sent.
    const confirm = confirmSpy();
    fireEvent.click(button(he.flatmates.invite.rotate));
    await answer(he.flatmates.invite.rotateConfirm, he.common.cancel);
    fireEvent.click(button(he.flatmates.invite.disable));
    await answer(he.flatmates.invite.disableConfirm, he.common.cancel);
    expect(api.calls(CREATE)).toHaveLength(0);
    expect(api.calls(DISABLE)).toHaveLength(0);

    // Confirmed rotate: the POST, then the new link shows.
    fireEvent.click(button(he.flatmates.invite.rotate));
    await answer(he.flatmates.invite.rotateConfirm, he.flatmates.invite.rotate);
    expect(await screen.findByRole('textbox')).toHaveValue(linkOf('T2'));
    expect(api.calls(CREATE)).toHaveLength(1);

    // Confirmed disable (two clicks, one dialog, one DELETE): the shown link goes, straight to the
    // "create" state with no "active" flash, and the focus moves to the heading.
    const disable = button(he.flatmates.invite.disable);
    fireEvent.click(disable);
    fireEvent.click(disable);
    expect(await screen.findAllByRole('dialog')).toHaveLength(1);
    await answer(he.flatmates.invite.disableConfirm, he.flatmates.invite.disable);
    expect(await screen.findByRole('button', { name: he.flatmates.invite.create })).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(he.flatmates.invite.active)).toBeNull();
    expect(api.calls(DISABLE)).toHaveLength(1);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: he.flatmates.title })).toHaveFocus();
    });
    expect(confirm).not.toHaveBeenCalled();
    reset(view);

    // A 500 on create: `common.error` inline, as an alert.
    ({ api, view } = renderPage({
      mine: [json([ROOM])],
      extra: { [CREATE]: [json({ detail: 'boom' }, 500)] },
    }));
    await heading();
    expect(alerts()).toHaveLength(0);
    fireEvent.click(button(he.flatmates.invite.create));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(he.common.error);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: he.flatmates.invite.create })).toBeEnabled();
    reset(view);

    // A 500 on disable and on rotate: the same alert.
    ({ view } = renderPage({
      mine: [json([ACTIVE])],
      extra: { [CREATE]: [json({ detail: 'boom' }, 500)], [DISABLE]: [json({}, 500)] },
    }));
    await screen.findByText(he.flatmates.invite.active);
    fireEvent.click(button(he.flatmates.invite.disable));
    await answer(he.flatmates.invite.disableConfirm, he.flatmates.invite.disable);
    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: he.flatmates.invite.rotate })).toBeEnabled();
    });
    fireEvent.click(button(he.flatmates.invite.rotate));
    await answer(he.flatmates.invite.rotateConfirm, he.flatmates.invite.rotate);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: he.flatmates.invite.rotate })).toBeEnabled();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(he.common.error);
  });

  it('ac3_focus_after_remove', async () => {
    // The removed row takes its button away: focus goes to the list's <h2>.
    const dana = flatmate({ display_name: 'דנה' });
    const yoni = flatmate({ display_name: 'יוני' });
    renderPage({
      list: [json([dana, yoni]), json([yoni])],
      extra: { [removeRoute(dana)]: [empty()] },
    });
    const list = await screen.findByRole('list', { name: he.flatmates.list.title });
    const remove = within(within(list).getAllByRole('listitem')[0] as HTMLElement).getByRole(
      'button',
      { name: he.flatmates.list.remove },
    );
    act(() => remove.focus());
    fireEvent.click(remove);
    await answer(i18n.t('flatmates.list.removeConfirm', { name: 'דנה' }), he.flatmates.list.remove);
    await waitFor(() => {
      expect(screen.queryByText('דנה')).toBeNull();
    });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: he.flatmates.list.title }),
      ).toHaveFocus();
    });
  });

  it('ac2_list_remove_and_states', async () => {
    // Two flatmates with their join days in Israel: 23:30 UTC on Nov 10 is Nov 11 there.
    const dana = flatmate({ display_name: 'דנה', joined_at: '2026-11-10T23:30:00Z' });
    const yoni = flatmate({ display_name: 'יוני', joined_at: '2026-11-01T08:00:00Z' });
    let { api, view } = renderPage({
      list: [json([dana, yoni]), json([yoni])],
      extra: { [removeRoute(dana)]: [empty()] },
    });
    const list = await screen.findByRole('list', { name: he.flatmates.list.title });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('דנה')).toBeVisible();
    expect(
      within(rows[0] as HTMLElement).getByText(
        i18n.t('flatmates.list.joinedAt', { date: '11.11.2026' }),
      ),
    ).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText('יוני')).toBeVisible();
    expect(
      within(rows[1] as HTMLElement).getByText(
        i18n.t('flatmates.list.joinedAt', { date: '1.11.2026' }),
      ),
    ).toBeVisible();

    // "Remove", declined at the confirm: nothing is sent.
    const removeDana = within(rows[0] as HTMLElement).getByRole('button', {
      name: he.flatmates.list.remove,
    });
    expect(removeDana).toHaveAccessibleDescription('דנה');
    const confirm = confirmSpy();
    const removeTitle = i18n.t('flatmates.list.removeConfirm', { name: 'דנה' });
    fireEvent.click(removeDana);
    await answer(removeTitle, he.common.cancel);
    expect(api.calls(removeRoute(dana))).toHaveLength(0);

    // Confirmed (two clicks in one tick, one dialog, one DELETE): then the list and "my listings"
    // refetch.
    fireEvent.click(removeDana);
    fireEvent.click(removeDana);
    expect(await screen.findAllByRole('dialog')).toHaveLength(1);
    await answer(removeTitle, he.flatmates.list.remove);
    await waitFor(() => {
      expect(screen.queryByText('דנה')).toBeNull();
    });
    expect(api.calls(removeRoute(dana))).toHaveLength(1);
    expect(api.calls(LIST)).toHaveLength(2);
    expect(api.calls(MINE)).toHaveLength(2);
    expect(screen.getByText('יוני')).toBeVisible();
    expect(confirm).not.toHaveBeenCalled();
    reset(view);

    // A failed removal: `common.error` inline; the row stays.
    ({ view } = renderPage({
      list: [json([yoni])],
      extra: { [removeRoute(yoni)]: [json({ detail: 'boom' }, 500)] },
    }));
    fireEvent.click(await screen.findByRole('button', { name: he.flatmates.list.remove }));
    await answer(
      i18n.t('flatmates.list.removeConfirm', { name: 'יוני' }),
      he.flatmates.list.remove,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    expect(screen.getByText('יוני')).toBeVisible();
    reset(view);

    // Empty.
    ({ view } = renderPage({ list: [json([])] }));
    expect(await screen.findByText(he.flatmates.list.empty)).toBeVisible();
    reset(view);

    // Loading: a busy skeleton under the list title, the invite block already there.
    const pending = deferred();
    ({ view } = renderPage({ list: [pending.promise] }));
    await heading();
    expect(screen.getByText(he.flatmates.invite.hint)).toBeVisible();
    const busy = screen.getByText(he.common.loading).closest<HTMLElement>('[aria-busy="true"]');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(busy as HTMLElement).getByTestId('skeleton')).toBeInTheDocument();
    pending.resolve(json([]));
    expect(await screen.findByText(he.flatmates.list.empty)).toBeVisible();
    reset(view);

    // Failing: ErrorState; retry refetches.
    ({ api, view } = renderPage({ list: [json({ detail: 'boom' }, 500), json([yoni])] }));
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByText('יוני')).toBeVisible();
    expect(api.calls(LIST)).toHaveLength(2);
    reset(view);

    // An apartment and an unknown id: not found, with the back link; no flatmates request.
    for (const id of [APARTMENT.id, '00000000-0000-0000-0000-999999999999']) {
      ({ api, view } = renderPage({ path: `/me/listings/${id}/flatmates` }));
      expect(
        await screen.findByRole('heading', { level: 1, name: he.flatmates.notFound }),
      ).toBeVisible();
      expect(screen.getByRole('link', { name: he.flatmates.back })).toHaveAttribute(
        'href',
        '/me/listings',
      );
      expect(api.calls(`GET /listings/${id}/flatmates`)).toHaveLength(0);
      expect(screen.queryByRole('button', { name: he.flatmates.invite.create })).toBeNull();
      reset(view);
    }

    // "My listings" loading, then failing.
    const mine = deferred();
    ({ view } = renderPage({ mine: [mine.promise] }));
    await waitFor(() => {
      expect(
        screen.getByText(he.common.loading).closest<HTMLElement>('[aria-busy="true"]'),
      ).toHaveAttribute('aria-busy', 'true');
    });
    reset(view);
    ({ api, view } = renderPage({ mine: [json({ detail: 'boom' }, 500), json([ROOM])] }));
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await heading()).toBeVisible();
  });

  it('ac4_h1_while_loading_and_on_error', async () => {
    const title = () => screen.getByRole('heading', { level: 1, name: he.flatmates.title });
    // "My listings" loading: the page's <h1> above the busy block.
    const pending = deferred();
    let { view } = renderPage({ mine: [pending.promise] });
    await screen.findByRole('heading', { level: 1, name: he.flatmates.title });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText(he.common.loading).closest('[aria-busy="true"]')).not.toBeNull();
    reset(view);

    // "My listings" failing: the <h1> above ErrorState, whose message is no heading.
    ({ view } = renderPage({ mine: [json({ detail: 'boom' }, 500)] }));
    await screen.findByRole('button', { name: he.common.retry });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(title()).toBeVisible();
    reset(view);

    // The flatmates failing: still the one <h1>.
    ({ view } = renderPage({ list: [json({ detail: 'boom' }, 500)] }));
    await screen.findByRole('button', { name: he.common.retry });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(title()).toBeVisible();
    reset(view);
  });

  it('ac1_layout', async () => {
    // The header: the back link, the <h1> and the room's title as the subtitle.
    const dana = flatmate({ display_name: 'דנה' });
    const yoni = flatmate({ display_name: 'Yoni' });
    const { view } = renderPage({
      list: [json([dana, yoni])],
      extra: { [CREATE]: [json({ token: 'T' }, 201)] },
    });
    const h1 = await heading();
    expect(screen.getByRole('link', { name: he.flatmates.back })).toHaveAttribute(
      'href',
      '/me/listings',
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toEqual([h1]);
    expect(screen.getByText(cardTitle(i18n.t, ROOM)).tagName).toBe('P');
    // The page is the default (720px) column.
    expect(h1.closest('section')).toHaveClass('max-w-page');

    // The invite column's <h2>, before the members' <h2> in DOM order (the invite first on a phone).
    // A string name matches the whole name (the hint and the create button also contain it).
    const inviteTitle = screen.getByRole('heading', { level: 2, name: he.flatmates.invite.title });
    const listTitle = screen.getByRole('heading', { level: 2, name: he.flatmates.list.title });
    expect(
      inviteTitle.compareDocumentPosition(listTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // After create: the URL in an LTR read-only textbox whose box carries `text-start`.
    fireEvent.click(button(he.flatmates.invite.create));
    const input = await screen.findByRole('textbox', { name: he.flatmates.invite.linkLabel });
    expect(input).toHaveValue(linkOf('T'));
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(input.closest('.text-start')).not.toBeNull();
    expect(button(he.flatmates.invite.copy)).toBeVisible();

    // Each member row: an aria-hidden initial, and "remove" described by the name.
    const rows = within(screen.getByRole('list', { name: he.flatmates.list.title })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(2);
    for (const [row, name, initial] of [
      [rows[0], 'דנה', 'ד'],
      [rows[1], 'Yoni', 'Y'],
    ] as const) {
      const item = row as HTMLElement;
      const avatar = within(item).getByText(initial, { exact: true });
      expect(avatar).toHaveAttribute('aria-hidden', 'true');
      expect(within(item).getByText(name)).toHaveAttribute('dir', 'auto');
      expect(
        within(item).getByRole('button', { name: he.flatmates.list.remove }),
      ).toHaveAccessibleDescription(name);
    }
    reset(view);
  });

  it('ac2_confirm_dialogs', async () => {
    const confirm = confirmSpy();
    const dana = flatmate({ display_name: 'דנה' });
    const { api } = renderPage({
      mine: [json([ACTIVE]), json([ACTIVE]), json([ROOM]), json([ROOM])],
      list: [json([dana]), json([])],
      extra: {
        [CREATE]: [json({ token: 'T2' }, 201)],
        [DISABLE]: [empty()],
        [removeRoute(dana)]: [empty()],
      },
    });
    await screen.findByText(he.flatmates.invite.active);
    const dialogFor = (title: string) => screen.findByRole('dialog', { name: title });

    // Rotate: a dialog named by the confirm sentence, its confirm button the action's label (the
    // primary tone). Cancel sends nothing and returns focus to the opener.
    const rotate = button(he.flatmates.invite.rotate);
    act(() => rotate.focus());
    fireEvent.click(rotate);
    let box = await dialogFor(he.flatmates.invite.rotateConfirm);
    expect(within(box).getByRole('button', { name: he.flatmates.invite.rotate })).toHaveClass(
      'bg-ink',
    );
    fireEvent.click(within(box).getByRole('button', { name: he.common.cancel }));
    await noDialog();
    expect(rotate).toHaveFocus();
    expect(api.calls(CREATE)).toHaveLength(0);
    // Confirm: exactly one POST.
    fireEvent.click(rotate);
    await answer(he.flatmates.invite.rotateConfirm, he.flatmates.invite.rotate);
    expect(await screen.findByRole('textbox')).toHaveValue(linkOf('T2'));
    expect(api.calls(CREATE)).toHaveLength(1);

    // Disable: the danger tone; cancel, then confirm (one DELETE).
    const disable = button(he.flatmates.invite.disable);
    act(() => disable.focus());
    fireEvent.click(disable);
    box = await dialogFor(he.flatmates.invite.disableConfirm);
    expect(within(box).getByRole('button', { name: he.flatmates.invite.disable })).toHaveClass(
      'bg-danger',
    );
    fireEvent.click(within(box).getByRole('button', { name: he.common.cancel }));
    await noDialog();
    expect(disable).toHaveFocus();
    expect(api.calls(DISABLE)).toHaveLength(0);
    fireEvent.click(disable);
    await answer(he.flatmates.invite.disableConfirm, he.flatmates.invite.disable);
    await screen.findByRole('button', { name: he.flatmates.invite.create });
    expect(api.calls(DISABLE)).toHaveLength(1);

    // Remove: a double click opens one dialog; cancel returns focus; confirm sends one DELETE.
    const removeTitle = i18n.t('flatmates.list.removeConfirm', { name: 'דנה' });
    const row = screen.getByRole('listitem');
    const remove = within(row).getByRole('button', { name: he.flatmates.list.remove });
    act(() => remove.focus());
    fireEvent.click(remove);
    fireEvent.click(remove);
    expect(await screen.findAllByRole('dialog')).toHaveLength(1);
    box = await dialogFor(removeTitle);
    expect(within(box).getByRole('button', { name: he.flatmates.list.remove })).toHaveClass(
      'bg-danger',
    );
    fireEvent.click(within(box).getByRole('button', { name: he.common.cancel }));
    await noDialog();
    expect(remove).toHaveFocus();
    expect(api.calls(removeRoute(dana))).toHaveLength(0);
    fireEvent.click(remove);
    fireEvent.click(remove);
    await answer(removeTitle, he.flatmates.list.remove);
    expect(await screen.findByText(he.flatmates.list.empty)).toBeVisible();
    expect(api.calls(removeRoute(dana))).toHaveLength(1);

    expect(confirm).not.toHaveBeenCalled();
  });
});
