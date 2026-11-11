// The "שותפים בגילך" chip (spec 0007f): computed in the browser from the seeker's own
// `GET /me/profile`; the birth year never leaves it.

/** How far apart (in years) a flatmate may be from the seeker and still count as "your age". */
export const SIMILAR_AGE_YEARS = 5;

/** The API's age rule (0007a): this calendar year (UTC) minus the birth year. */
export function seekerAge(birthYear: number, now: Date = new Date()): number {
  return now.getUTCFullYear() - birthYear;
}

/** True when every listed flatmate is within `SIMILAR_AGE_YEARS` of the seeker; false without a
 * birth year or without any listed age. */
export function flatmatesNearAge(
  birthYear: number | null | undefined,
  ages: readonly number[],
  now: Date = new Date(),
): boolean {
  if (birthYear === null || birthYear === undefined || ages.length === 0) return false;
  const age = seekerAge(birthYear, now);
  return ages.every((flatmate) => Math.abs(flatmate - age) <= SIMILAR_AGE_YEARS);
}
