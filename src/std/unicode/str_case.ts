// alloc `str::to_lowercase` / `str::to_uppercase` (library/alloc/src/str.rs) for `string` values.
// PORT: these belong next to the other `str_*` helpers in src/std/str.ts (not owned by the std-unicode
// lane); they live here until root moves them. Indices are UTF-16 code unit offsets into the JS string
// instead of UTF-8 byte offsets; `map_uppercase_sigma` only slices at char boundaries, so the result is
// the same.
import { is_case_ignorable, is_cased } from "../char.ts";
import * as conversions from "./conversions.ts";

const C_SIGMA = 0x3a3; // 'Σ'

/** Code points of `s` (`str::chars`). */
function chars(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) out.push(ch.codePointAt(0)!);
  return out;
}

/// Helper for final sigma lowercase
// std: library/alloc/src/str.rs:223 map_uppercase_sigma
function map_uppercase_sigma(from: string, i: number): number {
  function case_ignorable_then_cased(iter: number[]): boolean {
    const c = iter.find((c) => !is_case_ignorable(c));
    if (c !== undefined) {
      return is_cased(c);
    } else {
      return false;
    }
  }

  // See https://www.unicode.org/versions/latest/core-spec/chapter-3/#G54277
  // for the definition of `Final_Sigma`.
  // PORT: `'Σ'.len_utf8()` is 2 bytes but one UTF-16 code unit; `from` is indexed in code units.
  const is_word_final =
    case_ignorable_then_cased(chars(from.slice(0, i)).reverse()) && !case_ignorable_then_cased(chars(from.slice(i + 1)));
  return is_word_final ? 0x3c2 /* 'ς' */ : 0x3c3 /* 'σ' */;
}

function push_mapping(out: string[], m: conversions.CaseMapping): void {
  // [a, '\0', _] => s.push(a), [a, b, '\0'] => push a, b, [a, b, c] => push a, b, c
  if (m[1] === 0) {
    out.push(String.fromCodePoint(m[0]));
  } else if (m[2] === 0) {
    out.push(String.fromCodePoint(m[0], m[1]));
  } else {
    out.push(String.fromCodePoint(m[0], m[1], m[2]));
  }
}

/// Returns the lowercase equivalent of this string slice, as a new [`String`].
// std: library/alloc/src/str.rs:457 to_lowercase
export function str_to_lowercase(self: string): string {
  // PORT: `convert_while_ascii(self, u8::to_ascii_lowercase)` is a vectorised fast path over the
  // ASCII prefix; ASCII chars map through `conversions::to_lower` to the same result, so every char
  // goes through the loop below.
  const s: string[] = [];
  let i = 0;
  for (const ch of self) {
    const c = ch.codePointAt(0)!;
    if (c === C_SIGMA) {
      // Σ maps to σ, except at the end of a word where it maps to ς.
      // This is the only conditional (contextual) but language-independent mapping
      // in `SpecialCasing.txt`,
      // so hard-code it rather than have a generic "condition" mechanism.
      // See https://github.com/rust-lang/rust/issues/26035
      const sigma_lowercase = map_uppercase_sigma(self, i);
      s.push(String.fromCodePoint(sigma_lowercase));
    } else {
      push_mapping(s, conversions.to_lower(c));
    }
    i += ch.length;
  }
  return s.join("");
}

/// Returns the uppercase equivalent of this string slice, as a new [`String`].
// std: library/alloc/src/str.rs:672 to_uppercase
export function str_to_uppercase(self: string): string {
  // PORT: the `convert_while_ascii` fast path is folded into the loop, as in `str_to_lowercase`.
  const s: string[] = [];
  for (const ch of self) {
    push_mapping(s, conversions.to_upper(ch.codePointAt(0)!));
  }
  return s.join("");
}
