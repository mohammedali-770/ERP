import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import type { Answer, Failure } from '../src/api.ts';
import { importRequest, writeLifecycle, type Outcome, type Send, type WriteHooks } from '../src/write.ts';

const failure = (http: number, status: string): Failure =>
  ({ ok: false, http, status, message: null, constraint: null, detail: null, field: null });
const LOST = failure(0, 'network');
const SAVED: Answer<unknown> = { ok: true, value: { decision_id: 'd' } };

/** A lifecycle with every state change and hook call recorded, as a page would see them. */
function harness(seeAnswer: Answer<unknown> = SAVED) {
  const log: string[] = [];
  const state = { busy: false, inDoubt: false, failure: null as Failure | null };
  const hooks: WriteHooks = {
    onFailure: (f) => f.status === 'idle',
    see: async () => {
      log.push('see');
      return seeAnswer;
    },
    after: () => log.push('after'),
    onDone: (o: Outcome) => log.push(`done:${o}`),
  };
  const life = writeLifecycle({
    setBusy: (b) => (state.busy = b),
    setFailure: (f) => (state.failure = f),
    setInDoubt: (d) => (state.inDoubt = d),
  }, () => hooks);
  return { life, state, log, hooks };
}

/** A request that records what it was asked to send, and answers from a queue. */
function request(body: unknown, answers: Answer<unknown>[]) {
  const sent: unknown[] = [];
  const send: Send = async () => {
    sent.push(structuredClone(body));
    return answers.shift() ?? SAVED;
  };
  return { send, sent };
}

// --- the lifecycle ---------------------------------------------------------------

test('CONTROL: Retry sends the very request the form handed over, not one asked for again', async () => {
  // What the lifecycle can promise: Retry calls the same Send again. That the Send carries
  // a request built once, at Save, is the screens' part, read from their source below.
  const h = harness();
  const calls: Send[] = [];
  const answers: Answer<unknown>[] = [LOST, SAVED];
  const send: Send = async () => {
    calls.push(send);
    return answers.shift()!;
  };
  await h.life.run(send);
  assert.equal(h.state.inDoubt, true, 'an unanswered write is in doubt');
  assert.equal(h.life.pending, send);
  h.life.retry();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [send, send]);
});

test('CONTROL: a Retry that succeeds ends the doubt, and the form is reset for its next decision', async () => {
  // The code before this never cleared the doubt on the item, supplier and facility
  // pages: the next decision on the same form opened locked, with a Retry tied to nothing
  // (found in review). A lost write that was recorded is usually answered already_recorded
  // on Retry, since the database checks a decision's novelty first; stale ends it too.
  for (const [answer, outcome] of [[SAVED, 'saved'], [failure(409, 'already_recorded'), 'already'], [failure(409, 'stale'), 'stale']] as const) {
    const h = harness();
    const r = request({}, [LOST, answer]);
    await h.life.run(r.send);
    assert.equal(h.state.inDoubt, true);
    h.life.retry();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.state.inDoubt, false, `${outcome}: the doubt is over`);
    assert.equal(h.life.pending, null, outcome);
    assert.deepEqual(h.log, ['after', `done:${outcome}`], outcome);
  }
});

test('already recorded is the same success arriving twice; stale ends the write too; a refusal keeps the form', async () => {
  for (const [answer, outcome] of [[failure(409, 'already_recorded'), 'done:already'], [failure(409, 'stale'), 'done:stale']] as const) {
    const h = harness();
    await h.life.run(request({}, [answer]).send);
    assert.deepEqual(h.log, ['after', outcome]);
    assert.equal(h.state.failure, null);
  }
  const h = harness();
  const refused = failure(422, 'refused');
  const r = request({}, [refused]);
  await h.life.run(r.send);
  assert.equal(h.state.failure, refused, 'a refusal is shown');
  assert.equal(h.state.inDoubt, false, 'and is not doubt: nothing was recorded');
  assert.deepEqual(h.log, [], 'the form keeps its ids and fields');
  const ended = harness();
  await ended.life.run(request({}, [failure(401, 'idle')]).send);
  assert.equal(ended.state.failure, null, 'an ended session is the shell\'s to handle (it signs the person out)');
});

