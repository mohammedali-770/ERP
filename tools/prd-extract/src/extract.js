import { readZipEntry, parseDocxBlocks } from './docx.ts';
import { splitBilingual } from './bilingual.ts';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const PHASES = new Set(['F0', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'Future']);
const PRIORITIES = new Set(['P0', 'P1', 'P2']);
const REQ_ID = /^([A-Z]{2,4})-(\d{3})$/;
/**
 * A requirement row is a 4-cell table row shaped
 * `| <MOD>-<NNN> | <bilingual text> | <phase> | <priority> |`.
 * Everything else in the document — risks, open decisions, glossary, the phase
 * legend, discovery traceability — fails at least one of these tests, which is
 * why the recogniser is a shape check rather than a section whitelist.
 */
function asRequirement(row, section) {
    if (row.length !== 4)
        return null;
    const [rawId, rawText, rawPhase, rawPriority] = row;
    const id = rawId.trim();
    const m = REQ_ID.exec(id);
    if (!m)
        return null;
    const phase = rawPhase.trim();
    const priority = rawPriority.trim();
    if (!PHASES.has(phase) || !PRIORITIES.has(priority))
        return null;
    const { en, ar } = splitBilingual(rawText);
    return {
        id,
        module: m[1],
        text_en: en,
        text_ar: ar,
        phase: phase,
        priority: priority,
        prd_section: section,
    };
}
const HEADING_STYLE = /^(Heading\d|Title)$/;
export function extractFromDocx(docxPath) {
    const buf = readFileSync(docxPath);
    const sourceSha256 = createHash('sha256').update(buf).digest('hex');
    const xml = readZipEntry(buf, 'word/document.xml').toString('utf8');
    const blocks = parseDocxBlocks(xml);
    const requirements = [];
    let section = '(front matter)';
    for (const block of blocks) {
        if (block.kind === 'paragraph') {
            // Track the nearest preceding English heading so each requirement records
            // where in the PRD it came from. Arabic heading translations follow their
            // English counterpart as separate paragraphs; ignore those.
            if (block.style && HEADING_STYLE.test(block.style) && block.text) {
                const { en } = splitBilingual(block.text);
                if (en)
                    section = en;
            }
            continue;
        }
        for (const row of block.rows) {
            const req = asRequirement(row, section);
            if (req)
                requirements.push(req);
        }
    }
    return { requirements, sourceSha256 };
}
//# sourceMappingURL=extract.js.map