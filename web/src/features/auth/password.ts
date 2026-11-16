/** 1–9 characters, counted in code points as the API counts them (spec 0016a: at least 10). An
 * empty value is not "too short": it means no password. */
export function passwordTooShort(password: string): boolean {
  return password !== '' && [...password].length < 10;
}
