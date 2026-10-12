// Port of unicode-normalization =0.1.25 `src/normalize.rs` (its `#[cfg(test)] mod tests` is in
// normalize.test.ts).
//
// Copyright 2012-2015 The Rust Project Developers. See the COPYRIGHT
// file at the top-level directory of this distribution and at
// http://rust-lang.org/COPYRIGHT.
//
// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.

//! Functions for computing canonical and compatible decompositions for Unicode characters.
import {
  canonical_fully_decomposed,
  cjk_compat_variants_fully_decomposed,
  compatibility_fully_decomposed,
  composition_table,
} from "./lookups.ts";

/// Compute canonical Unicode decomposition for character.
/// See [Unicode Standard Annex #15](http://www.unicode.org/reports/tr15/)
/// for more information.
// crate: unicode-normalization-0.1.25/src/normalize.rs:23 decompose_canonical
export function decompose_canonical(c: number, emit_char: (c: number) => void): void {
  decompose(c, canonical_fully_decomposed, emit_char);
}

/// Compute canonical or compatible Unicode decomposition for character.
/// See [Unicode Standard Annex #15](http://www.unicode.org/reports/tr15/)
/// for more information.
// crate: unicode-normalization-0.1.25/src/normalize.rs:34 decompose_compatible
export function decompose_compatible(c: number, emit_char: (c: number) => void): void {
  const decompose_char = (c: number) => compatibility_fully_decomposed(c) ?? canonical_fully_decomposed(c);
  decompose(c, decompose_char, emit_char);
}

/// Compute standard-variation decomposition for character.
///
/// [Standardized Variation Sequences] are used instead of the standard canonical
/// decompositions, notably for CJK codepoints with singleton canonical decompositions,
/// to avoid losing information. See the [Unicode Variation Sequence FAQ] and the
/// "Other Enhancements" section of the [Unicode 6.3 Release Summary] for more information.
///
/// [Standardized Variation Sequences]: https://www.unicode.org/glossary/#standardized_variation_sequence
/// [Unicode Variation Sequence FAQ]: http://unicode.org/faq/vs.html
/// [Unicode 6.3 Release Summary]: https://www.unicode.org/versions/Unicode6.3.0/#Summary
// crate: unicode-normalization-0.1.25/src/normalize.rs:51 decompose_cjk_compat_variants
export function decompose_cjk_compat_variants(c: number, emit_char: (c: number) => void): void {
  // 7-bit ASCII never decomposes
  if (c <= 0x7f) {
    emit_char(c);
    return;
  }

  // Don't perform decomposition for Hangul

  const decomposed = cjk_compat_variants_fully_decomposed(c);
  if (decomposed !== undefined) {
    for (const d of decomposed) {
      emit_char(d);
    }
    return;
  }

  // Finally bottom out.
  emit_char(c);
}

// crate: unicode-normalization-0.1.25/src/normalize.rs:76 decompose
function decompose(c: number, decompose_char: (c: number) => Uint32Array | undefined, emit_char: (c: number) => void): void {
  // 7-bit ASCII never decomposes
  if (c <= 0x7f) {
    emit_char(c);
    return;
  }

  // Perform decomposition for Hangul
  if (is_hangul_syllable(c)) {
    // Safety: Hangul Syllables invariant checked by is_hangul_syllable above
    decompose_hangul(c, emit_char);
    return;
  }

  const decomposed = decompose_char(c);
  if (decomposed !== undefined) {
    for (const d of decomposed) {
      emit_char(d);
    }
    return;
  }

  // Finally bottom out.
  emit_char(c);
}

/// Compose two characters into a single character, if possible.
/// See [Unicode Standard Annex #15](http://www.unicode.org/reports/tr15/)
/// for more information.
// crate: unicode-normalization-0.1.25/src/normalize.rs:110 compose
export function compose(a: number, b: number): number | undefined {
  return compose_hangul(a, b) ?? composition_table(a, b);
}

// Constants from Unicode 9.0.0 Section 3.12 Conjoining Jamo Behavior
// http://www.unicode.org/versions/Unicode9.0.0/ch03.pdf#M9.32468.Heading.310.Combining.Jamo.Behavior
const S_BASE = 0xac00;
const L_BASE = 0x1100;
const V_BASE = 0x1161;
const T_BASE = 0x11a7;
const L_COUNT = 19;
const V_COUNT = 21;
const T_COUNT = 28;
const N_COUNT = V_COUNT * T_COUNT;
const S_COUNT = L_COUNT * N_COUNT;

