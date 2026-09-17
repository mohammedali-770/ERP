/**
 * Splits a PRD cell that carries English and Arabic text concatenated together.
 *
 * Every requirement in the source PRD is written as "<English sentence(s)> <Arabic
 * sentence(s)>" inside one table cell. We split at the FIRST Arabic-script
 * character rather than the last Latin one, because Arabic sentences routinely
 * embed Latin tokens — "استبدال Lazywait بالكامل", "دعم Apple Pay" — and splitting
 * from the right would cut them in half.
 */
export interface Bilingual {
    en: string;
    ar: string;
}
export declare function splitBilingual(cell: string): Bilingual;
export declare function hasArabic(s: string): boolean;
//# sourceMappingURL=bilingual.d.ts.map