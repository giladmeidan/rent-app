import { describe, expect, it } from 'vitest';

import { roomSectionHref } from '../links';

describe('roomSectionHref', () => {
  it('ac8_room_section_href', () => {
    expect(roomSectionHref('/listings/abc')).toBe(
      '/me/profile?section=room&next=%2Flistings%2Fabc',
    );
    // `next` is encoded whole: its own query cannot add parameters to the profile's.
    expect(roomSectionHref('/listings/abc?x=1&section=other')).toBe(
      '/me/profile?section=room&next=%2Flistings%2Fabc%3Fx%3D1%26section%3Dother',
    );
  });
});
