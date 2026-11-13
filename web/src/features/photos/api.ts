import { api } from '../../api/client';
import { ApiError, type PhotoOut } from '../listings/api';

const UPLOAD = '/listings/{listing_id}/photos';

/** Adds `file` last on the caller's listing (spec 0010d). The body is the image itself, not
 * multipart. 401, 404, 409 `photo_limit`, 413, 415, 429 (with `retryAfter`) and 503 throw. */
export async function uploadListingPhoto(listingId: string, file: File): Promise<PhotoOut> {
  const { data, error, response } = await api.POST(UPLOAD, {
    params: { path: { listing_id: listingId } },
    // The schema's `format: binary` is generated as `string`; the body is the `File` as is.
    body: file as unknown as string,
    bodySerializer: (body) => body,
    headers: { 'Content-Type': file.type },
  });
  if (data === undefined) {
    throw new ApiError('POST', UPLOAD, response.status, error, response.headers);
  }
  return data;
}

/** Deletes one photo of the caller's listing (204). 401 and 404 throw. */
export async function deleteListingPhoto(listingId: string, photoId: string): Promise<void> {
  const { error, response } = await api.DELETE('/listings/{listing_id}/photos/{photo_id}', {
    params: { path: { listing_id: listingId, photo_id: photoId } },
  });
  if (!response.ok) {
    throw new ApiError(
      'DELETE',
      '/listings/{id}/photos/{photo_id}',
      response.status,
      error,
      response.headers,
    );
  }
}

/** Sets the photos' order (the first is the cover); `ids` must be exactly the listing's photos
 * (422 `photo_order_mismatch` otherwise). Returns them in that order. */
export async function reorderListingPhotos(listingId: string, ids: string[]): Promise<PhotoOut[]> {
  const { data, error, response } = await api.PUT('/listings/{listing_id}/photos/order', {
    params: { path: { listing_id: listingId } },
    body: { photo_ids: ids },
  });
  if (data === undefined) {
    throw new ApiError(
      'PUT',
      '/listings/{id}/photos/order',
      response.status,
      error,
      response.headers,
    );
  }
  return data;
}
