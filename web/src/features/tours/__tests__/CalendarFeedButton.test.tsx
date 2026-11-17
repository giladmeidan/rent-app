import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { deferred, empty, json, mockApi, testQueryClient } from '../../auth/__tests__/harness';
import { CalendarFeedButton } from '../CalendarFeedButton';

const f = he.tours.feed;
const STATUS = 'GET /me/tour-feed';
const CREATE = 'POST /me/tour-feed';
const DISABLE = 'DELETE /me/tour-feed';
const TOKEN = 'A'.repeat(21) + '_-' + 'b'.repeat(20);
const NEW_TOKEN = 'C'.repeat(43);
const httpsOf = (token: string) => `http://api.test/tour-feed/${token}.ics`;
const webcalOf = (token: string) => `webcal://api.test/tour-feed/${token}.ics`;

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'clipboard');
  localStorage.clear();
  sessionStorage.clear();
});

function renderButton(client: QueryClient = testQueryClient()) {
  const view = render(
    <QueryClientProvider client={client}>
      <CalendarFeedButton />
    </QueryClientProvider>,
  );
  return { client, view };
}

const openDialog = () => {
  fireEvent.click(screen.getByRole('button', { name: f.title }));
  return screen.getByRole('dialog', { name: f.title });
};
const confirmDialog = (name: string) => screen.findByRole('dialog', { name });

