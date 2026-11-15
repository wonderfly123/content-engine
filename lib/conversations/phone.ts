/** Phone numbers: one shape (E.164) everywhere, and never written out in full in logs. */

/** Normalise a phone number to E.164 (+16195550123). Returns null when it cannot be one. */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (hasPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** "+16195550123" -> "•••0123", for logs and the Settings card. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `•••${digits.slice(-4)}`;
}
