import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { empty, json, mockApi, noa, renderRoutes } from '../../auth/__tests__/harness';
import { RequireSeeker } from '../../auth/RequireSeeker';
import { seeker } from '../../listings/__tests__/fixtures';
import { PersonPhoto } from '../PersonPhoto';
import { ProfilePage } from '../ProfilePage';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ME = 'GET /me';
const PUT = 'PUT /me/photo';
const DELETE = 'DELETE /me/photo';
const URL_S = 'https://media.test/me-s.webp';
const withPhoto = { ...noa, photo_url: URL_S };

const photo = (type = 'image/jpeg', size = 5) =>
  new File([new Uint8Array(size)], 'me.jpg', { type });
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const pick = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } });
const add = () => screen.getByRole('button', { name: he.profile.photo.add });
const avatar = () => document.querySelector('span[aria-hidden="true"].rounded-full') as HTMLElement;
const shown = () => document.querySelector('img') as HTMLImageElement | null;

function renderPhoto(replies: Parameters<typeof mockApi>[0]) {
  const api = mockApi({ [ME]: [json(noa)], ...replies });
  renderRoutes(
    '/',
    <Routes>
      <Route path="/" element={<PersonPhoto />} />
    </Routes>,
  );
  return api;
}

describe('PersonPhoto', () => {
  it('ac4_person_photo', async () => {
    const api = renderPhoto({
      [PUT]: [json(withPhoto)],
      [DELETE]: [empty()],
    });

    // No photo: the initial and "העלאת תמונה" (and the hint); the picker accepts the three types.
    await screen.findByRole('button', { name: he.profile.photo.add });
    expect(avatar()).toHaveTextContent('נ');
    expect(shown()).toBeNull();
    expect(screen.queryByRole('button', { name: he.profile.photo.replace })).toBeNull();
    expect(screen.queryByRole('button', { name: he.profile.photo.remove })).toBeNull();
    expect(screen.getByText(he.profile.photo.hint)).toBeVisible();
    expect(fileInput()).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    expect(fileInput()).not.toHaveAttribute('multiple');

    // A file: PUT with the file as the body, then the photo and "התמונה נשמרה".
    pick(photo('image/jpeg', 5));
    expect(await screen.findByText(he.profile.photo.saved)).toBeVisible();
    const puts = api.calls(PUT);
    expect(puts).toHaveLength(1);
    expect((await puts[0]?.request.arrayBuffer())?.byteLength).toBe(5);
    expect(puts[0]?.request.headers.get('Content-Type')).toBe('image/jpeg');
    expect(shown()).toHaveAttribute('src', URL_S);
    expect(screen.getByRole('button', { name: he.profile.photo.replace })).toBeVisible();
    // Focus follows the pressed button: "העלאת תמונה" is gone, so "החלפת תמונה" has it.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: he.profile.photo.replace })).toHaveFocus();
    });
    expect(screen.queryByRole('button', { name: he.profile.photo.add })).toBeNull();
    expect(fileInput().value).toBe('');

    // "הסרת תמונה": the DELETE, back to the initial, "התמונה הוסרה", focus on "העלאת תמונה".
    fireEvent.click(screen.getByRole('button', { name: he.profile.photo.remove }));
    // While it is in flight the other button is disabled (a pick would be dropped).
    expect(screen.getByRole('button', { name: he.profile.photo.replace })).toBeDisabled();
    expect(await screen.findByText(he.profile.photo.removed)).toBeVisible();
    expect(api.calls(DELETE)).toHaveLength(1);
    expect(shown()).toBeNull();
    expect(avatar()).toHaveTextContent('נ');
    await waitFor(() => {
      expect(add()).toHaveFocus();
    });
    expect(screen.queryByText(he.profile.photo.saved)).toBeNull();
  });

  it('ac4_person_photo_errors', async () => {
    const api = renderPhoto({
      [PUT]: [
        json({ detail: 'photo_too_large' }, 413),
        () =>
          new Response(JSON.stringify({ detail: 'rate_limited' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '5' },
          }),
        json({ detail: 'unavailable' }, 503),
      ],
    });
    await screen.findByRole('button', { name: he.profile.photo.add });

    // A file the page already knows is wrong: no request.
    pick(photo('image/gif'));
    expect(await screen.findByRole('alert')).toHaveTextContent(he.photos.errors.type);
    pick(photo('image/png', 8 * 1024 * 1024 + 1));
    expect(await screen.findByRole('alert')).toHaveTextContent(he.photos.errors.size);
    expect(api.calls(PUT)).toHaveLength(0);

    // The API's 413.
    pick(photo());
    await waitFor(() => {
      expect(api.calls(PUT)).toHaveLength(1);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(he.photos.errors.size);
    expect(add()).not.toHaveAttribute('aria-busy', 'true');

    // A 429 with `Retry-After`: when to try again.
    pick(photo());
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/אפשר לנסות שוב ב/);
    });
    expect(screen.getByRole('alert')).not.toHaveTextContent(he.photos.errors.rateLimited);

    // Anything else (a 503): "not uploaded", and no photo shown.
    pick(photo());
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(he.photos.errors.failed);
    });
    expect(shown()).toBeNull();
  });

  it('ac4_person_photo_with_the_switch_off', async () => {
    // The profile page with no profile (the "עליי" switch off): the control is there, above the
    // switch, and it keeps the cached account's photo.
    mockApi({
      [ME]: [json({ ...seeker, photo_url: URL_S })],
      'GET /me/profile': [() => json({ detail: 'seeker_profile_not_found' }, 404)],
      'GET /areas': [json([])],
    });
    renderRoutes(
      '/me/profile',
      <Routes>
        <Route element={<RequireSeeker />}>
          <Route path="/me/profile" element={<ProfilePage />} />
        </Route>
      </Routes>,
    );
    const aboutSwitch = await screen.findByRole('switch', { name: he.profile.about.switch });
    expect(aboutSwitch).not.toBeChecked();
    const replace = screen.getByRole('button', { name: he.profile.photo.replace });
    expect(replace).toBeVisible();
    expect(
      replace.compareDocumentPosition(aboutSwitch) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
