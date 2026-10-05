import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import type { Facility, FacilityDecision, Failure } from '../api.ts';
import type { Ctx } from '../context.ts';
import {
  areaBody, areaProblem, areaWarning, formatCoordinate, hasArea, mapLink, RADIUS_DEFAULT, removeAreaBody, splitPoint,
} from '../facilities.ts';
import { formatDateTime, shortId } from '../format.ts';
import { formIds } from '../ids.ts';
import { label, localName, t } from '../i18n.ts';
import { isUnanswered, writeOutcome } from '../items.ts';
import { FailureNotice, Field, InDoubt, Loading, Notice, ReasonField } from './ui.tsx';

type Banner = { tone: 'ok' | 'info'; text: string } | null;

/** What a sub-form reports: a write's outcome, or 'checked' after a fresh look at what is saved. */
type Done = (outcome: 'saved' | 'already' | 'stale' | 'checked') => void;

/** The rule sentence for an area field refused for its shape, before anything is sent. */
const AREA_RULE = { latitude: 'rule_coordinate', longitude: 'rule_coordinate', radius_m: 'rule_radius_shape' } as const;

/**
 * One facility: what it is, its area, and every decision ever recorded about it. Changes
 * are offered only where the database would accept them (Ctx.facilitiesWritable), and
 * every one carries ids minted when its form opened (ids.ts).
 */
