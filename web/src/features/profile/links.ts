/** The profile's room section, returning to `next` after a save (0007f's apply gate). */
export function roomSectionHref(next: string): string {
  return `/me/profile?section=room&next=${encodeURIComponent(next)}`;
}