const S_LAST = S_BASE + S_COUNT - 1;
const L_LAST = L_BASE + L_COUNT - 1;
const V_LAST = V_BASE + V_COUNT - 1;
const T_LAST = T_BASE + T_COUNT - 1;

// Composition only occurs for `TPart`s in `U+11A8 ..= U+11C2`,
// i.e. `T_BASE + 1 ..= T_LAST`.
const T_FIRST = T_BASE + 1;

// Safety-usable invariant: This ensures that c is a valid Hangul Syllable character (U+AC00..U+D7AF)
// crate: unicode-normalization-0.1.25/src/normalize.rs:136 is_hangul_syllable
export function is_hangul_syllable(c: number): boolean {
  // Safety: This checks the range 0xAC00 (S_BASE) to 0xD7A4 (S_BASE + S_COUNT), upholding the safety-usable invariant
  return c >= S_BASE && c < S_BASE + S_COUNT;
}

// Decompose a precomposed Hangul syllable
// Safety: `s` MUST be a valid Hangul Syllable character, between U+AC00..U+D7AF
// crate: unicode-normalization-0.1.25/src/normalize.rs:145 decompose_hangul
function decompose_hangul(s: number, emit_char: (c: number) => void): void {
  // This will be at most 0x2baf, the size of the Hangul Syllables block
  const s_index = s - S_BASE;
  // This will be at most 0x2baf / (21 * 28), 19
  const l_index = Math.floor(s_index / N_COUNT);
  {
    // Safety: L_BASE (0x1100) plus at most 19 is still going to be in range for a valid Unicode code point in the BMP (< 0xD800)
    emit_char(L_BASE + l_index);

    // Safety: This will be at most (N_COUNT - 1) / T_COUNT = (V*T - 1) / T, which gives us an upper bound of V_COUNT = 21
    const v_index = Math.floor((s_index % N_COUNT) / T_COUNT);
    // Safety: V_BASE (0x1161) plus at most 21 is still going to be in range for a valid Unicode code point in the BMP (< 0xD800)
    emit_char(V_BASE + v_index);

    // Safety: This will be at most T_COUNT - 1 (27)
    const t_index = s_index % T_COUNT;
    if (t_index > 0) {
      // Safety: T_BASE (0x11A7) plus at most 27 is still going to be in range for a valid Unicode code point in the BMP (< 0xD800)
      emit_char(T_BASE + t_index);
    }
  }
}

// crate: unicode-normalization-0.1.25/src/normalize.rs:172 hangul_decomposition_length
export function hangul_decomposition_length(s: number): number {
  const si = s - S_BASE;
  const ti = si % T_COUNT;
  if (ti > 0) {
    return 3;
  } else {
    return 2;
  }
}

// Compose a pair of Hangul Jamo
// crate: unicode-normalization-0.1.25/src/normalize.rs:186 compose_hangul
export function compose_hangul(a: number, b: number): number | undefined {
  // Compose a leading consonant and a vowel together into an LV_Syllable
  if (a >= L_BASE && a <= L_LAST && b >= V_BASE && b <= V_LAST) {
    // Safety: based on the above bounds, l_index will be less than or equal to L_COUNT (19)
    // and v_index will be <= V_COUNT (21)
    const l_index = a - L_BASE;
    const v_index = b - V_BASE;
    // Safety: This will be <= 19 * (20 * 21) + (21 * 20), which is 8400.
    const lv_index = l_index * N_COUNT + v_index * T_COUNT;
    // Safety: This is between 0xAC00 and 0xCCD0, which are in range for Hangul Syllables (U+AC00..U+D7AF) and also in range
    // for BMP unicode
    const s = S_BASE + lv_index;
    // Safety: We've verified this is in-range
    return s;
  }
  // Compose an LV_Syllable and a trailing consonant into an LVT_Syllable
  if (a >= S_BASE && a <= S_LAST && b >= T_FIRST && b <= T_LAST && (a - S_BASE) % T_COUNT === 0) {
    // Safety: a is between 0xAC00 and (0xAC00 + 19 * 21 * 28). b - T_BASE is between 0 and 19.
    // Adding a number 0 to 19 to a number that is at largest 0xD7A4 will not go out of bounds to 0xD800 (where the
    // surrogates start), so this is safe.
    return a + (b - T_BASE);
  }
  return undefined;
}