describe('CalendarFeedButton', () => {
  it('ac14_create_shows_link_once', async () => {
    const api = mockApi({
      [STATUS]: [json({ active: false })],
      [CREATE]: [json({ token: TOKEN }, 201)],
    });
    renderButton();
    expect(api.calls(STATUS)).toHaveLength(0); // idle until the dialog opens
    const dialog = openDialog();
    expect(await within(dialog).findByText(f.hint)).toBeVisible();

    fireEvent.click(within(dialog).getByRole('button', { name: f.create }));
    const field = await within(dialog).findByRole('textbox', { name: f.linkLabel });
    expect(field).toHaveValue(httpsOf(TOKEN));
    expect(field).toHaveAttribute('dir', 'ltr');
    expect(field).toHaveAttribute('readonly');
    const google = within(dialog).getByRole('link', { name: new RegExp(f.addGoogle) });
    expect(google).toHaveAttribute(
      'href',
      `https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Fapi.test%2Ftour-feed%2F${TOKEN}.ics`,
    );
    expect(google).toHaveAttribute('target', '_blank');
    expect(google).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(dialog).getByRole('link', { name: f.addOther })).toHaveAttribute(
      'href',
      webcalOf(TOKEN),
    );
    expect(within(dialog).getByText(f.onceWarning)).toBeVisible();
    expect(within(dialog).getByText(f.delay)).toBeVisible();

    writeText.mockResolvedValueOnce(undefined);
    fireEvent.click(within(dialog).getByRole('button', { name: f.copy }));
    expect(await within(dialog).findByText(f.copied)).toHaveAttribute('role', 'status');
    expect(writeText).toHaveBeenCalledWith(httpsOf(TOKEN));

    // A failing clipboard selects the field's text instead.
    writeText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(within(dialog).getByRole('button', { name: f.copy }));
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });

    // Closed and reopened on the same visit: the link is still there.
    fireEvent.click(within(dialog).getByRole('button', { name: f.close }));
    await waitFor(() => {
      expect(dialog).not.toHaveAttribute('open');
    });
    openDialog();
    expect(screen.getByRole('textbox', { name: f.linkLabel })).toHaveValue(httpsOf(TOKEN));
    expect(api.calls(CREATE)).toHaveLength(1);
  });

  it('ac15_rotate_and_disable_confirm', async () => {
    const api = mockApi({
      [STATUS]: [json({ active: true })],
      [CREATE]: [json({ token: NEW_TOKEN }, 201)],
      [DISABLE]: [empty()],
    });
    renderButton();
    const dialog = openDialog();
    expect(await within(dialog).findByText(f.active)).toBeVisible();
    expect(within(dialog).queryByRole('textbox')).toBeNull();

    // Rotate, cancelled: nothing sent.
    fireEvent.click(within(dialog).getByRole('button', { name: f.rotate }));
    let confirm = await confirmDialog(f.rotateConfirm);
    expect(confirm).toHaveTextContent(f.rotateBody);
    fireEvent.click(within(confirm).getByRole('button', { name: he.common.cancel }));
    await waitFor(() => {
      expect(confirm).not.toHaveAttribute('open');
    });
    expect(api.calls(CREATE)).toHaveLength(0);

    // Rotate, confirmed: the new link.
    fireEvent.click(within(dialog).getByRole('button', { name: f.rotate }));
    confirm = await confirmDialog(f.rotateConfirm);
    fireEvent.click(within(confirm).getByRole('button', { name: f.rotate }));
    expect(await within(dialog).findByRole('textbox', { name: f.linkLabel })).toHaveValue(
      httpsOf(NEW_TOKEN),
    );
    expect(api.calls(CREATE)).toHaveLength(1);

    // Disable, confirmed: the off state.
    fireEvent.click(within(dialog).getByRole('button', { name: f.disable }));
    confirm = await confirmDialog(f.disableConfirm);
    expect(confirm).toHaveTextContent(f.disableBody);
    fireEvent.click(within(confirm).getByRole('button', { name: f.disable }));
    expect(await within(dialog).findByText(f.hint)).toBeVisible();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(api.calls(DISABLE)).toHaveLength(1);
  });

  it('ac16_states_and_errors', async () => {
    const status = deferred();
    const create = deferred();
    const api = mockApi({
      [STATUS]: [() => status.promise, json({ active: false })],
      [CREATE]: [
        json({ detail: 'rate_limited' }, 429, { 'Retry-After': '840' }),
        () => create.promise,
      ],
    });
    renderButton();
    const dialog = openDialog();
    expect(within(dialog).getAllByTestId('skeleton').length).toBeGreaterThan(0);

    // A failed GET: retry.
    status.resolve(json({ detail: 'boom' }, 500));
    fireEvent.click(await within(dialog).findByRole('button', { name: he.common.retry }));
    expect(await within(dialog).findByText(f.hint)).toBeVisible();

    // A 429 on create: the retry time from Retry-After (840 s = 14 minutes), state unchanged.
    fireEvent.click(within(dialog).getByRole('button', { name: f.create }));
    const when = he.common.inMinutes_other.replace('{{count}}', '14');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      f.rateLimitedIn.replace('{{when}}', when),
    );
    expect(within(dialog).getByText(f.hint)).toBeVisible();

    // Pending: disabled, and a double click sends one POST.
    const button = within(dialog).getByRole('button', { name: f.create });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(api.calls(CREATE)).toHaveLength(2);
    create.resolve(json({ token: TOKEN }, 201));
    expect(await within(dialog).findByRole('textbox')).toHaveValue(httpsOf(TOKEN));
  });

  it('ac17_token_not_persisted', async () => {
    mockApi({
      [STATUS]: [json({ active: false }), json({ active: true })],
      [CREATE]: [json({ token: TOKEN }, 201)],
    });
    const { client } = renderButton();
    const dialog = openDialog();
    fireEvent.click(await within(dialog).findByRole('button', { name: f.create }));
    await within(dialog).findByRole('textbox');

    // A reload: a new mount (the same query client, to look inside its caches).
    cleanup();
    renderButton(client);
    const again = openDialog();
    expect(await within(again).findByText(f.active)).toBeVisible();
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(within(again).queryByRole('textbox')).toBeNull();
    const storage = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(storage).not.toContain(TOKEN);
    const queries = client
      .getQueryCache()
      .getAll()
      .map((q) => q.state.data);
    expect(JSON.stringify(queries)).not.toContain(TOKEN);
    await waitFor(() => {
      const mutations = client
        .getMutationCache()
        .getAll()
        .map((m) => m.state.data);
      expect(JSON.stringify(mutations)).not.toContain(TOKEN);
    });
  });
});
