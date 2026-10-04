import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Failure, Item, SupplierDecision, SupplierDetail as Detail, Supply } from '../api.ts';
import type { Ctx } from '../context.ts';
import { formatDateTime, formatFactor, shortId } from '../format.ts';
import { formIds } from '../ids.ts';
import { label, localName, t } from '../i18n.ts';
import { isUnanswered, optional, unitName, writeOutcome } from '../items.ts';
import { amendSupplyBody, hasContact, suppliablePacks, supplyChange, supplyWarning } from '../suppliers.ts';
import { FailureNotice, Field, InDoubt, Loading, Notice, ReasonField } from './ui.tsx';

type Banner = { tone: 'ok' | 'info'; text: string } | null;

/** What a sub-form reports: a write's outcome, or 'checked' after a fresh look at what is saved. */
type Done = (outcome: 'saved' | 'already' | 'stale' | 'checked') => void;

/**
 * One supplier: its business record, its contact, what it sells, and every decision ever
 * recorded about it — none of which carries a contact value (SEC-008). Changes are
 * offered only where the database would accept them (Ctx.suppliersWritable), and every
 * one carries ids minted when its form opened (ids.ts).
 */
export function SupplierDetail({ ctx, supplierId }: { ctx: Ctx; supplierId: string }) {
  const { api, lang, data, facilityId, onFailure } = ctx;
  const [supplier, setSupplier] = useState<Detail | null>(null);
  const [history, setHistory] = useState<readonly SupplierDecision[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [banner, setBanner] = useState<Banner>(null);

  // Only the newest load may draw, as on the item page.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const [s, h] = await Promise.all([api.getSupplier(facilityId, supplierId), api.supplierHistory(facilityId, supplierId)]);
    if (mine !== seq.current) return;
    if (!s.ok) {
      if (!onFailure(s)) setFailure(s);
      return;
    }
    setSupplier(s.value);
    setFailure(null);
    if (h.ok) setHistory(h.value);
    else if (!onFailure(h)) setFailure(h);
  }, [api, onFailure, facilityId, supplierId]);

  useEffect(() => {
    setSupplier(null);
    setHistory(null);
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  const afterWrite: Done = (outcome) => {
    setBanner(outcome === 'checked' ? null : outcome === 'saved' ? { tone: 'ok', text: t(lang, 'saved') }
      : outcome === 'already' ? { tone: 'info', text: t(lang, 'supplier_already_recorded') }
      : { tone: 'info', text: t(lang, 'rule_supplier_stale') });
    void load();
  };

  if (supplier === null) {
    return (
      <section>
        <a href="#suppliers">{t(lang, 'back')}</a>
        {failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />}
      </section>
    );
  }

  const active = supplier.status === 'active';
  const writable = ctx.suppliersWritable;
  const itemCode = (itemId: string | null) =>
    itemId === null ? '' : supplier.supplies?.find((x) => x.item_id === itemId)?.item_code ?? shortId(itemId);

  return (
    <section>
      <a href="#suppliers">{t(lang, 'back')}</a>
      <header className="page-header">
        <h1><span dir="ltr">{supplier.code}</span> — {localName(lang, supplier)}</h1>
        {writable && active ? (
          <div className="actions">
            <a className="button primary" href={`#suppliers/${supplier.supplier_id}/edit`}>{t(lang, 'edit_supplier')}</a>
          </div>
        ) : null}
      </header>
      {banner ? <Notice tone={banner.tone} text={banner.text} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}

      <dl className="facts">
        <dt>{t(lang, 'status')}</dt>
        <dd>{active ? t(lang, 'status_active') : t(lang, 'status_retired')}</dd>
        <dt>{t(lang, 'name_en')}</dt><dd><bdi>{supplier.name_en}</bdi></dd>
        <dt>{t(lang, 'name_ar')}</dt><dd><bdi>{supplier.name_ar}</bdi></dd>
        <dt>{t(lang, 'vat_number')}</dt><dd><bdi dir="ltr">{supplier.vat_number ?? '—'}</bdi></dd>
        <dt>{t(lang, 'cr_number')}</dt><dd><bdi dir="ltr">{supplier.cr_number ?? '—'}</bdi></dd>
        <dt>{t(lang, 'payment_terms_days')}</dt><dd>{t(lang, 'days', { n: supplier.payment_terms_days })}</dd>
      </dl>

      <h2>{t(lang, 'contact')}</h2>
      {hasContact(supplier) ? (
        <dl className="facts">
          {supplier.contact_person ? <><dt>{t(lang, 'contact_person')}</dt><dd><bdi>{supplier.contact_person}</bdi></dd></> : null}
          {supplier.phone ? <><dt>{t(lang, 'phone')}</dt><dd><bdi dir="ltr">{supplier.phone}</bdi></dd></> : null}
          {supplier.email ? <><dt>{t(lang, 'email')}</dt><dd><bdi dir="ltr">{supplier.email}</bdi></dd></> : null}
          {supplier.address ? <><dt>{t(lang, 'address')}</dt><dd><bdi>{supplier.address}</bdi></dd></> : null}
        </dl>
      ) : <p className="muted">{t(lang, 'no_contact')}</p>}
      {/* Erasure works on a retired supplier too: an erasure request does not wait (§2). */}
      {writable ? <p><a className="button" href={`#suppliers/${supplier.supplier_id}/contact`}>{t(lang, 'edit_contact')}</a></p> : null}

      <h2>{t(lang, 'supplies')}</h2>
      {supplier.supplies === null ? <p className="muted">{t(lang, 'supplies_hidden')}</p>
        : supplier.supplies.length === 0 ? <p className="muted">{t(lang, 'no_supplies')}</p> : (
        <table className="table">
          <thead>
            <tr>
              <th>{t(lang, 'item')}</th><th>{t(lang, 'pack')}</th><th>{t(lang, 'factor')}</th><th>{t(lang, 'their_code')}</th>
              <th>{t(lang, 'preferred')}</th><th>{t(lang, 'status')}</th><th />
            </tr>
          </thead>
          <tbody>
            {supplier.supplies.map((x) => {
              const warning = supplyWarning(x);
              return (
                <tr key={x.supplier_item_id} className={x.status === 'retired' ? 'retired' : undefined}>
                  <td><a href={`#items/${x.item_id}`} dir="ltr">{x.item_code}</a> {localName(lang, { name_en: x.item_name_en, name_ar: x.item_name_ar })}</td>
                  <td>{unitName(lang, data.units, x.unit_key)}</td>
                  <td><bdi dir="ltr">{formatFactor(x.factor)}</bdi></td>
                  <td><bdi dir="ltr">{x.supplier_code ?? ''}</bdi></td>
                  <td>{x.preferred ? t(lang, 'yes') : ''}</td>
                  <td>
                    {x.status === 'active' ? t(lang, 'status_active') : t(lang, 'supply_retired')}
                    {x.status === 'active' && warning ? <> · <em>{t(lang, warning === 'item_retired' ? 'item_retired_note' : 'pack_retired_note')}</em></> : null}
                  </td>
                  <td>
                    {writable && x.status === 'active'
                      ? <SupplyActions ctx={ctx} supply={x} supplierActive={active} supplierId={supplier.supplier_id} onDone={afterWrite} />
                      : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {writable && active && supplier.supplies !== null
        ? <AddSupply ctx={ctx} supplier={supplier} onDone={afterWrite} /> : null}

      {writable ? <StatusChange ctx={ctx} supplier={supplier} onDone={afterWrite} /> : null}

      <h2>{t(lang, 'history')}</h2>
      {history === null ? <Loading lang={lang} /> : (
        <table className="table">
          <thead>
            <tr><th>{t(lang, 'decided_at')}</th><th>{t(lang, 'decision')}</th><th>{t(lang, 'reason')}</th><th>{t(lang, 'decided_by')}</th></tr>
          </thead>
          <tbody>
            {[...history].reverse().map((d) => (
              <tr key={d.decision_id}>
                <td>{formatDateTime(lang, d.decided_at)}</td>
                <td>
                  {label(lang, `kind_${d.kind}`)}
                  {d.unit_key ? <> · <span dir="ltr">{itemCode(d.item_id)}</span> {unitName(lang, data.units, d.unit_key)} ({formatFactor(d.factor)}){d.preferred ? ` · ${t(lang, 'preferred')}` : ''}</> : null}
                  {d.kind === 'supplier_status_changed' ? <> · {d.status === 'active' ? t(lang, 'status_active') : t(lang, 'status_retired')}</> : null}
                </td>
                <td><bdi>{d.reason}</bdi></td>
                <td dir="ltr" title={d.actor_id}>{d.actor_id === data.person.person_id ? (localName(lang, {
                  name_en: data.person.full_name_en, name_ar: data.person.full_name_ar,
                }) || shortId(d.actor_id)) : shortId(d.actor_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * After an unanswered write on this page: can the supplier be read now? Then whatever the
 * lost attempt did is visible, and a new decision is safe under new ids — the database
 * refuses a second active supply of one pack, a second retirement and a stale change.
 */
async function seeWhatIsSaved(ctx: Ctx, supplierId: string): Promise<boolean> {
  const now = await ctx.api.getSupplier(ctx.facilityId, supplierId);
  if (now.ok) return true;
  ctx.onFailure(now);
  return false;
}

/** One form's write lifecycle: send, an unanswered attempt locks the form, Start over looks first. */
function useWrite(ctx: Ctx, supplierId: string, onDone: Done, after: () => void) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [inDoubt, setInDoubt] = useState(false);
  async function run(write: () => Promise<Parameters<typeof writeOutcome>[0]>) {
    setBusy(true);
    setFailure(null);
    const answer = await write();
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'failed') {
      if (isUnanswered(answer)) setInDoubt(true);
      else if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
      return;
    }
    after();
    onDone(outcome);
  }
  async function startOver() {
    setBusy(true);
    const seen = await seeWhatIsSaved(ctx, supplierId);
    setBusy(false);
    if (!seen) return;
    setInDoubt(false);
    after();
    onDone('checked');
  }
  return { busy, failure, inDoubt, run, startOver };
}

function SupplyActions({ ctx, supply, supplierActive, supplierId, onDone }: {
  ctx: Ctx; supply: Supply; supplierActive: boolean; supplierId: string; onDone: Done;
}) {
  const { api, lang } = ctx;
  const change = supplyChange(supply, supplierActive);
  const [open, setOpen] = useState<'amend' | 'retire' | null>(null);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [code, setCode] = useState(supply.supplier_code ?? '');
  const [preferred, setPreferred] = useState(supply.preferred);
  const [reason, setReason] = useState('');
  const w = useWrite(ctx, supplierId, onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(null);
    setReason('');
  });

  function submit(e?: FormEvent) {
    e?.preventDefault();
    void w.run(() => open === 'retire'
      ? api.retireSupply(supply.supplier_item_id, { decision_id: ids.decision_id, reason: reason.trim() })
      // A retired supplier may only give up the slot: its own code is sent unchanged.
      : api.amendSupply(supply.supplier_item_id, amendSupplyBody(supply, ids.decision_id, {
        supplierCode: change === 'unprefer' ? supply.supplier_code ?? '' : code, preferred, reason,
      })));
  }

  if (open === null) {
    return (
      <span className="actions">
        {change !== 'none' ? <button type="button" className="small" onClick={() => setOpen('amend')}>{t(lang, 'amend_supply')}</button> : null}
        <button type="button" className="small danger" onClick={() => setOpen('retire')}>{t(lang, 'retire_supply')}</button>
      </span>
    );
  }
  return (
    <form className="inline-form compact" onSubmit={submit}>
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={() => submit()} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.inDoubt}>
      {open === 'amend' ? (
        <>
          {change === 'unprefer' ? <p className="muted">{t(lang, 'unprefer_only')}</p> : null}
          {change === 'no_prefer' ? <p className="muted">{t(lang, 'no_prefer_now')}</p> : null}
          {change !== 'unprefer' ? (
            <Field label={t(lang, 'their_code')}>
              <input dir="ltr" maxLength={64} value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          ) : null}
          <label className="check">
            <input type="checkbox" checked={preferred}
              disabled={(change === 'unprefer' || change === 'no_prefer') && !preferred}
              onChange={(e) => setPreferred(e.target.checked)} />
            {t(lang, 'preferred')}
          </label>
        </>
      ) : null}
      <ReasonField lang={lang} value={reason} onChange={setReason} />
      <button type="submit" className={open === 'retire' ? 'danger small' : 'primary small'} disabled={w.busy}>
        {w.busy ? t(lang, 'saving') : open === 'retire' ? t(lang, 'retire_supply') : t(lang, 'save')}
      </button>
      <button type="button" className="small" onClick={() => setOpen(null)}>{t(lang, 'cancel')}</button>
      </fieldset>
    </form>
  );
}

const SUPPLY_IDS = ['decision_id', 'supplier_item_id'] as const;

/**
 * What the supplier sells, named down to the pack (ADR-0026 §3): find an item, then pick
 * one of its active conversions the supplier does not sell already.
 */
function AddSupply({ ctx, supplier, onDone }: { ctx: Ctx; supplier: Detail; onDone: Done }) {
  const { api, lang, data } = ctx;
  const [ids, setIds] = useState(() => formIds(SUPPLY_IDS));
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<readonly Item[] | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [unitId, setUnitId] = useState('');
  const [code, setCode] = useState('');
  const [preferred, setPreferred] = useState(false);
  const [reason, setReason] = useState('');
  const [lookFailure, setLookFailure] = useState<Failure | null>(null);
  const w = useWrite(ctx, supplier.supplier_id, onDone, () => {
    setIds(formIds(SUPPLY_IDS));
    setItem(null);
    setFound(null);
    setSearch('');
    setUnitId('');
    setCode('');
    setPreferred(false);
    setReason('');
  });

  async function find(e: FormEvent) {
    e.preventDefault();
    setLookFailure(null);
    setItem(null);
    setUnitId('');
    const answer = await api.listItems({ facilityId: ctx.facilityId, status: 'active', search: search.trim() || null, limit: 20 });
    if (answer.ok) setFound(answer.value.items);
    else if (!ctx.onFailure(answer)) setLookFailure(answer);
  }

  async function choose(itemId: string) {
    setUnitId('');
    setLookFailure(null);
    if (itemId === '') {
      setItem(null);
      return;
    }
    const answer = await api.getItem(ctx.facilityId, itemId);
    if (answer.ok) setItem(answer.value);
    else if (!ctx.onFailure(answer)) setLookFailure(answer);
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    void w.run(() => api.addSupply(supplier.supplier_id, {
      ...ids, item_unit_id: unitId, supplier_code: optional(code), preferred, reason: reason.trim(),
    }));
  }

  const packs = item === null ? [] : suppliablePacks(item.units, supplier.supplies);
  return (
    <div className="inline-form">
      <h3>{t(lang, 'add_supply')}</h3>
      {lookFailure ? <FailureNotice lang={lang} failure={lookFailure} /> : null}
      <form className="filters" onSubmit={(e) => void find(e)}>
        <input type="search" aria-label={t(lang, 'find_item')} placeholder={t(lang, 'find_item')} maxLength={100}
          value={search} onChange={(e) => setSearch(e.target.value)} disabled={w.inDoubt} />
        <button type="submit" disabled={w.inDoubt}>{t(lang, 'find')}</button>
      </form>
      {found !== null && found.length === 0 ? <p className="muted">{t(lang, 'no_items')}</p> : null}
      {found !== null && found.length > 0 ? (
        <form onSubmit={submit}>
          {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
          {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={() => submit()} onStartOver={() => void w.startOver()} /> : null}
          <fieldset className="plain" disabled={w.inDoubt}>
          <Field label={t(lang, 'choose_item')}>
            <select required value={item?.item_id ?? ''} onChange={(e) => void choose(e.target.value)}>
              <option value="" disabled>—</option>
              {found.map((i) => <option key={i.item_id} value={i.item_id}>{i.code} — {localName(lang, i)}</option>)}
            </select>
          </Field>
          {item !== null && packs.length === 0 ? <p className="muted">{t(lang, 'no_packs')}</p> : null}
          {item !== null && packs.length > 0 ? (
            <>
              <Field label={t(lang, 'choose_pack')}>
                <select required value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                  <option value="" disabled>—</option>
                  {packs.map((u) => (
                    <option key={u.item_unit_id} value={u.item_unit_id}>
                      {unitName(lang, data.units, u.unit_key)} = {formatFactor(u.factor)} {unitName(lang, data.units, item.base_unit_key)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t(lang, 'their_code')} hint={t(lang, 'their_code_hint')}>
                <input dir="ltr" maxLength={64} value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <label className="check">
                <input type="checkbox" checked={preferred} onChange={(e) => setPreferred(e.target.checked)} />
                {t(lang, 'preferred')}
              </label>
              <p className="field-hint">{t(lang, 'preferred_hint')}</p>
              <ReasonField lang={lang} value={reason} onChange={setReason} />
              <button type="submit" className="primary" disabled={w.busy || unitId === ''}>
                {w.busy ? t(lang, 'saving') : t(lang, 'add_supply')}
              </button>
            </>
          ) : null}
          </fieldset>
        </form>
      ) : null}
    </div>
  );
}

function StatusChange({ ctx, supplier, onDone }: { ctx: Ctx; supplier: Detail; onDone: Done }) {
  const { api, lang } = ctx;
  const target = supplier.status === 'active' ? 'retired' : 'active';
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const w = useWrite(ctx, supplier.supplier_id, onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    setReason('');
  });

  function submit(e?: FormEvent) {
    e?.preventDefault();
    void w.run(() => api.changeSupplierStatus(supplier.supplier_id, {
      ...ids, expected_decision_id: supplier.as_of_decision_id, status: target, reason: reason.trim(),
    }));
  }

  const verb = target === 'retired' ? t(lang, 'retire_supplier') : t(lang, 'reinstate_supplier');
  if (!open) {
    return (
      <p>
        <button type="button" className={target === 'retired' ? 'danger' : undefined} onClick={() => setOpen(true)}>{verb}</button>
      </p>
    );
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <h3>{verb}</h3>
      {target === 'retired' ? <p className="muted">{t(lang, 'retire_supplier_hint')}</p> : null}
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={() => submit()} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.inDoubt}>
      <ReasonField lang={lang} value={reason} onChange={setReason} />
      <button type="submit" className={target === 'retired' ? 'danger' : 'primary'} disabled={w.busy}>
        {w.busy ? t(lang, 'saving') : verb}
      </button>
      <button type="button" onClick={() => setOpen(false)}>{t(lang, 'cancel')}</button>
      </fieldset>
    </form>
  );
}
