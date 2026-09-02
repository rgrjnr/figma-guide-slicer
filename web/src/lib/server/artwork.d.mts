/** Types for artwork.mjs — JavaScript so `node --test` needs no compile step. */

export declare const MAX_ARTWORK_BYTES: number;
export declare function artworkFileFor(contentType: string | null | undefined): string | null;
export declare function artworkContentType(fileName: string | null | undefined): string | null;
