export type Phase = 'F0' | 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'Future';
export type Priority = 'P0' | 'P1' | 'P2';
export interface Requirement {
    id: string;
    module: string;
    text_en: string;
    text_ar: string;
    phase: Phase;
    priority: Priority;
    prd_section: string;
}
export interface ExtractResult {
    requirements: Requirement[];
    sourceSha256: string;
}
export declare function extractFromDocx(docxPath: string): ExtractResult;
//# sourceMappingURL=extract.d.ts.map