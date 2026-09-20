/**
 * Deriving the short reference sent to a payment terminal.
 *
 * Terminal protocols often cap the merchant reference at a small number of
 * characters — question A2 in the provider questionnaire. So the full intent
 * identifier usually cannot be sent, and something shorter must be derived.
 *
 * **How that shortening is done is a correctness question, not a formatting one.**
 *
 * The obvious approach — take the first N characters of the identifier — is
 * unsafe for UUIDv7, because its leading characters are a timestamp. Two intents
 * created in the same millisecond share that prefix entirely, so they receive the
 * SAME payment reference. The consequences are exactly what NFR-004 forbids: a
 * reconciliation query for one order returns the other order's outcome, and a
 * payment is attached to the wrong order.
 *
 * This spike hit that bug, which is why the mechanism now has its own module and
 * its own tests.
 */
import { createHash } from 'node:crypto';

/** Crockford base32: no I, L, O or U, so a reference read aloud or typed off a printed slip is unambiguous. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Derives a short, collision-resistant reference from a full identifier.
 *
 * Hashes first, so every bit of the identifier contributes to every output
 * character. Truncating the hash costs entropy but never structure — unlike
 * truncating the identifier, which discards precisely the bits that distinguish
 * two identifiers minted at the same instant.
 */
export function deriveReference(intentId: string, width: number): string {
  if (width < 6) throw new Error(`Reference width ${width} is too narrow to be collision-resistant`);
  const digest = createHash('sha256').update(intentId).digest();
  let out = '';
  for (let i = 0; i < width; i++) out += ALPHABET[digest[i]! % ALPHABET.length];
  return out;
}

/**
 * The unsafe derivation, kept so the tests can demonstrate the failure rather
 * than merely assert the fix. Never use this.
 */
export function unsafePrefixReference(intentId: string, width: number): string {
  return intentId.replace(/-/g, '').slice(0, width).toUpperCase();
}

/**
 * Rough collision probability for a given width and transaction count, by the
 * birthday bound. Useful when an acquirer states a field width and somebody has
 * to judge whether it is survivable.
 */
export function collisionProbability(width: number, transactions: number): number {
  const space = Math.pow(ALPHABET.length, width);
  const exponent = -(transactions * (transactions - 1)) / (2 * space);
  return 1 - Math.exp(exponent);
}
