import { describe, expect, it } from 'vitest';

import { profileHref } from '../links';

describe('profileHref', () => {
  it('ac12_profile_href_repeats_section_and_encodes_next', () => {
    expect(profileHref('/listings/abc', 'looking')).toBe(
      '/me/profile?section=looking&next=%2Flistings%2Fabc',
    );
    expect(profileHref('/listings/abc', 'about', 'looking')).toBe(
      '/me/profile?section=about&section=looking&next=%2Flistings%2Fabc',
    );
    expect(profileHref('/me/likes')).toBe('/me/profile?next=%2Fme%2Flikes');
    // `next` is encoded whole: its own query cannot add parameters to the profile's.
    expect(profileHref('/listings/abc?x=1&section=other', 'about')).toBe(
      '/me/profile?section=about&next=%2Flistings%2Fabc%3Fx%3D1%26section%3Dother',
    );
  });
});
