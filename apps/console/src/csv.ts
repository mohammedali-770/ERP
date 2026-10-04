/**
 * Bulk upload: a CSV file into the rows erp.import_items() (0012) or erp.import_suppliers()
 * (0016) takes.
 *
 * The warehouse system read .xlsx with a spreadsheet library. Here the file is CSV, read
 * by the forty lines below, because a dependency that parses untrusted spreadsheets in
 * the browser is a supply-chain risk this upload does not need: Excel saves "CSV UTF-8"
 * from the same sheet. Recorded in the UAT pack as a change staff will notice.
 *
 * WHAT IS CHECKED HERE: the file's shape only — UTF-8, a header naming known columns, at
 * most 5,000 rows, and brand codes this person can see. Every rule about an item (a code
 * already used, a kind that does not exist, a unit that does not fit) is the database's,
 * which reports every failing line and saves nothing if any fails.
 *
 * IDS ARE MINTED WHEN THE FILE IS READ. Each row carries the decision and item ids it
 * would record. Pressing Upload again after a lost answer sends the same rows with the
 * same ids. Choosing a file is not offered until the lost attempt is answered — one
 * still running would meet the new ids on its own codes and be reported "nothing was
 * saved" though it saved everything (found in review). Once answered, choosing again
 * mints new ids safely: rows match existing items by code, so an item the lost attempt
 * created is found and counted unchanged, never created twice.
 *
 * Requirements: INV-002 · INV-005 · ADR-0005
 */

export const IMPORT_COLUMNS = [
  'code', 'item_kind', 'base_unit_key', 'brand', 'name_en', 'name_ar', 'description_en', 'description_ar',
] as const;
/**
 * Every column, the optional ones included. The file wins — a blank cell clears that
 * field — and a column left out read exactly as a blank, so a file of codes and names
 * wiped every listed item's descriptions (found in module 2 step 3's review). Clearing
 * a field takes a cell that says so.
 */
const REQUIRED: readonly string[] = IMPORT_COLUMNS;
export const MAX_ROWS = 5000;

/** A record of the file, with the physical line it starts on (the header is line 1). */
export interface CsvRecord {
  readonly line: number;
  readonly fields: readonly string[];
  /** A quote out of place: text after a closing quote, or a quote never closed. */
  readonly malformed?: true;
}

export type Decoded = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: 'not_utf8' };

/**
 * The file's text. Not UTF-8 is refused rather than guessed: Excel's plain "CSV" on an
 * Arabic Windows is Windows-1256, and reading it as UTF-8 would save every Arabic name as
 * replacement characters.
 */
export function decodeCsv(bytes: Uint8Array): Decoded {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text };
  } catch {
    return { ok: false, reason: 'not_utf8' };
  }
}

/**
 * RFC 4180, plus what spreadsheets actually write: CRLF or LF, a quoted field holding
 * the delimiter, a newline or `""`, and a semicolon delimiter where the header uses one
 * (Excel's list separator follows the locale). Blank lines are skipped.
 *
 * A quote opens a quoted field only at the START of a field. Anywhere else it is a
 * character: `12" plate` is a name. Reading every quote as an opening one merged that
 * row with the next, silently, at exactly the header's width (found in review). Text
 * after a closing quote, or a quote never closed, marks the record malformed, and
 * prepareImport() refuses its line rather than guess.
 */
export function parseCsv(text: string): CsvRecord[] {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = !firstLine.includes(',') && firstLine.includes(';') ? ';' : ',';
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let atFieldStart = true;
  let malformed = false;
  let line = 1;
  let start = 1;
  let touched = false;
  const endRecord = () => {
    fields.push(field);
    if (touched || fields.length > 1 || field !== '') {
      records.push(malformed ? { line: start, fields, malformed: true } : { line: start, fields });
    }
    fields = [];
    field = '';
    touched = false;
    afterQuote = false;
    atFieldStart = true;
    malformed = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }
    if (c === delimiter) {
      fields.push(field);
      field = '';
      touched = true;
      afterQuote = false;
      atFieldStart = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      start = line;
    } else if (afterQuote) {
      // `"a"b`: text after a closing quote. Kept, so the line can be shown, but refused.
      malformed = true;
      field += c;
    } else if (c === '"' && atFieldStart) {
      quoted = true;
      touched = true;
      atFieldStart = false;
    } else {
      field += c;
      atFieldStart = false;
    }
  }
  if (quoted) malformed = true;
  if (field !== '' || fields.length > 0 || touched) endRecord();
  return records;
}

export interface ImportIds {
  readonly decision_id: string;
  readonly item_id: string;
  readonly base_unit_decision_id: string;
  readonly base_item_unit_id: string;
}

export type ImportProblem =
  | { readonly kind: 'empty' }
  | { readonly kind: 'too_many'; readonly rows: number }
  | { readonly kind: 'missing_column'; readonly column: string }
  | { readonly kind: 'unknown_column'; readonly column: string }
  | { readonly kind: 'duplicate_column'; readonly column: string }
  | { readonly kind: 'width'; readonly line: number; readonly expected: number; readonly found: number }
  | { readonly kind: 'quote'; readonly line: number }
  | { readonly kind: 'unknown_brand'; readonly line: number; readonly brand: string };

export type Prepared =
  | { readonly ok: true; readonly rows: readonly Record<string, string | null>[] }
  | { readonly ok: false; readonly problems: readonly ImportProblem[] };

