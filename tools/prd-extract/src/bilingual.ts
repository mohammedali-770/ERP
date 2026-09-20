/**
 * Splits a PRD cell that carries English and Arabic text concatenated together.
 *
 * Every requirement in the source PRD is written as "<English sentence(s)> <Arabic
 * sentence(s)>" inside one table cell. We split at the FIRST Arabic-script
 * character rather than the last Latin one, because Arabic sentences routinely
 * embed Latin tokens — "استبدال Lazywait بالكامل", "دعم Apple Pay" — and splitting
 * from the right would cut them in half.
 */

// Arabic, Arabic Supplement, Arabic Extended-A, Arabic Presentation Forms A/B.
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export interface Bilingual {
  en: string;
  ar: string;
}

export function splitBilingual(cell: string): Bilingual {
  const text = cell.replace(/\s+/g, ' ').trim();
  const idx = text.search(ARABIC_SCRIPT);
  if (idx < 0) return { en: text, ar: '' };
  if (idx === 0) return { en: '', ar: text };
  return { en: text.slice(0, idx).trim(), ar: text.slice(idx).trim() };
}

export function hasArabic(s: string): boolean {
  return ARABIC_SCRIPT.test(s);
}
