import type { Role } from '../../api/client';

/** A signed-in person's home: an owner's "המודעות שלי", a seeker's search (spec 0009a Q4). */
export function homeFor(role: Role): string {
  return role === 'owner' ? '/me/listings' : '/search';
}
