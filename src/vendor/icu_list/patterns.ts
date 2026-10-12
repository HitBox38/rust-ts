// Port of icu_list 2.3.0 `src/patterns.rs` (the `datagen`-only constructors are not ported).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { panic } from "../../std/panic.ts";
import { utf8 } from "../../std/str.ts";
import { LengthHint, type Writeable } from "../writeable/lib.ts";
import { add, bitor_assign, mul } from "../writeable/ops.ts";
import { writeable_str } from "../writeable/impls.ts";
import { matches_earliest_fwd_lazy } from "./lazy_automaton.ts";
import { ConditionalListJoinerPattern, ListFormatterPatterns, ListJoinerPattern } from "./provider/mod.ts";

// impl ListFormatterPatterns<'_>
// crate-skip: icu_list-2.3.0/src/patterns.rs:18 try_new feature "datagen" off

/// The range of the number of bytes required by the list literals to join a
/// list of length `len`. If none of the patterns are conditional, this is exact.
// crate: icu_list-2.3.0/src/patterns.rs:44 length_hint
export function ListFormatterPatterns_length_hint(self: ListFormatterPatterns, len: number): LengthHint {
  switch (len) {
    case 0:
    case 1:
      return LengthHint.exact(0);
    case 2:
      return ConditionalListJoinerPattern_size_hint(self.pair ?? self.end);
    default: {
      const n = len;
      return add(
        add(ListJoinerPattern_size_hint(self.start), mul(writeable_str(self.middle).writeable_length_hint(), n - 3)),
        ConditionalListJoinerPattern_size_hint(self.end),
      );
    }
  }
}

type PatternParts = [string, string, string];

// impl<'a> ConditionalListJoinerPattern<'a>
// crate: icu_list-2.3.0/src/patterns.rs:60 parts
export function ConditionalListJoinerPattern_parts(self: ConditionalListJoinerPattern, following_value: Writeable): PatternParts {
  const sc = self.special_case;
  if (sc !== undefined && matches_earliest_fwd_lazy(sc.condition.deref(), following_value)) {
    return ListJoinerPattern_parts(sc.pattern);
  }
  return ListJoinerPattern_parts(self.default);
}

/// The expected length of this pattern
// crate: icu_list-2.3.0/src/patterns.rs:75 size_hint
export function ConditionalListJoinerPattern_size_hint(self: ConditionalListJoinerPattern): LengthHint {
  let hint = ListJoinerPattern_size_hint(self.default);
  if (self.special_case !== undefined) {
    hint = bitor_assign(hint, ListJoinerPattern_size_hint(self.special_case.pattern));
  }
  return hint;
}

// impl<'data> ListJoinerPattern<'data>
// crate-skip: icu_list-2.3.0/src/patterns.rs:87 try_from_str feature "datagen" off

// crate: icu_list-2.3.0/src/patterns.rs:125 parts
export function ListJoinerPattern_parts(self: ListJoinerPattern): PatternParts {
  // #![allow(clippy::indexing_slicing)] // by invariant
  const index_0 = self.index_0;
  const index_1 = self.index_1;
  return [str_slice(self.string, 0, index_0), str_slice(self.string, index_0, index_1), str_slice(self.string, index_1, undefined)];
}

// crate: icu_list-2.3.0/src/patterns.rs:136 size_hint
export function ListJoinerPattern_size_hint(self: ListJoinerPattern): LengthHint {
  return LengthHint.exact(utf8(self.string).length);
}

// crate-skip: icu_list-2.3.0/src/patterns.rs:143 from feature "datagen" off

/** `&s[a..b]` with UTF-8 byte offsets (panics like Rust if not on char boundaries). */
function str_slice(s: string, a: number, b: number | undefined): string {
  const bytes = utf8(s);
  const end = b ?? bytes.length;
  const is_boundary = (i: number) => i === 0 || i === bytes.length || (i < bytes.length && (bytes[i]! & 0xc0) !== 0x80);
  if (a > end || end > bytes.length || !is_boundary(a) || !is_boundary(end)) {
    return panic(`byte index ${a}..${end} is out of bounds or not a char boundary of ${JSON.stringify(s)}`);
  }
  return new TextDecoder().decode(bytes.subarray(a, end));
}

// #[cfg(all(test, feature = "datagen"))] pub mod test: needs `try_new` / `SerdeDFA::new` (datagen).
// crate-skip: icu_list-2.3.0/src/patterns.rs:156 test_patterns_general #[cfg(all(test, feature = "datagen"))]
// crate-skip: icu_list-2.3.0/src/patterns.rs:160 test_patterns_lengths #[cfg(all(test, feature = "datagen"))]
// crate-skip: icu_list-2.3.0/src/patterns.rs:164 test_patterns_conditional #[cfg(all(test, feature = "datagen"))]
// crate-skip: icu_list-2.3.0/src/patterns.rs:175 rejects_bad_patterns #[cfg(all(test, feature = "datagen"))]
// crate-skip: icu_list-2.3.0/src/patterns.rs:190 produces_correct_parts #[cfg(all(test, feature = "datagen"))]
// crate-skip: icu_list-2.3.0/src/patterns.rs:198 produces_correct_parts_conditionally #[cfg(all(test, feature = "datagen"))]
// crate-skip: icu_list-2.3.0/src/patterns.rs:209 size_hint_works #[cfg(all(test, feature = "datagen"))]
