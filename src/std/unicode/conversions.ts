// core::unicode::conversions (library/core/src/unicode/unicode_data.rs, `pub mod conversions`).
// PORT: upstream's generated 2-level LUT (`L1Lut`/`L2Lut`, `lookup`) is replaced by the flat mapping
// tables TO_LOWER/TO_UPPER that tools/gen-unicode.ts generates from the oracle's `char::to_lowercase`/
// `char::to_uppercase`; `lookup` keeps its contract (`Some([char; 3])` with '\0' padding, or `None`).
import { mapping_index } from "./mod.ts";
import { TO_LOWER, TO_UPPER } from "./tables.ts";

/** `[char; 3]`: the mapped chars, padded with '\0' (0). */
export type CaseMapping = [number, number, number];

// std: library/core/src/unicode/unicode_data.rs:1014 lookup
function lookup(input: number, table: Uint32Array): CaseMapping | undefined {
  const i = mapping_index(table, input);
  if (i < 0) return undefined;
  return [table[i + 1]!, table[i + 2]!, table[i + 3]!];
}

/** `char::to_ascii_lowercase` */
function to_ascii_lowercase(c: number): number {
  return c >= 0x41 && c <= 0x5a ? c + 0x20 : c;
}

/** `char::to_ascii_uppercase` */
function to_ascii_uppercase(c: number): number {
  return c >= 0x61 && c <= 0x7a ? c - 0x20 : c;
}

// std: library/core/src/unicode/unicode_data.rs:1061 to_lower
export function to_lower(c: number): CaseMapping {
  // https://util.unicode.org/UnicodeJsps/list-unicodeset.jsp?a=[:Changes_When_Lowercased:]-[:ASCII:]&abb=on
  if (c < 0xc0) {
    return [to_ascii_lowercase(c), 0, 0];
  }

  // The rest of Latin-1: À..=Þ (except ×) add 0x20, everything else maps to itself.
  if (c <= 0xff) {
    if (c >= 0xc0 && c <= 0xde && c !== 0xd7) {
      // SAFETY: U+00C0..=U+00DE plus 0x20 lands in U+00E0..=U+00FE.
      return [c + 0x20, 0, 0];
    }
    return [c, 0, 0];
  }

  return lookup(c, TO_LOWER) ?? [c, 0, 0];
}

// std: library/core/src/unicode/unicode_data.rs:1081 to_upper
export function to_upper(c: number): CaseMapping {
  // https://util.unicode.org/UnicodeJsps/list-unicodeset.jsp?a=[:Changes_When_Uppercased:]-[:ASCII:]&abb=on
  if (c < 0xb5) {
    return [to_ascii_uppercase(c), 0, 0];
  }
  // The rest of Latin-1: µ maps to U+039C, ß expands to SS,
  // à..=þ (except ÷) subtract 0x20, ÿ maps to U+0178.
  if (c <= 0xff) {
    if (c === 0xb5) return [0x39c, 0, 0];
    if (c === 0xdf) return [0x53 /* 'S' */, 0x53 /* 'S' */, 0];
    if (c >= 0xe0 && c <= 0xfe && c !== 0xf7) {
      // SAFETY: U+00E0..=U+00FE minus 0x20 lands in U+00C0..=U+00DE.
      return [c - 0x20, 0, 0];
    }
    if (c === 0xff) return [0x178, 0, 0];
    return [c, 0, 0];
  }

  return lookup(c, TO_UPPER) ?? [c, 0, 0];
}