test('CONTROL: Start over reads the record before anything unlocks; a failed read leaves the form in doubt and says why', async () => {
  const unreadable = harness(LOST);
  await unreadable.life.run(request({}, [LOST]).send);
  await unreadable.life.startOver();
  assert.deepEqual(unreadable.log, ['see']);
  assert.equal(unreadable.state.inDoubt, true, 'still locked: nothing was seen');
  assert.equal(unreadable.state.failure, LOST, 'and the failed read is shown, not swallowed (found in review)');

  const h = harness();
  const r = request({}, [LOST]);
  await h.life.run(r.send);
  await h.life.startOver();
  assert.deepEqual(h.log, ['see', 'after', 'done:checked'], 'seen, then reset under new ids');
  assert.equal(h.state.inDoubt, false);
  assert.equal(h.life.pending, null, 'and the lost request can no longer be retried');
});

test('CONTROL: a record of an unexpected shape is "not seen there": the form still resets, never unlocking the used id', async () => {
  const h = harness({ ok: true, value: {} });
  h.hooks.recorded = () => {
    throw new TypeError('no receipts');
  };
  await h.life.run(request({}, [LOST]).send);
  await h.life.startOver();
  assert.deepEqual(h.log, ['see', 'after', 'done:checked']);
  assert.equal(h.state.inDoubt, false);
});

test('the hook carries recorded, settled and the page\'s hooks to the lifecycle, every render', () => {
  const hook = readFileSync(new URL('../src/screens/useWrite.tsx', import.meta.url), 'utf8');
  assert.match(hook, /hooks\.current = \{[^}]*\brecorded, settled, started: page\?\.started, refused: page\?\.refused \};/,
    'without it, Start over never asks, and the page is never told');
  // A request in doubt is reported to the page until it is settled or the form goes, and a
  // form the page holds is locked as one in doubt is (found in the second review).
  assert.match(hook, /useEffect\(\(\) => \{\s+if \(!inDoubt\) return undefined;\s+doubt\.current\?\.\(true\);\s+return \(\) => doubt\.current\?\.\(false\);\s+\}, \[inDoubt\]\);/);
  assert.match(hook, /doubt\.current = page\?\.doubt;/, 'the page\'s latest, every render');
  assert.match(hook, /locked: busy \|\| inDoubt \|\| page\?\.held === true,/);
});

test('CONTROL: the page is told when a request goes out, and of a refusal the form shows, and of nothing else', async () => {
  // A page's "Saved." stood above a later refusal as if it were its answer, and a par page
  // went on saying where an item was supplied from after a refusal said otherwise (found
  // writing module 9's staff testing pack).
  const told = (h: ReturnType<typeof harness>) => {
    h.hooks.started = () => h.log.push('started');
    h.hooks.refused = (f) => h.log.push(`refused:${f.status}`);
  };
  /** A request that writes to the log when it goes out. */
  const sent = (h: ReturnType<typeof harness>, answer: Answer<unknown>): Send => async () => {
    h.log.push('send');
    return answer;
  };
  const saved = harness();
  told(saved);
  await saved.life.run(sent(saved, SAVED));
  assert.deepEqual(saved.log, ['started', 'send', 'after', 'done:saved'], 'told as it goes out, before the answer');
  for (const [status, outcome] of [['already_recorded', 'already'], ['stale', 'stale']] as const) {
    const h = harness();
    told(h);
    await h.life.run(sent(h, failure(409, status)));
    assert.deepEqual(h.log, ['started', 'send', 'after', `done:${outcome}`], `${status} is an outcome, never a refusal`);
  }

  const refused = harness();
  told(refused);
  await refused.life.run(request({}, [failure(422, 'refused')]).send);
  assert.deepEqual(refused.log, ['started', 'refused:refused']);
  assert.equal(refused.state.failure?.status, 'refused', 'the form still shows it');

  const lost = harness();
  told(lost);
  await lost.life.run(request({}, [LOST, SAVED]).send);
  assert.deepEqual(lost.log, ['started'], 'an unanswered request is no refusal');
  lost.life.retry();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lost.log, ['started', 'started', 'after', 'done:saved'], 'a Retry goes out too');

  const ended = harness();
  told(ended);
  await ended.life.run(request({}, [failure(401, 'idle')]).send);
  assert.deepEqual(ended.log, ['started'], 'an ended session is the console\'s to handle, not the page\'s');
});

