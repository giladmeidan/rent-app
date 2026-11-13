import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { json, mockApi } from '../../auth/__tests__/harness';
import { PHOTO_ACCEPT } from '../../photos/limits';
import { gushDan } from './fixtures';
import {
  areasLoaded,
  chooseApartmentAndContinue,
  fillValidDetails,
  nextButton,
  progress,
  renderWizard,
} from './wizard';

const ph = he.listings.photos;
const createObjectURL = vi.fn<(file: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();

// jsdom has no object URLs.
beforeEach(() => {
  let n = 0;
  createObjectURL.mockImplementation(() => {
    n += 1;
    return `blob:photo-${String(n)}`;
  });
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
});

afterEach(() => {
  createObjectURL.mockReset();
  revokeObjectURL.mockReset();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  vi.unstubAllGlobals();
});

/** A file of `size` bytes (reported, not allocated). */
function photo(name: string, type = 'image/jpeg', size = 2048): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]');
const pick = (...files: File[]) => {
  fireEvent.change(fileInput() as HTMLInputElement, { target: { files } });
};
/** The photo tiles, in order (the stepper is a list too). */
const tiles = () => Array.from(document.querySelectorAll<HTMLElement>('li[data-photo]'));
/** The tiles' image sources, in order. */
const sources = () =>
  tiles().map((tile) => within(tile).getByRole('img').getAttribute('src') ?? '');
const button = (label: string) => screen.getByRole('button', { name: label });
const t = (key: string, n: number) => i18n.t(key, { n });
const addButton = () => screen.queryByRole('button', { name: ph.add });

async function toPhotos() {
  mockApi({ 'GET /areas': [json([gushDan])] });
  const view = renderWizard();
  chooseApartmentAndContinue();
  await areasLoaded();
  fillValidDetails();
  fireEvent.click(nextButton());
  expect(
    screen.getByRole('heading', { level: 2, name: he.listings.stepTitle.photos }),
  ).toBeVisible();
  return view;
}

