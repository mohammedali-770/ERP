import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveReference, unsafePrefixReference, collisionProbability } from '../src/reference.ts';
import { uuidv7, __resetMonotonicState } from '@firsttaste/contracts';

test('truncating a UUIDv7 collides for identifiers minted in the same millisecond', () => {
  // The bug this spike found. UUIDv7 leads with a timestamp, so a prefix keeps
  // the time and discards exactly the bits that distinguish two identifiers.
  __resetMonotonicState();
  const fixed = 1_700_000_000_000;
  const ids = Array.from({ length: 50 }, () => uuidv7(fixed));
  const truncated = new Set(ids.map((id) => unsafePrefixReference(id, 12)));
  assert.ok(truncated.size < ids.length, 'expected truncation to collide, which is why it is unsafe');
});

test('hashing the same identifiers does not collide', () => {
  __resetMonotonicState();
  const fixed = 1_700_000_000_000;
  const ids = Array.from({ length: 50 }, () => uuidv7(fixed));
  const hashed = new Set(ids.map((id) => deriveReference(id, 12)));
  assert.equal(hashed.size, ids.length);
});

test('derived references survive a large batch without collision', () => {
  __resetMonotonicState();
  const ids = Array.from({ length: 50_000 }, (_, i) => uuidv7(1_700_000_000_000 + i));
  const refs = new Set(ids.map((id) => deriveReference(id, 12)));
  assert.equal(refs.size, ids.length, 'collision in 50k references at width 12');
});

test('derivation is deterministic — a retry reuses the same reference', () => {
  // Load-bearing: the whole protocol depends on a retry presenting the SAME
  // reference so the provider and our records agree on what to look up.
  const id = uuidv7(1_700_000_000_000);
  assert.equal(deriveReference(id, 12), deriveReference(id, 12));
});

test('derivation respects the requested width', () => {
  const id = uuidv7(1_700_000_000_000);
  for (const width of [6, 8, 12, 16, 20]) {
    assert.equal(deriveReference(id, width).length, width);
  }
});

test('the alphabet avoids characters confused when read from a printed slip', () => {
  __resetMonotonicState();
  const refs = Array.from({ length: 500 }, (_, i) => deriveReference(uuidv7(1_700_000_000_000 + i), 16));
  for (const ref of refs) {
    assert.doesNotMatch(ref, /[ILOU]/, `${ref} contains a character easily misread`);
  }
});

test('a width too narrow to be safe is rejected rather than quietly used', () => {
  assert.throws(() => deriveReference(uuidv7(), 4), /too narrow/);
});

test('collision probability rises sharply as the field narrows', () => {
  // Useful when an acquirer states a field width and somebody must judge it.
  const at1m = (w: number): number => collisionProbability(w, 1_000_000);
  assert.ok(at1m(6) > at1m(10), 'narrower fields must not look safer');
  assert.ok(at1m(16) < 1e-6, 'width 16 should be comfortable at a million transactions');
});
