/**
 * Bulk upload: a CSV file into the rows erp.import_items() takes (0012).
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
 * IDS ARE MINTED ONCE PER FILE. Each row carries the decision and item ids it would
 * record, minted when the file is read. Uploading the same parsed file again after a
 * lost answer sends the same ids, so nothing is recorded twice.
 *
 * Requirements: INV-002 · INV-005 · ADR-0005
 */

export const IMPORT_COLUMNS = [
  'code', 'item_kind', 'base_unit_key', 'brand', 'name_en', 'name_ar', 'description_en', 'description_ar',
] as const;
const REQUIRED: readonly string[] = ['code', 'item_kind', 'base_unit_key', 'brand', 'name_en', 'name_ar'];
export const MAX_ROWS = 5000;

/** A record of the file, with the physical line it starts on (the header is line 1). */
export interface CsvRecord {
  readonly line: number;
  readonly fields: readonly string[];
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
 */
export function parseCsv(text: string): CsvRecord[] {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = !firstLine.includes(',') && firstLine.includes(';') ? ';' : ',';
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  let touched = false;
  const endRecord = () => {
    fields.push(field);
    if (touched || fields.length > 1 || field !== '') records.push({ line: start, fields });
    fields = [];
    field = '';
    touched = false;
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
        }
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
      touched = true;
    } else if (c === delimiter) {
      fields.push(field);
      field = '';
      touched = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      start = line;
    } else {
      field += c;
    }
  }
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
  | { readonly kind: 'unknown_brand'; readonly line: number; readonly brand: string };

export type Prepared =
  | { readonly ok: true; readonly rows: readonly Record<string, string | null>[] }
  | { readonly ok: false; readonly problems: readonly ImportProblem[] };

/**
 * The rows erp.import_items() takes, from parsed records. `brands` maps a brand code (or
 * id) to its id; only brands this person may see are in it. `mint` gives each row its
 * ids, once. Up to 20 problems are reported, as the database reports up to 20 lines.
 */
export function prepareImport(records: readonly CsvRecord[], brands: ReadonlyMap<string, string>,
                              mint: () => ImportIds): Prepared {
  const [header, ...body] = records;
  if (header === undefined || body.length === 0) return { ok: false, problems: [{ kind: 'empty' }] };
  if (body.length > MAX_ROWS) return { ok: false, problems: [{ kind: 'too_many', rows: body.length }] };

  const problems: ImportProblem[] = [];
  const columns = header.fields.map((f) => f.trim().toLowerCase());
  const known: ReadonlySet<string> = new Set(IMPORT_COLUMNS);
  const seen = new Set<string>();
  for (const c of columns) {
    if (!known.has(c)) problems.push({ kind: 'unknown_column', column: c });
    else if (seen.has(c)) problems.push({ kind: 'duplicate_column', column: c });
    seen.add(c);
  }
  for (const c of REQUIRED) if (!seen.has(c)) problems.push({ kind: 'missing_column', column: c });
  if (problems.length > 0) return { ok: false, problems };

  const rows: Record<string, string | null>[] = [];
  for (const record of body) {
    if (record.fields.length !== columns.length) {
      problems.push({ kind: 'width', line: record.line, expected: columns.length, found: record.fields.length });
      continue;
    }
    const value = (c: string) => {
      const i = columns.indexOf(c);
      const v = i === -1 ? '' : record.fields[i]!.trim();
      return v === '' ? null : v;
    };
    const brandText = value('brand') ?? '';
    const brandId = brands.get(brandText) ?? brands.get(brandText.toUpperCase()) ?? brands.get(brandText.toLowerCase());
    if (brandId === undefined) {
      problems.push({ kind: 'unknown_brand', line: record.line, brand: brandText });
      continue;
    }
    rows.push({
      line: String(record.line),
      ...mint(),
      code: value('code'),
      item_kind: value('item_kind'),
      base_unit_key: value('base_unit_key'),
      brand_id: brandId,
      name_en: value('name_en'),
      name_ar: value('name_ar'),
      description_en: value('description_en'),
      description_ar: value('description_ar'),
    });
  }
  return problems.length > 0 ? { ok: false, problems: problems.slice(0, 20) } : { ok: true, rows };
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
