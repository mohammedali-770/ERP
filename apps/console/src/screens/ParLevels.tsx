import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Facility, Failure, Item, ParDecision, ParHistory, ParRow, SourceRow, ViewerFacility } from '../api.ts';
import type { Ctx } from '../context.ts';
import { formatFactor, shortId } from '../format.ts';
import { formIds } from '../ids.ts';
import { label, localName, t } from '../i18n.ts';
import { unitName } from '../items.ts';
import { stateOf, type CapabilityState } from '../navigation.ts';
import {
  branchAdmits, branchesOf, branchIsHere, clearParBody, hiddenRefusal, inForce, matchItems, PAR_CAPABILITY, parActions, parInput,
  parNotice, parPacks, parPlace, parWriteBanner, readAll, setParBody, sourceMoved, stampOf, suppliedElsewhere, type ParPlace,
} from '../ordering-setup.ts';
import { formatQuantity, workingFacility } from '../stock.ts';
import { formatRiyadh } from '../transfer-prices.ts';
import { toViewer } from '../viewer.ts';
import type { Done, Outcome, PageHooks } from '../write.ts';
import { FailureNotice, Field, InDoubt, Loading, Notice, ReasonField } from './ui.tsx';
import { personLabel, useSupplyingFacilities } from './ReplenishmentSources.tsx';
import { useWrite } from './useWrite.tsx';

type Banner = { tone: 'ok' | 'info'; text: string } | null;

/** Where pars are read from: the facility worked at, by what it is (ordering-setup.ts, parPlace). */
function usePlace(ctx: Ctx): ParPlace {
  return parPlace(ctx.facilityId, workingFacility(ctx.data.facilities, ctx.facilityId));
}

/** A branch as a par page shows it. `status` and `brand_id` are null where they cannot be read. */
interface Branch {
  readonly facility_id: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly facility_type: string;
  readonly brand_id: string | null;
  readonly status: 'open' | 'closed' | null;
}

/**
 * The branch a par page is for: read where the person may read facilities (erp.get_facility(),
 * which says whether it is open), otherwise from the session's own list, which names the
 * branch a branch's staff work at. Null while unknown.
 */
function useBranch(ctx: Ctx, branchId: string): Branch | null {
  const { api, facilityId, seesFacilities, onFailure, data } = ctx;
  const [branch, setBranch] = useState<Branch | null>(null);
  useEffect(() => {
    const own = data.facilities.find((f) => f.facility_id === branchId);
    setBranch(own === undefined ? null : { ...own, status: null });
    if (!seesFacilities) return;
    let live = true;
    void api.getFacility(facilityId, branchId).then((answer) => {
      if (!live) return;
      if (answer.ok) setBranch(answer.value);
      else onFailure(answer);
    });
    return () => {
      live = false;
    };
  }, [api, facilityId, seesFacilities, onFailure, data, branchId]);
  return branch;
}

/**
 * Par levels' state at the branch a page is for, which 0024 asks again there (ordering-setup.ts,
 * branchAdmits): read as the viewer reads it, erp.viewer() at the branch, which the session
 * route answers for any facility. At the branch the person works at, the session's own. Null
 * while unread, or where it cannot be read: then left to 0024. Not a control (CAP-P04): it
 * decides what the page offers, and 0024 decides the rest.
 */
function useBranchState(ctx: Ctx, place: ParPlace, branchId: string): CapabilityState | null {
  const { api, onFailure, viewer } = ctx;
  const own = branchIsHere(place, branchId);
  const [state, setState] = useState<CapabilityState | null>(null);
  useEffect(() => {
    setState(null);
    if (own) return;
    let live = true;
    void api.session(branchId).then((answer) => {
      if (!live) return;
      if (answer.ok) setState(stateOf(toViewer(answer.value.viewer), PAR_CAPABILITY));
      else onFailure(answer);
    });
    return () => {
      live = false;
    };
  }, [api, onFailure, own, branchId]);
  return own ? stateOf(viewer, PAR_CAPABILITY) : state;
}

const branchTitle = (ctx: Ctx, branch: Branch | null, branchId: string) =>
  branch === null ? shortId(branchId) : `${branch.code} — ${localName(ctx.lang, branch)}`;

