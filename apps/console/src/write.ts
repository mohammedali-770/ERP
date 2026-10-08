/**
 * One write form's lifecycle on a detail page, from Save to an answer it can trust.
 *
 * Plain TypeScript with no React in it, so test/write.test.ts drives every path under
 * Node; screens/useWrite.tsx is the hook that gives it React state. Every sub-form on
 * the item, supplier, facility and transfer-price pages goes through it. Before it was
 * shared, the supplier, facility and transfer-price pages each kept a copy and the item
 * page kept it inline per form. They had drifted: on the item, supplier and facility pages
 * a Retry that succeeded never ended the doubt, and on the item, supplier and
 * transfer-price pages a failed Start over was never shown (found in review).
 *
 * THE RULES IT HOLDS:
 *
 *   A REQUEST IS BUILT ONCE, when the person presses the button, and handed to run() as
 *   a function that sends exactly it. Retry sends that same function again: the same
 *   ids, the same body, the same stamp. A reload of the page meanwhile (another form on
 *   it saving) can change what the page shows; it cannot change what a Retry sends. A
 *   retried "retire" once became a "reinstate", and a retried change carried a newer
 *   stamp past the stale check, before this was a rule.
 *
 *   AN UNANSWERED WRITE IS IN DOUBT (items.ts, isUnanswered): it may have been recorded.
 *   Only two ways out are offered: the same request again, or Start over, which first
 *   reads the record and only then lets the form make a new decision under new ids.
 *
 *   ONE REQUEST AT A TIME. A second run() while one is out is ignored, not queued: the
 *   screens lock their fields and buttons while busy (`locked`), and this is the backstop.
 *
 * Requirements: INV-002 · ADR-0005
 */
import type { Answer, Failure } from './api.ts';
import { isUnanswered, writeOutcome } from './items.ts';

/** What a sub-form reports to its page: a write's outcome, or 'checked' after Start over. */
export type Outcome = 'saved' | 'already' | 'stale' | 'checked';
export type Done = (outcome: Outcome) => void;

/** A request built once, sent by calling it, as many times as Retry is pressed. */
export type Send = () => Promise<Answer<unknown>>;

/** The state a screen shows, set by the lifecycle. */
export interface WriteState {
  setBusy(busy: boolean): void;
  setFailure(failure: Failure | null): void;
  setInDoubt(inDoubt: boolean): void;
}

/** What the lifecycle asks of its form, read afresh on every call: a form's closures change as it renders. */
export interface WriteHooks {
  /** Every failed call passes here first (Ctx.onFailure); true when it was handled, as an ended session is. */
  onFailure(failure: Failure): boolean;
  /** A fresh read of the record, which Start over makes before the form may decide again. */
  see(): Promise<Answer<unknown>>;
  /**
   * Whether what `see` read holds the request in doubt, by its id: the lost answer's write
   * was recorded. Start over then reports 'already', not 'checked', so the person is told,
   * where the record's look alone would not show it — a second receipt of the same goods
   * would be taken (found in review). Absent, Start over says nothing either way.
   */
  recorded?: ((seen: unknown) => boolean) | undefined;
  /**
   * Whether a refusal of `see` itself settles the doubt: the record can no longer be read
   * here because no decision of this form's kind can be made here any more, so a new one
   * cannot repeat the lost request. Start over then sends the request in doubt once more,
   * as Retry would — a route checks a decision's id before its rules, after its permission
   * gates, so while the person may still make it a request recorded under the lost answer
   * is answered already_recorded and they are told — and ends the doubt with what that
   * answer says: 'already', 'saved' or 'stale', or 'checked' for a refusal, a gate's
   * included. Unanswered again, the doubt stays, with Retry and Start over as before. Without this a par set from a facility
   * whose item's source moved away while the write was in doubt stayed locked, Start over
   * refused for ever (found in review); settling at once dropped the one request that
   * could say it had been saved (found in the second review). Absent, every refusal keeps
   * the doubt.
   */
  settled?: ((failure: Failure) => boolean) | undefined;
  /** The page's own, when it has them (PageHooks). */
  started?: (() => void) | undefined;
  refused?: ((failure: Failure) => void) | undefined;
  /** The form's reset for its next decision: new ids, closed, fields cleared. */
  after(): void;
  onDone: Done;
}

