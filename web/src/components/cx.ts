/** Joins the truthy class parts with one space. No merging: a state swaps its class, never appends. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
