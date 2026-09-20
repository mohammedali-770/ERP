/**
 * Hybrid logical clock.
 *
 * Device wall clocks are untrusted: an iPad's clock can be wrong, can jump when
 * NTP corrects it, and can be changed by a person. An HLC gives a total order
 * that never moves backwards and that respects any communication which actually
 * happened between devices.
 *
 * See docs/architecture/core-transaction-design.md §2 and I-6.
 */

export interface Hlc {
  /** Physical time in milliseconds. */
  readonly millis: number;
  /** Logical counter, disambiguating events within one millisecond. */
  readonly counter: number;
  /** Tie-breaker, so two devices never produce an identical HLC. */
  readonly deviceId: string;
}

const MAX_COUNTER = 0xffff;

export function hlcZero(deviceId: string): Hlc {
  return { millis: 0, counter: 0, deviceId };
}

/** Advances the clock for a locally created event. */
export function hlcNow(previous: Hlc, physicalNow: number): Hlc {
  if (physicalNow > previous.millis) {
    return { millis: physicalNow, counter: 0, deviceId: previous.deviceId };
  }
  // Wall clock stalled or went backwards. Hold our logical position and advance
  // the counter, so the clock never regresses.
  return { millis: previous.millis, counter: previous.counter + 1, deviceId: previous.deviceId };
}

/**
 * Merges a remote clock on receipt. This is what makes the order causal rather
 * than merely sortable: after receiving an event, our clock is strictly greater
 * than the sender's was when it sent.
 */
export function hlcMerge(local: Hlc, remote: Hlc, physicalNow: number): Hlc {
  const millis = Math.max(local.millis, remote.millis, physicalNow);

  let counter: number;
  if (millis === local.millis && millis === remote.millis) {
    counter = Math.max(local.counter, remote.counter) + 1;
  } else if (millis === local.millis) {
    counter = local.counter + 1;
  } else if (millis === remote.millis) {
    counter = remote.counter + 1;
  } else {
    // Physical time advanced past both; the counter can reset.
    counter = 0;
  }

  if (counter > MAX_COUNTER) {
    throw new Error(
      `HLC counter overflow at ${millis}. This means the wall clock has been stalled ` +
      `for an implausible period; investigate the device clock rather than widening the counter.`,
    );
  }
  return { millis, counter, deviceId: local.deviceId };
}

export function hlcCompare(a: Hlc, b: Hlc): number {
  if (a.millis !== b.millis) return a.millis < b.millis ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.deviceId === b.deviceId) return 0;
  return a.deviceId < b.deviceId ? -1 : 1;
}

/** Fixed-width so lexicographic string order matches hlcCompare. */
export function hlcEncode(h: Hlc): string {
  return `${h.millis.toString(16).padStart(12, '0')}:${h.counter.toString(16).padStart(4, '0')}:${h.deviceId}`;
}

export function hlcDecode(encoded: string): Hlc {
  const parts = encoded.split(':');
  if (parts.length < 3) throw new Error(`Malformed HLC: ${encoded}`);
  return {
    millis: parseInt(parts[0]!, 16),
    counter: parseInt(parts[1]!, 16),
    deviceId: parts.slice(2).join(':'),
  };
}
