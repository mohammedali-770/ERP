/**
 * The key risks the PRD records in section 10.1.
 *
 * These are extracted rather than transcribed because R-01..R-10 are cited as
 * authority across the architecture, the spikes and the programme documents —
 * `R-02 (Critical)` is the reason the offline-sync spike exists — and a risk
 * register that drifts from the PRD is worse than none: it would be quoted.
 */
import type { DocxBlock } from './docx.ts';

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low';

export interface Risk {
  id: string;
  severity: Severity;
  title_en: string;
  mitigation_en: string;
  title_ar: string;
  mitigation_ar: string;
}

const RISK_ID = /^R-\d{2}$/;

/**
 * Severity, title and mitigation share one table cell and arrive concatenated,
 * because in the source they are separate runs inside a single paragraph:
 * `HighPrinting reliability…Mitigation: Prototype…`. The severity word and the
 * `Mitigation:` label are the only reliable boundaries.
 */
const EN_CELL = /^(Critical|High|Medium|Low)(.*?)Mitigation:\s*(.*)$/s;
const AR_CELL = /^(حرج|مرتفع|متوسط|منخفض)(.*?)المعالجة:\s*(.*)$/s;

const AR_SEVERITY: Readonly<Record<string, Severity>> = {
  'حرج': 'Critical', 'مرتفع': 'High', 'متوسط': 'Medium', 'منخفض': 'Low',
};

export function extractRisks(blocks: readonly DocxBlock[]): Risk[] {
  const risks: Risk[] = [];
  for (const block of blocks) {
    if (block.kind !== 'table') continue;
    for (const row of block.rows) {
      if (row.length !== 3) continue;
      const id = row[0]!.trim();
      if (!RISK_ID.test(id)) continue;

      const en = EN_CELL.exec(row[1]!.trim());
      const ar = AR_CELL.exec(row[2]!.trim());
      if (!en || !ar) {
        throw new Error(
          `${id} does not have the expected severity/title/mitigation shape. ` +
          'The PRD risk table has changed; fix the extractor rather than the register.',
        );
      }

      const severity = en[1] as Severity;
      // The two languages state the severity independently, so a disagreement is
      // a fault in the source that silently picking one would hide.
      const arSeverity = AR_SEVERITY[ar[1]!];
      if (arSeverity !== severity) {
        throw new Error(`${id} is ${severity} in English and ${arSeverity ?? ar[1]} in Arabic.`);
      }

      risks.push({
        id,
        severity,
        title_en: en[2]!.trim(),
        mitigation_en: en[3]!.trim(),
        title_ar: ar[2]!.trim(),
        mitigation_ar: ar[3]!.trim(),
      });
    }
  }
  return risks;
}
