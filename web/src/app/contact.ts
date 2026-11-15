/** The public contact address of the footer, the legal pages and the sign-up block message
 * (spec 0013f). Production sets `VITE_CONTACT_EMAIL` in the web build. */
export const CONTACT_EMAIL: string = import.meta.env.VITE_CONTACT_EMAIL || 'contact@example.com';

/** The address inside a Hebrew sentence: first-strong isolates keep it one left-to-right run, so the
 * punctuation beside it never flips (as `OtpForm` does for the code step's email). */
export const CONTACT_EMAIL_INLINE = `⁨${CONTACT_EMAIL}⁩`;
