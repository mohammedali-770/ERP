/**
 * Minimal, dependency-free .docx reader.
 *
 * A .docx is a ZIP container; we only ever need `word/document.xml`. Pulling in a
 * ZIP library for one entry would add a supply-chain dependency to the one tool
 * that defines our requirement baseline, so we read the central directory directly.
 * Only STORED (0) and DEFLATE (8) entries are supported — Word emits DEFLATE.
 */
import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const MAX_EOCD_SCAN = 66_000; // 64 KiB comment limit + header slack

function findEndOfCentralDirectory(buf: Buffer): number {
  const start = Math.max(0, buf.length - MAX_EOCD_SCAN);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error('Not a ZIP container: end-of-central-directory record not found');
}

/** Reads one named entry out of a ZIP archive. */
export function readZipEntry(zip: Buffer, wantedName: string): Buffer {
  const eocd = findEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(offset) !== CENTRAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`Corrupt central directory at entry ${i}`);
    }
    const compressionMethod = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    if (name === wantedName) {
      // The local header repeats name/extra lengths, and they can differ from the
      // central directory's, so re-read them rather than reusing the values above.
      const localNameLength = zip.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const raw = zip.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) return Buffer.from(raw);
      if (compressionMethod === 8) return inflateRawSync(raw);
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${name}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Entry not found in archive: ${wantedName}`);
}

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
};

export function decodeXmlText(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m);
}

/** Concatenates every `<w:t>` run inside a fragment, which is how Word stores split text. */
export function textOf(fragment: string): string {
  const runs = fragment.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [];
  return decodeXmlText(runs.map((r) => r.replace(/^<w:t[^>]*>|<\/w:t>$/g, '')).join(''));
}

export interface DocxBlock {
  kind: 'paragraph' | 'table';
  /** For paragraphs: the text. For tables: unused. */
  text: string;
  /** For tables: rows of cell texts. */
  rows: string[][];
  /** Heading style name, when the paragraph carries one. */
  style: string | null;
}

/** Walks the document body in order, yielding paragraphs and tables. */
export function parseDocxBlocks(documentXml: string): DocxBlock[] {
  const bodyMatch = /<w:body>([\s\S]*)<\/w:body>/.exec(documentXml);
  if (!bodyMatch?.[1]) throw new Error('document.xml has no <w:body>');
  const body = bodyMatch[1];

  const blocks: DocxBlock[] = [];
  const blockRe = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
  for (const m of body.matchAll(blockRe)) {
    const frag = m[0];
    if (frag.startsWith('<w:tbl')) {
      const rows: string[][] = [];
      for (const tr of frag.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)) {
        const cells: string[] = [];
        for (const tc of tr[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)) {
          const paras = tc[0].match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) ?? [];
          cells.push(paras.map(textOf).join(' ').trim());
        }
        rows.push(cells);
      }
      blocks.push({ kind: 'table', text: '', rows, style: null });
    } else {
      const style = /<w:pStyle w:val="([^"]+)"/.exec(frag)?.[1] ?? null;
      blocks.push({ kind: 'paragraph', text: textOf(frag).trim(), rows: [], style });
    }
  }
  return blocks;
}