/**
 * What the page a form sits on is told of the form's writes, beyond their outcome.
 * - `started`: a request is being sent. The page's word on an earlier write ("Saved.") no
 *   longer describes the page, and stood above a later refusal as if it were its answer
 *   (found writing module 9's staff testing pack).
 * - `refused`: the route refused the request, and the form shows why. A page whose facts
 *   the refusal shows to be out of date reads them again.
 */
export interface PageHooks {
  readonly started?: () => void;
  readonly refused?: (failure: Failure) => void;
}

export interface WriteLifecycle {
  run(send: Send): Promise<void>;
  /** The request first sent, again; nothing when there is none. */
  retry(): void;
  startOver(): Promise<void>;
  /** The request a Retry would send, or null. For tests. */
  readonly pending: Send | null;
}

export function writeLifecycle(state: WriteState, hooks: () => WriteHooks): WriteLifecycle {
  let pending: Send | null = null;
  let out = false;

  async function run(send: Send): Promise<void> {
    if (out) return;
    out = true;
    pending = send;
    state.setBusy(true);
    state.setFailure(null);
    hooks().started?.();
    let answer: Answer<unknown>;
    try {
      answer = await send();
    } finally {
      out = false;
      state.setBusy(false);
    }
    const h = hooks();
    const outcome = writeOutcome(answer);
    if (outcome === 'failed') {
      // Kept: an unanswered request may have been recorded, and only it may be sent again.
      if (isUnanswered(answer)) state.setInDoubt(true);
      else if (!answer.ok && !h.onFailure(answer)) {
        state.setFailure(answer);
        h.refused?.(answer);
      }
      return;
    }
    pending = null;
    state.setInDoubt(false);
    h.after();
    h.onDone(outcome);
  }

  function retry(): void {
    if (pending !== null) void run(pending);
  }

  async function startOver(): Promise<void> {
    if (out) return;
    out = true;
    state.setBusy(true);
    let now: Answer<unknown>;
    try {
      now = await hooks().see();
    } finally {
      out = false;
      state.setBusy(false);
    }
    const h = hooks();
    if (!now.ok) {
      if (h.onFailure(now)) return;
      if (h.settled?.(now) === true) {
        let outcome: Outcome = 'checked';
        if (pending !== null) {
          const send = pending;
          out = true;
          state.setBusy(true);
          // An earlier Start over's failure is not this one's.
          state.setFailure(null);
          let again: Answer<unknown>;
          try {
            again = await send();
          } finally {
            out = false;
            state.setBusy(false);
          }
          // Unanswered again: still in doubt, with the same two ways out.
          if (isUnanswered(again)) return;
          if (!again.ok && hooks().onFailure(again)) return;
          const said = writeOutcome(again);
          outcome = said === 'failed' ? 'checked' : said;
        }
        const settled = hooks();
        pending = null;
        state.setInDoubt(false);
        state.setFailure(null);
        settled.after();
        settled.onDone(outcome);
        return;
      }
      // Still in doubt: nothing is unlocked until the record has been seen.
      state.setFailure(now);
      return;
    }
    // Asked before anything unlocks; a record of an unexpected shape is "not seen there", so
    // the form still resets under new ids rather than unlocking the used one (found in review).
    let already = false;
    try {
      already = h.recorded?.(now.value) ?? false;
    } catch {
      already = false;
    }
    pending = null;
    state.setInDoubt(false);
    state.setFailure(null);
    h.after();
    h.onDone(already ? 'already' : 'checked');
  }

  return {
    run,
    retry,
    startOver,
    get pending() {
      return pending;
    },
  };
}

/** An upload's request: the reason, and the rows with the ids minted when the file was read. */
export interface ImportRequest {
  readonly reason: string;
  readonly rows: readonly Record<string, string | null>[];
}

/**
 * What Upload sends. While the last sending went unanswered, it is exactly that request
 * again: Upload is the import's Retry, and the file input is locked meanwhile, but the
 * reason was read afresh, so a reason edited after a lost answer went under the first
 * sending's ids and was answered as saved while the log kept the first one (found in
 * review). Otherwise it is built now, from the rows read and the reason typed; null when
 * there are no rows.
 */
export function importRequest(
  last: ImportRequest | null, unanswered: boolean, reason: string, rows: ImportRequest['rows'] | null,
): ImportRequest | null {
  if (unanswered && last !== null) return last;
  return rows === null ? null : { reason: reason.trim(), rows };
}