describe('PhotosStep', () => {
  it('ac1_pick_check_move_remove', async () => {
    const view = await toPhotos();

    // Empty: the add button and the "publish without photos" line; no tiles, no count.
    expect(addButton()).toBeVisible();
    expect(screen.getByText(ph.empty)).toBeVisible();
    expect(tiles()).toHaveLength(0);
    const input = fileInput() as HTMLInputElement;
    expect(input).toHaveAttribute('accept', PHOTO_ACCEPT);
    expect(input).toHaveAttribute('multiple');
    // The add button opens the hidden input.
    const click = vi.spyOn(input, 'click');
    fireEvent.click(addButton() as HTMLElement);
    expect(click).toHaveBeenCalledTimes(1);

    // A GIF, a 9 MB JPEG and a valid JPEG: one tile, one alert naming the type and the size.
    pick(
      photo('a.gif', 'image/gif'),
      photo('big.jpg', 'image/jpeg', 9 * 1024 * 1024),
      photo('a.jpg'),
    );
    expect(tiles()).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(
      `${he.photos.errors.type} ${he.photos.errors.size}`,
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('');
    expect(within(tiles()[0] as HTMLElement).getByRole('img')).toHaveAccessibleName(
      t('listings.photos.tileAlt', 1),
    );
    expect(within(tiles()[0] as HTMLElement).getByText(ph.cover)).toBeVisible();
    expect(screen.getByText(i18n.t('listings.photos.count', { count: 1 }))).toBeVisible();
    expect(screen.queryByText(ph.empty)).toBeNull();

    // Two more: appended in pick order, the alert gone.
    pick(photo('b.jpg', 'image/png'), photo('c.jpg', 'image/webp'));
    expect(sources()).toEqual(['blob:photo-1', 'blob:photo-2', 'blob:photo-3']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(button(t('listings.photos.moveEarlier', 1))).toBeDisabled();
    expect(button(t('listings.photos.moveLater', 3))).toBeDisabled();

    // Move the first later: the cover follows the list order, focus stays on the moved photo.
    fireEvent.click(button(t('listings.photos.moveLater', 1)));
    expect(sources()).toEqual(['blob:photo-2', 'blob:photo-1', 'blob:photo-3']);
    expect(within(tiles()[0] as HTMLElement).getByText(ph.cover)).toBeVisible();
    expect(within(tiles()[1] as HTMLElement).queryByText(ph.cover)).toBeNull();
    expect(document.activeElement).toBe(button(t('listings.photos.moveLater', 2)));
    // Into the last place: "later" is disabled there, so focus goes to "earlier".
    fireEvent.click(button(t('listings.photos.moveLater', 2)));
    expect(sources()).toEqual(['blob:photo-2', 'blob:photo-3', 'blob:photo-1']);
    expect(document.activeElement).toBe(button(t('listings.photos.moveEarlier', 3)));
    // And back to the front: "earlier" is disabled there, focus on "later".
    fireEvent.click(button(t('listings.photos.moveEarlier', 3)));
    fireEvent.click(button(t('listings.photos.moveEarlier', 2)));
    expect(sources()).toEqual(['blob:photo-1', 'blob:photo-2', 'blob:photo-3']);
    expect(document.activeElement).toBe(button(t('listings.photos.moveLater', 1)));

    // Leaving the step keeps them.
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '4');
    fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    expect(sources()).toEqual(['blob:photo-1', 'blob:photo-2', 'blob:photo-3']);

    // Remove the middle one: its URL is revoked, focus on the remove button now at that place.
    fireEvent.click(button(t('listings.photos.remove', 2)));
    expect(sources()).toEqual(['blob:photo-1', 'blob:photo-3']);
    expect(revokeObjectURL.mock.calls).toEqual([['blob:photo-2']]);
    expect(document.activeElement).toBe(button(t('listings.photos.remove', 2)));
    // The last one: focus on the previous tile's.
    fireEvent.click(button(t('listings.photos.remove', 2)));
    expect(document.activeElement).toBe(button(t('listings.photos.remove', 1)));
    // The only one: focus on the add button; the cover goes with it.
    fireEvent.click(button(t('listings.photos.remove', 1)));
    expect(tiles()).toHaveLength(0);
    expect(document.activeElement).toBe(addButton());
    expect(revokeObjectURL).toHaveBeenCalledTimes(3);
    expect(screen.getByText(ph.empty)).toBeVisible();

    // Eleven at once: ten fit, "one was not added", the add button goes and focus is on the count.
    pick(...Array.from({ length: 11 }, (_, i) => photo(`p${String(i)}.jpg`)));
    expect(tiles()).toHaveLength(10);
    expect(screen.getByRole('alert')).toHaveTextContent(ph.tooMany_one);
    expect(addButton()).toBeNull();
    const count = screen.getByText(i18n.t('listings.photos.count', { count: 10 }));
    expect(count).toHaveTextContent('10 מתוך 10');
    expect(document.activeElement).toBe(count);
    expect(within(tiles()[0] as HTMLElement).getByText(ph.cover)).toBeVisible();
    expect(screen.getAllByText(ph.cover)).toHaveLength(1);

    // Unmounting the wizard revokes every remaining object URL.
    revokeObjectURL.mockClear();
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(10);
    expect(new Set(revokeObjectURL.mock.calls.map(([url]) => url)).size).toBe(10);
  });

  it('ac1_reasons_in_order_and_too_many_plural', async () => {
    await toPhotos();
    pick(...Array.from({ length: 8 }, (_, i) => photo(`p${String(i)}.jpg`)));
    // Too many, a size and a type problem in one pick: type, size, then too many (2 left over).
    pick(
      photo('big.jpg', 'image/jpeg', 8 * 1024 * 1024 + 1),
      photo('x.jpg'),
      photo('y.jpg'),
      photo('z.jpg'),
      photo('w.jpg'),
      photo('doc.pdf', 'application/pdf'),
    );
    expect(tiles()).toHaveLength(10);
    expect(screen.getByRole('alert')).toHaveTextContent(
      [
        he.photos.errors.type,
        he.photos.errors.size,
        i18n.t('listings.photos.tooMany', { count: 2 }),
      ].join(' '),
    );
    expect(i18n.t('listings.photos.tooMany', { count: 2 })).toBe(
      'אפשר עד 10 תמונות. 2 תמונות לא נוספו.',
    );
  });
});
