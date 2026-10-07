import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  Failure, LimitDecision, LimitHistory, PurchaseOrder, PurchaseOrderRow, RaiseOrderInput, ReceiptRow, Supplier, SupplierDetail, Supply,
} from '../api.ts';
import type { Ctx } from '../context.ts';
import { formatFactor, shortId } from '../format.ts';
import { formIds } from '../ids.ts';
import { label, localName, t, type Lang } from '../i18n.ts';
import { isUnanswered, unitName, writeOutcome } from '../items.ts';
import {
  clearLimitBody, currentLimit, decideBody, DEFAULT_VAT, formatVat, limitInput, limitStamp, MAX_DELIVERY_NOTE,
  MAX_ORDER_LINES, ORDER_STATES, orderActions, orderLines, orderTotals, raiseBody, receiptBody, receiptLines,
  receiptReversalBody, receiptReversible, RECEIPT_WOULD_GO_NEGATIVE, setLimitBody, vatInput,
  type DraftOrderLine, type OrderDecision, type OrderLineProblem, type ReceiptProblem,
} from '../purchase-orders.ts';
import { formatQuantity, stockMoment, writableHere } from '../stock.ts';
import { formatMinor, formatRiyadh } from '../transfer-prices.ts';
import type { Done } from '../write.ts';
import { FailureNotice, Field, InDoubt, Loading, Notice, ReasonField } from './ui.tsx';
import { MomentFields } from './StockEntry.tsx';
import { stockPlace, useFacilityStatus } from './StockList.tsx';
import { useWrite } from './useWrite.tsx';

type Banner = { tone: 'ok' | 'info'; text: string } | null;

/** Who recorded something: the person's own name, or a short id for anyone else (as on every history). */
function personLabel(ctx: Ctx, id: string): string {
  const { lang, data } = ctx;
  return id === data.person.person_id
    ? (localName(lang, { name_en: data.person.full_name_en, name_ar: data.person.full_name_ar }) || shortId(id))
    : shortId(id);
}

function supplierName(lang: Lang, r: { supplier_name_en: string; supplier_name_ar: string }): string {
  return localName(lang, { name_en: r.supplier_name_en, name_ar: r.supplier_name_ar });
}

function StateBadge({ lang, state }: { lang: Lang; state: PurchaseOrderRow['state'] }) {
  const text = label(lang, `po_state_${state}`);
  return state === 'pending' ? <strong>{text}</strong> : state === 'approved' ? <span>{text}</span> : <em>{text}</em>;
}

/**
 * The orders at the facility worked at (erp.purchase_orders(), 0023), newest first, each
 * with its supplier, state, what has arrived and its total; one state alone on asking.
 * An order is raised from here and opened from its number.
 */