/**
 * The par levels entry. At a branch, its own pars; at a warehouse or factory, or
 * organisation-wide, a branch to choose first; at an office, none: pars are read at a branch,
 * at a facility that supplies it, or organisation-wide (0024: erp.assert_par_read()).
 */
export function ParLevels({ ctx }: { ctx: Ctx }) {
  const { lang } = ctx;
  const place = usePlace(ctx);
  if (place.kind === 'branch') return <ParBranch ctx={ctx} branchId={place.facility.facility_id} />;
  if (place.kind === 'none') {
    return (
      <section>
        <header className="page-header"><h1>{t(lang, 'par_levels')}</h1></header>
        <Notice tone="info" text={t(lang, 'par_place_none')} />
      </section>
    );
  }
  return <BranchChooser ctx={ctx} place={place} />;
}

/**
 * The branches a par is set for: every branch of the facility's brand where the person reads
 * facilities (erp.list_facilities(), closed ones included, as their pars stay readable);
 * otherwise the branches the session names, which organisation-wide is every one.
 */
function BranchChooser({ ctx, place }: { ctx: Ctx; place: Exclude<ParPlace, { kind: 'branch' } | { kind: 'none' }> }) {
  const { api, lang, facilityId, seesFacilities, onFailure, data } = ctx;
  const [branches, setBranches] = useState<readonly (Facility | ViewerFacility)[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const brandId = place.kind === 'source' ? place.facility.brand_id : null;

  useEffect(() => {
    setBranches(null);
    setFailure(null);
    if (!seesFacilities) {
      // The session's own facilities: every brand's to someone organisation-wide, so at a
      // warehouse or factory only its brand's, as 0024 reads a branch from there.
      setBranches(branchesOf(data.facilities, brandId));
      return;
    }
    let live = true;
    void readAll<Facility>((after) => api.listFacilities({ facilityId, status: 'all', after, limit: 500 })
      .then((a) => (a.ok ? { ok: true as const, value: { rows: a.value.facilities, next: a.value.next_after } } : a)))
      .then((answer) => {
        if (!live) return;
        if (answer.ok) setBranches(branchesOf(answer.value));
        else if (!onFailure(answer)) setFailure(answer);
      });
    return () => {
      live = false;
    };
  }, [api, facilityId, seesFacilities, onFailure, data, brandId]);

  return (
    <section>
      <header className="page-header"><h1>{t(lang, 'par_levels')}</h1></header>
      <p className="muted">{place.kind === 'source' ? t(lang, 'pars_source_hint', { code: place.facility.code }) : t(lang, 'pars_org_hint')}</p>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {branches === null && failure === null ? <Loading lang={lang} /> : null}
      {branches !== null && branches.length === 0
        ? <p className="muted">{t(lang, seesFacilities ? 'par_no_branches' : 'par_needs_facilities')}</p> : null}
      {branches !== null && branches.length > 0 ? (
        <table className="table">
          <thead>
            <tr><th>{t(lang, 'facility_code')}</th><th>{lang === 'ar' ? t(lang, 'name_ar') : t(lang, 'name_en')}</th></tr>
          </thead>
          <tbody>
            {branches.map((b) => {
              const closed = 'status' in b && b.status === 'closed';
              return (
                <tr key={b.facility_id} className={closed ? 'retired' : undefined}>
                  <td className="code"><a href={`#par_levels/${b.facility_id}`} dir="ltr">{b.code}</a></td>
                  <td>{localName(lang, b)}{closed ? <> · <em>{t(lang, 'status_closed')}</em></> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

/**
 * One branch's pars (erp.par_levels(), 0024), by item code, each in the base unit and as
 * entered: read at the branch, all of them; at a warehouse or factory, those of the items it
 * supplies; organisation-wide, all. A par is set and cleared from its item's page, found here.
 */
export function ParBranch({ ctx, branchId }: { ctx: Ctx; branchId: string }) {
  const { api, lang, data, facilityId } = ctx;
  const place = usePlace(ctx);
  const branch = useBranch(ctx, branchId);
  const branchState = useBranchState(ctx, place, branchId);
  const supplying = useSupplyingFacilities(ctx);
  const [rows, setRows] = useState<readonly ParRow[] | null>(null);
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
    void api.parLevels({ facilityId, branchId }).then((answer) => {
      if (mine !== seq.current) return;
      if (answer.ok) {
        setRows(answer.value.pars);
        setNext(answer.value.next_after);
      } else if (!ctx.onFailure(answer)) {
        setFailure(answer);
      }
    });
    return () => {
      seq.current++;
    };
  }, [api, facilityId, branchId]);

  async function more() {
    if (next === null) return;
    const mine = ++seq.current;
    setLoadingMore(true);
    const answer = await api.parLevels({ facilityId, branchId, after: next });
    if (mine !== seq.current) return;
    setLoadingMore(false);
    if (answer.ok) {
      setRows((current) => [...(current ?? []), ...answer.value.pars]);
      setNext(answer.value.next_after);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  const sourceCode = (id: string | null) => {
    if (id === null) return <em>{t(lang, 'no_source')}</em>;
    const f = (supplying.rows ?? []).find((x) => x.facility_id === id);
    return <bdi dir="ltr">{f === undefined ? shortId(id) : f.code}</bdi>;
  };
  const sets = ctx.ordering.setsPars && branch?.status !== 'closed' && branchAdmits(branchState) !== false;
  const notice = parNotice({ rights: ctx.ordering, branchStatus: branch?.status ?? null, branchState });
  // Hidden at the branch, 0024 refuses its pars as "not permitted": the reason is said, not
  // the refusal. Any other refusal is 0024's to say, and the state its id reads is not.
  const hiddenSaid = hiddenRefusal(branchState, failure);
  const showNotice = notice !== null && !(notice === 'par_branch_hidden' && failure !== null && !hiddenSaid);

  return (
    <section>
      {place.kind !== 'branch' ? <a href="#par_levels">{t(lang, 'back')}</a> : null}
      <header className="page-header">
        <h1>{t(lang, 'pars_at', { branch: branchTitle(ctx, branch, branchId) })}</h1>
      </header>
      <p className="muted">
        {t(lang, 'pars_hint')}{place.kind === 'source' ? <> {t(lang, 'pars_from_hint', { code: place.facility.code })}</> : null}
      </p>
      {showNotice && notice !== null ? <Notice tone="info" text={t(lang, notice)} /> : null}

      {failure && !hiddenSaid ? <FailureNotice lang={lang} failure={failure} /> : null}
      {rows === null && failure === null ? <Loading lang={lang} /> : null}
      {rows !== null && rows.length === 0 ? <p className="muted">{t(lang, 'no_pars')}</p> : null}
      {rows !== null && rows.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t(lang, 'item_code')}</th>
              <th>{lang === 'ar' ? t(lang, 'name_ar') : t(lang, 'name_en')}</th>
              <th>{t(lang, 'par_level')}</th>
              <th>{t(lang, 'supplied_by')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const base = unitName(lang, data.units, r.base_unit_key);
              return (
                <tr key={r.item_id} className={r.item_status === 'retired' ? 'retired' : undefined}>
                  <td className="code"><a href={`#par_levels/${branchId}/items/${r.item_id}`} dir="ltr">{r.code}</a></td>
                  <td>{localName(lang, r)}{r.item_status === 'retired' ? <> · <em>{t(lang, 'status_retired')}</em></> : null}</td>
                  <td>
                    <bdi dir="ltr">{formatQuantity(r.par)}</bdi> {base}
                    {r.unit_key !== r.base_unit_key ? (
                      <div className="muted"><bdi dir="ltr">{formatQuantity(r.quantity)}</bdi> {unitName(lang, data.units, r.unit_key)}</div>
                    ) : null}
                  </td>
                  <td>{sourceCode(r.source_facility_id)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      {next !== null ? (
        <button type="button" onClick={() => void more()} disabled={loadingMore}>
          {loadingMore ? t(lang, 'loading') : t(lang, 'more')}
        </button>
      ) : null}

      {sets && place.kind !== 'branch' && place.kind !== 'none'
        ? <ParItemChooser ctx={ctx} place={place} branchId={branchId} brandId={branch?.brand_id ?? null} /> : null}
    </section>
  );
}

/**
 * Finds an item to set a par for. From a warehouse or factory, among the items it supplies
 * (erp.replenishment_sources(), filtered to it), as 0024 sets a par from there only for those;
 * organisation-wide, any active item of the branch's brand.
 */
function ParItemChooser({ ctx, place, branchId, brandId }: {
  ctx: Ctx; place: Exclude<ParPlace, { kind: 'branch' } | { kind: 'none' }>; branchId: string; brandId: string | null;
}) {
  const { api, lang, facilityId } = ctx;
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<readonly { item_id: string; code: string; name_en: string; name_ar: string }[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const supplied = useRef<readonly SourceRow[] | null>(null);
  const seq = useRef(0);

  async function find(e?: FormEvent) {
    e?.preventDefault();
    const q = search.trim();
    if (q === '') return;
    const mine = ++seq.current;
    if (place.kind === 'source') {
      const here = place.facility.facility_id;
      let rows = supplied.current;
      if (rows === null) {
        const all = await readAll<SourceRow>((after) => api.replenishmentSources({ facilityId: here, suppliedBy: here, after, limit: 500 })
          .then((a) => (a.ok ? { ok: true as const, value: { rows: a.value.sources, next: a.value.next_after } } : a)));
        if (mine !== seq.current) return;
        if (!all.ok) {
          if (!ctx.onFailure(all)) setFailure(all);
          return;
        }
        rows = all.value;
        supplied.current = rows;
      }
      // A par is new work on an item: only active ones take one (0024).
      setFound(matchItems(rows.filter((r) => r.item_status === 'active'), q).slice(0, 50));
      setFailure(null);
      return;
    }
    // Organisation-wide, where the facility worked at is none.
    const answer = await api.listItems({ facilityId, brandId, status: 'active', search: q, limit: 20 });
    if (mine !== seq.current) return;
    if (answer.ok) {
      setFound(answer.value.items);
      setFailure(null);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  if (place.kind === 'source' && !ctx.ordering.seesSources) return <Notice tone="info" text={t(lang, 'par_needs_sources')} />;
  return (
    <form className="inline-form" onSubmit={(e) => void find(e)}>
      <h2>{t(lang, 'set_par_for')}</h2>
      <Field label={t(lang, 'find_item')} hint={place.kind === 'source'
        ? t(lang, 'find_par_item_source_hint', { code: place.facility.code }) : t(lang, 'find_item_minimum_hint')}>
        <input type="search" maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>
      <button type="submit" className="small">{t(lang, 'search')}</button>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {found !== null && found.length === 0 ? <p className="muted">{t(lang, 'no_items_match')}</p> : null}
      {found !== null && found.length > 0 ? (
        <ul className="plain-list">
          {found.map((i) => (
            <li key={i.item_id}>
              <a className="button small" href={`#par_levels/${branchId}/items/${i.item_id}`}>{t(lang, 'open_minimum')}</a>{' '}
              <bdi dir="ltr">{i.code}</bdi> — {localName(lang, i)}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

/**
 * One item's par at a branch: the par in force as entered, every decision about it
 * (erp.par_level_history(), 0024), the facility that supplies the item, and, where the
 * person may, a form to set it and one to clear it. Both are checked against the decision in
 * force, which the history marks (ordering-setup.ts, stampOf), and both state where they are
 * set from (OrderingRights.parFrom).
 */
export function ParItem({ ctx, branchId, itemId }: { ctx: Ctx; branchId: string; itemId: string }) {
  const { api, lang, data, onFailure, facilityId } = ctx;
  const place = usePlace(ctx);
  const branch = useBranch(ctx, branchId);
  const branchState = useBranchState(ctx, place, branchId);
  const supplying = useSupplyingFacilities(ctx);
  const seesSources = ctx.ordering.seesSources;
  const fromSupplier = place.kind === 'source' ? place.facility.facility_id : null;
  const [item, setItem] = useState<Item | null>(null);
  const [history, setHistory] = useState<readonly ParDecision[] | null>(null);
  // Read from a warehouse or factory that does not supply the item: 0024 reads its par only
  // where it is supplied from, and answers as missing here (found in review).
  const [notHere, setNotHere] = useState(false);
  // The item's source: a facility, null for none, undefined where it cannot be read.
  const [source, setSource] = useState<{ id: string | null; code: string | null } | undefined>(undefined);
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // The last write's outcome, said as the page that follows can: with the par, or without.
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // A write refused because the item's source moved (sourceMoved): kept on the page that
  // the read it prompts lands on, where the form that showed it is gone.
  const [refusal, setRefusal] = useState<Failure | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // True from a write's answer until the page has read what it left: the forms are not
  // offered meanwhile, as their stamp would be the one before the write.
  const [reloading, setReloading] = useState(false);
  const seq = useRef(0);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    generation.current++;
    setLoadingMore(false);
    const [i, h, s] = await Promise.all([
      api.getItem(facilityId, itemId),
      api.parLevelHistory(facilityId, branchId, itemId),
      seesSources ? api.replenishmentSourceHistory(facilityId, itemId) : Promise.resolve(null),
    ]);
    if (mine !== seq.current) return;
    const now = s !== null && s.ok ? inForce(s.value.decisions) : undefined;
    const supplied = now === undefined ? undefined : { id: now?.facility_id ?? null, code: now?.facility_code ?? null };
    // Asked from a warehouse or factory, a par of an item it does not supply is no par of
    // this place's: the page says where it is set, not that the item is missing, and says so
    // even where the item's source cannot be read (found in the second review).
    if (!h.ok && i.ok && suppliedElsewhere(fromSupplier, h, supplied === undefined ? undefined : supplied.id)) {
      setItem(i.value);
      setHistory(null);
      setSource(supplied);
      setNotHere(true);
      setNext(null);
      setFailure(null);
      setReloading(false);
      return;
    }
    for (const a of [i, h, s]) {
      if (a !== null && !a.ok) {
        if (!onFailure(a)) setFailure(a);
        return;
      }
    }
    if (i.ok && h.ok) {
      setItem(i.value);
      setHistory(h.value.decisions);
      setSource(supplied);
      setNotHere(false);
      setNext(h.value.next_before);
      setFailure(null);
      setReloading(false);
    }
  }, [api, onFailure, facilityId, branchId, itemId, seesSources, fromSupplier]);

  useEffect(() => {
    setItem(null);
    setHistory(null);
    setSource(undefined);
    setNotHere(false);
    setNext(null);
    setLoadingMore(false);
    // Another record's page: an earlier write's word is not about this one.
    setOutcome(null);
    setRefusal(null);
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  async function older() {
    if (next === null || reloading) return;
    const mine = generation.current;
    setLoadingMore(true);
    const answer = await api.parLevelHistory(facilityId, branchId, itemId, next);
    if (mine !== generation.current) return;
    setLoadingMore(false);
    if (answer.ok) {
      setHistory((current) => [...(current ?? []), ...answer.value.decisions]);
      setNext(answer.value.next_before);
    } else if (!onFailure(answer)) {
      setFailure(answer);
    }
  }

  const afterWrite: Done = (done) => {
    setOutcome(done);
    setReloading(true);
    void load();
  };
  const page: PageHooks = {
    started: () => {
      setOutcome(null);
      setRefusal(null);
    },
    refused: (f) => {
      if (!sourceMoved(f)) return;
      setRefusal(f);
      setReloading(true);
      void load();
    },
  };
  const said = (shown: boolean): Banner => {
    const key = parWriteBanner(outcome, shown);
    return key === null ? null : { tone: key === 'saved' ? 'ok' : 'info', text: t(lang, key) };
  };

  const back = <a href={place.kind === 'branch' ? '#par_levels' : `#par_levels/${branchId}`}>{t(lang, 'back')}</a>;
  if (item !== null && notHere) {
    const here = place.kind === 'source' ? place.facility.code : '';
    const banner = said(false);
    return (
      <section>
        {back}
        <header className="page-header"><h1><bdi dir="ltr">{item.code}</bdi> — {localName(lang, item)}</h1></header>
        <p className="muted">{t(lang, 'par_for_branch', { branch: branchTitle(ctx, branch, branchId) })}</p>
        {/* A write's answer is said here too: the reload after it can land here (found in the second review). */}
        {refusal ? <FailureNotice lang={lang} failure={refusal} /> : banner ? <Notice tone={banner.tone} text={banner.text} /> : null}
        <Notice tone="info" text={source === undefined ? t(lang, 'par_not_supplied_here', { code: here })
          : source.id === null ? t(lang, 'par_no_source') : t(lang, 'par_set_elsewhere', { code: source.code ?? shortId(source.id) })} />
      </section>
    );
  }
  if (item === null || history === null) {
    // Hidden at the branch, 0024 refuses its pars as "not permitted": the reason is said.
    return (
      <section>
        {back}
        {hiddenRefusal(branchState, failure) ? <Notice tone="info" text={t(lang, 'par_branch_hidden')} />
          : failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />}
      </section>
    );
  }

  const base = unitName(lang, data.units, item.base_unit_key);
  const banner = said(true);
  const current = inForce(history);
  const stamp = stampOf(history);
  const sourceStatus = source === undefined || source.id === null ? null
    : (supplying.rows ?? []).find((f) => f.facility_id === source.id)?.status ?? null;
  const actions = parActions({
    rights: ctx.ordering, branchStatus: branch?.status ?? null, branchState, itemActive: item.status === 'active',
    inForce: current !== null, source: source === undefined ? undefined : source.id, sourceStatus,
  });
  const notice = parNotice({
    rights: ctx.ordering, branchStatus: branch?.status ?? null, branchState,
    item: { active: item.status === 'active', source: source === undefined ? undefined : source.id, sourceStatus },
  });
  const asEntered = (d: ParDecision) => (d.unit_key === null || d.quantity === null || d.factor === null ? null : (
    <>
      <bdi dir="ltr">{formatQuantity(d.quantity)}</bdi> {unitName(lang, data.units, d.unit_key)}{' '}
      ({unitName(lang, data.units, d.unit_key)} = <bdi dir="ltr">{formatFactor(d.factor)}</bdi> {base})
    </>
  ));

  return (
    <section>
      {back}
      <header className="page-header">
        <h1><bdi dir="ltr">{item.code}</bdi> — {localName(lang, item)}</h1>
      </header>
      <p className="muted">{t(lang, 'par_for_branch', { branch: branchTitle(ctx, branch, branchId) })}</p>
      {refusal ? <FailureNotice lang={lang} failure={refusal} /> : banner ? <Notice tone={banner.tone} text={banner.text} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {notice !== null ? <Notice tone="info" text={t(lang, notice, { code: source?.code ?? '' })} /> : null}

      <p>
        {t(lang, 'par_level')}:{' '}
        {current === null || current.par === null ? <em>{t(lang, 'no_par')}</em> : (
          <>
            <strong><bdi dir="ltr">{formatQuantity(current.par)}</bdi> {base}</strong>
            {current.unit_key !== item.base_unit_key ? <span className="muted"> · {asEntered(current)}</span> : null}
          </>
        )}
      </p>
      {source !== undefined ? (
        <p>
          {t(lang, 'supplied_by')}:{' '}
          {source.id === null ? <em>{t(lang, 'no_source')}</em> : <bdi dir="ltr">{source.code ?? shortId(source.id)}</bdi>}
          {sourceStatus === 'closed' ? <> · <em>{t(lang, 'status_closed')}</em></> : null}
        </p>
      ) : null}

      {reloading && failure !== null
        ? <button type="button" onClick={() => { setFailure(null); void load(); }}>{t(lang, 'reload')}</button>
        : reloading ? <Loading lang={lang} /> : null}
      {actions.set && !reloading ? <SetPar ctx={ctx} item={item} branchId={branchId} stamp={stamp} onDone={afterWrite} page={page} /> : null}
      {actions.clear && !reloading && stamp !== null
        ? <ClearPar ctx={ctx} item={item} branchId={branchId} stamp={stamp} onDone={afterWrite} page={page} /> : null}

      <h2>{t(lang, 'history')}</h2>
      {history.length === 0 ? <p className="muted">{t(lang, 'no_par_history')}</p> : (
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
                  {d.par !== null ? <> · <bdi dir="ltr">{formatQuantity(d.par)}</bdi> {base}</> : null}
                  {d.unit_key !== null && d.unit_key !== item.base_unit_key ? <div className="muted">{asEntered(d)}</div> : null}
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

/**
 * Whether Start over's refused read settles a par write in doubt (write.ts, `settled`): set
 * from a warehouse or factory, 0024 answers a par's history as missing once the item is no
 * longer supplied from there, and then takes no par of it from there either, so a new
 * decision cannot repeat the lost one. Organisation-wide the history is always read.
 */
const notSuppliedHere = (ctx: Ctx) => (f: Failure): boolean => suppliedElsewhere(ctx.ordering.parFrom, f, undefined);

/**
 * A par, in a current pack of the item, typed as decimal text and sent as typed, set from
 * where the person works (OrderingRights.parFrom), against the stamp the page read when the
 * button was pressed (write.ts: built once, retried as sent).
 */
function SetPar({ ctx, item, branchId, stamp, onDone, page }: {
  ctx: Ctx; item: Item; branchId: string; stamp: string | null; onDone: Done; page: PageHooks;
}) {
  const { api, lang, data } = ctx;
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const packs = parPacks(item.units);
  const basePack = packs.find((u) => u.unit_key === item.base_unit_key)?.item_unit_id ?? '';
  const [unitId, setUnitId] = useState(basePack);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState(false);
  // A pack retired since the form opened is no longer offered: never left chosen.
  useEffect(() => {
    if (unitId !== '' && !packs.some((u) => u.item_unit_id === unitId)) setUnitId('');
  }, [packs, unitId]);
  const w = useWrite(ctx, () => ctx.api.parLevelHistory(ctx.facilityId, branchId, item.item_id), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setQuantity('');
    setReason('');
  }, (seen) => (seen as ParHistory).decisions.some((d) => d.decision_id === ids.decision_id), notSuppliedHere(ctx), page);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = parInput(quantity);
    if (!q.ok) return setProblem(true);
    setProblem(false);
    const id = branchId;
    const body = setParBody(ids, { from: ctx.ordering.parFrom, itemUnitId: unitId, quantity: q.value, expectedDecisionId: stamp, reason });
    void w.run(() => api.setParLevel(id, body));
  }

  if (packs.length === 0) return null;
  return (
    <form className="inline-form" onSubmit={submit}>
      <h3>{t(lang, 'set_par')}</h3>
      <p className="muted">{t(lang, 'set_par_hint')}</p>
      {problem ? <Notice tone="error" text={t(lang, 'par_bad_quantity')} /> : null}
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
        <Field label={t(lang, 'pack')}>
          <select required value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="" disabled>—</option>
            {packs.map((u) => (
              <option key={u.item_unit_id} value={u.item_unit_id}>
                {unitName(lang, data.units, u.unit_key)} = {formatFactor(u.factor)} {unitName(lang, data.units, item.base_unit_key)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t(lang, 'par_level')} hint={t(lang, 'par_quantity_hint')}>
          <input dir="ltr" inputMode="decimal" required maxLength={19} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className="primary" disabled={w.busy || unitId === ''}>
          {w.busy ? t(lang, 'saving') : t(lang, 'set_par')}
        </button>
      </fieldset>
    </form>
  );
}

/** The item will have no par at the branch: module 10 suggests nothing for it there. Against the stamp read, as a set is. */
function ClearPar({ ctx, item, branchId, stamp, onDone, page }: {
  ctx: Ctx; item: Item; branchId: string; stamp: string; onDone: Done; page: PageHooks;
}) {
  const { api, lang } = ctx;
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const w = useWrite(ctx, () => ctx.api.parLevelHistory(ctx.facilityId, branchId, item.item_id), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    setReason('');
  }, (seen) => (seen as ParHistory).decisions.some((d) => d.decision_id === ids.decision_id), notSuppliedHere(ctx), page);

  function submit(e: FormEvent) {
    e.preventDefault();
    const par = { branchId, itemId: item.item_id };
    const body = clearParBody(ids, { from: ctx.ordering.parFrom, expectedDecisionId: stamp, reason });
    void w.run(() => api.clearParLevel(par, body));
  }

  if (!open) {
    return <button type="button" className="danger" onClick={() => { setReason(''); setOpen(true); }}>{t(lang, 'clear_par')}</button>;
  }
  return (
    <form className="inline-form compact" onSubmit={submit}>
      <p className="muted">{t(lang, 'clear_par_hint')}</p>
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className="danger" disabled={w.busy}>{w.busy ? t(lang, 'saving') : t(lang, 'clear_par')}</button>
        <button type="button" onClick={() => setOpen(false)}>{t(lang, 'cancel')}</button>
      </fieldset>
    </form>
  );
}
