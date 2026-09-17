/**
 * A deliberately tiny YAML emitter and parser for the restricted shape this
 * repository uses for requirement data. It is not a general YAML implementation
 * and must not be used as one.
 *
 * Emitting uses double-quoted scalars throughout: YAML 1.2 double-quoted scalars
 * accept JSON string escapes, so `JSON.stringify` produces valid YAML and handles
 * the colons, quotes and bidirectional Arabic text in requirement bodies without
 * a quoting heuristic that could silently corrupt a requirement.
 */

export type Scalar = string | number | boolean | null;
export type Node = Scalar | Scalar[];

export function emitScalar(v: Scalar): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return JSON.stringify(v);
}

export function emitList(items: Scalar[], indent: string): string {
  if (items.length === 0) return ' []';
  return '\n' + items.map((i) => `${indent}- ${emitScalar(i)}`).join('\n');
}

/**
 * Parses a map of `key:` blocks whose values are maps of scalars and string lists.
 * Supports `#` comments on their own line, `key: value`, and `key:` followed by
 * `  - item` lines. Anything else raises, so a malformed annotations file fails
 * loudly rather than dropping a requirement's ownership silently.
 */
export function parseAnnotations(src: string): Record<string, Record<string, Node>> {
  const out: Record<string, Record<string, Node>> = {};
  let currentKey: string | null = null;
  let currentField: string | null = null;

  const lines = src.split('\n');
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const raw = lines[lineNo]!;
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const where = `annotations.yaml:${lineNo + 1}`;

    const topLevel = /^([A-Za-z0-9_.-]+):\s*$/.exec(raw);
    if (topLevel) {
      currentKey = topLevel[1]!;
      out[currentKey] ??= {};
      currentField = null;
      continue;
    }

    const listItem = /^\s{4}-\s+(.*)$/.exec(raw);
    if (listItem) {
      if (!currentKey || !currentField) throw new Error(`${where}: list item outside a field`);
      const target = out[currentKey]![currentField];
      if (!Array.isArray(target)) throw new Error(`${where}: field ${currentField} is not a list`);
      target.push(unquote(listItem[1]!.trim(), where));
      continue;
    }

    const field = /^\s{2}([A-Za-z0-9_]+):\s*(.*)$/.exec(raw);
    if (field) {
      if (!currentKey) throw new Error(`${where}: field outside an entry`);
      currentField = field[1]!;
      const value = field[2]!.trim();
      out[currentKey]![currentField] = value === '' ? [] : unquote(value, where);
      continue;
    }
    throw new Error(`${where}: unrecognised line: ${raw}`);
  }
  return out;
}

function unquote(v: string, where: string): string {
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v) as string;
    } catch {
      throw new Error(`${where}: malformed quoted string: ${v}`);
    }
  }
  return v;
}
