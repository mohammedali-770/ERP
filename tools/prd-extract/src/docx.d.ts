/** Reads one named entry out of a ZIP archive. */
export declare function readZipEntry(zip: Buffer, wantedName: string): Buffer;
export declare function decodeXmlText(s: string): string;
/** Concatenates every `<w:t>` run inside a fragment, which is how Word stores split text. */
export declare function textOf(fragment: string): string;
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
export declare function parseDocxBlocks(documentXml: string): DocxBlock[];
//# sourceMappingURL=docx.d.ts.map