export function PurchaseOrdersList({ ctx }: { ctx: Ctx }) {
  const { api, lang } = ctx;
  const place = stockPlace(ctx);
  const facilityId = place.facility?.facility_id ?? null;
  const status = useFacilityStatus(ctx, facilityId);
  const raises = writableHere(ctx.purchase.raises, status);
  const [state, setState] = useState<PurchaseOrderRow['state'] | ''>('');
  const [rows, setRows] = useState<readonly PurchaseOrderRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Only the newest load may draw, as on the other lists.
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setRows(null);
    setNext(null);
    setFailure(null);
    setLoadingMore(false);
    if (facilityId === null) return;
    void api.purchaseOrders({ facilityId, state: state === '' ? null : state }).then((answer) => {
      if (mine !== seq.current) return;
      if (answer.ok) {
        setRows(answer.value.orders);
        setNext(answer.value.next_before);
      } else if (!ctx.onFailure(answer)) {
        setFailure(answer);
      }
    });
    return () => {
      seq.current++;
    };
  }, [api, facilityId, state]);

  async function older() {
    if (next === null || facilityId === null) return;
    const mine = ++seq.current;
    setLoadingMore(true);
    const answer = await api.purchaseOrders({ facilityId, state: state === '' ? null : state, before: next });
    if (mine !== seq.current) return;
    setLoadingMore(false);
    if (answer.ok) {
      setRows((current) => [...(current ?? []), ...answer.value.orders]);
      setNext(answer.value.next_before);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  if (place.facility === null) {
    return (
      <section>
        <header className="page-header"><h1>{t(lang, 'purchase_orders')}</h1></header>
        {place.notice}
      </section>
    );
  }

  return (
    <section>
      <header className="page-header">
        <h1>{t(lang, 'purchase_orders_at', { code: place.facility.code })} — {localName(lang, place.facility)}</h1>
        <div className="actions">
          {ctx.purchase.seesLimits ? <a className="button" href="#purchase_limits">{t(lang, 'purchase_limits')}</a> : null}
          {raises ? <a className="button primary" href="#purchase_orders/new">{t(lang, 'raise_order')}</a> : null}
        </div>
      </header>
      {status === 'closed' ? <Notice tone="info" text={t(lang, 'rule_facility_no_new_work')} />
        : !ctx.purchase.raises && !ctx.purchase.approves && !ctx.purchase.receives
          ? <Notice tone="info" text={t(lang, 'read_only_orders')} /> : null}

      <div className="filters">
        <select aria-label={t(lang, 'status')} value={state} onChange={(e) => setState(e.target.value as PurchaseOrderRow['state'] | '')}>
          <option value="">{t(lang, 'po_state_all')}</option>
          {ORDER_STATES.map((s) => <option key={s} value={s}>{label(lang, `po_state_${s}`)}</option>)}
        </select>
      </div>

      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {rows === null && failure === null ? <Loading lang={lang} /> : null}
      {rows !== null && rows.length === 0 ? <p className="muted">{t(lang, 'no_orders')}</p> : null}
      {rows !== null && rows.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t(lang, 'po_number')}</th>
              <th>{t(lang, 'business_date')}</th>
              <th>{t(lang, 'supplier')}</th>
              <th>{t(lang, 'status')}</th>
              <th>{t(lang, 'po_progress')}</th>
              <th>{t(lang, 'po_total')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.purchase_order_id} className={o.state === 'rejected' || o.state === 'cancelled' ? 'retired' : undefined}>
                <td className="code"><a href={`#purchase_orders/${o.purchase_order_id}`} dir="ltr">{o.number}</a></td>
                <td className="code"><bdi dir="ltr">{o.business_date}</bdi></td>
                <td><bdi dir="ltr">{o.supplier_code}</bdi> — {supplierName(lang, o)}</td>
                <td><StateBadge lang={lang} state={o.state} /></td>
                <td>{label(lang, `po_progress_${o.progress}`)}</td>
                <td className="code"><bdi dir="ltr">{formatMinor(lang, o.total_minor, o.currency)}</bdi></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {next !== null ? (
        <button type="button" onClick={() => void older()} disabled={loadingMore}>
          {loadingMore ? t(lang, 'loading') : t(lang, 'older')}
        </button>
      ) : null}
    </section>
  );
}

/** A line as the order form holds it. */
interface FormLine extends DraftOrderLine {
  readonly key: string;
}

function orderProblemText(lang: Lang, p: OrderLineProblem): string {
  switch (p.kind) {
    case 'no_lines': return t(lang, 'po_no_lines');
    case 'too_many': return t(lang, 'po_too_many_lines', { n: MAX_ORDER_LINES });
    case 'pack': return t(lang, 'po_line_pack', { line: p.line });
    case 'quantity': return t(lang, 'po_line_quantity', { line: p.line });
    case 'price': return t(lang, 'po_line_price', { line: p.line });
    case 'repeat': return t(lang, 'po_line_repeat', { line: p.line, first: p.first });
    case 'line_too_much': return t(lang, 'po_line_too_much', { line: p.line });
    case 'order_too_much': return t(lang, 'po_order_too_much');
  }
}

/** What a supplier sells that an order may name now: the supply, its pack and its item all current. */
function orderableSupplies(s: SupplierDetail): Supply[] {
  return (s.supplies ?? []).filter((x) => x.status === 'active' && x.conversion_status === 'active' && x.item_status === 'active');
}

/** Finds an active supplier by code or name. */
function SupplierFinder({ ctx, facilityId, onPick }: { ctx: Ctx; facilityId: string; onPick: (s: Supplier) => void }) {
  const { api, lang } = ctx;
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<readonly Supplier[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const seq = useRef(0);

  async function find() {
    const q = search.trim();
    if (q === '') return;
    const mine = ++seq.current;
    // An order commits the company to buy: only an active supplier takes one (0023).
    const answer = await api.listSuppliers({ facilityId, status: 'active', search: q, limit: 20 });
    if (mine !== seq.current) return;
    if (answer.ok) {
      setFound(answer.value.suppliers);
      setFailure(null);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  return (
    <div className="finder">
      <Field label={t(lang, 'find_supplier')} hint={t(lang, 'find_supplier_hint')}>
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
      {found !== null && found.length === 0 ? <p className="muted">{t(lang, 'no_suppliers_match')}</p> : null}
      {found !== null && found.length > 0 ? (
        <ul className="plain-list">
          {found.map((s) => (
            <li key={s.supplier_id}>
              <button type="button" className="small" onClick={() => onPick(s)}>{t(lang, 'choose')}</button>{' '}
              <bdi dir="ltr">{s.code}</bdi> — {localName(lang, s)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A new order at the facility worked at (0023's erp.raise_purchase_order()): one supplier,
 * up to 200 lines of what it sells, each a pack, a quantity and a price per pack in riyals,
 * and one VAT rate. The figures shown are the ones 0023 will record. Within the facility's
 * limit, someone else having set it, the order is approved when raised; otherwise it waits
 * for an approver (P3).
 */
export function PurchaseOrderNew({ ctx }: { ctx: Ctx }) {
  const { api, lang, data } = ctx;
  const place = stockPlace(ctx);
  const [ids, setIds] = useState(() => formIds(['decision_id', 'purchase_order_id'] as const));
  const [supplier, setSupplier] = useState<SupplierDetail | null>(null);
  const [supplierFailure, setSupplierFailure] = useState<Failure | null>(null);
  const [lines, setLines] = useState<readonly FormLine[]>([]);
  const [vat, setVat] = useState(DEFAULT_VAT);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inDoubt, setInDoubt] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const keySeq = useRef(0);
  const pick = useRef(0);
  // The request as first sent: Retry resends exactly this, never the fields as they are now.
  const sent = useRef<RaiseOrderInput | null>(null);
  // One request at a time: two quick Enters sent the same id twice (found in review, on stock).
  const out = useRef(false);
  const status = useFacilityStatus(ctx, place.facility?.facility_id ?? null);
  // A supplier chosen and lines typed are work: every way out of the page asks first (leave.ts).
  const { setLeaveGuard } = ctx;
  useEffect(() => {
    setLeaveGuard(() => lines.length > 0 || supplier !== null);
    return () => setLeaveGuard(null);
  }, [setLeaveGuard, lines.length, supplier]);

  if (place.facility === null) return <section><a href="#purchase_orders">{t(lang, 'back')}</a>{place.notice}</section>;
  if (status === 'closed') return <Notice tone="info" text={t(lang, 'rule_facility_no_new_work')} />;
  if (!writableHere(ctx.purchase.raises, status)) return <Notice tone="info" text={t(lang, 'read_only_orders')} />;
  const facilityId = place.facility.facility_id;

  async function choose(s: Supplier) {
    const mine = ++pick.current;
    setSupplierFailure(null);
    const answer = await api.getSupplier(facilityId, s.supplier_id);
    if (mine !== pick.current) return;
    if (answer.ok) {
      setSupplier(answer.value);
      setLines([]);
    } else if (!ctx.onFailure(answer)) {
      setSupplierFailure(answer);
    }
  }

  async function send(body: RaiseOrderInput) {
    sent.current = body;
    if (out.current) return;
    out.current = true;
    setBusy(true);
    setFailure(null);
    const answer = await api.raisePurchaseOrder(body);
    out.current = false;
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'saved' || outcome === 'already') {
      ctx.navigate({ screen: 'purchase_order', purchaseOrderId: body.purchase_order_id },
        outcome === 'already' ? t(lang, 'order_already_recorded') : t(lang, 'order_raised'));
      return;
    }
    if (isUnanswered(answer)) setInDoubt(true);
    else if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (supplier === null) return setProblem(t(lang, 'po_choose_supplier'));
    const rate = vatInput(vat);
    if (!rate.ok) return setProblem(t(lang, 'po_bad_vat'));
    const built = orderLines(lines);
    if (!built.ok) return setProblem(orderProblemText(lang, built.problem));
    setProblem(null);
    void send(raiseBody(ids, { facilityId, supplierId: supplier.supplier_id, vatRateBp: rate.value, lines: built.value, reason }));
  }

  /** Is the order there? Then the lost attempt raised it. If not, nothing was recorded yet: new ids. */
  async function startOver() {
    setBusy(true);
    // At the facility the request went to: after a switch, the order answers elsewhere as missing (found in review).
    const found = await api.getPurchaseOrder(sent.current?.facility_id ?? facilityId, ids.purchase_order_id);
    setBusy(false);
    if (found.ok) {
      ctx.navigate({ screen: 'purchase_order', purchaseOrderId: ids.purchase_order_id }, t(lang, 'order_already_recorded'));
    } else if (found.status === 'not_found') {
      setIds(formIds(['decision_id', 'purchase_order_id'] as const));
      sent.current = null;
      setInDoubt(false);
      setFailure(null);
    } else if (!ctx.onFailure(found)) {
      setFailure(found);
    }
  }

  const supplies = supplier === null ? [] : orderableSupplies(supplier);
  const change = (key: string, patch: Partial<DraftOrderLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = () => setLines((ls) => [...ls, { key: `l${++keySeq.current}`, itemUnitId: '', quantity: '', price: '' }]);
  // The figures, once every line and the rate read: the ones 0023 will record.
  const rate = vatInput(vat);
  const built = orderLines(lines);
  const totals = rate.ok && built.ok ? orderTotals(built.value, rate.value) : null;
  const locked = inDoubt || busy;

  return (
    <section>
      <a href="#purchase_orders">{t(lang, 'back')}</a>
      <h1>{t(lang, 'raise_order')} · <bdi dir="ltr">{place.facility.code}</bdi></h1>
      <p className="muted">{t(lang, 'raise_order_hint')}</p>
      {problem ? <Notice tone="error" text={problem} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {inDoubt && sent.current !== null
        ? <InDoubt lang={lang} busy={busy} onRetry={() => void send(sent.current!)} onStartOver={() => void startOver()} /> : null}
      <form className="form" onSubmit={submit}>
        {/* Locked while a request is out, not only once it is in doubt: what Retry resends is what was on screen. */}
        <fieldset className="plain" disabled={locked}>
          {supplier === null ? (
            <SupplierFinder ctx={ctx} facilityId={facilityId} onPick={(s) => void choose(s)} />
          ) : (
            <p>
              {t(lang, 'supplier')}: <strong><bdi dir="ltr">{supplier.code}</bdi> — {localName(lang, supplier)}</strong>{' '}
              <button type="button" className="small" onClick={() => {
                // Its lines are the supplier's packs: another supplier starts them again.
                if (lines.length === 0 || window.confirm(t(lang, 'po_change_supplier_confirm'))) {
                  pick.current++;
                  setSupplier(null);
                  setLines([]);
                }
              }}>{t(lang, 'po_change_supplier')}</button>
            </p>
          )}
          {supplierFailure ? <FailureNotice lang={lang} failure={supplierFailure} /> : null}
          {supplier !== null && supplier.supplies === null ? <Notice tone="info" text={t(lang, 'supplies_hidden')} /> : null}
          {supplier !== null && supplier.supplies !== null && supplies.length === 0
            ? <Notice tone="info" text={t(lang, 'po_supplier_sells_nothing')} /> : null}

          {supplier !== null && supplies.length > 0 ? (
            <>
              {lines.length === 0 ? <p className="muted">{t(lang, 'po_no_lines')}</p> : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th><th>{t(lang, 'pack')}</th><th>{t(lang, 'quantity')}</th>
                      <th>{t(lang, 'po_price_per_pack')}</th><th>{t(lang, 'po_amount')}</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const one = orderLines([l]);
                      return (
                        <tr key={l.key}>
                          <td>{i + 1}</td>
                          <td>
                            <select aria-label={t(lang, 'pack')} required value={l.itemUnitId}
                              onChange={(e) => change(l.key, { itemUnitId: e.target.value })}>
                              <option value="" disabled>—</option>
                              {supplies.map((s) => (
                                <option key={s.supplier_item_id} value={s.item_unit_id}>
                                  {s.item_code} — {localName(lang, { name_en: s.item_name_en, name_ar: s.item_name_ar })} ·{' '}
                                  {unitName(lang, data.units, s.unit_key)} ({formatFactor(s.factor)})
                                  {s.supplier_code ? ` · ${s.supplier_code}` : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input aria-label={t(lang, 'quantity')} dir="ltr" inputMode="decimal" required maxLength={19}
                              value={l.quantity} onChange={(e) => change(l.key, { quantity: e.target.value })} />
                          </td>
                          <td>
                            <input aria-label={t(lang, 'po_price_per_pack')} dir="ltr" inputMode="decimal" required maxLength={13}
                              value={l.price} onChange={(e) => change(l.key, { price: e.target.value })} />
                          </td>
                          <td><bdi dir="ltr">{one.ok ? formatMinor(lang, Number(orderTotals(one.value, 0).subtotal)) : '—'}</bdi></td>
                          <td>
                            <button type="button" className="small" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                              {t(lang, 'remove')}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <div>
                <button type="button" className="small" onClick={add} disabled={lines.length >= MAX_ORDER_LINES}>{t(lang, 'po_add_line')}</button>
              </div>
              <p className="muted">{t(lang, 'price_hint')}</p>
            </>
          ) : null}

          <Field label={t(lang, 'po_vat_rate')} hint={t(lang, 'po_vat_rate_hint')}>
            <input dir="ltr" inputMode="decimal" required maxLength={6} value={vat} onChange={(e) => setVat(e.target.value)} />
          </Field>
          <dl className="facts">
            <dt>{t(lang, 'po_subtotal')}</dt><dd><bdi dir="ltr">{totals === null ? '—' : formatMinor(lang, Number(totals.subtotal))}</bdi></dd>
            <dt>{t(lang, 'po_vat')}</dt><dd><bdi dir="ltr">{totals === null ? '—' : formatMinor(lang, Number(totals.vat))}</bdi></dd>
            <dt>{t(lang, 'po_total')}</dt><dd><strong><bdi dir="ltr">{totals === null ? '—' : formatMinor(lang, Number(totals.total))}</bdi></strong></dd>
          </dl>
          <ReasonField lang={lang} value={reason} onChange={setReason} />
          <button type="submit" className="primary" disabled={busy || supplier === null}>
            {busy ? t(lang, 'saving') : t(lang, 'raise_order')}
          </button>
        </fieldset>
      </form>
    </section>
  );
}

/**
 * One order at the facility worked at, whole (erp.get_purchase_order()): its lines with
 * what has arrived and what is still to come, every decision about it, every receipt and
 * its reversal; and, where the person may, the decisions its state admits and a receipt.
 */
export function PurchaseOrderPage({ ctx, purchaseOrderId }: { ctx: Ctx; purchaseOrderId: string }) {
  const { api, lang, data, onFailure } = ctx;
  const place = stockPlace(ctx);
  const facilityId = place.facility?.facility_id ?? null;
  const status = useFacilityStatus(ctx, facilityId);
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  // True from a write's answer until the page has read what it left: no form is offered
  // meanwhile, as what it offers depends on the order's state (stock alerts' rule).
  const [reloading, setReloading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (facilityId === null) return;
    const mine = ++seq.current;
    const answer = await api.getPurchaseOrder(facilityId, purchaseOrderId);
    if (mine !== seq.current) return;
    if (answer.ok) {
      setOrder(answer.value);
      setFailure(null);
      setReloading(false);
    } else if (!onFailure(answer)) {
      setFailure(answer);
    }
  }, [api, onFailure, facilityId, purchaseOrderId]);

  useEffect(() => {
    setOrder(null);
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  const afterWrite = (saved: string, already: string): Done => (outcome) => {
    setBanner(outcome === 'checked' ? null : outcome === 'already' ? { tone: 'info', text: already }
      : outcome === 'saved' ? { tone: 'ok', text: saved } : { tone: 'info', text: t(lang, 'order_changed') });
    setReloading(true);
    void load();
  };

  if (place.facility === null) return <section><a href="#purchase_orders">{t(lang, 'back')}</a>{place.notice}</section>;
  if (order === null) {
    return (
      <section>
        <a href="#purchase_orders">{t(lang, 'back')}</a>
        {failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />}
      </section>
    );
  }

  const facility = place.facility.facility_id;
  const actions = orderActions(order, data.person.person_id, ctx.purchase, status !== 'closed');
  const ownPending = order.state === 'pending' && order.raised_by === data.person.person_id && ctx.purchase.approves;
  const lineOf = new Map(order.lines.map((l) => [l.line_no, l]));
  const pack = (key: string) => unitName(lang, data.units, key);
  const decisionsDone = afterWrite(t(lang, 'saved'), t(lang, 'order_already_recorded'));

  return (
    <section>
      <a href="#purchase_orders">{t(lang, 'back')}</a>
      <header className="page-header">
        <h1><bdi dir="ltr">{order.number}</bdi> · <StateBadge lang={lang} state={order.state} /></h1>
      </header>
      {banner ? <Notice tone={banner.tone} text={banner.text} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {ownPending ? <Notice tone="info" text={t(lang, 'po_own_order')} /> : null}
      {order.state === 'pending' && order.supplier_status === 'retired' ? <Notice tone="info" text={t(lang, 'po_supplier_retired')} /> : null}

      <dl className="facts">
        <dt>{t(lang, 'supplier')}</dt>
        <dd>
          {ctx.seesSuppliers ? <a href={`#suppliers/${order.supplier_id}`} dir="ltr">{order.supplier_code}</a> : <bdi dir="ltr">{order.supplier_code}</bdi>}
          {' '}— {supplierName(lang, order)}
        </dd>
        <dt>{t(lang, 'business_date')}</dt><dd><bdi dir="ltr">{order.business_date}</bdi></dd>
        <dt>{t(lang, 'po_raised_by')}</dt><dd><span dir="ltr" title={order.raised_by}>{personLabel(ctx, order.raised_by)}</span> · {formatRiyadh(lang, order.raised_at)}</dd>
        <dt>{t(lang, 'po_progress')}</dt><dd>{label(lang, `po_progress_${order.progress}`)}</dd>
        <dt>{t(lang, 'po_subtotal')}</dt><dd><bdi dir="ltr">{formatMinor(lang, order.subtotal_minor, order.currency)}</bdi></dd>
        <dt>{t(lang, 'po_vat')} ({formatVat(order.vat_rate_bp)}%)</dt><dd><bdi dir="ltr">{formatMinor(lang, order.vat_minor, order.currency)}</bdi></dd>
        <dt>{t(lang, 'po_total')}</dt><dd><strong><bdi dir="ltr">{formatMinor(lang, order.total_minor, order.currency)}</bdi></strong></dd>
      </dl>

      <h2>{t(lang, 'po_lines')}</h2>
      <table className="table">
        <thead>
          <tr>
            <th>#</th><th>{t(lang, 'item_code')}</th><th>{t(lang, 'pack')}</th><th>{t(lang, 'po_ordered')}</th>
            <th>{t(lang, 'po_price_per_pack')}</th><th>{t(lang, 'po_amount')}</th>
            <th>{t(lang, 'po_received')}</th><th>{t(lang, 'po_remaining')}</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.line_no}>
              <td>{l.line_no}</td>
              <td><bdi dir="ltr">{l.code}</bdi> — {localName(lang, l)}</td>
              <td>{pack(l.unit_key)} (<bdi dir="ltr">{formatFactor(l.factor)}</bdi> {pack(l.base_unit_key)})</td>
              <td><bdi dir="ltr">{formatQuantity(l.quantity)}</bdi></td>
              <td className="code"><bdi dir="ltr">{formatMinor(lang, l.price_minor, order.currency)}</bdi></td>
              <td className="code"><bdi dir="ltr">{formatMinor(lang, l.amount_minor, order.currency)}</bdi></td>
              <td><bdi dir="ltr">{formatQuantity(l.received)}</bdi></td>
              <td><bdi dir="ltr">{formatQuantity(l.remaining)}</bdi></td>
            </tr>
          ))}
        </tbody>
      </table>

      {reloading && failure !== null
        ? <button type="button" onClick={() => { setFailure(null); void load(); }}>{t(lang, 'reload')}</button>
        : reloading ? <Loading lang={lang} /> : null}
      {!reloading ? (
        <div className="actions order-decisions">
          {(['approve', 'reject', 'cancel', 'close'] as const).filter((d) => actions[d]).map((d) => (
            <DecideOrder key={d} ctx={ctx} order={order} facilityId={facility} decision={d} onDone={decisionsDone} />
          ))}
        </div>
      ) : null}
      {!reloading && actions.receive
        ? <ReceiveForm ctx={ctx} order={order} facilityId={facility}
          onDone={afterWrite(t(lang, 'receipt_saved'), t(lang, 'receipt_already_recorded'))} /> : null}

      <h2>{t(lang, 'po_receipts')}</h2>
      {order.receipts.length === 0 ? <p className="muted">{t(lang, 'po_no_receipts')}</p> : (
        <table className="table">
          <thead>
            <tr>
              <th>{t(lang, 'po_received_at')}</th><th>{t(lang, 'po_delivery_note')}</th><th>{t(lang, 'po_lines')}</th>
              <th>{t(lang, 'decided_by')}</th><th />
            </tr>
          </thead>
          <tbody>
            {order.receipts.map((r) => (
              <tr key={r.decision_id} className={r.reversed_by_decision_id === null ? undefined : 'retired'}>
                <td>
                  {ctx.seesStock ? <a href={`#current_stock/decisions/${r.decision_id}`}>{formatRiyadh(lang, r.occurred_at)}</a>
                    : formatRiyadh(lang, r.occurred_at)}
                </td>
                <td><bdi>{r.delivery_note ?? '—'}</bdi></td>
                <td>
                  {r.lines.map((x) => {
                    const l = lineOf.get(x.order_line_no);
                    return (
                      <div key={x.order_line_no}>
                        {x.order_line_no}. <bdi dir="ltr">{formatQuantity(x.quantity)}</bdi> {l ? pack(l.unit_key) : ''}
                        {l ? <> · <bdi dir="ltr">{l.code}</bdi></> : null}
                      </div>
                    );
                  })}
                </td>
                <td dir="ltr" title={r.actor_id}>{personLabel(ctx, r.actor_id)}</td>
                <td>
                  {r.reversed_by_decision_id !== null ? (
                    <em>
                      {t(lang, 'po_receipt_reversed')}
                      {r.reversed_at !== null ? <> · {formatRiyadh(lang, r.reversed_at)}</> : null}
                    </em>
                  ) : !reloading && receiptReversible(r, ctx.purchase, status !== 'closed') ? (
                    <ReverseReceipt key={r.decision_id} ctx={ctx} order={order} receipt={r} facilityId={facility}
                      onDone={afterWrite(t(lang, 'saved'), t(lang, 'receipt_already_recorded'))} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>{t(lang, 'history')}</h2>
      <table className="table">
        <thead>
          <tr><th>{t(lang, 'decided_at')}</th><th>{t(lang, 'decision')}</th><th>{t(lang, 'reason')}</th><th>{t(lang, 'decided_by')}</th></tr>
        </thead>
        <tbody>
          {order.decisions.map((d) => (
            <tr key={d.decision_id}>
              <td>{formatRiyadh(lang, d.decided_at)}</td>
              <td>
                {label(lang, `kind_${d.kind}`)}
                {/* A raise is the one decision whose state is not its name: pending, or approved by the limit. */}
                {d.kind === 'order_raised' ? <> · {label(lang, `po_state_${d.state}`)}</> : null}
                {d.limit_decision_id !== null ? <div className="muted">{t(lang, 'po_approved_by_limit')}</div> : null}
              </td>
              <td><bdi>{d.reason}</bdi></td>
              <td dir="ltr" title={d.actor_id}>{personLabel(ctx, d.actor_id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const DECISION_KEYS = {
  approve: { button: 'po_approve', hint: 'po_approve_hint' },
  reject: { button: 'po_reject', hint: 'po_reject_hint' },
  cancel: { button: 'po_cancel', hint: 'po_cancel_hint' },
  close: { button: 'po_close', hint: 'po_close_hint' },
} as const;

/** Approve, reject, cancel or close: a button, then a reason. The decision is the path (write.ts: built once, retried as sent). */
function DecideOrder({ ctx, order, facilityId, decision, onDone }: {
  ctx: Ctx; order: PurchaseOrder; facilityId: string; decision: OrderDecision; onDone: Done;
}) {
  const { api, lang } = ctx;
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const w = useWrite(ctx, () => ctx.api.getPurchaseOrder(facilityId, order.purchase_order_id), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    setReason('');
  }, (seen) => (seen as PurchaseOrder).decisions.some((d) => d.decision_id === ids.decision_id));
  const keys = DECISION_KEYS[decision];
  const tone = decision === 'approve' ? 'primary' : decision === 'reject' || decision === 'cancel' ? 'danger' : undefined;

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = order.purchase_order_id;
    const body = decideBody(ids, { facilityId, reason });
    void w.run(() => api.decidePurchaseOrder(id, decision, body));
  }

  if (!open) {
    return <button type="button" className={tone} onClick={() => { setReason(''); setOpen(true); }}>{t(lang, keys.button)}</button>;
  }
  return (
    <form className="inline-form compact" onSubmit={submit}>
      <p className="muted">{t(lang, keys.hint)}</p>
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className={tone} disabled={w.busy}>{w.busy ? t(lang, 'saving') : t(lang, keys.button)}</button>
        <button type="button" onClick={() => setOpen(false)}>{t(lang, 'back')}</button>
      </fieldset>
    </form>
  );
}

function receiptProblemText(lang: Lang, p: ReceiptProblem): string {
  switch (p.kind) {
    case 'no_lines': return t(lang, 'receipt_no_lines');
    case 'quantity': return t(lang, 'receipt_line_quantity', { line: p.line });
    case 'exceeds': return t(lang, 'receipt_line_exceeds', { line: p.line });
  }
}

/**
 * Goods arrived against the order (0023's erp.receive_purchase_order()): for each line,
 * how much, in the pack ordered; when, now or stated (D3); and the supplier's delivery
 * note. It posts a stock receipt at the facility, in one decision.
 */
function ReceiveForm({ ctx, order, facilityId, onDone }: { ctx: Ctx; order: PurchaseOrder; facilityId: string; onDone: Done }) {
  const { api, lang, data } = ctx;
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [typed, setTyped] = useState<Readonly<Record<number, string>>>({});
  const [when, setWhen] = useState<'now' | 'stated'>('now');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // A receipt recorded under a lost answer looks like any other on the page: Start over
  // says it was saved, so the same goods are not received twice (found in review).
  const w = useWrite(ctx, () => ctx.api.getPurchaseOrder(facilityId, order.purchase_order_id), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setTyped({});
    setNote('');
  }, (seen) => (seen as PurchaseOrder).receipts.some((r) => r.decision_id === ids.decision_id));
  // Quantities typed are work: every way out of the page asks first (leave.ts).
  const { setLeaveGuard } = ctx;
  const dirty = Object.values(typed).some((v) => v.trim() !== '');
  useEffect(() => {
    setLeaveGuard(() => dirty);
    return () => setLeaveGuard(null);
  }, [setLeaveGuard, dirty]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const bad = (dateRef.current?.validity.badInput ?? false) || (timeRef.current?.validity.badInput ?? false);
    const moment = stockMoment(when, date, time, bad);
    if (!moment.ok) return setProblem(t(lang, 'stock_bad_moment'));
    const built = receiptLines(order, typed);
    if (!built.ok) return setProblem(receiptProblemText(lang, built.problem));
    setProblem(null);
    const id = order.purchase_order_id;
    const body = receiptBody(ids, { facilityId, receivedAt: moment.value, lines: built.value, deliveryNote: note });
    void w.run(() => api.receivePurchaseOrder(id, body));
  }

  const open = order.lines.filter((l) => l.remaining !== '0');
  return (
    <form className="inline-form" onSubmit={submit}>
      <h2>{t(lang, 'receive_goods')}</h2>
      <p className="muted">{t(lang, 'receive_goods_hint')}</p>
      {problem ? <Notice tone="error" text={problem} /> : null}
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
        <table className="table">
          <thead>
            <tr><th>#</th><th>{t(lang, 'item_code')}</th><th>{t(lang, 'po_remaining')}</th><th>{t(lang, 'po_arrived')}</th></tr>
          </thead>
          <tbody>
            {open.map((l) => (
              <tr key={l.line_no}>
                <td>{l.line_no}</td>
                <td><bdi dir="ltr">{l.code}</bdi> — {localName(lang, l)}</td>
                <td><bdi dir="ltr">{formatQuantity(l.remaining)}</bdi> {unitName(lang, data.units, l.unit_key)}</td>
                <td>
                  <input aria-label={t(lang, 'po_arrived')} dir="ltr" inputMode="decimal" maxLength={19}
                    value={typed[l.line_no] ?? ''} onChange={(e) => setTyped((m) => ({ ...m, [l.line_no]: e.target.value }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <MomentFields lang={lang} legend={t(lang, 'po_received_at')} when={when} setWhen={setWhen}
          date={date} setDate={setDate} time={time} setTime={setTime} dateRef={dateRef} timeRef={timeRef} />
        <Field label={t(lang, 'po_delivery_note')} hint={t(lang, 'po_delivery_note_hint')}>
          <input type="text" dir="ltr" maxLength={MAX_DELIVERY_NOTE} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button type="submit" className="primary" disabled={w.busy}>{w.busy ? t(lang, 'saving') : t(lang, 'receive_goods')}</button>
      </fieldset>
    </form>
  );
}

/**
 * A receipt taken back whole (0023's erp.reverse_purchase_receipt()): the goods go back
 * out of stock and the order's lines reopen. Refused once the item has been counted since
 * (D3); below zero only with the override and its reason (D1).
 */
function ReverseReceipt({ ctx, order, receipt, facilityId, onDone }: {
  ctx: Ctx; order: PurchaseOrder; receipt: ReceiptRow; facilityId: string; onDone: Done;
}) {
  const { api, lang } = ctx;
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState('');
  const w = useWrite(ctx, () => ctx.api.getPurchaseOrder(facilityId, order.purchase_order_id), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    setReason('');
    setOverride('');
  }, (seen) => (seen as PurchaseOrder).receipts.some((r) => r.reversed_by_decision_id === ids.decision_id));

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = receipt.decision_id;
    const body = receiptReversalBody(ids, { facilityId, reason, overrideReason: ctx.stockOverride ? override : '' });
    void w.run(() => api.reversePurchaseReceipt(id, body));
  }

  if (!open) {
    return <button type="button" className="small danger" onClick={() => { setReason(''); setOpen(true); }}>{t(lang, 'po_reverse_receipt')}</button>;
  }
  return (
    <form className="inline-form compact" onSubmit={submit}>
      <p className="muted">{t(lang, 'po_reverse_receipt_hint')}</p>
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.failure?.constraint === RECEIPT_WOULD_GO_NEGATIVE
        ? <Notice tone="info" text={t(lang, ctx.stockOverride ? 'override_offer' : 'override_not_held')} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        {ctx.stockOverride ? (
          <Field label={t(lang, 'override_reason')} hint={t(lang, 'override_reason_hint')}>
            <input type="text" maxLength={500} value={override} onChange={(e) => setOverride(e.target.value)} />
          </Field>
        ) : null}
        <button type="submit" className="danger" disabled={w.busy}>{w.busy ? t(lang, 'saving') : t(lang, 'po_reverse_receipt')}</button>
        <button type="button" onClick={() => setOpen(false)}>{t(lang, 'back')}</button>
      </fieldset>
    </form>
  );
}

/**
 * The approval limit at the facility worked at (erp.purchase_limit_history(), 0023): the
 * one in force, every decision about it, and, for whoever may, a form to set it and one to
 * clear it, each against the decision in force (purchase-orders.ts, limitStamp). An order
 * whose subtotal before VAT is within it is approved when raised, unless its raiser set it.
 */
export function PurchaseLimits({ ctx }: { ctx: Ctx }) {
  const { api, lang, onFailure } = ctx;
  const place = stockPlace(ctx);
  const facilityId = place.facility?.facility_id ?? null;
  const status = useFacilityStatus(ctx, facilityId);
  const writable = writableHere(ctx.purchase.setsLimits, status);
  const [history, setHistory] = useState<readonly LimitDecision[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloading, setReloading] = useState(false);
  const seq = useRef(0);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (facilityId === null) return;
    const mine = ++seq.current;
    generation.current++;
    setLoadingMore(false);
    const answer = await api.purchaseLimitHistory(facilityId);
    if (mine !== seq.current) return;
    if (answer.ok) {
      setHistory(answer.value.decisions);
      setNext(answer.value.next_before);
      setFailure(null);
      setReloading(false);
    } else if (!onFailure(answer)) {
      setFailure(answer);
    }
  }, [api, onFailure, facilityId]);

  useEffect(() => {
    setHistory(null);
    setNext(null);
    if (ctx.purchase.seesLimits) void load();
    return () => {
      seq.current++;
    };
  }, [load, ctx.purchase.seesLimits]);

  async function older() {
    if (next === null || facilityId === null || reloading) return;
    const mine = generation.current;
    setLoadingMore(true);
    const answer = await api.purchaseLimitHistory(facilityId, next);
    if (mine !== generation.current) return;
    setLoadingMore(false);
    if (answer.ok) {
      setHistory((current) => [...(current ?? []), ...answer.value.decisions]);
      setNext(answer.value.next_before);
    } else if (!onFailure(answer)) {
      setFailure(answer);
    }
  }

  const afterWrite: Done = (outcome) => {
    setBanner(outcome === 'checked' ? null : outcome === 'saved' ? { tone: 'ok', text: t(lang, 'saved') }
      : outcome === 'already' ? { tone: 'info', text: t(lang, 'limit_already_recorded') }
        : { tone: 'info', text: t(lang, 'limit_changed') });
    setReloading(true);
    void load();
  };

  // Reached from the orders list, or from its own entry by someone who reads no orders.
  const back = ctx.seesPurchaseOrders ? <a href="#purchase_orders">{t(lang, 'back')}</a> : null;
  if (place.facility === null) {
    return (
      <section>
        <header className="page-header"><h1>{t(lang, 'purchase_limits')}</h1></header>
        {place.notice}
      </section>
    );
  }
  if (!ctx.purchase.seesLimits) return <Notice tone="info" text={t(lang, 'refusal_forbidden')} />;
  if (history === null) {
    return (
      <section>
        {back}
        {failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />}
      </section>
    );
  }

  const current = currentLimit(history);
  const stamp = limitStamp(history);
  return (
    <section>
      {back}
      <header className="page-header">
        <h1>{t(lang, 'purchase_limits_at', { code: place.facility.code })} — {localName(lang, place.facility)}</h1>
      </header>
      <p className="muted">{t(lang, 'purchase_limits_hint')}</p>
      {banner ? <Notice tone={banner.tone} text={banner.text} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {status === 'closed' ? <Notice tone="info" text={t(lang, 'rule_facility_no_new_work')} />
        : !writable ? <Notice tone="info" text={t(lang, 'read_only_limits')} /> : null}
      <p>
        {t(lang, 'po_limit')}:{' '}
        {current === null || current.limit_minor === null ? <em>{t(lang, 'po_no_limit')}</em>
          : <strong><bdi dir="ltr">{formatMinor(lang, current.limit_minor, current.currency ?? undefined)}</bdi></strong>}
      </p>

      {reloading && failure !== null
        ? <button type="button" onClick={() => { setFailure(null); void load(); }}>{t(lang, 'reload')}</button>
        : reloading ? <Loading lang={lang} /> : null}
      {writable && !reloading ? <SetLimit ctx={ctx} facilityId={place.facility.facility_id} stamp={stamp} onDone={afterWrite} /> : null}
      {writable && !reloading && current !== null && stamp !== null
        ? <ClearLimit ctx={ctx} facilityId={place.facility.facility_id} stamp={stamp} onDone={afterWrite} /> : null}

      <h2>{t(lang, 'history')}</h2>
      {history.length === 0 ? <p className="muted">{t(lang, 'po_no_limit_history')}</p> : (
        <table className="table">
          <thead>
            <tr><th>{t(lang, 'decided_at')}</th><th>{t(lang, 'decision')}</th><th>{t(lang, 'reason')}</th><th>{t(lang, 'decided_by')}</th></tr>
          </thead>
          <tbody>
            {history.map((d) => (
              <tr key={d.decision_id} className={d.is_current ? undefined : 'retired'}>
                <td>{formatRiyadh(lang, d.decided_at)}</td>
                <td>
                  {label(lang, `kind_${d.kind}`)}
                  {d.limit_minor !== null ? <> · <bdi dir="ltr">{formatMinor(lang, d.limit_minor, d.currency ?? undefined)}</bdi></> : null}
                </td>
                <td><bdi>{d.reason}</bdi></td>
                <td dir="ltr" title={d.actor_id}>{personLabel(ctx, d.actor_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next !== null ? (
        <button type="button" onClick={() => void older()} disabled={loadingMore || reloading}>
          {loadingMore ? t(lang, 'loading') : t(lang, 'older')}
        </button>
      ) : null}
    </section>
  );
}

/** A limit in riyals before VAT, against the stamp the page read (write.ts: built once, retried as sent). */
function SetLimit({ ctx, facilityId, stamp, onDone }: { ctx: Ctx; facilityId: string; stamp: string | null; onDone: Done }) {
  const { api, lang } = ctx;
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState(false);
  const w = useWrite(ctx, () => ctx.api.purchaseLimitHistory(facilityId), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setAmount('');
    setReason('');
  }, (seen) => (seen as LimitHistory).decisions.some((d) => d.decision_id === ids.decision_id));

  function submit(e: FormEvent) {
    e.preventDefault();
    const a = limitInput(amount);
    if (!a.ok) return setProblem(true);
    setProblem(false);
    const body = setLimitBody(ids, { facilityId, limitMinor: a.value, expectedDecisionId: stamp, reason });
    void w.run(() => api.setPurchaseLimit(body));
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <h3>{t(lang, 'set_limit')}</h3>
      <p className="muted">{t(lang, 'set_limit_hint')}</p>
      {problem ? <Notice tone="error" text={t(lang, 'limit_bad_amount')} /> : null}
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
        <Field label={t(lang, 'po_limit')} hint={t(lang, 'price_hint')}>
          <input dir="ltr" inputMode="decimal" required maxLength={15} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className="primary" disabled={w.busy}>{w.busy ? t(lang, 'saving') : t(lang, 'set_limit')}</button>
      </fieldset>
    </form>
  );
}

/** No limit here: every order waits for an approver. Against the stamp read, as a set is. */
function ClearLimit({ ctx, facilityId, stamp, onDone }: { ctx: Ctx; facilityId: string; stamp: string; onDone: Done }) {
  const { api, lang } = ctx;
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const w = useWrite(ctx, () => ctx.api.purchaseLimitHistory(facilityId), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    setReason('');
  }, (seen) => (seen as LimitHistory).decisions.some((d) => d.decision_id === ids.decision_id));

  function submit(e: FormEvent) {
    e.preventDefault();
    const body = clearLimitBody(ids, { facilityId, expectedDecisionId: stamp, reason });
    void w.run(() => api.clearPurchaseLimit(body));
  }

  if (!open) {
    return <button type="button" className="danger" onClick={() => { setReason(''); setOpen(true); }}>{t(lang, 'clear_limit')}</button>;
  }
  return (
    <form className="inline-form compact" onSubmit={submit}>
      <p className="muted">{t(lang, 'clear_limit_hint')}</p>
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className="danger" disabled={w.busy}>{w.busy ? t(lang, 'saving') : t(lang, 'clear_limit')}</button>
        <button type="button" onClick={() => setOpen(false)}>{t(lang, 'back')}</button>
      </fieldset>
    </form>
  );
}
