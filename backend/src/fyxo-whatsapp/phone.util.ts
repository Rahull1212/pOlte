/**
 * Matching a WhatsApp number against a stored one.
 *
 * Fyxo always sends E.164 digits with no "+" (919616926635), while PoliOS
 * stores numbers as they were typed — almost always the 10 local digits
 * (9616926635), because that's what a Cadre gives you and what phone-based
 * login matches on. An exact comparison therefore never matches, which
 * silently made every inbound message look like it came from an unknown
 * number.
 *
 * Rather than migrate stored numbers (and risk breaking login, which uses
 * phone as a unique key), inbound lookups compare the last NATIONAL_DIGITS
 * digits — enough to identify a subscriber within a country, and stable
 * whichever format either side uses.
 */
const NATIONAL_DIGITS = 10;

export function nationalDigits(raw: string): string {
  return (raw ?? "").replace(/\D/g, "").slice(-NATIONAL_DIGITS);
}

/**
 * A Prisma `where` fragment matching a stored phone against an inbound one.
 * `endsWith` rather than equality so "9616926635", "+919616926635" and
 * "919616926635" all resolve to the same user.
 */
export function phoneMatchFilter(inbound: string) {
  return { phone: { endsWith: nationalDigits(inbound) } };
}
