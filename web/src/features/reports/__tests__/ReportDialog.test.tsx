import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UserOut } from '../../../api/client';
import he from '../../../locales/he.json';
import {
  deferred,
  json,
  mockApi,
  networkError,
  noa,
  renderAt,
  testQueryClient,
} from '../../auth/__tests__/harness';
import { ME_KEY } from '../../auth/useMe';
import type { ReportReason } from '../api';
import { LISTING_REASONS, PERSON_REASONS } from '../reasons';
import { ReportButton } from '../ReportButton';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const r = he.report;
const ID = '00000000-0000-0000-0000-0000000000c1';
const ROUTE = 'POST /reports';
const TITLE = r.title.listing;

function renderButton(reasons: readonly ReportReason[] = LISTING_REASONS) {
  const client = testQueryClient();
  client.setQueryData<UserOut | null>(ME_KEY, noa);
  renderAt(
    '/x',
    <ReportButton target={{ type: 'listing', id: ID }} title={TITLE} reasons={reasons} />,
    client,
  );
  const opener = screen.getByRole('button', { name: r.button });
  return { client, opener };
}

function open(opener: HTMLElement) {
  opener.focus();
  fireEvent.click(opener);
}

const dialog = () => screen.getByRole('dialog', { name: TITLE });
const group = () => within(dialog()).getByRole('group', { name: r.reasonLegend });
const radios = () => within(group()).getAllByRole('radio');
const labels = () => radios().map((radio) => (radio as HTMLInputElement).labels?.[0]?.textContent);
const note = () => within(dialog()).getByLabelText(r.note);
const submit = () => within(dialog()).getByRole('button', { name: r.submit });
const pick = (label: string) =>
  fireEvent.click(within(group()).getByRole('radio', { name: label }));
const type = (value: string) => fireEvent.change(note(), { target: { value } });
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const ALL_LABELS = [
  r.reasons.moneyBeforeViewing,
  r.reasons.broker,
  r.reasons.misleading,
  r.reasons.unavailable,
  r.reasons.offensive,
  r.reasons.other,
];