test('CONTROL: a refused read settles the doubt only where the form says it does, asking the request once more first', async () => {
  // A par set from a facility whose item's source moved away while its write was in doubt:
  // Start over's read is answered missing, and stayed so, and the form stayed locked (found in
  // review). It now settles where the form says so, but first sends the request in doubt
  // once more, as Retry would: a route checks a decision's id before its rules, so one
  // recorded under the lost answer is answered already_recorded, and the person is told
  // (found in the second review). Any other refusal of the read still keeps the doubt.
  const missing = failure(404, 'not_found');
  for (const [settles, refusal, again, log, sends] of [
    [true, missing, failure(409, 'already_recorded'), ['see', 'after', 'done:already'], 2],
    [true, missing, failure(422, 'refused'), ['see', 'after', 'done:checked'], 2],
    [true, missing, failure(409, 'stale'), ['see', 'after', 'done:stale'], 2],
    [true, missing, SAVED, ['see', 'after', 'done:saved'], 2],
    [true, missing, LOST, ['see'], 2],
    [false, missing, SAVED, ['see'], 1],
    [true, failure(500, 'error'), SAVED, ['see'], 1],
  ] as const) {
    const h = harness(refusal);
    const asked: Failure[] = [];
    h.hooks.settled = (f) => {
      asked.push(f);
      return settles && f.status === 'not_found';
    };
    const r = request({ decision_id: 'd1' }, [LOST, again]);
    await h.life.run(r.send);
    await h.life.startOver();
    const label = `${settles} ${refusal.status} then ${again.ok ? 'saved' : again.status}`;
    assert.deepEqual(h.log, log, label);
    assert.equal(r.sent.length, sends, `${label}: sent once more only when settling`);
    assert.deepEqual(r.sent, Array(sends).fill({ decision_id: 'd1' }), `${label}: the very request first sent`);
    const kept = log.length === 1;
    assert.equal(h.state.inDoubt, kept, `${label}: kept in doubt unless settled`);
    assert.equal(h.life.pending === null, !kept, `${label}: settled, nothing is left to Retry`);
    assert.equal(h.state.busy, false);
    assert.deepEqual(asked, [refusal]);
    if (kept && sends === 1) assert.equal(h.state.failure, refusal, `${label}: a kept doubt says why`);
  }
  // A session that has ended is the session's, on the read or on the request asked again.
  const ended = harness(failure(401, 'idle'));
  ended.hooks.settled = () => true;
  await ended.life.run(request({}, [LOST]).send);
  await ended.life.startOver();
  assert.deepEqual(ended.log, ['see'], 'signed out, not settled');
  assert.equal(ended.state.inDoubt, true);
  const endedAgain = harness(missing);
  endedAgain.hooks.settled = () => true;
  await endedAgain.life.run(request({}, [LOST, failure(401, 'idle')]).send);
  await endedAgain.life.startOver();
  assert.deepEqual(endedAgain.log, ['see'], 'signed out on the request asked again, not settled');
  assert.equal(endedAgain.state.inDoubt, true);
});

