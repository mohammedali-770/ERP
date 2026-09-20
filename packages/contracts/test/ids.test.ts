import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uuidv7, isUuidv7, timestampOf, __resetMonotonicState } from '../src/ids/uuidv7.ts';
import { hlcZero, hlcNow, hlcMerge, hlcCompare, hlcEncode, hlcDecode } from '../src/ids/hlc.ts';

test('uuidv7 produces well-formed version-7 identifiers', () => {
  __resetMonotonicState();
  for (let i = 0; i < 100; i++) assert.ok(isUuidv7(uuidv7()), 'malformed UUIDv7');
});

test('uuidv7 is unique across a burst', () => {
  __resetMonotonicState();
  const seen = new Set<string>();
  for (let i = 0; i < 20_000; i++) seen.add(uuidv7());
  assert.equal(seen.size, 20_000, 'collision in a 20k burst');
});

test('uuidv7 is monotonically increasing as a string', () => {
  __resetMonotonicState();
  // Time ordering is the reason for choosing v7; if sort order breaks, the
  // indexing rationale in ADR-0005 no longer holds.
  const ids = Array.from({ length: 5000 }, () => uuidv7());
  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted, 'identifiers are not lexicographically ordered');
});

test('uuidv7 stays ordered when the wall clock goes backwards', () => {
  __resetMonotonicState();
  const a = uuidv7(1_700_000_000_000);
  const b = uuidv7(1_699_999_999_000); // NTP correction, or someone changed the clock
  assert.ok(a < b, 'a backwards clock produced a backwards identifier');
});

test('uuidv7 embeds a recoverable timestamp', () => {
  __resetMonotonicState();
  const now = 1_700_000_000_000;
  assert.equal(timestampOf(uuidv7(now)), now);
});

test('uuidv7 survives counter exhaustion within one millisecond', () => {
  __resetMonotonicState();
  const fixed = 1_700_000_000_000;
  const ids = Array.from({ length: 5000 }, () => uuidv7(fixed));
  assert.equal(new Set(ids).size, 5000, 'collision after counter rollover');
  assert.deepEqual(ids, [...ids].sort(), 'ordering lost after counter rollover');
});

test('isUuidv7 rejects other UUID versions', () => {
  assert.equal(isUuidv7('00000000-0000-4000-8000-000000000000'), false); // v4
  assert.equal(isUuidv7('not-a-uuid'), false);
});

test('hlc advances with physical time', () => {
  const a = hlcNow(hlcZero('dev-a'), 1000);
  const b = hlcNow(a, 2000);
  assert.ok(hlcCompare(a, b) < 0);
  assert.equal(b.counter, 0);
});

test('hlc never regresses when the clock stalls or goes backwards', () => {
  const a = hlcNow(hlcZero('dev-a'), 5000);
  const b = hlcNow(a, 5000);     // stalled
  const c = hlcNow(b, 1000);     // went backwards
  assert.ok(hlcCompare(a, b) < 0);
  assert.ok(hlcCompare(b, c) < 0);
  assert.equal(c.millis, 5000, 'clock regressed');
});

test('hlc merge makes the receiver strictly later than the sender', () => {
  // This is the property that makes the ordering causal rather than merely sortable.
  const sender = hlcNow(hlcZero('dev-b'), 9000);
  const receiver = hlcMerge(hlcNow(hlcZero('dev-a'), 1000), sender, 1000);
  assert.ok(hlcCompare(sender, receiver) < 0, 'receiver not strictly after sender');
});

test('hlc breaks ties by device so two devices never collide', () => {
  const a = { millis: 100, counter: 0, deviceId: 'dev-a' };
  const b = { millis: 100, counter: 0, deviceId: 'dev-b' };
  assert.ok(hlcCompare(a, b) < 0);
  assert.ok(hlcCompare(b, a) > 0);
  assert.equal(hlcCompare(a, a), 0);
});

test('hlc encoding sorts lexicographically in the same order as hlcCompare', () => {
  const clocks = [
    { millis: 2, counter: 0, deviceId: 'dev-a' },
    { millis: 10, counter: 0, deviceId: 'dev-a' },
    { millis: 2, counter: 5, deviceId: 'dev-a' },
    { millis: 2, counter: 5, deviceId: 'dev-b' },
  ];
  const byCompare = [...clocks].sort(hlcCompare).map(hlcEncode);
  const byString = [...clocks].map(hlcEncode).sort();
  assert.deepEqual(byString, byCompare, 'encoded order diverges from hlcCompare');
});

test('hlc encode/decode round-trips', () => {
  const h = { millis: 1_700_000_000_000, counter: 42, deviceId: 'dev-a' };
  assert.deepEqual(hlcDecode(hlcEncode(h)), h);
});

test('hlc counter overflow is loud rather than silent', () => {
  let h = { millis: 1000, counter: 0xffff, deviceId: 'dev-a' };
  assert.throws(() => hlcMerge(h, { millis: 1000, counter: 0xffff, deviceId: 'dev-b' }, 1000), /overflow/);
});