export function FacilityDetail({ ctx, targetId }: { ctx: Ctx; targetId: string }) {
  const { api, lang, data, facilityId, onFailure } = ctx;
  const [facility, setFacility] = useState<Facility | null>(null);
  const [history, setHistory] = useState<readonly FacilityDecision[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [banner, setBanner] = useState<Banner>(null);

  // Only the newest load may draw, as on the other detail pages.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const [f, h] = await Promise.all([api.getFacility(facilityId, targetId), api.facilityHistory(facilityId, targetId)]);
    if (mine !== seq.current) return;
    if (!f.ok) {
      if (!onFailure(f)) setFailure(f);
      return;
    }
    setFacility(f.value);
    setFailure(null);
    if (h.ok) setHistory(h.value);
    else if (!onFailure(h)) setFailure(h);
  }, [api, onFailure, facilityId, targetId]);

  useEffect(() => {
    setFacility(null);
    setHistory(null);
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  const afterWrite: Done = (outcome) => {
    setBanner(outcome === 'checked' ? null : outcome === 'saved' ? { tone: 'ok', text: t(lang, 'saved') }
      : outcome === 'already' ? { tone: 'info', text: t(lang, 'facility_already_recorded') }
      : { tone: 'info', text: t(lang, 'rule_facility_stale') });
    void load();
  };

  if (facility === null) {
    return (
      <section>
        <a href="#facilities">{t(lang, 'back')}</a>
        {failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />}
      </section>
    );
  }

  const open = facility.status === 'open';
  const writable = ctx.facilitiesWritable;
  const brand = data.brands.find((b) => b.brand_id === facility.brand_id);
  const warning = areaWarning(facility);

  return (
    <section>
      <a href="#facilities">{t(lang, 'back')}</a>
      <header className="page-header">
        <h1><span dir="ltr">{facility.code}</span> — {localName(lang, facility)}</h1>
        {writable && open ? (
          <div className="actions">
            <a className="button primary" href={`#facilities/${facility.facility_id}/edit`}>{t(lang, 'edit_facility')}</a>
          </div>
        ) : null}
      </header>
      {banner ? <Notice tone={banner.tone} text={banner.text} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {!open ? <Notice tone="info" text={t(lang, 'facility_closed_note')} /> : null}

      <dl className="facts">
        <dt>{t(lang, 'status')}</dt>
        <dd>{open ? t(lang, 'status_open') : t(lang, 'status_closed')}</dd>
        <dt>{t(lang, 'facility_type')}</dt><dd>{label(lang, `type_${facility.facility_type}`)}</dd>
        <dt>{t(lang, 'brand')}</dt><dd>{brand === undefined ? shortId(facility.brand_id) : localName(lang, brand)}</dd>
        <dt>{t(lang, 'name_en')}</dt><dd><bdi>{facility.name_en}</bdi></dd>
        <dt>{t(lang, 'name_ar')}</dt><dd><bdi>{facility.name_ar}</bdi></dd>
        <dt>{t(lang, 'address_en')}</dt><dd><bdi>{facility.address_en ?? '—'}</bdi></dd>
        <dt>{t(lang, 'address_ar')}</dt><dd><bdi>{facility.address_ar ?? '—'}</bdi></dd>
        <dt>{t(lang, 'time_zone')}</dt><dd><bdi dir="ltr">{facility.tz_name}</bdi></dd>
      </dl>

      <h2>{t(lang, 'area')}</h2>
      <p className="muted">{t(lang, 'area_explained')}</p>
      {hasArea(facility) ? (
        <dl className="facts">
          <dt>{t(lang, 'latitude')}</dt><dd><bdi dir="ltr">{formatCoordinate(facility.latitude)}</bdi></dd>
          <dt>{t(lang, 'longitude')}</dt><dd><bdi dir="ltr">{formatCoordinate(facility.longitude)}</bdi></dd>
          <dt>{t(lang, 'radius_m')}</dt><dd>{t(lang, 'area_radius', { n: facility.geofence_radius_m ?? '' })}</dd>
          <dt />
          <dd>
            <a href={mapLink(facility.latitude!, facility.longitude!)} target="_blank" rel="noopener noreferrer">{t(lang, 'view_on_map')}</a>
          </dd>
        </dl>
      ) : warning === 'no_area'
        ? <Notice tone="error" text={writable ? `${t(lang, 'area_missing_explained')} ${t(lang, 'area_set_below')}` : t(lang, 'area_missing_explained')} />
        : <p className="muted">{t(lang, 'area_none')}</p>}
      {writable && open ? <AreaForm ctx={ctx} facility={facility} onDone={afterWrite} /> : null}

      {writable ? <StatusChange ctx={ctx} facility={facility} onDone={afterWrite} /> : null}

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
                  {d.kind === 'facility_located' ? <> · {d.latitude === null ? t(lang, 'area_removed')
                    : <><bdi dir="ltr">{formatCoordinate(d.latitude)}, {formatCoordinate(d.longitude)}</bdi> · {t(lang, 'area_radius', { n: d.geofence_radius_m ?? '' })}</>}</> : null}
                  {d.kind === 'facility_status_changed' ? <> · {d.status === 'open' ? t(lang, 'status_open') : t(lang, 'status_closed')}</> : null}
                </td>
                <td><bdi>{d.reason}</bdi></td>
                <td dir="ltr" title={d.actor_id ?? undefined}>{d.actor_id === null ? t(lang, 'recorded_by_nobody')
                  : d.actor_id === data.person.person_id ? (localName(lang, {
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
 * One form's write lifecycle, as on the supplier page. The request is built ONCE, when the
 * person presses the button, and Retry resends exactly that request: same ids, same body,
 * same stamp. A reload of the page meanwhile, another form on it saving, must not change
 * what a retry sends. Start over looks at what is saved first.
 */
type Send = () => Promise<Parameters<typeof writeOutcome>[0]>;

function useWrite(ctx: Ctx, targetId: string, onDone: Done, after: () => void) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [inDoubt, setInDoubt] = useState(false);
  const pending = useRef<Send | null>(null);
  async function run(send: Send) {
    pending.current = send;
    setBusy(true);
    setFailure(null);
    const answer = await send();
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'failed') {
      if (isUnanswered(answer)) setInDoubt(true);
      else if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
      return;
    }
    pending.current = null;
    after();
    onDone(outcome);
  }
  /** The same request again: never rebuilt from what the page shows now. */
  function retry() {
    if (pending.current !== null) void run(pending.current);
  }
  /**
   * After an unanswered write: can the facility be read now? Then whatever the lost attempt
   * did is visible, and a new decision is safe under new ids: the database refuses a stale
   * change, and a status the facility already has.
   */
  async function startOver() {
    setBusy(true);
    const now = await ctx.api.getFacility(ctx.facilityId, targetId);
    setBusy(false);
    if (!now.ok) {
      if (!ctx.onFailure(now)) setFailure(now);
      return;
    }
    pending.current = null;
    setInDoubt(false);
    after();
    onDone('checked');
  }
  return { busy, failure, inDoubt, run, retry, startOver };
}

/**
 * Set, move or remove the area. A point pasted whole into Latitude fills both fields, as a
 * map's "copy coordinates" gives it. Every value stays the text the person entered.
 */
function AreaForm({ ctx, facility, onDone }: { ctx: Ctx; facility: Facility; onDone: Done }) {
  const { api, lang } = ctx;
  // Fixed when the form opens: a reload while it is open must not change what it does.
  const [open, setOpen] = useState<'set' | 'remove' | null>(null);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radius, setRadius] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<keyof typeof AREA_RULE | null>(null);
  const w = useWrite(ctx, facility.facility_id, onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(null);
    setReason('');
  });

  /** Every opening starts from the area as the page shows it NOW (as on the supplier page). */
  function openAs(mode: 'set' | 'remove') {
    setLatitude(formatCoordinate(facility.latitude));
    setLongitude(formatCoordinate(facility.longitude));
    setRadius(facility.geofence_radius_m === null ? '' : String(facility.geofence_radius_m));
    setReason('');
    setProblem(null);
    setOpen(mode);
  }

  /**
   * A point pasted whole fills both fields. Only a paste: split as it is typed, "24.7136,
   * 46.6" already reads as a point, and the rest of the longitude then landed in Latitude,
   * saving an area kilometres away (found in review).
   */
  function onLatitudePaste(e: ClipboardEvent<HTMLInputElement>) {
    const point = splitPoint(e.clipboardData.getData('text'));
    if (point === null) return;
    e.preventDefault();
    setLatitude(point.latitude);
    setLongitude(point.longitude);
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const id = facility.facility_id;
    if (open === 'remove') {
      const body = removeAreaBody(facility, ids.decision_id, reason);
      void w.run(() => api.setFacilityArea(id, body));
      return;
    }
    const p = areaProblem({ latitude, longitude, radius });
    setProblem(p);
    if (p !== null) return;
    const body = areaBody(facility, ids.decision_id, { latitude, longitude, radius, reason });
    void w.run(() => api.setFacilityArea(id, body));
  }

  if (open === null) {
    return (
      <p className="actions">
        <button type="button" className={hasArea(facility) ? undefined : 'primary'} onClick={() => openAs('set')}>
          {hasArea(facility) ? t(lang, 'edit_area') : t(lang, 'set_area')}
        </button>
        {hasArea(facility) ? <button type="button" className="danger" onClick={() => openAs('remove')}>{t(lang, 'remove_area')}</button> : null}
      </p>
    );
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <h3>{open === 'remove' ? t(lang, 'remove_area') : hasArea(facility) ? t(lang, 'edit_area') : t(lang, 'set_area')}</h3>
      {open === 'remove' && facility.facility_type === 'branch' ? <p className="muted">{t(lang, 'remove_area_hint')}</p> : null}
      {problem ? <Notice tone="error" text={t(lang, AREA_RULE[problem])} /> : null}
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.inDoubt}>
      {open === 'set' ? (
        <>
          <p className="field-hint">{t(lang, 'point_hint')}</p>
          <div className="grid">
            <Field label={t(lang, 'latitude')}>
              <input required inputMode="decimal" dir="ltr" maxLength={64} value={latitude}
                onChange={(e) => setLatitude(e.target.value)} onPaste={onLatitudePaste} placeholder="24.713600" />
            </Field>
            <Field label={t(lang, 'longitude')}>
              <input required inputMode="decimal" dir="ltr" maxLength={24} value={longitude}
                onChange={(e) => setLongitude(e.target.value)} placeholder="46.675300" />
            </Field>
            <Field label={t(lang, 'radius_m')} hint={t(lang, 'radius_hint')}>
              <input inputMode="numeric" dir="ltr" maxLength={9} value={radius}
                onChange={(e) => setRadius(e.target.value)} placeholder={String(RADIUS_DEFAULT)} />
            </Field>
          </div>
        </>
      ) : null}
      <ReasonField lang={lang} value={reason} onChange={setReason} />
      <button type="submit" className={open === 'remove' ? 'danger' : 'primary'} disabled={w.busy}>
        {w.busy ? t(lang, 'saving') : open === 'remove' ? t(lang, 'remove_area') : t(lang, 'save')}
      </button>
      <button type="button" onClick={() => setOpen(null)}>{t(lang, 'cancel')}</button>
      </fieldset>
    </form>
  );
}

function StatusChange({ ctx, facility, onDone }: { ctx: Ctx; facility: Facility; onDone: Done }) {
  const { api, lang } = ctx;
  // Fixed when the form opens: a reload while it is open (another form saving) must not
  // turn a "close" into a "reopen" under the person's hand.
  const [opened, setOpened] = useState<'closed' | 'open' | null>(null);
  const target = opened ?? (facility.status === 'open' ? 'closed' : 'open');
  const isOpen = opened !== null;
  const setOpen = (v: boolean) => setOpened(v ? (facility.status === 'open' ? 'closed' : 'open') : null);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const w = useWrite(ctx, facility.facility_id, onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    setReason('');
  });

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const id = facility.facility_id;
    const body = { ...ids, expected_decision_id: facility.as_of_decision_id, status: target, reason: reason.trim() };
    void w.run(() => api.changeFacilityStatus(id, body));
  }

  const verb = target === 'closed' ? t(lang, 'close_facility') : t(lang, 'reopen_facility');
  if (!isOpen) {
    return (
      <p>
        <button type="button" className={target === 'closed' ? 'danger' : undefined} onClick={() => setOpen(true)}>{verb}</button>
      </p>
    );
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <h3>{verb}</h3>
      {target === 'closed' ? <p className="muted">{t(lang, 'close_facility_hint')}</p> : null}
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.inDoubt}>
      <ReasonField lang={lang} value={reason} onChange={setReason} />
      <button type="submit" className={target === 'closed' ? 'danger' : 'primary'} disabled={w.busy}>
        {w.busy ? t(lang, 'saving') : verb}
      </button>
      <button type="button" onClick={() => setOpen(false)}>{t(lang, 'cancel')}</button>
      </fieldset>
    </form>
  );
}
