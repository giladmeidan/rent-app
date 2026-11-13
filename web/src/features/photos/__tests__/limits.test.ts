import { describe, expect, it } from 'vitest';

import { checkFile, MAX_PHOTO_BYTES, PHOTO_ACCEPT } from '../limits';

/** A file of `size` bytes and `type`, without allocating the bytes. */
function fileOf(type: string, size: number): File {
  const file = new File(['x'], 'photo', { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('photo limits', () => {
  it('checkFile', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(checkFile(fileOf(type, 1000)), type).toBeNull();
      expect(checkFile(fileOf(type, MAX_PHOTO_BYTES)), type).toBeNull();
      expect(checkFile(fileOf(type, MAX_PHOTO_BYTES + 1)), type).toBe('size');
    }
    // The type is checked first: a large GIF is a type problem.
    for (const type of ['image/gif', 'image/heic', 'application/pdf', '']) {
      expect(checkFile(fileOf(type, 1000)), type).toBe('type');
      expect(checkFile(fileOf(type, MAX_PHOTO_BYTES + 1)), type).toBe('type');
    }
    expect(PHOTO_ACCEPT).toBe('image/jpeg,image/png,image/webp');
  });
});
