import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Failure, ImportSummary } from '../api.ts';
import type { Ctx } from '../context.ts';
import { decodeCsv, parseCsv, prepareSupplierImport, SUPPLIER_IMPORT_COLUMNS, type ImportProblem } from '../csv.ts';
import { formIds } from '../ids.ts';
import { t } from '../i18n.ts';
import { isUnanswered, writeOutcome } from '../items.ts';
import { importProblem } from '../messages.ts';
import { FailureNotice, Field, Notice, ReasonField } from './ui.tsx';

const ROW_IDS = ['decision_id', 'contact_decision_id', 'supplier_id'] as const;

/**
 * The warehouse's supplier upload, from CSV (ADR-0026 §7). As the items upload: the file
 * is checked for shape here; every row's rules are erp.import_suppliers()'s, which saves
 * all of it or none, names each failing line, and matches by code. The file wins: a blank
 * cell clears that field of an existing supplier, contacts included.
 */
export function SupplierImport({ ctx }: { ctx: Ctx }) {
  const { api, lang } = ctx;
  const [rows, setRows] = useState<readonly Record<string, string | null>[] | null>(null);
  const [problems, setProblems] = useState<readonly ImportProblem[]>([]);
  const [notUtf8, setNotUtf8] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<ImportSummary | null>(null);
  /** The file was saved by an earlier sending of these same rows (0017). */
  const [already, setAlready] = useState(false);
  /** An earlier attempt at these rows went unanswered, and may have saved them. */
  const [doubted, setDoubted] = useState(false);
  // Each file chosen takes a number, and only the newest may set the rows. Reading is
  // asynchronous: choosing A then B, with A finishing last, left A's rows under B's name,
  // and Upload imported the file not shown (found by Codex on PR #33).
  const choice = useRef(0);
  const [fileName, setFileName] = useState<string | null>(null);

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    setRows(null);
    setProblems([]);
    setNotUtf8(false);
    setFailure(null);
    setDone(null);
    setAlready(false);
    setDoubted(false);
    const mine = ++choice.current;
    const file = e.target.files?.[0];
    // Cleared once read, so choosing the same file again reads it again: an unchanged
    // value fires no change event, and "upload the same file again" did nothing (found
    // running the supplier screens; items UAT 6.2 asks exactly this). The name is shown
    // below instead.
    e.target.value = '';
    if (file === undefined) return;
    setFileName(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (mine !== choice.current) return;
    const decoded = decodeCsv(bytes);
    if (!decoded.ok) {
      setNotUtf8(true);
      return;
    }
    const prepared = prepareSupplierImport(parseCsv(decoded.text), () => formIds(ROW_IDS));
    if (prepared.ok) setRows(prepared.rows);
    else setProblems(prepared.problems);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (rows === null) return;
    setBusy(true);
    setFailure(null);
    // The same rows, with the same ids, on every attempt: a lost answer is safe to retry.
    const answer = await api.importSuppliers(reason.trim(), rows);
    setBusy(false);
    if (answer.ok) {
      setDone(answer.value);
      setRows(null);
      return;
    }
    // Sent again while an earlier sending of the same rows was still running, or after
    // its answer was lost: that sending saved the file. The same success arriving twice,
    // not an error; only its counts are lost (found in module 2 step 2's review).
    if (writeOutcome(answer) === 'already') {
      setAlready(true);
      setRows(null);
      return;
    }
    if (isUnanswered(answer)) setDoubted(true);
    if (!ctx.onFailure(answer)) setFailure(answer);
  }

  if (!ctx.suppliersWritable) return <Notice tone="info" text={t(lang, 'read_only_suppliers')} />;
  return (
    <section>
      <a href="#suppliers">{t(lang, 'back')}</a>
      <h1>{t(lang, 'suppliers')} — {t(lang, 'bulk_upload')}</h1>
      <p>{t(lang, 'supplier_import_hint', { columns: SUPPLIER_IMPORT_COLUMNS.join(', ') })}</p>
      {done ? <Notice tone="ok" text={t(lang, 'import_done', { ...done })} /> : null}
      {done && doubted ? <Notice tone="info" text={t(lang, 'import_after_doubt')} /> : null}
      {already ? <Notice tone="ok" text={t(lang, 'import_already')} /> : null}
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
        {fileName !== null ? <p dir="auto">{t(lang, 'import_file', { name: fileName })}</p> : null}
        {rows !== null ? <p>{t(lang, 'import_rows', { n: rows.length })}</p> : null}
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className="primary" disabled={busy || rows === null}>
          {busy ? t(lang, 'saving') : t(lang, 'import_submit')}
        </button>
      </form>
    </section>
  );
}
