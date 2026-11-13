/** A part of the profile page (0010c): "עליי" or "מה מחפשים". */
export type ProfileSection = 'about' | 'looking';

/** The profile page with the parts in `open` switched on (the first one focused), returning to
 * `next` after a save: `/me/profile?section=about&section=looking&next=…`. */
export function profileHref(next: string, ...open: ProfileSection[]): string {
  const sections = open.map((section) => `section=${section}&`).join('');
  return `/me/profile?${sections}next=${encodeURIComponent(next)}`;
}
