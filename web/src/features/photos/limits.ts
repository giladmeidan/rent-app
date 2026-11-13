// The photo limits (PRODUCT.md Q11), mirroring the API's `MAX_LISTING_PHOTOS`, `MAX_PHOTO_BYTES`
// and accepted formats in `api/app/services/photos.py` (spec 0010d). The API checks every upload
// again; these only save a wasted upload.

export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** The file input's `accept`. */
export const PHOTO_ACCEPT = PHOTO_TYPES.join(',');

/** Why a chosen file cannot be uploaded (`type`: not JPEG / PNG / WebP; `size`: over 8 MB), or
 * null. */
export function checkFile(file: File): 'type' | 'size' | null {
  if (!PHOTO_TYPES.includes(file.type)) return 'type';
  if (file.size > MAX_PHOTO_BYTES) return 'size';
  return null;
}
