import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPushBatch, resumePoint, PUSH_MAX_EVENTS, type AckHello } from '../src/sync/protocol.ts';
import { payloadHash, GENESIS_HASH, type ChainedEvent } from '../src/events/envelope.ts';

function ev(seq: number, payloadSize = 10): ChainedEvent {
  const payload = { pad: 'x'.repeat(payloadSize) };
  return {
    event_id: `evt-${seq}`, device_id: 'dev-a', device_seq: seq, hlc: `h${seq}`,
    occurred_at: '2026-09-17T10:00:00Z', tz_name: 'Asia/Riyadh', business_date: '2026-09-17',
    branch_id: 'br-1', shift_id: null, aggregate_type: 'order', aggregate_id: 'ord-1',
    event_type: 'OrderLineAdded', schema_version: 1, payload,
    correlation_id: null, causation_id: null, actor_type: 'cashier', actor_id: null,
    payload_hash: payloadHash(payload), prev_hash: GENESIS_HASH,
  };
}

const ack = (over: Partial<AckHello> = {}): AckHello => ({
  server_now: '2026-09-17T10:00:00Z', epoch: 1, acked_through_seq: 0, want_from_seq: 1,
  config_version: 'v1', backoff_hint_ms: 0, resume_token: 'tok', ...over,
});

test('a batch starts at want_from_seq and is contiguous', () => {
  const batch = selectPushBatch([ev(1), ev(2), ev(3)], 1);
  assert.deepEqual(batch.map((e) => e.device_seq), [1, 2, 3]);
});

test('a batch skips events already acknowledged', () => {
  const batch = selectPushBatch([ev(1), ev(2), ev(3)], 3);
  assert.deepEqual(batch.map((e) => e.device_seq), [3]);
});

test('a batch stops at a gap rather than pushing past it', () => {
  // A gap would break the prefix guarantee that makes acknowledgement cheap.
  const batch = selectPushBatch([ev(1), ev(2), ev(5), ev(6)], 1);
  assert.deepEqual(batch.map((e) => e.device_seq), [1, 2]);
});

test('a batch honours the event-count cap', () => {
  const pending = Array.from({ length: PUSH_MAX_EVENTS + 50 }, (_, i) => ev(i + 1));
  assert.equal(selectPushBatch(pending, 1).length, PUSH_MAX_EVENTS);
});

test('a batch honours the byte cap', () => {
  const pending = Array.from({ length: 20 }, (_, i) => ev(i + 1, 1000));
  const batch = selectPushBatch(pending, 1, 500, 5000);
  assert.ok(batch.length < 20 && batch.length > 0);
});

test('an oversized single event still goes, rather than wedging the queue', () => {
  // If the byte cap could exclude every event, one large event would block
  // synchronisation permanently.
  const batch = selectPushBatch([ev(1, 100_000)], 1, 500, 10);
  assert.equal(batch.length, 1);
});

test('events arriving out of order are still batched in sequence order', () => {
  const batch = selectPushBatch([ev(3), ev(1), ev(2)], 1);
  assert.deepEqual(batch.map((e) => e.device_seq), [1, 2, 3]);
});

test('nothing to push yields an empty batch', () => {
  assert.deepEqual(selectPushBatch([], 1), []);
  assert.deepEqual(selectPushBatch([ev(1)], 5), []);
});

test('resume point trusts the higher of want_from and acked+1', () => {
  // This is what lets a device that timed out mid-push simply resume, with no
  // reconciliation protocol on the sync channel at all.
  assert.equal(resumePoint(ack({ acked_through_seq: 10, want_from_seq: 11 })), 11);
  assert.equal(resumePoint(ack({ acked_through_seq: 10, want_from_seq: 5 })), 11);
  assert.equal(resumePoint(ack({ acked_through_seq: 0, want_from_seq: 1 })), 1);
});
