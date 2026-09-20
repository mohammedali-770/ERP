/**
 * UUIDv7 generation (RFC 9562).
 *
 * Time-ordered identifiers, minted at the edge. See ADR-0005 and
 * docs/architecture/core-transaction-design.md §1.
 *
 * Time-ordering matters for two reasons: the identifiers index without the
 * random-UUID page-split behaviour at sustained load, and a sorted list of
 * identifiers is roughly creation order, which makes debugging a branch's event
 * stream tractable.
 */
import { randomBytes } from 'node:crypto';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Monotonic guard: two calls in the same millisecond must not collide. */
let lastMillis = -1;
let lastCounter = 0;

/**
 * Mints a UUIDv7. Within a single millisecond a 12-bit counter keeps values
 * strictly increasing, so ordering holds even at burst rates far above anything
 * a branch produces.
 */
export function uuidv7(now: number = Date.now()): string {
  if (now === lastMillis) {
    lastCounter += 1;
    // Counter exhausted inside one millisecond: borrow from the next. Callers
    // never see a duplicate or a value that goes backwards.
    if (lastCounter > 0xfff) {
      lastMillis = now + 1;
      lastCounter = 0;
    }
  } else if (now > lastMillis) {
    lastMillis = now;
    lastCounter = 0;
  } else {
    // Wall clock moved backwards (NTP correction, manual change). Keep our own
    // monotonic position rather than minting an out-of-order identifier.
    lastCounter += 1;
  }

  const bytes = randomBytes(16);
  const ms = lastMillis;

  // 48-bit big-endian millisecond timestamp.
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;

  // Version 7 in the high nibble of byte 6, then the 12-bit counter.
  bytes[6] = 0x70 | ((lastCounter >> 8) & 0x0f);
  bytes[7] = lastCounter & 0xff;

  // RFC 9562 variant bits.
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuidv7(value: string): boolean {
  return UUID_V7.test(value);
}

/** Extracts the embedded millisecond timestamp. */
export function timestampOf(uuid: string): number {
  if (!isUuidv7(uuid)) throw new Error(`Not a UUIDv7: ${uuid}`);
  return parseInt(uuid.slice(0, 8) + uuid.slice(9, 13), 16);
}

/** Resets the monotonic guard. Test-only. */
export function __resetMonotonicState(): void {
  lastMillis = -1;
  lastCounter = 0;
}