/** What one record becomes: the row the import takes, or the problem that refuses its line. */
type Built = { readonly row: Record<string, string | null> } | { readonly problem: ImportProblem };

/**
 * Rows from parsed records, for an upload whose header may name `known` columns and must
 * name `required` ones. `build` turns one record into a row, given a cell reader (blank is
 * null); everything else — empty files, too many rows, header problems, malformed and
 * short lines, at most 20 problems reported as the database reports 20 lines — is the
 * same for every upload.
 */
function prepareRows(records: readonly CsvRecord[], known: readonly string[], required: readonly string[],
                     build: (value: (column: string) => string | null, line: number) => Built): Prepared {
  const [header, ...all] = records;
  // Excel writes rows of bare delimiters below the data: nothing in them, nothing to do.
  const body = all.filter((r) => !r.fields.every((f) => f.trim() === ''));
  if (header === undefined || body.length === 0) return { ok: false, problems: [{ kind: 'empty' }] };
  if (body.length > MAX_ROWS) return { ok: false, problems: [{ kind: 'too_many', rows: body.length }] };

  const problems: ImportProblem[] = [];
  const columns = header.fields.map((f) => f.trim().toLowerCase());
  const knownSet: ReadonlySet<string> = new Set(known);
  const seen = new Set<string>();
  for (const c of columns) {
    if (!knownSet.has(c)) problems.push({ kind: 'unknown_column', column: c });
    else if (seen.has(c)) problems.push({ kind: 'duplicate_column', column: c });
    seen.add(c);
  }
  for (const c of required) if (!seen.has(c)) problems.push({ kind: 'missing_column', column: c });
  if (problems.length > 0) return { ok: false, problems };

  const rows: Record<string, string | null>[] = [];
  for (const record of body) {
    if (record.malformed) {
      problems.push({ kind: 'quote', line: record.line });
      continue;
    }
    if (record.fields.length !== columns.length) {
      problems.push({ kind: 'width', line: record.line, expected: columns.length, found: record.fields.length });
      continue;
    }
    const value = (c: string) => {
      const i = columns.indexOf(c);
      const v = i === -1 ? '' : record.fields[i]!.trim();
      return v === '' ? null : v;
    };
    const built = build(value, record.line);
    if ('problem' in built) problems.push(built.problem);
    else rows.push(built.row);
  }
  return problems.length > 0 ? { ok: false, problems: problems.slice(0, 20) } : { ok: true, rows };
}

/**
 * The rows erp.import_items() takes, from parsed records. `brands` maps a brand code (or
 * id) to its id; only brands this person may see are in it. `mint` gives each row its
 * ids, once.
 */
export function prepareImport(records: readonly CsvRecord[], brands: ReadonlyMap<string, string>,
                              mint: () => ImportIds): Prepared {
  return prepareRows(records, IMPORT_COLUMNS, REQUIRED, (value, line) => {
    const brandText = value('brand') ?? '';
    const brandId = brands.get(brandText) ?? brands.get(brandText.toUpperCase()) ?? brands.get(brandText.toLowerCase());
    if (brandId === undefined) return { problem: { kind: 'unknown_brand', line, brand: brandText } };
    return { row: {
      line: String(line),
      ...mint(),
      code: value('code'),
      item_kind: value('item_kind'),
      base_unit_key: value('base_unit_key'),
      brand_id: brandId,
      name_en: value('name_en'),
      name_ar: value('name_ar'),
      description_en: value('description_en'),
      description_ar: value('description_ar'),
    } };
  });
}

/**
 * The supplier upload's columns: erp.import_suppliers() (0016) reads each by this name.
 * The file wins, as in the warehouse: a blank cell clears that field of an existing
 * supplier, contacts included (ADR-0026 §7).
 */
export const SUPPLIER_IMPORT_COLUMNS = [
  'code', 'name_en', 'name_ar', 'vat_number', 'cr_number', 'payment_terms_days',
  'contact_person', 'phone', 'email', 'address',
] as const;
/**
 * Every column, as for items. Here it matters more: a file of codes and terms alone
 * cleared every listed supplier's VAT and CR numbers and erased its contacts, which the
 * log, holding no contact value by design (SEC-008), could never give back.
 */
const SUPPLIER_REQUIRED: readonly string[] = SUPPLIER_IMPORT_COLUMNS;

export interface SupplierImportIds {
  readonly decision_id: string;
  readonly contact_decision_id: string;
  readonly supplier_id: string;
}

/**
 * The rows erp.import_suppliers() takes. Every cell is passed as text, payment terms
 * included: the database reads a blank or non-numeric cell as an error on its line, not
 * a silent 30, and folds digits typed on an Arabic keyboard.
 */
export function prepareSupplierImport(records: readonly CsvRecord[], mint: () => SupplierImportIds): Prepared {
  return prepareRows(records, SUPPLIER_IMPORT_COLUMNS, SUPPLIER_REQUIRED, (value, line) => {
    const row: Record<string, string | null> = { line: String(line), ...mint() };
    for (const c of SUPPLIER_IMPORT_COLUMNS) row[c] = value(c);
    return { row };
  });
}

/** Brand code and id, each to the id: what prepareImport() looks a row's brand up in. */
export function brandLookup(brands: readonly { readonly brand_id: string; readonly code: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const b of brands) {
    map.set(b.code, b.brand_id);
    map.set(b.brand_id, b.brand_id);
  }
  return map;
}
