export type Protocol = 'globalThis' | 'localStorage' | 'sessionStorage' | 'indexedDB' | 'cookie' | 'locationHash';

export interface ParsedUSL {
    protocol: Protocol;
    usp: string;
    uspParts: string[];
    accessorChain: string | undefined;
}

const cache = new Map<string, ParsedUSL>();

/**
 * Splits a string on the first occurrence of a separator.
 * Returns [str, undefined] if the separator is not found.
 */
function splitOnce(str: string, sep: string): [string, string | undefined] {
    const idx = str.indexOf(sep);
    if (idx === -1) return [str, undefined];
    return [str.substring(0, idx), str.substring(idx + sep.length)];
}

/**
 * Parses a Uniform Source Locator (USL) string into its components.
 * Results are cached for repeated lookups.
 */
export function parse(usl: string): ParsedUSL {
    const cached = cache.get(usl);
    if (cached !== undefined) return cached;

    const [protocol, rest] = splitOnce(usl, '://');
    const [pathPortion, accessorChain] = splitOnce(rest!, '?.');
    const uspParts = pathPortion.split('/');
    const usp = `${protocol}://${pathPortion}`;

    const parsed: ParsedUSL = {
        protocol: protocol as Protocol,
        usp,
        uspParts,
        accessorChain,
    };

    cache.set(usl, parsed);
    return parsed;
}
