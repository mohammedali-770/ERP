import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { Failure, ImportSummary } from '../api.ts';
import type { Ctx } from '../context.ts';
import { brandLookup, decodeCsv, IMPORT_COLUMNS, parseCsv, prepareImport, type ImportProblem } from '../csv.ts';
import { formIds } from '../ids.ts';
import { t } from '../i18n.ts';
import { importProblem } from '../messages.ts';
import { FailureNotice, Field, Notice, ReasonField } from './ui.tsx';

const ROW_IDS = ['decision_id', 'item_id', 'base_unit_decision_id', 'base_item_unit_id'] as const;

/**
 * Bulk upload from CSV. The file is read and checked for shape here; every row's rules
 * are the database's, which saves all of it or none and names each failing line.
 */
export function ItemImport({ ctx }: { ctx: Ctx }) {
  const { api, lang, data } = ctx;
  const [rows, setRows] = useState<readonly Record<string, string | null>[] | null>(null);
  const [problems, setProblems] = useState<readonly ImportProblem[]>([]);
  const [notUtf8, setNotUtf8] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<ImportSummary | null>(null);

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    setRows(null);
    setProblems([]);
    setNotUtf8(false);
    setFailure(null);
    setDone(null);
    const file = e.target.files?.[0];
    if (file === undefined) return;
    const decoded = decodeCsv(new Uint8Array(await file.arrayBuffer()));
    if (!decoded.ok) {
      setNotUtf8(true);
      return;
    }
    // Item writes are organisation-wide, so every brand is a valid target.
    const prepared = prepareImport(parseCsv(decoded.text), brandLookup(data.brands), () => formIds(ROW_IDS));
    if (prepared.ok) setRows(prepared.rows);
    else setProblems(prepared.problems);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (rows === null) return;
    setBusy(true);
    setFailure(null);
    // The same rows, with the same ids, on every attempt: a lost answer is safe to retry.
    const answer = await api.importItems(reason.trim(), rows);
    setBusy(false);
    if (answer.ok) {
      setDone(answer.value);
      setRows(null);
      return;
    }
    if (!ctx.onFailure(answer)) setFailure(answer);
  }

  if (!ctx.writable) return <Notice tone="info" text={t(lang, 'read_only_here')} />;
  return (
    <section>
      <a href="#items">{t(lang, 'back')}</a>
      <h1>{t(lang, 'bulk_upload')}</h1>
      <p>{t(lang, 'import_hint', { columns: IMPORT_COLUMNS.join(', ') })}</p>
      {done ? <Notice tone="ok" text={t(lang, 'import_done', { ...done })} /> : null}
      {notUtf8 ? <Notice tone="error" text={t(lang, 'import_not_utf8')} /> : null}
      {problems.length > 0 ? (
        <div className="notice notice-error" role="alert">
          <ul>{problems.map((p, i) => <li key={i}>{importProblem(lang, p)}</li>)}</ul>
        </div>
      ) : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      <form className="form" onSubmit={submit}>
        <Field label={t(lang, 'import_choose')}>
          <input type="file" accept=".csv,text/csv" onChange={(e) => void choose(e)} />
        </Field>
        {rows !== null ? <p>{t(lang, 'import_rows', { n: rows.length })}</p> : null}
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className="primary" disabled={busy || rows === null}>
          {busy ? t(lang, 'saving') : t(lang, 'import_submit')}
        </button>
      </form>
    </section>
  );
}
