import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import type { Failure, Item, StockAdjustmentInput, StockCountInput } from '../api.ts';
import type { Ctx } from '../context.ts';
import { formatFactor } from '../format.ts';
import { formIds } from '../ids.ts';
import { label, localName, t, type Lang } from '../i18n.ts';
import { isUnanswered, unitName, writeOutcome } from '../items.ts';
import {
  adjustmentBody, ADJUSTMENT_KINDS, countBody, MAX_LINES, stockLines, stockMoment, WOULD_GO_NEGATIVE, writableHere,
  type AdjustmentKind, type DraftLine, type LineProblem,
} from '../stock.ts';
import { FailureNotice, Field, InDoubt, Notice, ReasonField } from './ui.tsx';
import { stockPlace, useFacilityStatus } from './StockList.tsx';

/** A line as the form holds it: the item it is for, with the pack, quantity and direction typed. */
interface FormLine extends DraftLine {
  readonly key: string;
  readonly item: Item;
}

/** The pack a new line starts in: the item's base unit, the one every balance is kept in. */
function basePack(item: Item): string {
  return item.units.find((u) => u.unit_key === item.base_unit_key && u.status === 'active')?.item_unit_id ?? '';
}

function problemText(lang: Lang, p: LineProblem): string {
  switch (p.kind) {
    case 'no_lines': return t(lang, 'stock_no_lines');
    case 'too_many': return t(lang, 'stock_too_many_lines', { n: MAX_LINES });
    case 'pack': return t(lang, 'stock_line_pack', { line: p.line });
    case 'quantity': return t(lang, 'stock_line_quantity', { line: p.line });
    case 'direction': return t(lang, 'stock_line_direction', { line: p.line });
    case 'repeat': return t(lang, 'stock_line_repeat', { line: p.line, first: p.first });
  }
}

/**
 * Finds an item at the facility's brand and adds a line for it. Retired items are found
 * too: what is still on a shelf is still written off or counted.
 */