describe('ReportDialog', () => {
  it('ac11_send_and_success', async () => {
    const post = deferred();
    const api = mockApi({
      [ROUTE]: [post.promise, json({ already_reported: false }, 201)],
    });
    const { opener } = renderButton();
    open(opener);

    // The title, the intro as its description, six reasons in order, none chosen, the counter.
    expect(dialog()).toHaveAccessibleDescription(r.intro);
    expect(labels()).toEqual(ALL_LABELS);
    for (const radio of radios()) expect(radio).not.toBeChecked();
    expect(note()).toHaveValue('');
    expect(within(dialog()).getByText('נותרו 500 תווים')).toBeVisible();
    expect(submit()).toBeDisabled();

    pick(r.reasons.moneyBeforeViewing);
    type('  hi  ');
    expect(within(dialog()).getByText('נותרו 494 תווים')).toBeVisible();
    expect(submit()).toBeEnabled();
    fireEvent.click(submit());
    await vi.waitFor(() => {
      expect(submit()).toHaveAttribute('aria-busy', 'true');
    });
    expect(note()).toHaveValue('  hi  ');
    await vi.waitFor(() => {
      expect(api.calls(ROUTE).map((call) => call.body)).toEqual([
        { target_type: 'listing', target_id: ID, reason: 'money_before_viewing', note: 'hi' },
      ]);
    });
    post.resolve(json({ already_reported: false }, 201));
    const sent = await within(dialog()).findByRole('status');
    expect(sent).toHaveTextContent(r.sent);
    expect(screen.queryByRole('group')).toBeNull();
    const close = within(dialog()).getByRole('button', { name: r.close });
    expect(close).toHaveFocus();

    // סגירה closes; focus returns to the opener.
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();

    // A blank note is sent as null; a 200 says it is already in.
    const again = mockApi({ [ROUTE]: [json({ already_reported: true }, 200)] });
    open(opener);
    pick(r.reasons.other);
    type('   ');
    fireEvent.click(submit());
    expect(await within(dialog()).findByRole('status')).toHaveTextContent(r.already);
    expect(again.calls(ROUTE).map((call) => call.body)).toEqual([
      { target_type: 'listing', target_id: ID, reason: 'other', note: null },
    ]);
  });

  it('ac12_errors', async () => {
    const api = mockApi({
      [ROUTE]: [json({ detail: 'boom' }, 500), json({ already_reported: false }, 201)],
    });
    const { client, opener } = renderButton();
    open(opener);

    // A 500: the failure line, the form and the note kept, and a second submit sends again.
    pick(r.reasons.broker);
    type('details');
    fireEvent.click(submit());
    const failed = await within(dialog()).findByRole('alert');
    expect(failed).toHaveTextContent(r.errors.failed);
    expect(note()).toHaveValue('details');
    expect(note()).toHaveAccessibleDescription(expect.stringContaining(r.errors.failed));
    expect(submit()).toBeEnabled();
    fireEvent.click(submit());
    expect(await within(dialog()).findByRole('status')).toHaveTextContent(r.sent);
    expect(api.calls(ROUTE)).toHaveLength(2);

    /** A fresh opening that sends one report answered by `reply`. */
    async function sendWith(reply: Response | (() => Promise<Response>)) {
      fireEvent.click(within(dialog()).getByRole('button', { name: r.close }));
      mockApi({ [ROUTE]: [reply] });
      open(opener);
      pick(r.reasons.broker);
      type('details');
      fireEvent.click(submit());
      await flush();
    }

    // Offline: no network, a rejected fetch.
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await sendWith(networkError);
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(he.common.offline);
    onLine.mockRestore();

    // A 429 with and without `Retry-After`.
    fireEvent.click(within(dialog()).getByRole('button', { name: he.common.cancel }));
    mockApi({
      [ROUTE]: [
        new Response(JSON.stringify({ detail: 'rate_limited' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '900' },
        }),
      ],
    });
    open(opener);
    pick(r.reasons.broker);
    fireEvent.click(submit());
    await flush();
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(
      r.errors.rateLimitedIn.replace('{{when}}', 'בעוד 15 דקות'),
    );
    mockApi({ [ROUTE]: [json({ detail: 'rate_limited' }, 429)] });
    fireEvent.click(submit());
    await flush();
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(r.errors.rateLimited);

    // A 422 at the note marks the note invalid and focuses it.
    mockApi({
      [ROUTE]: [json({ detail: [{ loc: ['body', 'note'], msg: 'x', type: 'value_error' }] }, 422)],
    });
    fireEvent.click(submit());
    await flush();
    expect(note()).toHaveAttribute('aria-invalid', 'true');
    expect(note()).toHaveAccessibleDescription(expect.stringContaining(r.errors.noteInvalid));
    expect(note()).toHaveFocus();

    // A 404 replaces the form and focuses סגירה.
    mockApi({ [ROUTE]: [json({ detail: 'not_found' }, 404)] });
    fireEvent.click(submit());
    await flush();
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(r.gone);
    expect(screen.queryByRole('group')).toBeNull();
    expect(within(dialog()).getByRole('button', { name: r.close })).toHaveFocus();

    // A 401 forgets the session.
    await sendWith(json({ detail: 'unauthenticated' }, 401));
    expect(client.getQueryData(ME_KEY)).toBeNull();
  });

  it('ac13_keyboard_and_reasons', async () => {
    const post = deferred();
    const api = mockApi({ [ROUTE]: [post.promise] });
    const { opener } = renderButton(PERSON_REASONS);

    // Esc and ביטול close with nothing sent.
    open(opener);
    act(() => {
      dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
    open(opener);
    fireEvent.click(within(dialog()).getByRole('button', { name: he.common.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.calls(ROUTE)).toHaveLength(0);

    // A person: five reasons, no "no longer relevant".
    open(opener);
    expect(labels()).toEqual(ALL_LABELS.filter((label) => label !== r.reasons.unavailable));
    expect(within(dialog()).queryByText(r.reasons.unavailable)).toBeNull();

    // What was typed is gone on the next opening.
    pick(r.reasons.offensive);
    type('typed');
    fireEvent.click(within(dialog()).getByRole('button', { name: he.common.cancel }));
    open(opener);
    expect(note()).toHaveValue('');
    for (const radio of radios()) expect(radio).not.toBeChecked();

    // A double click sends one request.
    pick(r.reasons.offensive);
    fireEvent.click(submit());
    fireEvent.click(submit());
    await flush();
    expect(api.calls(ROUTE)).toHaveLength(1);
    post.resolve(json({ already_reported: false }, 201));
    expect(await within(dialog()).findByRole('status')).toHaveTextContent(r.sent);
  });
});