test('CONTROL: while the request is asked again, the form stays locked and in doubt, and nothing else goes out', async () => {
  // Without the lock, Retry stayed live while the request was asked again, sent a third copy
  // and reported the outcome twice (found in the third review).
  const h = harness(failure(404, 'not_found'));
  h.hooks.settled = () => true;
  let release!: (a: Answer<unknown>) => void;
  let sends = 0;
  const send: Send = () => {
    sends++;
    return sends === 1 ? Promise.resolve(LOST) : new Promise((resolve) => (release = resolve));
  };
  await h.life.run(send);
  const over = h.life.startOver();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sends, 2, 'the request is out again');
  assert.equal(h.state.busy, true, 'locked while it is out');
  assert.equal(h.state.inDoubt, true, 'and still in doubt');
  h.life.retry();
  await h.life.startOver();
  await h.life.run(send);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sends, 2, 'Retry, Start over and Save send nothing meanwhile');
  release(failure(409, 'already_recorded'));
  await over;
  assert.deepEqual(h.log, ['see', 'after', 'done:already'], 'read once, settled once');
  assert.equal(h.state.busy, false);
});

test('CONTROL: a second asking unanswered leaves both ways out, and clears an earlier Start over\'s failure', async () => {
  // The same two ways out, live: without them the form was locked for ever (found in the third review).
  for (const way of ['retry', 'startOver'] as const) {
    const h = harness();
    const reads: Answer<unknown>[] = [failure(503, 'error'), failure(404, 'not_found'), failure(404, 'not_found')];
    h.hooks.see = async () => {
      h.log.push('see');
      return reads.shift()!;
    };
    h.hooks.settled = (f) => f.status === 'not_found';
    const r = request({ decision_id: 'd1' }, [LOST, LOST, failure(409, 'already_recorded')]);
    await h.life.run(r.send);
    await h.life.startOver();
    assert.equal(h.state.failure?.http, 503, 'a read that failed is said');
    await h.life.startOver();
    assert.equal(r.sent.length, 2, 'settled: asked once more');
    assert.equal(h.state.inDoubt, true, 'unanswered again: still in doubt');
    assert.equal(h.state.failure, null, 'and the earlier read\'s failure is not this one\'s');
    assert.equal(h.state.busy, false);
    if (way === 'retry') {
      h.life.retry();
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(h.log, ['see', 'see', 'after', 'done:already'], 'Retry still answers');
    } else {
      await h.life.startOver();
      assert.deepEqual(h.log, ['see', 'see', 'see', 'after', 'done:already'], 'Start over still answers');
    }
    assert.equal(r.sent.length, 3);
    assert.deepEqual(r.sent, [{ decision_id: 'd1' }, { decision_id: 'd1' }, { decision_id: 'd1' }]);
  }
});

test('CONTROL: Start over says "already saved" when the record it read holds the lost request', async () => {
  // A receipt recorded under a lost answer looks like any other: without this, the person
  // was told nothing and could receive the same goods twice (found in review).
  for (const [held, outcome] of [[true, 'already'], [false, 'checked']] as const) {
    const h = harness({ ok: true, value: { receipts: ['r'] } });
    const seen: unknown[] = [];
    h.hooks.recorded = (v) => {
      seen.push(v);
      return held;
    };
    await h.life.run(request({}, [LOST]).send);
    await h.life.startOver();
    assert.deepEqual(h.log, ['see', 'after', `done:${outcome}`], `held: ${held}`);
    assert.deepEqual(seen, [{ receipts: ['r'] }], 'asked of what was read');
    assert.equal(h.state.inDoubt, false);
  }
});

test('one request at a time: a second Save while one is out sends nothing', async () => {
  const h = harness();
  let release!: (a: Answer<unknown>) => void;
  let calls = 0;
  const slow: Send = () => {
    calls++;
    return new Promise((resolve) => (release = resolve));
  };
  const first = h.life.run(slow);
  assert.equal(h.state.busy, true);
  await h.life.run(slow);
  assert.equal(calls, 1, 'a double click while a request is out sends nothing');
  await h.life.startOver();
  assert.deepEqual(h.log, [], 'Start over while a request is out reads nothing and resets nothing');
  assert.equal(h.state.busy, true, 'and does not unlock the form');
  release(SAVED);
  await first;
  assert.equal(h.state.busy, false);
});

// --- the imports -------------------------------------------------------------------