function ItemFinder({ ctx, facilityId, onAdd }: { ctx: Ctx; facilityId: string; onAdd: (item: Item) => void }) {
  const { api, lang } = ctx;
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<readonly Item[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const seq = useRef(0);

  async function find() {
    const q = search.trim();
    if (q === '') return;
    const mine = ++seq.current;
    const answer = await api.listItems({ facilityId, status: 'all', search: q, limit: 20 });
    if (mine !== seq.current) return;
    if (answer.ok) {
      setFound(answer.value.items);
      setFailure(null);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  return (
    <div className="finder">
      <Field label={t(lang, 'find_item')} hint={t(lang, 'find_item_hint')}>
        <input
          type="search"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void find(); } }}
        />
      </Field>
      <button type="button" className="small" onClick={() => void find()}>{t(lang, 'search')}</button>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {found !== null && found.length === 0 ? <p className="muted">{t(lang, 'no_items_match')}</p> : null}
      {found !== null && found.length > 0 ? (
        <ul className="plain-list">
          {found.map((i) => (
            <li key={i.item_id}>
              <button type="button" className="small" onClick={() => onAdd(i)}>{t(lang, 'add_line')}</button>{' '}
              <bdi dir="ltr">{i.code}</bdi> — {localName(lang, i)}
              {i.status === 'retired' ? <> · <em>{t(lang, 'status_retired')}</em></> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The lines of a movement or a count: one per pack, each with its quantity, and a direction on an adjustment. */
function Lines({ ctx, lines, setLines, withDirection }: {
  ctx: Ctx; lines: readonly FormLine[]; setLines: (f: (l: readonly FormLine[]) => readonly FormLine[]) => void; withDirection: boolean;
}) {
  const { lang, data } = ctx;
  const change = (key: string, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  if (lines.length === 0) return <p className="muted">{t(lang, 'stock_no_lines')}</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>#</th><th>{t(lang, 'item_code')}</th><th>{t(lang, 'pack')}</th>
          {withDirection ? <th>{t(lang, 'direction')}</th> : null}
          <th>{t(lang, 'quantity')}</th><th />
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={l.key}>
            <td>{i + 1}</td>
            <td><bdi dir="ltr">{l.item.code}</bdi> — {localName(lang, l.item)}</td>
            <td>
              <select aria-label={t(lang, 'pack')} required value={l.itemUnitId} onChange={(e) => change(l.key, { itemUnitId: e.target.value })}>
                <option value="" disabled>—</option>
                {l.item.units.map((u) => (
                  <option key={u.item_unit_id} value={u.item_unit_id}>
                    {unitName(lang, data.units, u.unit_key)} = {formatFactor(u.factor)} {unitName(lang, data.units, l.item.base_unit_key)}
                    {u.status === 'retired' ? ` (${t(lang, 'status_retired')})` : ''}
                  </option>
                ))}
              </select>
            </td>
            {withDirection ? (
              <td>
                <select aria-label={t(lang, 'direction')} required value={l.direction}
                  onChange={(e) => change(l.key, { direction: e.target.value as DraftLine['direction'] })}>
                  <option value="" disabled>—</option>
                  <option value="in">{t(lang, 'direction_in')}</option>
                  <option value="out">{t(lang, 'direction_out')}</option>
                </select>
              </td>
            ) : null}
            <td>
              <input aria-label={t(lang, 'quantity')} dir="ltr" inputMode="decimal" required maxLength={19}
                value={l.quantity} onChange={(e) => change(l.key, { quantity: e.target.value })} />
            </td>
            <td><button type="button" className="small" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>{t(lang, 'remove')}</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Now, or a stated Riyadh date and time (D3): an explicit choice, never a blank date read as now. */
export function MomentFields({ lang, legend, when, setWhen, date, setDate, time, setTime, dateRef, timeRef }: {
  lang: Lang; legend: string; when: 'now' | 'stated'; setWhen: (w: 'now' | 'stated') => void;
  date: string; setDate: (v: string) => void; time: string; setTime: (v: string) => void;
  dateRef: RefObject<HTMLInputElement>; timeRef: RefObject<HTMLInputElement>;
}) {
  return (
    <>
      <div className="field" role="radiogroup" aria-label={legend}>
        <span className="field-label">{legend}</span>
        <label className="check">
          <input type="radio" name="when" checked={when === 'now'} onChange={() => setWhen('now')} />
          {t(lang, 'moment_now')}
        </label>
        <label className="check">
          <input type="radio" name="when" checked={when === 'stated'} onChange={() => setWhen('stated')} />
          {t(lang, 'moment_stated')}
        </label>
      </div>
      {when === 'stated' ? (
        <>
          <Field label={t(lang, 'moment_date')} hint={t(lang, 'moment_date_hint')}>
            <input ref={dateRef} type="date" dir="ltr" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t(lang, 'moment_time')}>
            <input ref={timeRef} type="time" dir="ltr" required value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </>
      ) : null}
    </>
  );
}

/**
 * A waste, a damage, an expiry or an adjustment at the facility worked at, as one
 * decision of up to 500 lines (0020's erp.record_stock_adjustment()). A write-off takes
 * stock out; an adjustment states each line's direction. A movement that would take an
 * item below zero is refused unless the person holds the override and gives its reason
 * (D1).
 */
export function StockAdjust({ ctx }: { ctx: Ctx }) {
  const { lang } = ctx;
  const place = stockPlace(ctx);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [kind, setKind] = useState<AdjustmentKind>('waste');
  const [when, setWhen] = useState<'now' | 'stated'>('now');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<readonly FormLine[]>([]);
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inDoubt, setInDoubt] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const keySeq = useRef(0);
  // The request as first sent: Retry resends exactly this, never the fields as they are now.
  const sent = useRef<StockAdjustmentInput | null>(null);
  // One request at a time: two quick Enters sent the same id twice (found in review).
  const out = useRef(false);
  const status = useFacilityStatus(ctx, place.facility?.facility_id ?? null);
  // Lines typed are work: every way out of the page asks first (leave.ts).
  const { setLeaveGuard } = ctx;
  useEffect(() => {
    setLeaveGuard(() => lines.length > 0);
    return () => setLeaveGuard(null);
  }, [setLeaveGuard, lines.length]);

  if (place.facility === null) return <section><a href="#current_stock">{t(lang, 'back')}</a>{place.notice}</section>;
  if (status === 'closed') return <Notice tone="info" text={t(lang, 'rule_facility_no_new_work')} />;
  if (!writableHere(ctx.stockWritable, status)) return <Notice tone="info" text={t(lang, 'read_only_stock')} />;
  const facilityId = place.facility.facility_id;

  async function send(body: StockAdjustmentInput) {
    sent.current = body;
    if (out.current) return;
    out.current = true;
    setBusy(true);
    setFailure(null);
    const answer = await ctx.api.recordStockAdjustment(body);
    out.current = false;
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'saved' || outcome === 'already') {
      ctx.navigate({ screen: 'stock_decision', decisionId: body.decision_id },
        outcome === 'already' ? t(lang, 'stock_already_recorded') : t(lang, 'saved'));
      return;
    }
    if (isUnanswered(answer)) setInDoubt(true);
    else if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const bad = (dateRef.current?.validity.badInput ?? false) || (timeRef.current?.validity.badInput ?? false);
    const moment = stockMoment(when, date, time, bad);
    if (!moment.ok) return setProblem(t(lang, 'stock_bad_moment'));
    const built = stockLines(kind, lines);
    if (!built.ok) return setProblem(problemText(lang, built.problem));
    setProblem(null);
    void send(adjustmentBody(ids, {
      facilityId, kind, occurredAt: moment.value, lines: built.value, reason, overrideReason: ctx.stockOverride ? override : '',
    }));
  }

  /** Is the decision there? Then the lost attempt made it. If not, nothing was recorded yet: a new id. */
  async function startOver() {
    setBusy(true);
    const found = await ctx.api.getStockDecision(facilityId, ids.decision_id);
    setBusy(false);
    if (found.ok) {
      ctx.navigate({ screen: 'stock_decision', decisionId: ids.decision_id }, t(lang, 'stock_already_recorded'));
    } else if (found.status === 'not_found') {
      setIds(formIds(['decision_id'] as const));
      sent.current = null;
      setInDoubt(false);
      setFailure(null);
    } else if (!ctx.onFailure(found)) {
      setFailure(found);
    }
  }

  const add = (item: Item) =>
    setLines((ls) => [...ls, { key: `l${++keySeq.current}`, item, itemUnitId: basePack(item), quantity: '', direction: '' }]);

  return (
    <section>
      <a href="#current_stock">{t(lang, 'back')}</a>
      <h1>{t(lang, 'record_movement')} · <bdi dir="ltr">{place.facility.code}</bdi></h1>
      <p className="muted">{t(lang, 'record_movement_hint')}</p>
      {problem ? <Notice tone="error" text={problem} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {failure?.constraint === WOULD_GO_NEGATIVE
        ? <Notice tone="info" text={t(lang, ctx.stockOverride ? 'override_offer' : 'override_not_held')} /> : null}
      {inDoubt && sent.current !== null
        ? <InDoubt lang={lang} busy={busy} onRetry={() => void send(sent.current!)} onStartOver={() => void startOver()} /> : null}
      <form className="form" onSubmit={submit}>
        {/* Locked while a request is out, not only once it is in doubt: what Retry resends is what was on screen. */}
        <fieldset className="plain" disabled={inDoubt || busy}>
          <Field label={t(lang, 'movement_kind')}>
            <select required value={kind} onChange={(e) => setKind(e.target.value as AdjustmentKind)}>
              {ADJUSTMENT_KINDS.map((k) => <option key={k} value={k}>{label(lang, `stock_kind_${k}`)}</option>)}
            </select>
          </Field>
          <p className="muted">{t(lang, kind === 'adjustment' ? 'adjustment_hint' : 'write_off_hint')}</p>
          <MomentFields lang={lang} legend={t(lang, 'occurred_at')} when={when} setWhen={setWhen}
            date={date} setDate={setDate} time={time} setTime={setTime} dateRef={dateRef} timeRef={timeRef} />
          <ItemFinder ctx={ctx} facilityId={facilityId} onAdd={add} />
          <Lines ctx={ctx} lines={lines} setLines={setLines} withDirection={kind === 'adjustment'} />
          <ReasonField lang={lang} value={reason} onChange={setReason} />
          {ctx.stockOverride ? (
            <Field label={t(lang, 'override_reason')} hint={t(lang, 'override_reason_hint')}>
              <input type="text" maxLength={500} value={override} onChange={(e) => setOverride(e.target.value)} />
            </Field>
          ) : null}
          <button type="submit" className="primary" disabled={busy}>{busy ? t(lang, 'saving') : t(lang, 'record_movement')}</button>
        </fieldset>
      </form>
    </section>
  );
}

/**
 * A count at the facility worked at (0020's erp.record_stock_count()): what was found,
 * line by line, in the packs it was found in. A partial count changes only the items it
 * lists; a count may find none. A count entered late states when it was made, and nothing
 * is then recorded at or before it (D3).
 */
export function StockCount({ ctx }: { ctx: Ctx }) {
  const { lang } = ctx;
  const place = stockPlace(ctx);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [when, setWhen] = useState<'now' | 'stated'>('now');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<readonly FormLine[]>([]);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inDoubt, setInDoubt] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const keySeq = useRef(0);
  // The request as first sent: Retry resends exactly this, never the fields as they are now.
  const sent = useRef<StockCountInput | null>(null);
  // One request at a time: two quick Enters sent the same id twice (found in review).
  const out = useRef(false);
  const status = useFacilityStatus(ctx, place.facility?.facility_id ?? null);
  // Lines typed are work: every way out of the page asks first (leave.ts).
  const { setLeaveGuard } = ctx;
  useEffect(() => {
    setLeaveGuard(() => lines.length > 0);
    return () => setLeaveGuard(null);
  }, [setLeaveGuard, lines.length]);

  if (place.facility === null) return <section><a href="#current_stock">{t(lang, 'back')}</a>{place.notice}</section>;
  if (status === 'closed') return <Notice tone="info" text={t(lang, 'rule_facility_no_new_work')} />;
  if (!writableHere(ctx.stockWritable, status)) return <Notice tone="info" text={t(lang, 'read_only_stock')} />;
  const facilityId = place.facility.facility_id;

  async function send(body: StockCountInput) {
    sent.current = body;
    if (out.current) return;
    out.current = true;
    setBusy(true);
    setFailure(null);
    const answer = await ctx.api.recordStockCount(body);
    out.current = false;
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'saved' || outcome === 'already') {
      ctx.navigate({ screen: 'stock_decision', decisionId: body.decision_id },
        outcome === 'already' ? t(lang, 'stock_already_recorded') : t(lang, 'saved'));
      return;
    }
    if (isUnanswered(answer)) setInDoubt(true);
    else if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const bad = (dateRef.current?.validity.badInput ?? false) || (timeRef.current?.validity.badInput ?? false);
    const moment = stockMoment(when, date, time, bad);
    if (!moment.ok) return setProblem(t(lang, 'stock_bad_moment'));
    const built = stockLines('count', lines);
    if (!built.ok) return setProblem(problemText(lang, built.problem));
    setProblem(null);
    void send(countBody(ids, { facilityId, countedAt: moment.value, lines: built.value, reason }));
  }

  /** Is the count there? Then the lost attempt made it. If not, nothing was recorded yet: a new id. */
  async function startOver() {
    setBusy(true);
    const found = await ctx.api.getStockDecision(facilityId, ids.decision_id);
    setBusy(false);
    if (found.ok) {
      ctx.navigate({ screen: 'stock_decision', decisionId: ids.decision_id }, t(lang, 'stock_already_recorded'));
    } else if (found.status === 'not_found') {
      setIds(formIds(['decision_id'] as const));
      sent.current = null;
      setInDoubt(false);
      setFailure(null);
    } else if (!ctx.onFailure(found)) {
      setFailure(found);
    }
  }

  const add = (item: Item) =>
    setLines((ls) => [...ls, { key: `l${++keySeq.current}`, item, itemUnitId: basePack(item), quantity: '', direction: '' }]);

  return (
    <section>
      <a href="#current_stock">{t(lang, 'back')}</a>
      <h1>{t(lang, 'record_count')} · <bdi dir="ltr">{place.facility.code}</bdi></h1>
      <p className="muted">{t(lang, 'record_count_hint')}</p>
      {problem ? <Notice tone="error" text={problem} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {inDoubt && sent.current !== null
        ? <InDoubt lang={lang} busy={busy} onRetry={() => void send(sent.current!)} onStartOver={() => void startOver()} /> : null}
      <form className="form" onSubmit={submit}>
        {/* Locked while a request is out, not only once it is in doubt: what Retry resends is what was on screen. */}
        <fieldset className="plain" disabled={inDoubt || busy}>
          <MomentFields lang={lang} legend={t(lang, 'counted_at')} when={when} setWhen={setWhen}
            date={date} setDate={setDate} time={time} setTime={setTime} dateRef={dateRef} timeRef={timeRef} />
          <ItemFinder ctx={ctx} facilityId={facilityId} onAdd={add} />
          <Lines ctx={ctx} lines={lines} setLines={setLines} withDirection={false} />
          <ReasonField lang={lang} value={reason} onChange={setReason} />
          <button type="submit" className="primary" disabled={busy}>{busy ? t(lang, 'saving') : t(lang, 'record_count')}</button>
        </fieldset>
      </form>
    </section>
  );
}
