// Fixtures for the auth screens (spec 0009m, `auth.screens.ts`): what the visitor types and what
// the API answers. Every value is an obvious placeholder; no code here is ever sent by email.

/** `GET /me` for a visitor who is not signed in. */
export const ANONYMOUS = { status: 401, body: { detail: 'unauthenticated' } } as const;

export const EMAIL = 'dana@example.com';
export const NAME = 'דנה'; // "דנה"
/** One character: under the 2–40 the form asks for. */
export const SHORT_NAME = 'א'; // "א"
export const CODE = '123456';

/** How the API answers one call: a status and a body (204 has none), or a dropped connection. */
export type Answer = { status: number; body?: unknown } | 'abort';

export const SENT: Answer = { status: 204 };
/** The API refuses the address (a validation 422). */
export const INVALID_EMAIL: Answer = {
  status: 422,
  body: { detail: [{ loc: ['body', 'email'], msg: 'bad', type: 'value_error' }] },
};
export const TOO_MANY: Answer = { status: 429, body: { detail: 'rate_limited' } };
export const NETWORK_DOWN: Answer = 'abort';
export const WRONG_CODE: Answer = { status: 401, body: { detail: 'invalid_code' } };
export const PROFILE_REQUIRED: Answer = { status: 422, body: { detail: 'profile_required' } };
