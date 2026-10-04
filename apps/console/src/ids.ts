/**
 * Identifiers the console mints: UUIDv7, as ADR-0005 requires of every business object
 * and decision — minted by the creating device, time-ordered so it indexes without the
 * random-UUID scatter.
 *
 * A form mints its ids ONCE, when it opens (`FormIds`), and sends the same ones on every
 * attempt. That is what makes a retry safe: if the answer to the first attempt was lost,
 * the second arrives with the same decision id and the database answers
 * `already_recorded` instead of recording the decision twice (0012's
 * erp.assert_item_decision_is_new()). Minting a fresh id per click would turn every
 * double-click on a slow connection into two decisions.
 *
 * Requirements: INV-002 · ADR-0005
 */

export type Random = (bytes: Uint8Array) => Uint8Array;

const defaultRandom: Random = (bytes) => globalThis.crypto.getRandomValues(bytes);

/**
 * RFC 9562 UUIDv7: 48 bits of Unix milliseconds, version 7, 74 random bits, variant 10.
 * `now` and `random` are parameters so a test can pin both.
 */
export function uuidv7(now: number = Date.now(), random: Random = defaultRandom): string {
  if (!Number.isInteger(now) || now < 0 || now > 0xffff_ffff_ffff) throw new RangeError(`not a UUIDv7 time: ${now}`);
  const b = random(new Uint8Array(16));
  // Bytes 0-5: the time, big-endian. Division, not shifts: a shift truncates to 32 bits.
  let t = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = 0x70 | (b[6]! & 0x0f);
  b[8] = 0x80 | (b[8]! & 0x3f);
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A form's ids, minted together and kept until the write succeeds — or is answered
 * `already_recorded`, which is the same success arriving twice. A failure keeps them: a
 * refusal recorded nothing, so the ids are still unused, and a lost answer may have
 * recorded everything, so only the same ids make the next attempt safe.
 */
export function formIds<K extends string>(keys: readonly K[], mint: () => string = () => uuidv7()): Record<K, string> {
  const ids = {} as Record<K, string>;
  for (const k of keys) ids[k] = mint();
  return ids;
}
