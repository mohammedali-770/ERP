import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJson, payloadHash, chainHash, verifyChain, GENESIS_HASH, type ChainedEvent,
} from '../src/events/envelope.ts';

function ev(seq: number, payload: Record<string, unknown>, prev: string): ChainedEvent {
  return {
    event_id: `evt-${seq}`, device_id: 'dev-a', device_seq: seq,
    hlc: `00000000000${seq}:0000:dev-a`, occurred_at: '2026-09-17T10:00:00Z',
    tz_name: 'Asia/Riyadh', business_date: '2026-09-17', branch_id: 'br-1', shift_id: 'sh-1',
    aggregate_type: 'order', aggregate_id: 'ord-1', event_type: 'OrderLineAdded',
    schema_version: 1, payload, correlation_id: null, causation_id: null,
    actor_type: 'cashier', actor_id: 'emp-1',
    payload_hash: payloadHash(payload), prev_hash: prev,
  };
}

function chainOf(payloads: Record<string, unknown>[]): ChainedEvent[] {
  const out: ChainedEvent[] = [];
  let prev = GENESIS_HASH;
  payloads.forEach((p, i) => {
    const e = ev(i, p, prev);
    out.push(e);
    prev = chainHash(e.prev_hash, e.payload_hash);
  });
  return out;
}

test('canonical json sorts keys so two devices agree byte-for-byte', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('canonical json sorts nested keys too', () => {
  assert.equal(canonicalJson({ z: { y: 1, x: 2 } }), '{"z":{"x":2,"y":1}}');
});

test('canonical json preserves array order', () => {
  // Arrays are ordered data; sorting them would change meaning.
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
});

test('canonical json drops undefined but keeps null', () => {
  assert.equal(canonicalJson({ a: undefined, b: null }), '{"b":null}');
});

test('payload hash is stable across key ordering', () => {
  assert.equal(payloadHash({ qty: 2, item: 'x' }), payloadHash({ item: 'x', qty: 2 }));
});

test('payload hash changes when any value changes', () => {
  assert.notEqual(payloadHash({ qty: 2 }), payloadHash({ qty: 3 }));
});

test('a well-formed chain verifies', () => {
  const chain = chainOf([{ qty: 1 }, { qty: 2 }, { qty: 3 }]);
  const result = verifyChain(chain);
  assert.equal(result.ok, true, JSON.stringify(result.failures));
});

test('verification survives out-of-order delivery', () => {
  // Events can arrive reordered; the chain is defined by device_seq, not arrival.
  const chain = chainOf([{ qty: 1 }, { qty: 2 }, { qty: 3 }]);
  assert.equal(verifyChain([chain[2]!, chain[0]!, chain[1]!]).ok, true);
});

test('a tampered payload is detected', () => {
  const chain = chainOf([{ qty: 1 }, { qty: 2 }, { qty: 3 }]);
  // Someone edits an amount in the stored event but leaves the hash alone.
  const tampered = [...chain];
  tampered[1] = { ...chain[1]!, payload: { qty: 99 } };
  const result = verifyChain(tampered);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.reason.includes('payload hash')));
});

test('a tampered payload WITH a recomputed hash is still detected by the chain link', () => {
  // The more sophisticated attack: recompute the payload hash to match the edit.
  // The chain link to the following event is what catches it.
  const chain = chainOf([{ qty: 1 }, { qty: 2 }, { qty: 3 }]);
  const forged = { ...chain[1]!, payload: { qty: 99 }, payload_hash: payloadHash({ qty: 99 }) };
  const result = verifyChain([chain[0]!, forged, chain[2]!]);
  assert.equal(result.ok, false, 'a forged event with a matching hash went undetected');
  assert.ok(result.failures.some((f) => f.reason.includes('chain link')));
});

test('a removed event is detected as a sequence gap', () => {
  const chain = chainOf([{ qty: 1 }, { qty: 2 }, { qty: 3 }]);
  const result = verifyChain([chain[0]!, chain[2]!]);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.reason.includes('sequence gap')));
});

test('an empty chain is trivially valid', () => {
  assert.equal(verifyChain([]).ok, true);
});
