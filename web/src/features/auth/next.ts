// Any ASCII control character (U+0000-U+001F, U+007F), a space or a backslash.
const UNSAFE = /[\u0000-\u001f\u007f \\]/;

/**
 * A `?next=` return path, or `'/'` when it is not a plain same-origin path: it must start with
 * exactly one `/` (not `//` or `/\`, which browsers read as another host) and hold no control
 * character, space or backslash anywhere (FOLLOWUPS 0001b · routes.tsx). `navigate()` only ever
 * receives this function's output.
 */
export function safeNext(raw: string | null): string {
  if (raw === null || !raw.startsWith('/')) return '/';
  const second = raw.charAt(1);
  if (second === '/' || second === '\\') return '/';
  if (UNSAFE.test(raw)) return '/';
  return raw;
}