test('CONTROL: an upload sent again after a lost answer is the same request, reason included', () => {
  const rows = [{ code: 'A', decision_id: 'd' }];
  const first = importRequest(null, false, ' first reason ', rows)!;
  assert.deepEqual(first, { reason: 'first reason', rows });
  assert.equal(importRequest(first, true, 'edited after the answer was lost', rows), first,
    'while unanswered, Upload resends exactly what was sent');
  assert.deepEqual(importRequest(first, false, 'a new reason', rows), { reason: 'a new reason', rows },
    'once answered, the next upload is built afresh');
  assert.equal(importRequest(null, false, 'r', null), null, 'no rows, nothing to send');
});

// --- every screen (.tsx, read as source) ---------------------------------------------

const dir = new URL('../src/screens/', import.meta.url);
const screens = readdirSync(dir).filter((f) => f.endsWith('.tsx'));
const source = (name: string) => readFileSync(new URL(name, dir), 'utf8');

test('CONTROL: no screen rebuilds a request on Retry', () => {
  for (const name of screens) {
    const src = source(name);
    assert.doesNotMatch(src, /onRetry=\{\(\) => (void )?(submit|send)\(\)\}/, `${name}: a Retry that rebuilds from the fields`);
    for (const m of src.matchAll(/onRetry=\{([^}]*\}?)\}/g)) {
      assert.match(m[1]!, /^w\.retry$|send\((sent(\.current!)?|inDoubt\.body, inDoubt\.erase)\)/, `${name}: Retry is ${m[1]}`);
    }
  }
});

