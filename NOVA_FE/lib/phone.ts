// Phone helpers for Bulgarian mobile numbers.
//
// UI shows a fixed "BG +359" prefix and the user types the rest of the number.
// We accept digits and spaces only, drop a leading 0, and expect 9 digits.
// The value sent to the backend is always +359XXXXXXXXX.

/** Keep only digits and spaces — used to filter the raw input as the user types. */
export function sanitizePhoneInput(raw: string): string {
  return raw.replace(/[^\d ]/g, "");
}

/** Strip everything but digits and drop a single leading 0 (e.g. "0888" -> "888"). */
export function normalizeDigits(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits;
}

/** A valid Bulgarian mobile (without the leading 0) has exactly 9 digits. */
export function isValidPhone(raw: string): boolean {
  return normalizeDigits(raw).length === 9;
}

/** Produce the full E.164 number to send to the backend. */
export function toE164(raw: string): string {
  return "+359" + normalizeDigits(raw);
}
