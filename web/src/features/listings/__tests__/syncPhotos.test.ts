import { afterEach, describe, expect, it, vi } from 'vitest';

import { empty, json, mockApi, networkError } from '../../auth/__tests__/harness';
import type { PhotoOut } from '../api';
import { syncPhotos, type WizardPhoto } from '../syncPhotos';

afterEach(() => {
  vi.unstubAllGlobals();
});

const LISTING = '00000000-0000-0000-0000-0000000001a1';
const UPLOAD = `POST /listings/${LISTING}/photos`;
const ORDER = `PUT /listings/${LISTING}/photos/order`;
const del = (id: string) => `DELETE /listings/${LISTING}/photos/${id}`;

const out = (id: string): PhotoOut => ({
  id,
  small_url: `https://media.example.test/${id}-s.webp`,
  large_url: `https://media.example.test/${id}-l.webp`,
});
const storedPhoto = (id: string): WizardPhoto => ({
  kind: 'stored',
  id,
  url: out(id).small_url,
});
const newPhoto = (localId: string, size = 3, type = 'image/jpeg'): WizardPhoto => ({
  kind: 'new',
  localId,
  file: new File([new Uint8Array(size)], `${localId}.jpg`, { type }),
  url: `blob:${localId}`,
});
const rateLimited = (retryAfter: string) =>
  new Response(JSON.stringify({ detail: 'rate_limited' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': retryAfter },
  });

const A = out('a0000000-0000-0000-0000-00000000000a');
const B = out('b0000000-0000-0000-0000-00000000000b');
const C = out('c0000000-0000-0000-0000-00000000000c');
const N1 = out('d0000000-0000-0000-0000-0000000000d1');
const N2 = out('d0000000-0000-0000-0000-0000000000d2');

/** A `sleep` that records the wait and returns at once. */
const noSleep = () => vi.fn((ms: number) => Promise.resolve(ms).then(() => undefined));

describe('syncPhotos', () => {
  it('only_new_photos_upload_in_order', async () => {
    const api = mockApi({ [UPLOAD]: [json(N1, 201), json(N2, 201)] });
    const progress = vi.fn();
    const first = newPhoto('one', 5, 'image/png');
    const second = newPhoto('two', 7, 'image/webp');

    const result = await syncPhotos(LISTING, [], [first, second], progress);

    expect(result).toEqual({ failed: 0, unauthenticated: false });
    const uploads = api.calls(UPLOAD);
    expect(uploads).toHaveLength(2);
    // Each body is the file itself, with the file's type.
    expect((await uploads[0]?.request.arrayBuffer())?.byteLength).toBe(5);
    expect(uploads[0]?.request.headers.get('Content-Type')).toBe('image/png');
    expect((await uploads[1]?.request.arrayBuffer())?.byteLength).toBe(7);
    expect(uploads[1]?.request.headers.get('Content-Type')).toBe('image/webp');
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
    // The server order (uploads last, in order) is already the wanted one.
    expect(api.calls(ORDER)).toHaveLength(0);
  });

  it('only_removed_photos_delete', async () => {
    const api = mockApi({ [del(B.id)]: [empty()] });
    const progress = vi.fn();

    const result = await syncPhotos(
      LISTING,
      [A, B, C],
      [storedPhoto(A.id), storedPhoto(C.id)],
      progress,
    );

    expect(result).toEqual({ failed: 0, unauthenticated: false });
    expect(api.calls(del(B.id))).toHaveLength(1);
    expect(api.calls(UPLOAD)).toHaveLength(0);
    expect(api.calls(ORDER)).toHaveLength(0);
    expect(progress).not.toHaveBeenCalled();
  });

  it('reorder_only', async () => {
    const api = mockApi({ [ORDER]: [json([B, A])] });

    const result = await syncPhotos(
      LISTING,
      [A, B],
      [storedPhoto(B.id), storedPhoto(A.id)],
      vi.fn(),
    );

    expect(result).toEqual({ failed: 0, unauthenticated: false });
    expect(api.calls(ORDER).map((c) => c.body)).toEqual([{ photo_ids: [B.id, A.id] }]);
    expect(api.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a_failed_upload_counts_and_the_rest_goes_on', async () => {
    const api = mockApi({
      [UPLOAD]: [json({ detail: 'photo_storage_unavailable' }, 503), json(N2, 201)],
      [ORDER]: [json([N2, A])],
    });

    // The first new photo fails; the second is uploaded and goes before A as wanted.
    const result = await syncPhotos(
      LISTING,
      [A],
      [newPhoto('one'), newPhoto('two'), storedPhoto(A.id)],
      vi.fn(),
    );

    expect(result).toEqual({ failed: 1, unauthenticated: false });
    expect(api.calls(UPLOAD)).toHaveLength(2);
    expect(api.calls(ORDER).map((c) => c.body)).toEqual([{ photo_ids: [N2.id, A.id] }]);

    // A network error counts the same.
    vi.unstubAllGlobals();
    const again = mockApi({ [UPLOAD]: [networkError, json(N2, 201)] });
    expect(await syncPhotos(LISTING, [], [newPhoto('one'), newPhoto('two')], vi.fn())).toEqual({
      failed: 1,
      unauthenticated: false,
    });
    expect(again.calls(UPLOAD)).toHaveLength(2);
    expect(again.calls(ORDER)).toHaveLength(0);
  });

  it('a_failed_delete_then_a_reorder', async () => {
    const api = mockApi({
      [del(B.id)]: [json({ detail: 'boom' }, 503)],
      [ORDER]: [json([C, A, B])],
    });

    const result = await syncPhotos(
      LISTING,
      [A, B, C],
      [storedPhoto(C.id), storedPhoto(A.id)],
      vi.fn(),
    );

    // B is still there: it goes last, so the reorder names exactly the listing's photos.
    expect(result).toEqual({ failed: 1, unauthenticated: false });
    expect(api.calls(ORDER).map((c) => c.body)).toEqual([{ photo_ids: [C.id, A.id, B.id] }]);
  });

  it('a_deleted_photo_already_gone_is_not_a_failure', async () => {
    const api = mockApi({ [del(B.id)]: [json({ detail: 'not_found' }, 404)] });

    const result = await syncPhotos(LISTING, [A, B], [storedPhoto(A.id)], vi.fn());

    expect(result).toEqual({ failed: 0, unauthenticated: false });
    expect(api.calls(ORDER)).toHaveLength(0);
  });

  it('a_failed_reorder_counts_one', async () => {
    mockApi({ [ORDER]: [json({ detail: 'photo_order_mismatch' }, 422)] });

    const result = await syncPhotos(
      LISTING,
      [A, B],
      [storedPhoto(B.id), storedPhoto(A.id)],
      vi.fn(),
    );

    expect(result).toEqual({ failed: 1, unauthenticated: false });
  });

  it('a_401_midway_stops', async () => {
    const api = mockApi({
      [del(B.id)]: [empty()],
      [UPLOAD]: [json(N1, 201), json({ detail: 'unauthenticated' }, 401), json(N2, 201)],
    });

    const result = await syncPhotos(
      LISTING,
      [A, B],
      [newPhoto('one'), newPhoto('two'), newPhoto('three'), storedPhoto(A.id)],
      vi.fn(),
    );

    expect(result).toEqual({ failed: 0, unauthenticated: true });
    expect(api.calls(UPLOAD)).toHaveLength(2);
    expect(api.calls(ORDER)).toHaveLength(0);

    // A 401 on a delete stops before any upload.
    vi.unstubAllGlobals();
    const early = mockApi({ [del(B.id)]: [json({ detail: 'unauthenticated' }, 401)] });
    expect(
      await syncPhotos(LISTING, [A, B], [storedPhoto(A.id), newPhoto('one')], vi.fn()),
    ).toEqual({
      failed: 0,
      unauthenticated: true,
    });
    expect(early.calls(UPLOAD)).toHaveLength(0);
  });

  it('a_short_retry_after_is_waited_out', async () => {
    // "One upload at a time" (0010d) answers 429 with Retry-After: 5: wait and send it again.
    const api = mockApi({ [UPLOAD]: [rateLimited('5'), json(N1, 201)] });
    const sleep = noSleep();

    const result = await syncPhotos(LISTING, [], [newPhoto('one')], vi.fn(), { sleep });

    expect(result).toEqual({ failed: 0, unauthenticated: false });
    expect(sleep.mock.calls).toEqual([[5000]]);
    expect(api.calls(UPLOAD)).toHaveLength(2);

    // At most two retries: still 429 after them is one failure, and the sync goes on.
    vi.unstubAllGlobals();
    const busy = mockApi({
      [UPLOAD]: [rateLimited('5'), rateLimited('5'), rateLimited('5'), json(N2, 201)],
    });
    const waits = noSleep();
    expect(
      await syncPhotos(LISTING, [], [newPhoto('one'), newPhoto('two')], vi.fn(), {
        sleep: waits,
      }),
    ).toEqual({ failed: 1, unauthenticated: false });
    expect(waits).toHaveBeenCalledTimes(2);
    expect(busy.calls(UPLOAD)).toHaveLength(4);
  });

  it('a_long_or_missing_retry_after_fails_at_once', async () => {
    // The hourly limit: Retry-After 3600 is not waited for.
    const api = mockApi({ [UPLOAD]: [rateLimited('3600')] });
    const sleep = noSleep();

    const result = await syncPhotos(LISTING, [], [newPhoto('one')], vi.fn(), { sleep });

    expect(result).toEqual({ failed: 1, unauthenticated: false });
    expect(sleep).not.toHaveBeenCalled();
    expect(api.calls(UPLOAD)).toHaveLength(1);

    // No Retry-After at all: the same.
    vi.unstubAllGlobals();
    const bare = mockApi({ [UPLOAD]: [json({ detail: 'rate_limited' }, 429)] });
    expect(await syncPhotos(LISTING, [], [newPhoto('one')], vi.fn(), { sleep })).toEqual({
      failed: 1,
      unauthenticated: false,
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(bare.calls(UPLOAD)).toHaveLength(1);
  });
});
