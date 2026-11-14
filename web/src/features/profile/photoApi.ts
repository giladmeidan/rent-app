import { api, type UserOut } from '../../api/client';
import { ApiError } from '../listings/api';

/** Sets (or replaces) the caller's own photo (spec 0010j). The body is the image itself, not
 * multipart. Answers the caller's account with its new `photo_url`. 401, 413, 415, 429 (with
 * `retryAfter`: one upload at a time) and 503 throw. */
export async function uploadMyPhoto(file: File): Promise<UserOut> {
  const { data, error, response } = await api.PUT('/me/photo', {
    // The schema's `format: binary` is generated as `string`; the body is the `File` as is.
    body: file as unknown as string,
    bodySerializer: (body) => body,
    headers: { 'Content-Type': file.type },
  });
  if (data === undefined) {
    throw new ApiError('PUT', '/me/photo', response.status, error, response.headers);
  }
  return data;
}

/** Removes the caller's own photo (204, also without one). 401 throws. */
export async function deleteMyPhoto(): Promise<void> {
  const { error, response } = await api.DELETE('/me/photo');
  if (!response.ok) {
    throw new ApiError('DELETE', '/me/photo', response.status, error, response.headers);
  }
}
