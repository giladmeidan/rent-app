import { deleteListingPhoto, reorderListingPhotos, uploadListingPhoto } from '../photos/api';
import { ApiError, type PhotoOut } from './api';

/** A photo in the wizard (spec 0010e): one the listing already has, or a file chosen here that is
 * uploaded after the publish or save. `url` is the stored `small_url`, or the file's object URL. */
export type WizardPhoto =
  | { kind: 'stored'; id: string; url: string }
  | { kind: 'new'; localId: string; file: File; url: string };

export type SyncResult = {
  /** Deletes, uploads and the reorder that failed (each counts one). */
  failed: number;
  /** A 401 stopped the sync: the session is gone. */
  unauthenticated: boolean;
};

/** `done`: the 1-based photo now uploading, of `total` new photos. */
export type SyncProgress = (done: number, total: number) => void;

export type SyncOptions = {
  /** Waits `ms` before a rate-limited upload is tried again (a real timer unless a test passes
   * its own). */
  sleep?: (ms: number) => Promise<void>;
};

/** A 429 whose `Retry-After` is at most this many seconds (the API's "one upload at a time" slot
 * answers 5) is waited out and tried again, at most `MAX_RETRIES` times. A longer wait (the hourly
 * or daily limit) or none given fails the photo at once. */
const MAX_RETRY_AFTER_S = 10;
const MAX_RETRIES = 2;

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const isUnauthenticated = (error: unknown) => error instanceof ApiError && error.status === 401;

class Unauthenticated extends Error {}

/**
 * Makes the listing's photos on the server what the wizard shows, after the listing is saved:
 * (1) deletes every stored photo not in `wanted`; (2) uploads each new photo, one at a time, in
 * list order; (3) when the server's order (the stored photos kept, then the uploads) differs from
 * the wanted one, sends one reorder with exactly the listing's ids: the wanted ones that exist,
 * in wanted order, then any whose delete failed. A failed step counts one in `failed` and the rest
 * goes on; a 401 stops everything.
 */
export async function syncPhotos(
  listingId: string,
  stored: PhotoOut[],
  wanted: WizardPhoto[],
  onProgress: SyncProgress,
  { sleep = realSleep }: SyncOptions = {},
): Promise<SyncResult> {
  let failed = 0;
  const wantedStored = new Set(
    wanted.flatMap((photo) => (photo.kind === 'stored' ? [photo.id] : [])),
  );
  // The server's photos as this sync leaves them, in the server's order.
  const onServer: string[] = [];
  const deleteFailed: string[] = [];

  async function upload(file: File): Promise<PhotoOut> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await uploadListingPhoto(listingId, file);
      } catch (error) {
        const wait = error instanceof ApiError && error.status === 429 ? error.retryAfter : null;
        if (wait === null || wait > MAX_RETRY_AFTER_S || attempt >= MAX_RETRIES) throw error;
        await sleep(wait * 1000);
      }
    }
  }

  try {
    for (const photo of stored) {
      if (wantedStored.has(photo.id)) {
        onServer.push(photo.id);
        continue;
      }
      try {
        await deleteListingPhoto(listingId, photo.id);
      } catch (error) {
        if (isUnauthenticated(error)) throw new Unauthenticated();
        // A 404 is a photo that is already gone: what the delete wanted.
        if (error instanceof ApiError && error.status === 404) continue;
        failed += 1;
        onServer.push(photo.id);
        deleteFailed.push(photo.id);
      }
    }

    const added = wanted.flatMap((photo) => (photo.kind === 'new' ? [photo] : []));
    const uploaded = new Map<string, string>();
    for (const [index, photo] of added.entries()) {
      onProgress(index + 1, added.length);
      try {
        const out = await upload(photo.file);
        uploaded.set(photo.localId, out.id);
        onServer.push(out.id);
      } catch (error) {
        if (isUnauthenticated(error)) throw new Unauthenticated();
        failed += 1;
      }
    }

    const present = new Set(onServer);
    const target = [
      ...wanted.flatMap((photo) => {
        const id = photo.kind === 'stored' ? photo.id : uploaded.get(photo.localId);
        return id !== undefined && present.has(id) ? [id] : [];
      }),
      ...deleteFailed,
    ];
    if (target.some((id, i) => id !== onServer[i])) {
      try {
        await reorderListingPhotos(listingId, target);
      } catch (error) {
        if (isUnauthenticated(error)) throw new Unauthenticated();
        failed += 1;
      }
    }
  } catch (error) {
    if (error instanceof Unauthenticated) return { failed, unauthenticated: true };
    throw error;
  }
  return { failed, unauthenticated: false };
}