test('CONTROL: every detail page\'s sub-forms share one write lifecycle, and lock while a request is out', () => {
  const pages = ['ItemDetail.tsx', 'SupplierDetail.tsx', 'FacilityDetail.tsx', 'ItemPrices.tsx', 'StockDecision.tsx', 'StockAlerts.tsx',
    'ReplenishmentSources.tsx', 'OrderCutoffs.tsx', 'ParLevels.tsx'];
  const forms: Record<string, number> = {
    'ItemDetail.tsx': 3, 'SupplierDetail.tsx': 3, 'FacilityDetail.tsx': 2, 'ItemPrices.tsx': 2, 'StockDecision.tsx': 1,
    'StockAlerts.tsx': 2, 'ReplenishmentSources.tsx': 2, 'OrderCutoffs.tsx': 2, 'ParLevels.tsx': 2,
  };
  for (const name of screens.filter((f) => f !== 'useWrite.tsx')) {
    assert.doesNotMatch(source(name), /function useWrite\(/, `${name} keeps no copy of its own`);
    assert.doesNotMatch(source(name), /function seeWhatIsSaved\(/, `${name}: Start over is the shared one`);
  }
  for (const page of pages) {
    const src = source(page);
    assert.match(src, /import \{ useWrite \} from '\.\/useWrite\.tsx';/, page);
    assert.equal([...src.matchAll(/= useWrite\(ctx, /g)].length, forms[page], `${page}: every write form`);
    assert.equal([...src.matchAll(/onRetry=\{w\.retry\}/g)].length, forms[page], `${page}: every Retry`);
    assert.doesNotMatch(src, /disabled=\{w\.inDoubt\}/, `${page}: locked only in doubt, the fields were live while a request was out`);
    assert.equal([...src.matchAll(/<fieldset className="plain" disabled=\{w\.locked\}>/g)].length, forms[page], `${page}: every form's fields lock while a request is out`);
    // Every request is a constant built at Save, and the Send sends that constant: a reload
    // of the page afterwards cannot reach it.
    const runs = [...src.matchAll(/void w\.run\(([^;]*)\);/g)].map((m) => m[1]!);
    assert.ok(runs.length >= forms[page]!, `${page}: its sends were found`);
    for (const r of runs) assert.match(r, /^\(\) => api\.\w+\((\w+, )?body\)$/, `${page}: ${r}`);
    for (const m of src.matchAll(/void w\.run\(/g)) {
      const before = src.slice(Math.max(0, m.index! - 400), m.index!);
      const at = before.lastIndexOf('const body');
      // The statement just before the send is the body's own declaration: one semicolon between.
      assert.ok(at >= 0 && before.slice(at).split(';').length === 2, `${page}: the body is a constant built just before it is sent`);
    }
  }
  assert.match(source('useWrite.tsx'), /locked: busy \|\| inDoubt( \|\| page\?\.held === true)?,/);
});

test('CONTROL: every full-page form keeps the request it sent, locks while it is out, and Start over unlocks nothing it has not seen', () => {
  const pages: Array<[string, number]> = [['ItemForm.tsx', 2], ['SupplierForm.tsx', 2], ['FacilityForm.tsx', 2], ['StockEntry.tsx', 2]];
  for (const [page, n] of pages) {
    const src = source(page);
    assert.equal([...src.matchAll(/disabled=\{inDoubt \|\| busy\}/g)].length, n, `${page}: both forms lock while a request is out`);
    assert.equal([...src.matchAll(/onRetry=\{\(\) => void send\(sent(\.current!)?\)\}/g)].length, n, `${page}: both retry what they sent`);
    // ...and both store it before it goes: without that, the banner never showed and the
    // form stayed locked with no Retry and no Start over (found in review).
    assert.equal([...src.matchAll(/async function send\(body[^)]*\) \{\s+(sent\.current = body|setSent\(body\));/g)].length, n, `${page}: both store the request first`);
  }
  // The edit forms: when the stamp has moved, the form is replaced by what was read, and
  // nothing is unlocked before; only an unmoved stamp unlocks the same, unused ids.
  for (const page of ['ItemForm.tsx', 'SupplierForm.tsx', 'FacilityForm.tsx', 'SupplierContact.tsx']) {
    const src = source(page);
    const startOver = src.slice(src.lastIndexOf('async function startOver()'));
    const moved = startOver.indexOf('onReplace(now.value);');
    const unlock = startOver.search(/setInDoubt\((false|null)\);/);
    assert.ok(moved > 0 && unlock > moved, `${page}: replaced before any unlock`);
    assert.match(startOver.slice(0, moved), /if \(now\.value\.as_of_decision_id !== (item|supplier|facility)\.as_of_decision_id\) \{\s+(\/\/[^\n]*\n\s+)*$/,
      `${page}: replaced exactly when the stamp has moved`);
    assert.match(startOver.slice(moved, unlock), /return;/, `${page}: and returns, still locked`);
    // An unmoved stamp unlocks under a NEW id: the lost request may still land, and the
    // next Save must then be refused as stale, never answered "already recorded" (found in review).
    assert.match(startOver.slice(moved, unlock), /setIds\(formIds\(\['decision_id'\] as const\)\);\s+$/, `${page}: a new id before it unlocks`);
    assert.match(src, /onReplace=\{replace\}/, `${page}: the page takes the record already read`);
    // The remount on the new stamp is what mints new ids after a replace.
    assert.match(src, /<(AmendForm|ContactForm) key=\{(item|supplier|facility)\.as_of_decision_id\} [^>]*onReplace=\{replace\}/, `${page}: keyed by the stamp`);
    assert.match(src, /if \(mine !== seq\.current\) return;/, `${page}: only the newest load draws`);
  }
  assert.match(source('SupplierContact.tsx'), /disabled=\{inDoubt !== null \|\| busy\}/);
});

test('both uploads lock their reason while a sending is out or unanswered, and resend what was sent', () => {
  for (const name of ['ItemImport.tsx', 'SupplierImport.tsx']) {
    const src = source(name);
    assert.match(src, /const body = importRequest\(sent\.current, unanswered, reason, rows\);/, name);
    assert.match(src, /<fieldset className="plain" disabled=\{busy \|\| unanswered\}>\s+<ReasonField/, name);
    assert.match(src, /if \(!isUnanswered\(answer\)\) sent\.current = null;/, `${name}: an answer ends the doubt`);
  }
});
